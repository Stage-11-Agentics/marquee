import { SELF } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import { DEMO_EVENT_ID, DEMO_ORGANIZER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

/**
 * One append-only log, three lenses (MRQ-211).
 *
 * Every test here is the same round trip — a real writer runs, a row lands in
 * `audit_log`, and the lens that should show it does — because that round trip
 * is the only thing that can catch the failure this feature is prone to: a
 * writer recording a scope or a subject the reader does not query, which loses
 * the row silently and looks exactly like "nothing happened yet".
 *
 * One file, one Miniflare isolate: the suite budget is 45s.
 */

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = DEMO_EVENT_ID;
const OWNER_ID = DEMO_ORGANIZER_PERSON_ID;
const OWNER_SESSION = "sess-mrq-211-owner";
const SECOND_ORGANIZER = "per-mrq-211-second";
const SECOND_SESSION = "sess-mrq-211-second";
const SUBMISSION_ID = "sub-mrq-211";

interface ActivityEvent {
  id: string;
  action: string;
  summary: string;
  detail: string | null;
  actor_name: string | null;
  entity_id?: string;
  event_id: string | null;
  event_name: string | null;
  created_at: number;
}

interface ActivityPage {
  data: ActivityEvent[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  next_cursor: string | null;
  has_more: boolean;
}

async function request(path: string, init: RequestInit = {}, session = OWNER_SESSION): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${session}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function orgActivity(query = ""): Promise<ActivityPage> {
  const response = await request(`/api/v1/org/activity${query}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<ActivityPage>;
}

async function orgId(): Promise<string> {
  const row = await env.DB.prepare("SELECT org_id FROM events WHERE id = ?").bind(EVENT_ID).first<{ org_id: string }>();
  return row!.org_id;
}

beforeAll(async () => {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  const organization = await orgId();
  await env.DB.batch([
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)`,
    ).bind(OWNER_SESSION, OWNER_ID, now + 86_400_000, now, now),
    env.DB.prepare(
      "INSERT INTO people (id, org_id, name, email, created_at, updated_at) VALUES (?, ?, 'Rhea Vasquez-Oyelaran', 'rhea-211@example.test', ?, ?)",
    ).bind(SECOND_ORGANIZER, organization, now, now),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('mem-mrq-211-second', ?, NULL, ?, 'program_lead', ?, ?)`,
    ).bind(organization, SECOND_ORGANIZER, now, now),
    // A live session for the organizer about to be removed. Removal must both
    // revoke it and say so — "access ended" with no count is the half-answer
    // that leaves an owner wondering whether the link in that inbox still works.
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'program_lead', ?, 'fixture', NULL, ?, ?)`,
    ).bind(SECOND_SESSION, SECOND_ORGANIZER, now + 86_400_000, now, now),
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, kind, title, abstract, search_blob, status, origin, submitter_person_id, submitted_at, last_saved_at, created_at, updated_at)
       VALUES (?, ?, 'session', 'Backpressure in Practice', 'A field guide.', 'backpressure in practice', 'submitted', 'public', ?, ?, ?, ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, SECOND_ORGANIZER, now, now, now, now),
  ]);
});

test("CONTRACT · MRQ-211 · the schema refuses an audit row scoped to neither a conference nor an organization", async () => {
  // The CHECK is what keeps "one substrate" true: a row no lens can reach is
  // the same as a row nobody wrote, and it would fail as silence rather than
  // as an error.
  await expect(
    env.DB.prepare(
      `INSERT INTO audit_log (id, event_id, org_id, actor_person_id, actor_kind, action, entity_type, entity_id, created_at)
       VALUES ('audit-mrq-211-unscoped', NULL, NULL, NULL, 'system', 'test.unscoped', 'submission', ?, ?)`,
    ).bind(SUBMISSION_ID, Date.now()).run(),
  ).rejects.toThrow();
});

