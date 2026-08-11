import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { apiManifest } from "../../../src/routes/_manifest";
import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZATION_ID = DEMO_ORGANIZATION_ID;
const REVIEWER_ID = "per_blind_audit_reviewer";
const REVIEWER_SESSION_ID = "sess_blind_audit_reviewer";
const FORM_ID = "form_blind_audit";
const FIELD_ID = "field_blind_audit_outcome";
const FORMAT_ID = "format_blind_audit_workshop";
const TRACK_ID = "track_blind_audit";
const OUT_OF_SCOPE_TRACK_ID = "track_blind_audit_other";
const PLAN_ID = "plan_blind_audit";
const SCORE_ROUND_ID = "round_blind_audit_scorecard";
const COMPARISON_ROUND_ID = "round_blind_audit_comparison";
const MAIN_SUBMISSION_ID = "submission_blind_audit_main";
const COMPARISON_SUBMISSION_IDS = [
  "submission_blind_audit_comparison_a",
  "submission_blind_audit_comparison_b",
  "submission_blind_audit_comparison_c",
] as const;
const OUT_OF_SCOPE_SUBMISSION_ID = "submission_blind_audit_out_of_scope";
const ALL_SUBMISSION_IDS = [
  MAIN_SUBMISSION_ID,
  ...COMPARISON_SUBMISSION_IDS,
  OUT_OF_SCOPE_SUBMISSION_ID,
] as const;
const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.now();
const LEGACY_BLIND_MODE_SENTINELS = ["Demo Organizer", "organizer@demo.marquee.example"] as const;

const identityPeople = [
  {
    id: "per_blind_audit_submitter",
    email: "blind.audit.submitter@example.com",
    name: "Blind Audit Submitter",
    title: "Private Submitter Title",
    company: "Blind Submitter Affiliation",
    bio: "Private submitter biography sentinel for the anonymity scan.",
    headshot: "headshot_blind_audit_submitter",
    r2Key: "people/blind-audit-submitter/headshot.png",
    social: "https://social.example/blind-audit-submitter",
  },
  {
    id: "per_blind_audit_speaker_alpha",
    email: "blind.audit.speaker.alpha@example.com",
    name: "Blind Audit Speaker Alpha",
    title: "Private Speaker Alpha Title",
    company: "Blind Speaker Alpha Organization",
    bio: "Private speaker alpha biography sentinel for the anonymity scan.",
    headshot: "headshot_blind_audit_speaker_alpha",
    r2Key: "people/blind-audit-speaker-alpha/headshot.png",
    social: "https://social.example/blind-audit-speaker-alpha",
  },
  {
    id: "per_blind_audit_speaker_beta",
    email: "blind.audit.speaker.beta@example.com",
    name: "Blind Audit Speaker Beta",
    title: "Private Speaker Beta Title",
    company: "Blind Speaker Beta Organization",
    bio: "Private speaker beta biography sentinel for the anonymity scan.",
    headshot: "headshot_blind_audit_speaker_beta",
    r2Key: "people/blind-audit-speaker-beta/headshot.png",
    social: "https://social.example/blind-audit-speaker-beta",
  },
] as const;

const REVIEWER_ROUTE_SIGNATURES = [
  "GET /api/v1/events/{eventId}/reviewer/queue getReviewerQueueContext",
  "GET /api/v1/events/{eventId}/rounds/{roundId}/comparisons/next getReviewerComparisonQueue",
  "GET /api/v1/events/{eventId}/rounds/{roundId}/export exportReviewerQueue",
  "GET /api/v1/events/{eventId}/rounds/{roundId}/queue getReviewerQueue",
  "GET /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId} getReviewerSubmission",
  "GET /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/files getReviewerSubmissionFiles",
  "POST /api/v1/events/{eventId}/rounds/{roundId}/comparisons writeReviewerComparison",
  "POST /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations writeReviewerEvaluation",
].sort();

type ReviewerRoute = (typeof apiManifest)[number];

interface IdentityPersonRow {
  bio: string | null;
  company: string | null;
  email: string;
  headshot_attachment_id: string | null;
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  social_links: string;
  title: string | null;
}

interface AttachmentRow {
  filename: string;
  id: string;
  r2_key: string;
}

function reviewerRoutes(): ReviewerRoute[] {
  return apiManifest.filter((entry) => {
    const tags = (entry.route as { tags?: readonly string[] }).tags ?? [];
    return tags.includes("Reviewer");
  });
}

