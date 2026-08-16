import { z } from "@hono/zod-openapi";

import {
  SEARCH_RESULT_LIMIT,
  SEARCH_RESULT_TYPES,
  type SearchCandidate,
  type SearchResult,
} from "../api/search";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { authHasRole } from "../lib/auth/scope-resolution";
import { requireSubmissionRead } from "../lib/auth/program-access";
import { rankSearchCandidates } from "../lib/quick-search";
import { SPEAKER_ROSTER_PERSON_SOURCE } from "./speakers.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const searchQuery = z.object({ q: z.string().trim().max(200).optional() });
const resultType = z.enum(SEARCH_RESULT_TYPES);
const searchResult = z.object({
  type: resultType,
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  href: z.string(),
}).openapi("SearchResult");
const searchResponse = z.object({ data: z.array(searchResult).max(SEARCH_RESULT_LIMIT) }).openapi("SearchResponse");

interface SubmissionSearchRow {
  id: string;
  reference_code: string | null;
  kind: "abstract" | "session";
  title: string;
  abstract: string | null;
  search_blob: string;
}

interface SpeakerSearchRow {
  id: string;
  on_roster: 0 | 1;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
}

interface FormSearchRow {
  id: string;
  name: string;
  slug: string;
  kind: "abstract" | "session";
  status: "draft" | "open" | "closed";
}

function resultTypeFor(kind: "abstract" | "session"): SearchResult["type"] {
  return kind === "abstract" ? "Abstract" : "Session";
}

const SEARCH_CACHE_TTL_MS = 5_000;
const SEARCH_CACHE_MAX_ENTRIES = 32;
// The short-lived snapshot amortizes the candidate scans across one typeahead burst.
const searchCandidateCache = new Map<string, {
  expiresAt: number;
  candidates?: SearchCandidate[];
  promise: Promise<SearchCandidate[]>;
}>();

function eventScope(authPersonId: string | null): { clause: string; bindings: string[] } {
  if (authPersonId === null) return { clause: "", bindings: [] };
  return {
    clause: " AND EXISTS (SELECT 1 FROM form_admins scoped_admin WHERE scoped_admin.form_id = s.form_id AND scoped_admin.person_id = ?)",
    bindings: [authPersonId],
  };
}

function formScope(authPersonId: string | null): { clause: string; bindings: string[] } {
  if (authPersonId === null) return { clause: "", bindings: [] };
  return {
    clause: " AND EXISTS (SELECT 1 FROM form_admins scoped_admin WHERE scoped_admin.form_id = f.id AND scoped_admin.person_id = ?)",
    bindings: [authPersonId],
  };
}

async function querySearchCandidates(database: D1Database, eventId: string, scopedPersonId: string | null): Promise<SearchCandidate[]> {
  const submissionsScope = eventScope(scopedPersonId);
  const formsScope = formScope(scopedPersonId);
  const [submissions, speakers, forms] = await Promise.all([
    database.prepare(
      `SELECT s.id, s.reference_code, s.kind, s.title, s.abstract, s.search_blob
       FROM submissions s
       WHERE s.event_id = ?${submissionsScope.clause}
       ORDER BY s.title COLLATE NOCASE ASC, s.id ASC`,
    ).bind(eventId, ...submissionsScope.bindings).all<SubmissionSearchRow>(),
    database.prepare(
      `SELECT id, name, email, title, company,
              CASE WHEN id IN (${SPEAKER_ROSTER_PERSON_SOURCE}) THEN 1 ELSE 0 END AS on_roster
       FROM (
         SELECT p.id, p.name, p.email, p.title, p.company
         FROM participations participation
         JOIN submissions s ON s.id = participation.submission_id
         JOIN people p ON p.id = participation.person_id
         WHERE s.event_id = ?${submissionsScope.clause}
         UNION
         SELECT p.id, p.name, p.email, p.title, p.company
         FROM submissions s
         JOIN people p ON p.id = s.submitter_person_id
         WHERE s.event_id = ?${submissionsScope.clause}
       )
       ORDER BY name COLLATE NOCASE ASC, id ASC`,
    ).bind(eventId, eventId, eventId, ...submissionsScope.bindings, eventId, ...submissionsScope.bindings).all<SpeakerSearchRow>(),
    database.prepare(
      `SELECT f.id, f.name, f.slug, f.kind, f.status
       FROM forms f
       WHERE f.event_id = ?${formsScope.clause}
       ORDER BY f.name COLLATE NOCASE ASC, f.id ASC`,
    ).bind(eventId, ...formsScope.bindings).all<FormSearchRow>(),
  ]);

  const people = new Map<string, SpeakerSearchRow>();
  for (const person of speakers.results) people.set(person.id, person);

  return [
    ...submissions.results.map((row) => {
      const type = resultTypeFor(row.kind);
      return {
        type,
        id: row.id,
        title: row.title,
        subtitle: `${row.reference_code ?? row.id} · ${type}`,
        href: `/submissions/${encodeURIComponent(row.id)}`,
        searchText: [row.title, row.reference_code ?? "", row.id, row.search_blob, row.abstract ?? ""],
      } satisfies SearchCandidate;
    }),
    ...[...people.values()].map((row) => ({
      type: "Speaker" as const,
      id: row.id,
      title: row.name,
      subtitle: [row.title, row.company].filter(Boolean).join(" · ") || "Conference person",
      // MRQ-127 widened these candidates to submitters so its person picker can
      // find them; MRQ-111 added a speaker record they have no row on. So the
      // destination follows the person: someone on the roster opens their
      // record, and anyone else keeps the chase-board link they had before.
      // Sending a non-roster person to the roster would 404 in the drawer.
      href: row.on_roster === 1
        ? `/roster?person=${encodeURIComponent(row.id)}`
        : `/onboarding?person=${encodeURIComponent(row.id)}`,
      searchText: [row.name, row.email, row.title ?? "", row.company ?? "", row.id],
    } satisfies SearchCandidate)),
    ...forms.results.map((row) => ({
      type: "Form" as const,
      id: row.id,
      title: row.name,
      subtitle: `${row.kind === "abstract" ? "Abstract" : "Session"} · ${row.status}`,
      href: `/forms?form=${encodeURIComponent(row.id)}`,
      searchText: [row.name, row.slug, row.id],
    } satisfies SearchCandidate)),
  ];
}