test("CONTRACT · MRQ-211 · keyset pages survive an append between reads without losing or repeating a row", async () => {
  const inviteIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await request("/api/v1/org/invites", { method: "POST" });
    expect(response.status).toBe(201);
    inviteIds.push((await response.json() as { data: { id: string } }).data.id);
  }

  // Read page one, then append X. With OFFSET, page two starts one row too
  // early and either repeats the boundary or permanently skips the oldest of
  // these three. The route's cursor pins page one's actual last row.
  const first = await orgActivity("?per_page=2");
  expect(first.data).toHaveLength(2);
  expect(first.next_cursor).toBeTruthy();
  const appended = await request("/api/v1/org/invites", { method: "POST" });
  expect(appended.status).toBe(201);
  const appendedId = (await appended.json() as { data: { id: string } }).data.id;

  const second = await orgActivity(`?per_page=2&page=2&cursor=${encodeURIComponent(first.next_cursor!)}`);
  const pageIds = [...first.data, ...second.data]
    .map((entry) => entry.entity_id)
    .filter((id): id is string => typeof id === "string");
  expect(new Set(pageIds).size).toBe(pageIds.length);
  expect(pageIds.filter((id) => inviteIds.includes(id))).toHaveLength(3);
  expect(pageIds).not.toContain(appendedId);
});

test("CONTRACT · MRQ-211 · lens one · minting and revoking an invite lands in the organization log, in the organizer's language", async () => {
  const minted = await request("/api/v1/org/invites", { method: "POST" });
  expect(minted.status).toBe(201);
  const inviteId = (await minted.json() as { data: { id: string } }).data.id;

  const afterMint = await orgActivity();
  const mintRow = afterMint.data.find((entry) => entry.action === "org.invite_minted");
  expect(mintRow?.summary).toBe("Invite created");
  expect(mintRow?.actor_name).toBe("Demo Organizer");
  // An organization-level action names no conference, and the lens says so
  // rather than inventing one.
  expect(mintRow?.event_id).toBeNull();

  const revoked = await request(`/api/v1/org/invites/${inviteId}`, { method: "DELETE" });
  expect(revoked.status).toBe(200);
  const afterRevoke = await orgActivity();
  expect(afterRevoke.data[0]?.action).toBe("org.invite_revoked");
  expect(afterRevoke.data[0]?.summary).toBe("Invite revoked");
  // The mint is still there. An append-only log never edits what it said.
  expect(afterRevoke.data.some((entry) => entry.id === mintRow?.id)).toBe(true);

  // A revoke that changes nothing (the invite is already spent) writes nothing.
  const again = await request(`/api/v1/org/invites/${inviteId}`, { method: "DELETE" });
  expect(again.status).toBe(404);
  const afterSecondRevoke = await orgActivity();
  expect(afterSecondRevoke.data.filter((entry) => entry.action === "org.invite_revoked")).toHaveLength(1);
});

test("CONTRACT · MRQ-211 · lens one · an API token is recorded by name and grants, never by secret", async () => {
  const created = await request("/api/v1/org/tokens", {
    method: "POST",
    body: JSON.stringify({ name: "Schedule bot", scopes: { permissions: ["program:read"], event_ids: [EVENT_ID] } }),
  });
  expect(created.status).toBe(201);
  const body = await created.json() as { data: { id: string }; secret: string };

  const created_log = await orgActivity();
  const row = created_log.data.find((entry) => entry.action === "org.token_created");
  expect(row?.summary).toBe("API token created");
  expect(row?.detail).toBe("Schedule bot · program:read");
  // Scoped to one conference, so the lens resolves the conference by join
  // rather than storing a copy of its name that a rename would falsify.
  expect(row?.event_id).toBe(EVENT_ID);
  expect(row?.event_name).toBeTruthy();

  const stored = await env.DB
    .prepare("SELECT before_json, after_json FROM audit_log WHERE action = 'org.token_created'")
    .first<{ before_json: string | null; after_json: string | null }>();
  const payload = `${stored?.before_json ?? ""}${stored?.after_json ?? ""}`;
  expect(payload).not.toContain(body.secret);

  const revoked = await request(`/api/v1/org/tokens/${body.data.id}`, { method: "DELETE" });
  expect(revoked.status).toBe(200);
  expect((await orgActivity()).data[0]?.summary).toBe("API token revoked");

  // Revoking an already-revoked token still answers 200 (the UPDATE is a
  // COALESCE no-op), so a retried DELETE must not record a second revocation of
  // a credential that was revoked once. Same rule the invite path follows.
  const again = await request(`/api/v1/org/tokens/${body.data.id}`, { method: "DELETE" });
  expect(again.status).toBe(200);
  const log = await orgActivity();
  expect(log.data.filter((entry) => entry.action === "org.token_revoked")).toHaveLength(1);
});