function signature(entry: ReviewerRoute): string {
  return `${entry.method.toUpperCase()} ${entry.path} ${entry.operationId}`;
}

function pathFor(entry: ReviewerRoute, roundId = SCORE_ROUND_ID, submissionId = MAIN_SUBMISSION_ID): string {
  return entry.path
    .replace("{eventId}", EVENT_ID)
    .replace("{roundId}", roundId)
    .replace("{submissionId}", submissionId);
}

async function request(path: string, init: RequestInit = {}, sessionId = REVIEWER_SESSION_ID): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${sessionId}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function bytesContain(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

async function seededIdentityStrings(): Promise<string[]> {
  const placeholders = ALL_SUBMISSION_IDS.map(() => "?").join(", ");
  const people = await env.DB.prepare(`
      SELECT DISTINCT person.id, person.email, person.name, person.title, person.company,
      person.bio, person.headshot_attachment_id, person.social_links,
      person.org_id, organization.name AS org_name
    FROM people person
    JOIN organizations organization ON organization.id = person.org_id
    WHERE person.id IN (
      SELECT submission.submitter_person_id
      FROM submissions submission
      WHERE submission.id IN (${placeholders})
      UNION
      SELECT participation.person_id
      FROM participations participation
      WHERE participation.submission_id IN (${placeholders})
    )
    ORDER BY person.id
  `).bind(...ALL_SUBMISSION_IDS, ...ALL_SUBMISSION_IDS).all<IdentityPersonRow>();
  const headshotIds = people.results
    .map((person) => person.headshot_attachment_id)
    .filter((id): id is string => id !== null);
  const attachments = headshotIds.length === 0
    ? { results: [] as AttachmentRow[] }
    : await env.DB.prepare(`
        SELECT id, r2_key, filename
        FROM attachments
        WHERE id IN (${headshotIds.map(() => "?").join(", ")})
      `).bind(...headshotIds).all<AttachmentRow>();
  const values = new Set<string>();
  for (const person of people.results) {
    for (const value of [
      person.id,
      person.email,
      person.name,
      person.title,
      person.company,
      person.bio,
      person.headshot_attachment_id,
      person.social_links,
      person.org_id,
      person.org_name,
    ]) {
      if (value) values.add(value);
    }
    try {
      const socialLinks = JSON.parse(person.social_links) as unknown;
      if (Array.isArray(socialLinks)) {
        for (const value of socialLinks) if (typeof value === "string") values.add(value);
      }
    } catch {
      // Keep the scan useful even if a legacy fixture has malformed JSON.
    }
  }
  for (const attachment of attachments.results) {
    for (const value of [attachment.id, attachment.r2_key, attachment.filename]) values.add(value);
  }
  for (const value of LEGACY_BLIND_MODE_SENTINELS) values.add(value);
  return [...values].sort();
}

async function scanResponse(
  response: Response,
  method: string,
  path: string,
  identityStrings: readonly string[],
): Promise<string> {
  const body = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(body);
  const headerBytes = new TextEncoder().encode(
    [...response.headers].map(([name, value]) => `${name}: ${value}`).join("\n"),
  );
  for (const value of identityStrings) {
    const needle = new TextEncoder().encode(value);
    if (bytesContain(body, needle) || bytesContain(headerBytes, needle)) {
      throw new Error(
        `reviewer identity leak: ${method} ${path} -> HTTP ${response.status} ${response.headers.get("content-type") ?? ""}; returned ${JSON.stringify(value)}`,
      );
    }
  }
  return text;
}

function submissionStatement(id: string, title: string, abstract: string, vendorAffiliation = "none") {
  return env.DB.prepare(`
    INSERT INTO submissions (
      id, event_id, form_id, format_id, kind, bypass_evaluation, title, abstract,
      status, origin, vendor_affiliation, submitter_person_id, submitted_at,
      last_saved_at, search_blob, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'abstract', 0, ?, ?, 'in_review', 'public', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    EVENT_ID,
    FORM_ID,
    FORMAT_ID,
    title,
    abstract,
    vendorAffiliation,
    identityPeople[0].id,
    NOW,
    NOW,
    title.toLowerCase(),
    NOW,
    NOW,
  );
}

function assignmentStatement(id: string, roundId: string, submissionId: string) {
  return env.DB.prepare(`
    INSERT INTO round_assignments
      (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 'assigned', ?, ?)
  `).bind(id, roundId, submissionId, REVIEWER_ID, NOW, NOW);
}

async function seedAuditFixture(): Promise<void> {
  await applyMigrations();
  for (const row of demoFixtureRows(NOW)) await env.DB.prepare(row.statement).bind(...row.bindings).run();

  const headshots = identityPeople.map((person) => env.DB.prepare(`
    INSERT INTO attachments (
      id, event_id, owner_type, owner_id, r2_key, filename, content_type,
      size_bytes, status, sha256, r2_etag, created_at, updated_at
    ) VALUES (?, ?, 'person_headshot', ?, ?, ?, 'image/png', 2048, 'ready', NULL, ?, ?, ?)
  `).bind(
    person.headshot,
    EVENT_ID,
    person.id,
    person.r2Key,
    `${person.id}.png`,
    `etag-${person.headshot}`,
    NOW,
    NOW,
  ));
  const people = identityPeople.map((person) => env.DB.prepare(`
    INSERT INTO people (
      id, org_id, email, name, title, company, bio, headshot_attachment_id,
      social_links, is_demo, last_write_source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'marquee', ?, ?)
  `).bind(
    person.id,
    ORGANIZATION_ID,
    person.email,
    person.name,
    person.title,
    person.company,
    person.bio,
    person.headshot,
    JSON.stringify([person.social]),
    NOW,
    NOW,
  ));
  const reviewer = env.DB.prepare(`
    INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
    VALUES (?, ?, 'blind.audit.reviewer@example.com', 'Blind Audit Reviewer', 'Reviewer', 'Review Committee', 'Reviewer identity is not an author identity.', NULL, '[]', 0, 'marquee', ?, ?)
  `).bind(REVIEWER_ID, ORGANIZATION_ID, NOW, NOW);
  const tracks = env.DB.prepare(`
    INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at)
    VALUES (?, ?, 'Blind Audit Track', '#0d9488', 0, ?, ?)
  `).bind(TRACK_ID, EVENT_ID, NOW, NOW);
  const outOfScopeTrack = env.DB.prepare(`
    INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at)
    VALUES (?, ?, 'Blind Audit Other Track', '#be185d', 1, ?, ?)
  `).bind(OUT_OF_SCOPE_TRACK_ID, EVENT_ID, NOW, NOW);
  const formats = env.DB.prepare(`
    INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at)
    VALUES (?, ?, 'Blind Audit Workshop', 60, 30, 120, 0, ?, ?)
  `).bind(FORMAT_ID, EVENT_ID, NOW, NOW);
  const form = env.DB.prepare(`
    INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at)
    VALUES (?, ?, 'Blind Audit Form', 'blind-audit-form', 'abstract', 'open', ?, ?)
  `).bind(FORM_ID, EVENT_ID, NOW, NOW);
  const field = env.DB.prepare(`
    INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at)
    VALUES (?, ?, 'audience_outcome', 'Audience outcome', 'long_text', 1, 0, '{}', ?, ?)
  `).bind(FIELD_ID, FORM_ID, NOW, NOW);
  const plan = env.DB.prepare(`
    INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at)
    VALUES (?, ?, 'Blind audit plan', 'Read each submission without author identity.', 1, 5, 'open', ?, ?)
  `).bind(PLAN_ID, EVENT_ID, NOW, NOW);
  const scoreRound = env.DB.prepare(`
    INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at)
    VALUES (?, ?, 0, 'Blind scorecard', 'scorecard', 1, 1, ?, ?)
  `).bind(SCORE_ROUND_ID, PLAN_ID, NOW, NOW);
  const comparisonRound = env.DB.prepare(`
    INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at)
    VALUES (?, ?, 1, 'Blind comparison', 'comparison', 1, 1, ?, ?)
  `).bind(COMPARISON_ROUND_ID, PLAN_ID, NOW, NOW);
  const criterion = env.DB.prepare(`
    INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at)
    VALUES ('criterion_blind_audit', ?, 'Fit', 100, 0, ?, ?)
  `).bind(SCORE_ROUND_ID, NOW, NOW);
  const membership = env.DB.prepare(`
    INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
    VALUES ('membership_blind_audit_reviewer', ?, ?, ?, 'reviewer', ?, ?)
  `).bind(ORGANIZATION_ID, EVENT_ID, REVIEWER_ID, NOW, NOW);
  const session = env.DB.prepare(`
    INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
    VALUES (?, ?, 'reviewer', ?, 'blind-audit', NULL, ?, ?)
  `).bind(REVIEWER_SESSION_ID, REVIEWER_ID, NOW + 86_400_000, NOW, NOW);
  const scope = env.DB.prepare(`
    INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at)
    VALUES ('scope_blind_audit', ?, ?, ?, ?, ?)
  `).bind(EVENT_ID, REVIEWER_ID, TRACK_ID, NOW, NOW);
  const submissions = [
    submissionStatement(MAIN_SUBMISSION_ID, "Blind review main submission", "A reviewer-visible abstract with no author identity.", "vendor_with_champion"),
    ...COMPARISON_SUBMISSION_IDS.map((id, index) => submissionStatement(id, `Blind comparison ${index + 1}`, "A reviewer-visible comparison abstract with no author identity.")),
    submissionStatement(OUT_OF_SCOPE_SUBMISSION_ID, "Out of scope blind submission", "This submission must not cross the reviewer track boundary."),
  ];
  const submissionTracks = ALL_SUBMISSION_IDS.map((submissionId, index) => env.DB.prepare(`
    INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).bind(
    `submission_track_blind_audit_${index}`,
    submissionId,
    submissionId === OUT_OF_SCOPE_SUBMISSION_ID ? OUT_OF_SCOPE_TRACK_ID : TRACK_ID,
    NOW,
    NOW,
  ));
  const participations = ALL_SUBMISSION_IDS.flatMap((submissionId, submissionIndex) => identityPeople.slice(1).map((person, speakerIndex) => env.DB.prepare(`
    INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `participation_blind_audit_${submissionIndex}_${speakerIndex}`,
    submissionId,
    person.id,
    speakerIndex === 0 ? "speaker" : "co_speaker",
    speakerIndex,
    NOW,
    NOW,
  )));
  const answers = env.DB.prepare(`
    INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
    VALUES ('answer_blind_audit', ?, ?, 'A durable reviewer outcome.', NULL, ?, ?)
  `).bind(MAIN_SUBMISSION_ID, FIELD_ID, NOW, NOW);
  const submissionFile = env.DB.prepare(`
    INSERT INTO attachments (
      id, event_id, owner_type, owner_id, r2_key, filename, content_type,
      size_bytes, status, sha256, r2_etag, created_at, updated_at
    ) VALUES ('file_blind_audit_submission', ?, 'submission_file', ?, 'submissions/blind-audit/reviewer-material.pdf', 'reviewer-material.pdf', 'application/pdf', 4096, 'ready', NULL, 'etag_blind_audit_submission', ?, ?)
  `).bind(EVENT_ID, MAIN_SUBMISSION_ID, NOW, NOW);
  const scoreAssignments = [MAIN_SUBMISSION_ID, OUT_OF_SCOPE_SUBMISSION_ID].map((submissionId, index) => assignmentStatement(`assignment_blind_audit_score_${index}`, SCORE_ROUND_ID, submissionId));
  const comparisonAssignments = COMPARISON_SUBMISSION_IDS.map((submissionId, index) => assignmentStatement(`assignment_blind_audit_comparison_${index}`, COMPARISON_ROUND_ID, submissionId));
  await env.DB.batch([
    ...headshots,
    ...people,
    reviewer,
    tracks,
    outOfScopeTrack,
    formats,
    form,
    field,
    plan,
    scoreRound,
    comparisonRound,
    criterion,
    membership,
    session,
    scope,
    ...submissions,
    ...submissionTracks,
    ...participations,
    answers,
    submissionFile,
    ...scoreAssignments,
    ...comparisonAssignments,
  ]);
}

describe.sequential("reviewer anonymity audit", () => {
  let identityStrings: string[];

  beforeAll(async () => {
    await seedAuditFixture();
    identityStrings = await seededIdentityStrings();
  }, 10_000);

  test("AC-64 · manifest inventory drives every reviewer response and export through a byte scan", async () => {
    const routes = reviewerRoutes();
    expect(routes.map(signature).sort()).toEqual(REVIEWER_ROUTE_SIGNATURES);
    expect(identityStrings).toEqual(expect.arrayContaining([
      ...identityPeople.flatMap((person) => [
        person.id,
        person.email,
        person.name,
        person.title,
        person.company,
        person.bio,
        person.headshot,
        person.r2Key,
        `${person.id}.png`,
        person.social,
      ]),
      ...LEGACY_BLIND_MODE_SENTINELS,
    ]));

    const byOperation = new Map(routes.map((entry) => [entry.operationId, entry]));
    const requests: Array<{ operationId: string; init?: RequestInit; roundId?: string; submissionId?: string }> = [
      { operationId: "getReviewerQueueContext" },
      { operationId: "getReviewerQueue", roundId: SCORE_ROUND_ID },
      { operationId: "getReviewerQueue", roundId: COMPARISON_ROUND_ID },
      { operationId: "getReviewerComparisonQueue", roundId: COMPARISON_ROUND_ID },
      { operationId: "getReviewerSubmission", roundId: SCORE_ROUND_ID, submissionId: MAIN_SUBMISSION_ID },
      { operationId: "getReviewerSubmission", roundId: COMPARISON_ROUND_ID, submissionId: COMPARISON_SUBMISSION_IDS[0] },
      { operationId: "getReviewerSubmissionFiles", roundId: SCORE_ROUND_ID, submissionId: MAIN_SUBMISSION_ID },
      { operationId: "getReviewerSubmissionFiles", roundId: COMPARISON_ROUND_ID, submissionId: COMPARISON_SUBMISSION_IDS[0] },
      { operationId: "exportReviewerQueue", roundId: SCORE_ROUND_ID },
      { operationId: "exportReviewerQueue", roundId: COMPARISON_ROUND_ID },
      {
        operationId: "writeReviewerComparison",
        roundId: COMPARISON_ROUND_ID,
        init: {
          method: "POST",
          body: JSON.stringify({
            ranking: [[COMPARISON_SUBMISSION_IDS[0]], [COMPARISON_SUBMISSION_IDS[1]], [COMPARISON_SUBMISSION_IDS[2]]],
            submission_ids: COMPARISON_SUBMISSION_IDS,
          }),
        },
      },
      {
        operationId: "writeReviewerEvaluation",
        roundId: SCORE_ROUND_ID,
        submissionId: MAIN_SUBMISSION_ID,
        init: { method: "POST", body: JSON.stringify({ comment: "No identity in this note.", recommendation: "maybe" }) },
      },
    ];

    for (const item of requests) {
      const entry = byOperation.get(item.operationId);
      expect(entry, `manifest route missing: ${item.operationId}`).toBeDefined();
      const path = pathFor(entry!, item.roundId, item.submissionId);
      const requestPath = item.operationId === "exportReviewerQueue" ? `${path}?format=csv` : path;
      const response = await request(requestPath, item.init);
      const body = await scanResponse(response, item.init?.method ?? "GET", requestPath, identityStrings);
      expect(response.status, `${item.operationId} ${requestPath}`).toBe(
        item.operationId === "writeReviewerComparison" ? 201 : 200,
      );
      if (item.operationId === "getReviewerSubmission") {
        const detail = JSON.parse(body) as { blind_mode: boolean; identity: unknown; vendor_affiliation: string };
        expect(detail.blind_mode).toBe(true);
        expect(detail.identity).toBeNull();
        if (item.roundId === SCORE_ROUND_ID) expect(detail.vendor_affiliation).toBe("vendor_with_champion");
      }
      if (item.operationId === "getReviewerComparisonQueue") {
        const comparison = JSON.parse(body) as { data: Array<{ id: string }> };
        expect(comparison.data.map((item) => item.id)).toEqual([...COMPARISON_SUBMISSION_IDS]);
      }
      if (item.operationId === "exportReviewerQueue") {
        expect(body).toContain("submission_id,title,abstract,format,tracks");
      }
    }
  });

  test("AC-64 · unauthenticated, out-of-scope, not-found, malformed, and wrong-mode bodies are byte-scanned", async () => {
    const cases: Array<{ label: string; path: string; init?: RequestInit; expectedStatus: number; sessionId?: string }> = [
      {
        label: "unauthenticated queue",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/queue`,
        expectedStatus: 401,
        sessionId: "",
      },
      {
        label: "unauthenticated reviewer context",
        path: `/api/v1/events/${EVENT_ID}/reviewer/queue`,
        expectedStatus: 401,
        sessionId: "",
      },
      {
        label: "out-of-scope record with an author id in the URL",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/submissions/${identityPeople[0].id}`,
        expectedStatus: 403,
      },
      {
        label: "forbidden record with an author name in the URL",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/submissions/${encodeURIComponent(identityPeople[0].name)}`,
        expectedStatus: 403,
      },
      {
        label: "out-of-scope file metadata",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/submissions/${OUT_OF_SCOPE_SUBMISSION_ID}/files`,
        expectedStatus: 403,
      },
      {
        label: "forbidden file metadata with an author email in the URL",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/submissions/${encodeURIComponent(identityPeople[0].email)}/files`,
        expectedStatus: 403,
      },
      {
        label: "unknown round",
        path: `/api/v1/events/${EVENT_ID}/rounds/${encodeURIComponent(identityPeople[0].name)}/queue`,
        expectedStatus: 404,
      },
      {
        label: "unknown comparison round with an author name",
        path: `/api/v1/events/${EVENT_ID}/rounds/${encodeURIComponent(identityPeople[0].name)}/comparisons/next`,
        expectedStatus: 404,
      },
      {
        label: "unknown comparison write round with an author name",
        path: `/api/v1/events/${EVENT_ID}/rounds/${encodeURIComponent(identityPeople[0].name)}/comparisons`,
        init: {
          method: "POST",
          body: JSON.stringify({
            ranking: [[COMPARISON_SUBMISSION_IDS[0]], [COMPARISON_SUBMISSION_IDS[1]], [COMPARISON_SUBMISSION_IDS[2]]],
            submission_ids: COMPARISON_SUBMISSION_IDS,
          }),
        },
        expectedStatus: 404,
      },
      {
        label: "export query validation with an author name",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/export?format=${encodeURIComponent(identityPeople[0].name)}`,
        expectedStatus: 400,
      },
      {
        label: "malformed evaluation",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/submissions/${MAIN_SUBMISSION_ID}/evaluations`,
        init: { method: "POST", body: JSON.stringify({ comment: identityPeople[0].name }) },
        expectedStatus: 400,
      },
      {
        label: "duplicate comparison ids",
        path: `/api/v1/events/${EVENT_ID}/rounds/${COMPARISON_ROUND_ID}/comparisons`,
        init: {
          method: "POST",
          body: JSON.stringify({
            ranking: [[COMPARISON_SUBMISSION_IDS[0]]],
            submission_ids: [COMPARISON_SUBMISSION_IDS[0], COMPARISON_SUBMISSION_IDS[0], COMPARISON_SUBMISSION_IDS[0]],
          }),
        },
        expectedStatus: 422,
      },
      {
        label: "out-of-scope evaluation",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/submissions/${OUT_OF_SCOPE_SUBMISSION_ID}/evaluations`,
        init: { method: "POST", body: JSON.stringify({ recommendation: "maybe" }) },
        expectedStatus: 403,
      },
      {
        label: "forbidden evaluation with an author email in the URL",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/submissions/${encodeURIComponent(identityPeople[0].email)}/evaluations`,
        init: { method: "POST", body: JSON.stringify({ recommendation: "maybe" }) },
        expectedStatus: 403,
      },
      {
        label: "out-of-scope comparison write",
        path: `/api/v1/events/${EVENT_ID}/rounds/${COMPARISON_ROUND_ID}/comparisons`,
        init: {
          method: "POST",
          body: JSON.stringify({
            ranking: [[COMPARISON_SUBMISSION_IDS[0]], [COMPARISON_SUBMISSION_IDS[1]], [OUT_OF_SCOPE_SUBMISSION_ID]],
            submission_ids: [COMPARISON_SUBMISSION_IDS[0], COMPARISON_SUBMISSION_IDS[1], OUT_OF_SCOPE_SUBMISSION_ID],
          }),
        },
        expectedStatus: 403,
      },
      {
        label: "comparison endpoint on scorecard round",
        path: `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/comparisons/next`,
        expectedStatus: 409,
      },
    ];
    for (const item of cases) {
      const response = await request(item.path, item.init, item.sessionId);
      await scanResponse(response, item.init?.method ?? "GET", item.path, identityStrings);
      expect(response.status, item.label).toBe(item.expectedStatus);
    }

    const savedDetailPath = `/api/v1/events/${EVENT_ID}/rounds/${SCORE_ROUND_ID}/submissions/${MAIN_SUBMISSION_ID}`;
    const savedDetail = await request(savedDetailPath);
    const savedDetailBody = await scanResponse(savedDetail, "GET", savedDetailPath, identityStrings);
    expect(savedDetail.status).toBe(200);
    expect(JSON.parse(savedDetailBody)).toMatchObject({ blind_mode: true, identity: null });
  });
});