async function cachedSearchCandidates(
  database: D1Database,
  eventId: string,
  scopedPersonId: string | null,
  allowStart: boolean,
): Promise<SearchCandidate[]> {
  // Authorization runs before this helper. Never cache a form-admin snapshot:
  // form assignment changes must take effect immediately for scoped sessions.
  if (scopedPersonId !== null) return querySearchCandidates(database, eventId, scopedPersonId);
  // The unscoped event snapshot is safe to share across short dialog bursts and
  // avoids restarting a full candidate scan for every reopen in the speed flow.
  const key = JSON.stringify([eventId, scopedPersonId]);
  const now = Date.now();
  const existing = searchCandidateCache.get(key);
  if (existing && (existing.candidates === undefined || existing.expiresAt > now)) return existing.promise;
  if (existing) searchCandidateCache.delete(key);
  if (!allowStart) return querySearchCandidates(database, eventId, scopedPersonId);
  for (const [entryKey, entry] of searchCandidateCache) {
    if (entry.expiresAt <= now) searchCandidateCache.delete(entryKey);
  }
  while (searchCandidateCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchCandidateCache.keys().next().value;
    if (oldestKey === undefined) break;
    searchCandidateCache.delete(oldestKey);
  }

  const entry: { expiresAt: number; candidates?: SearchCandidate[]; promise: Promise<SearchCandidate[]> } = {
    expiresAt: Number.POSITIVE_INFINITY,
    promise: Promise.resolve([]),
  };
  entry.promise = querySearchCandidates(database, eventId, scopedPersonId).then(
    (candidates) => {
      if (searchCandidateCache.get(key) === entry) {
        entry.candidates = candidates;
        entry.expiresAt = Date.now() + SEARCH_CACHE_TTL_MS;
      }
      return candidates;
    },
    (error: unknown) => {
      if (searchCandidateCache.get(key) === entry) searchCandidateCache.delete(key);
      throw error;
    },
  );
  searchCandidateCache.set(key, entry);
  return entry.promise;
}

const searchEvent = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/search",
    operationId: "searchEvent",
    summary: "Search conference program records",
    description: "Search event-scoped Abstracts, Sessions, Speakers, and Forms for the admin shell.",
    tags: ["Search"],
    request: { params: eventParams, query: searchQuery },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(searchResponse, "Search results"),
      ...errorResponses([400, 401, 403, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const { q = "" } = context.req.valid("query");
    const auth = await requireSubmissionRead(context, eventId);
    const scopedPersonId = auth.kind === "session" && !authHasRole(auth, "ops", eventId) ? auth.personId : null;
    const searchSession = context.req.header("x-search-session")?.trim().slice(0, 128) ?? "";
    const prefetch = context.req.header("x-search-prefetch") === "1";
    if (!q && !prefetch) return context.json({ data: [] }, 200);
    const candidates = searchSession && (prefetch || q)
      ? await cachedSearchCandidates(context.env.DB, eventId, scopedPersonId, prefetch)
      : await querySearchCandidates(context.env.DB, eventId, scopedPersonId);
    if (!q) return context.json({ data: [] }, 200);
    return context.json({ data: rankSearchCandidates(candidates, q, SEARCH_RESULT_LIMIT) }, 200);
  },
);

export const apiRoutes = [searchEvent];