test("CONTRACT · MRQ-211 · lenses one and two · removing an organizer records what it revoked, on the person's own record", async () => {
  const removed = await request(`/api/v1/org/members/${SECOND_ORGANIZER}`, { method: "DELETE" });
  expect(removed.status).toBe(200);

  const log = await orgActivity();
  const row = log.data.find((entry) => entry.action === "org.member_removed");
  expect(row?.summary).toBe("Organizer access ended");
  expect(row?.detail).toBe("Organizer · 1 sign-in revoked");

  // Lens two: the same row, on the person it is about. This is the property the
  // subject convention exists for — file it under the actor and the removed
  // organizer's record would show nothing at all.
  const feed = await request(`/api/v1/org/people/${SECOND_ORGANIZER}/activity`);
  expect(feed.status).toBe(200);
  const entries = (await feed.json() as ActivityPage).data;
  expect(entries.some((entry) => entry.summary === "Organizer access ended")).toBe(true);

  // And the access really ended, in the same transaction the log describes.
  const session = await env.DB
    .prepare("SELECT revoked_at FROM auth_sessions WHERE id = ?")
    .bind(SECOND_SESSION)
    .first<{ revoked_at: number | null }>();
  expect(session?.revoked_at).not.toBeNull();
});

test("CONTRACT · MRQ-211 · lens two · the person's feed merges annotations, audit rows and mail, and pages in SQL", async () => {
  const noteA = await request(`/api/v1/org/people/${SECOND_ORGANIZER}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: "Met at the infra track dinner." }),
  });
  expect(noteA.status).toBe(201);
  const tagged = await request(`/api/v1/org/people/${SECOND_ORGANIZER}/tags`, {
    method: "POST",
    body: JSON.stringify({ tag: "keynote-candidate" }),
  });
  expect(tagged.status).toBe(200);

  const record = await request(`/api/v1/org/people/${SECOND_ORGANIZER}`);
  expect(record.status).toBe(200);
  const view = await record.json() as { activity: ActivityEvent[]; activity_total: number };
  expect(view.activity.some((entry) => entry.summary === "Note added")).toBe(true);
  expect(view.activity.some((entry) => entry.summary === "Tag added" && entry.detail === "keynote-candidate")).toBe(true);
  expect(view.activity.some((entry) => entry.summary === "Organizer access ended")).toBe(true);
  expect(view.activity_total).toBe(view.activity.length);

  // Paging is the server's job. Page one of size one, then page two, must be
  // two different rows — a client-side slice of a full read would pass a test
  // that only counted rows, so this asserts they differ.
  const first = await request(`/api/v1/org/people/${SECOND_ORGANIZER}/activity?per_page=1`);
  const firstPage = await first.json() as ActivityPage;
  const second = await request(`/api/v1/org/people/${SECOND_ORGANIZER}/activity?per_page=1&page=2&cursor=${encodeURIComponent(firstPage.next_cursor!)}`);
  const secondPage = await second.json() as ActivityPage;
  expect(firstPage.data).toHaveLength(1);
  expect(secondPage.data).toHaveLength(1);
  expect(firstPage.data[0]?.id).not.toBe(secondPage.data[0]?.id);
  expect(firstPage.total).toBe(view.activity_total);
});

test("CONTRACT · MRQ-211 · lens two · a second organization's person-shaped audit row is absent from the first organization's feed", async () => {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org-mrq-211-other', 'Other Org', 'other-mrq-211', ?, ?)",
    ).bind(now, now),
    env.DB.prepare(
      "INSERT INTO people (id, org_id, name, email, created_at, updated_at) VALUES ('per-mrq-211-other', 'org-mrq-211-other', 'Other Actor', 'other-mrq-211@example.test', ?, ?)",
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO audit_log
        (id, event_id, org_id, actor_person_id, actor_name, actor_kind, action, entity_type, entity_id, created_at)
       VALUES ('audit-mrq-211-cross-org', NULL, 'org-mrq-211-other', 'per-mrq-211-other', 'Other Actor', 'user', 'org-b.person_touched', 'person', ?, ?)`,
    ).bind(OWNER_ID, now + 10_000),
  ]);

  const response = await request(`/api/v1/org/people/${OWNER_ID}/activity`);
  expect(response.status).toBe(200);
  const feed = await response.json() as ActivityPage;
  expect(feed.data.some((entry) => entry.action === "org-b.person_touched")).toBe(false);
  expect(feed.data.some((entry) => entry.actor_name === "Other Actor")).toBe(false);
});

