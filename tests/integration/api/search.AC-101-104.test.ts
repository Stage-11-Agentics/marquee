import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_search";
const OTHER_EVENT_ID = "evt_search_other";
const OWNER_ID = "person_search_owner";
const FORM_ADMIN_ID = "person_search_form_admin";
const SPEAKER_ID = "person_signal_speaker";
const SECRET_SPEAKER_ID = "person_secret_speaker";
const SUBMITTER_ONLY_ID = "person_submitter_only";
const MAIN_FORM_ID = "form_signal";
const SECRET_FORM_ID = "form_secret";
const ABSTRACT_ID = "submission_signal_abstract";
const SESSION_ID = "submission_signal_session";
const SECRET_ID = "submission_secret";

interface SearchResult {
  type: "Abstract" | "Session" | "Speaker" | "Form";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface SearchEnvelope {
  data: SearchResult[];
}

let ownerCookie = "";
let formAdminCookie = "";
let otherEventCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_search", "Search Org", "search-org", now, now),
    env.DB.prepare(`INSERT INTO events
      (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, 'org_search', ?, ?, '', '2026-10-01', '2026-10-02', 'UTC', '', 'live', 1, ?, ?),
             (?, 'org_search', ?, ?, '', '2026-10-03', '2026-10-04', 'UTC', '', 'live', 1, ?, ?)`)
      .bind(EVENT_ID, "Search Conference", EVENT_ID, now, now, OTHER_EVENT_ID, "Other Conference", OTHER_EVENT_ID, now, now),
    ...[
      [OWNER_ID, "owner@search.example", "Search Owner", "Program Lead", "Search Org"],
      [FORM_ADMIN_ID, "admin@search.example", "Assigned Admin", "Conference Operator", "Search Org"],
      [SPEAKER_ID, "speaker@search.example", "Signal Speaker", "Systems Cartographer", "Signal Labs"],
      [SECRET_SPEAKER_ID, "secret@search.example", "Secret Speaker", "Private Researcher", "Secret Labs"],
      [SUBMITTER_ONLY_ID, "submitter@search.example", "Submitter Only Person", null, null],
      ["person_other_reviewer", "other@search.example", "Other Event Reviewer", "Reviewer", "Search Org"],
    ].map(([id, email, name, title, company]) => env.DB.prepare(
      `INSERT INTO people
        (id, org_id, email, name, title, company, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, 'org_search', ?, ?, ?, ?, '[]', 1, 'marquee', ?, ?)`,
    ).bind(id, email, name, title, company, now, now)),
    env.DB.prepare(`INSERT INTO memberships
      (id, org_id, event_id, person_id, role, created_at, updated_at)
      VALUES ('membership_search_owner', 'org_search', NULL, ?, 'owner', ?, ?),
             ('membership_search_admin', 'org_search', ?, ?, 'reviewer', ?, ?),
             ('membership_other_reviewer', 'org_search', ?, 'person_other_reviewer', 'reviewer', ?, ?)`)
      .bind(OWNER_ID, now, now, EVENT_ID, FORM_ADMIN_ID, now, now, OTHER_EVENT_ID, now, now),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, welcome_md, per_submitter_limit, min_speakers, max_speakers, max_sponsors, admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Signal CFP', 'signal-cfp', 'abstract', 'open', '', 3, 1, 4, 0, '[]', 1, ?, ?),
             (?, ?, 'Secret reviewers', 'secret-reviewers', 'session', 'draft', '', 3, 1, 4, 0, '[]', 1, ?, ?)`)
      .bind(MAIN_FORM_ID, EVENT_ID, now, now, SECRET_FORM_ID, EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO form_admins (id, form_id, person_id, created_at, updated_at) VALUES ('form-admin-search', ?, ?, ?, ?)").bind(MAIN_FORM_ID, FORM_ADMIN_ID, now, now),
    env.DB.prepare(`INSERT INTO submissions
      (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, created_at, updated_at)
      VALUES (?, ?, ?, 'abstract', 'Signal over silent failures', 'A reliable signal for operators.', 'accepted', 'public', ?, ?, ?),
             (?, ?, ?, 'session', 'Signal workshop in practice', 'A session about signal routing.', 'accepted', 'public', ?, ?, ?),
             (?, ?, ?, 'abstract', 'Secret signal review', 'A private signal record.', 'draft', 'admin', ?, ?, ?)`)
      .bind(ABSTRACT_ID, EVENT_ID, MAIN_FORM_ID, OWNER_ID, now, now, SESSION_ID, EVENT_ID, MAIN_FORM_ID, OWNER_ID, now, now, SECRET_ID, EVENT_ID, SECRET_FORM_ID, SUBMITTER_ONLY_ID, now, now),
    env.DB.prepare(`INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
      VALUES ('participation_signal', ?, ?, 'speaker', 0, ?, ?),
             ('participation_session', ?, ?, 'speaker', 0, ?, ?),
             ('participation_secret', ?, ?, 'speaker', 0, ?, ?)`)
      .bind(ABSTRACT_ID, SPEAKER_ID, now, now, SESSION_ID, SPEAKER_ID, now, now, SECRET_ID, SECRET_SPEAKER_ID, now, now),
  ]);

  const [owner, formAdmin, otherEvent] = await Promise.all([
    createSession(env.DB, { personId: OWNER_ID, roleHint: "owner", userAgent: "search-owner" }),
    createSession(env.DB, { personId: FORM_ADMIN_ID, roleHint: "reviewer", userAgent: "search-form-admin" }),
    createSession(env.DB, { personId: "person_other_reviewer", roleHint: "reviewer", userAgent: "search-other-event" }),
  ]);
  ownerCookie = `mq_session=${owner.id}`;
  formAdminCookie = `mq_session=${formAdmin.id}`;
  otherEventCookie = `mq_session=${otherEvent.id}`;
}

async function request(query: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/search${query}`, {
    headers: { cookie },
  });
}