test("CONTRACT · MRQ-211 · lens three · a submission's timeline reads its own audit rows as sentences, newest first", async () => {
  const decisionBody = { recommendation: "approve", feedback_md: "Strong fit for the infra track." };
  const planResponse = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/decision-plan`, {
    method: "POST",
    body: JSON.stringify(decisionBody),
  });
  expect(planResponse.status).toBe(200);
  const plan = await planResponse.json() as { plan_fingerprint: string; etag: string };
  const decided = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/decision`, {
    method: "POST",
    headers: { "if-match": plan.etag },
    body: JSON.stringify({ ...decisionBody, plan_fingerprint: plan.plan_fingerprint }),
  });
  expect(decided.status).toBe(200);
  const edited = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/content`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Backpressure in Practice: A Field Guide" }),
  });
  expect(edited.status).toBe(200);

  const timeline = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/timeline`);
  expect(timeline.status).toBe(200);
  const page = await timeline.json() as { data: Array<ActivityEvent & { restorable: boolean }>; total: number };
  expect(page.data[0]?.summary).toBe("Content edited");
  // The detail names what moved. Repeating the record's own title would say
  // nothing, and would say the same nothing for an abstract-only edit.
  expect(page.data[0]?.detail).toBe("Title");
  // The decision writer records `submission.approve`; the timeline says
  // "Accepted", which is the word the rest of the pipeline uses.
  expect(page.data.some((entry) => entry.summary === "Accepted")).toBe(true);
  // A content edit is the row that offers a restore; a decision is not.
  expect(page.data.find((entry) => entry.action === "content_updated")?.restorable).toBe(true);
  expect(page.data.find((entry) => entry.action === "submission.approve")?.restorable).toBe(false);

  const record = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}`);
  const view = await record.json() as { history: Array<{ id: string; summary: string }>; history_total: number };
  // The record and the paged endpoint are the same projection over the same
  // rows: the card and "Load more" cannot tell different stories.
  expect(view.history_total).toBe(page.total);
  expect(view.history[0]?.summary).toBe(page.data[0]?.summary);
});

test("CONTRACT · MRQ-211 · the org lens reads by scope, so an action nobody has written copy for still appears", async () => {
  const organization = await orgId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO audit_log (id, event_id, org_id, actor_person_id, actor_kind, action, entity_type, entity_id, created_at)
     VALUES ('audit-mrq-211-future', NULL, ?, NULL, 'system', 'org.ownership_transferred', 'person', ?, ?)`,
  ).bind(organization, OWNER_ID, now + 1_000).run();
  const withFuture = await orgActivity();
  expect(withFuture.data[0]?.summary).toBe("Ownership transferred");

  // And one the vocabulary has never met — what MRQ-207 or MRQ-212 will write
  // before this file learns the name. It must read as something, not vanish.
  await env.DB.prepare(
    `INSERT INTO audit_log (id, event_id, org_id, actor_person_id, actor_kind, action, entity_type, entity_id, created_at)
     VALUES ('audit-mrq-211-unknown', NULL, ?, NULL, 'system', 'org.branding_replaced', 'organization', ?, ?)`,
  ).bind(organization, organization, now + 2_000).run();
  const withUnknown = await orgActivity();
  expect(withUnknown.data[0]?.summary).toBe("Branding replaced");
});

test("CONTRACT · MRQ-211 · the organization log is organizer authority, not open to any signed-in seat", async () => {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, org_id, name, email, created_at, updated_at) VALUES ('per-mrq-211-reviewer', (SELECT org_id FROM events WHERE id = ?), 'Tomás Villalobos-Reed', 'tomas-211@example.test', ?, ?)",
    ).bind(EVENT_ID, now, now),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('mem-mrq-211-reviewer', (SELECT org_id FROM events WHERE id = ?), ?, 'per-mrq-211-reviewer', 'reviewer', ?, ?)`,
    ).bind(EVENT_ID, EVENT_ID, now, now),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES ('sess-mrq-211-reviewer', 'per-mrq-211-reviewer', 'reviewer', ?, 'fixture', NULL, ?, ?)`,
    ).bind(now + 86_400_000, now, now),
  ]);
  const response = await request("/api/v1/org/activity", {}, "sess-mrq-211-reviewer");
  expect(response.status).toBe(403);
});