async function json(response: Response): Promise<SearchEnvelope> {
  return response.json<SearchEnvelope>();
}

describe.sequential("MRQ-29 quick search", () => {
  beforeEach(seedFixture);

  test("AC-101 · the event search route is authenticated and event-scoped", async () => {
    const unauthenticated = await request("?q=Secret", "");
    expect(unauthenticated.status).toBe(401);
    const unauthenticatedBody = await unauthenticated.text();
    expect(unauthenticatedBody).not.toContain(SECRET_ID);
    expect(unauthenticatedBody).not.toContain("Secret signal review");

    const otherEvent = await request("?q=Secret", otherEventCookie);
    expect(otherEvent.status).toBe(403);
    const otherEventBody = await otherEvent.text();
    expect(otherEventBody).not.toContain(SECRET_ID);
    expect(otherEventBody).not.toContain("Secret signal review");

    const positive = await request("?q=Secret");
    expect(positive.status).toBe(200);
    const positiveBody = await json(positive);
    expect(positiveBody.data.some((result) => result.id === SECRET_ID && result.title === "Secret signal review")).toBe(true);
  });

  test("AC-102 · one labelled result list returns Abstract, Session, Speaker, and Form", async () => {
    const response = await request("?q=Signal");
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(new Set(body.data.map((result) => result.type))).toEqual(new Set(["Abstract", "Session", "Speaker", "Form"]));
    expect(body.data.find((result) => result.id === ABSTRACT_ID)).toMatchObject({ type: "Abstract", href: `/submissions/${ABSTRACT_ID}` });
    expect(body.data.find((result) => result.id === SESSION_ID)).toMatchObject({ type: "Session", href: `/submissions/${SESSION_ID}` });
    // MRQ-111: the speaker hit now lands on the roster record it names. The
    // link was always shaped like a deep link; nothing read `?person=` until
    // the roster existed, so it went nowhere.
    expect(body.data.find((result) => result.id === SPEAKER_ID)).toMatchObject({ type: "Speaker", href: `/speakers?person=${SPEAKER_ID}` });
    expect(body.data.find((result) => result.id === MAIN_FORM_ID)).toMatchObject({ type: "Form", href: `/forms?form=${MAIN_FORM_ID}` });
  });

  test("CONTRACT · MRQ-127 submitter-only people are discoverable for the create-submission picker", async () => {
    const response = await request("?q=Submitter%20Only");
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.data.find((result) => result.id === SUBMITTER_ONLY_ID)).toMatchObject({
      type: "Speaker",
      subtitle: "Conference person",
    });
  });

  test("AC-103 · an event search query remains bounded and responds to a misspelled title", async () => {
    const response = await request("?q=sgnal");
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.data.length).toBeLessThanOrEqual(20);
    expect(body.data.some((result) => result.id === ABSTRACT_ID)).toBe(true);
    expect(body.data.some((result) => result.id === SESSION_ID)).toBe(true);
  });

  test("AC-104 · explicit form admins cannot search unassigned records and positive controls prove non-vacuity", async () => {
    const restricted = await request("?q=Secret", formAdminCookie);
    expect(restricted.status).toBe(200);
    const restrictedBody = await json(restricted);
    expect(restrictedBody.data).toEqual([]);
    expect(JSON.stringify(restrictedBody)).not.toContain(SECRET_ID);
    expect(JSON.stringify(restrictedBody)).not.toContain("Secret signal review");

    const fuzzy = await request("?q=sgnal", formAdminCookie);
    expect(fuzzy.status).toBe(200);
    const fuzzyBody = await json(fuzzy);
    expect(fuzzyBody.data.some((result) => result.id === ABSTRACT_ID)).toBe(true);
    expect(fuzzyBody.data.some((result) => result.id === SPEAKER_ID)).toBe(true);
    expect(fuzzyBody.data.some((result) => result.id === SECRET_ID)).toBe(false);
  });
});
