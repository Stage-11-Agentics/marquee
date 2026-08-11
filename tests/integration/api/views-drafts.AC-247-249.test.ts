import { beforeEach, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { SUBMISSION_COLUMN_REGISTRY } from "../../../src/lib/submission-columns";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.example";
const ORG_ID = "org_mrq_34";
const EVENT_ID = "evt_mrq_34";
const OTHER_EVENT_ID = "evt_mrq_34_other";
const FORM_ID = "form_mrq_34";
const DRAFT_ID = "draft_mrq_34";
const NOW = Date.now();

let ownerCookie = "";
let peerCookie = "";
let reviewerCookie = "";
let speakerCookie = "";
let formAdminCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "MRQ-34 Org", "mrq-34-org", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'MRQ-34 Conference', 'mrq-34', '', '2026-10-01', '2026-10-02', 'UTC', '', 'live', 0, ?, ?),
             (?, ?, 'MRQ-34 Other Conference', 'mrq-34-other', '', '2026-11-01', '2026-11-02', 'UTC', '', 'live', 0, ?, ?)`).bind(EVENT_ID, ORG_ID, NOW, NOW, OTHER_EVENT_ID, ORG_ID, NOW, NOW),
    ...[
      ["per_mrq_34_owner", "owner@mrq-34.example", "MRQ-34 Owner"],
      ["per_mrq_34_peer", "peer@mrq-34.example", "MRQ-34 Peer"],
      ["per_mrq_34_reviewer", "reviewer@mrq-34.example", "MRQ-34 Reviewer"],
      ["per_mrq_34_speaker", "speaker@mrq-34.example", "MRQ-34 Speaker"],
      ["per_mrq_34_form_admin", "form-admin@mrq-34.example", "MRQ-34 Form Admin"],
    ].map(([id, email, name]) => env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, ORG_ID, email, name, NOW, NOW)),
    env.DB.prepare(`INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
      VALUES ('mem_mrq_34_owner', ?, NULL, 'per_mrq_34_owner', 'owner', ?, ?),
             ('mem_mrq_34_peer', ?, ?, 'per_mrq_34_peer', 'ops', ?, ?),
             ('mem_mrq_34_reviewer', ?, ?, 'per_mrq_34_reviewer', 'reviewer', ?, ?),
             ('mem_mrq_34_speaker', ?, ?, 'per_mrq_34_speaker', 'speaker', ?, ?)`).bind(ORG_ID, NOW, NOW, ORG_ID, EVENT_ID, NOW, NOW, ORG_ID, EVENT_ID, NOW, NOW, ORG_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at)
      VALUES (?, ?, 'MRQ-34 Intake', 'mrq-34-intake', 'abstract', 'open', ?, ?)`).bind(FORM_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, condition, created_at, updated_at)
      VALUES ('field_mrq_34_gate', ?, 'audience', 'Audience', 'single_select', 1, 0, ?, NULL, ?, ?),
             ('field_mrq_34_hidden', ?, 'private_context', 'Private context', 'long_text', 1, 1, '{}', ?, ?, ?)`).bind(
      FORM_ID, JSON.stringify({ options: ["No", "Yes"] }), NOW, NOW,
      FORM_ID, JSON.stringify({ all: [{ fieldKey: "audience", op: "equals", value: "Yes" }] }), NOW, NOW,
    ),
    env.DB.prepare("INSERT INTO form_admins (id, form_id, person_id, created_at, updated_at) VALUES ('admin_mrq_34', ?, 'per_mrq_34_form_admin', ?, ?)").bind(FORM_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, created_at, updated_at)
      VALUES (?, ?, ?, 'abstract', 'Secret draft content', 'Only authorized staff should see this.', 'draft', 'public', 'per_mrq_34_speaker', NULL, ?, ?, ?)`).bind(DRAFT_ID, EVENT_ID, FORM_ID, NOW, NOW, NOW),
    env.DB.prepare(`INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
      VALUES ('answer_mrq_34_gate', ?, 'field_mrq_34_gate', 'No', NULL, ?, ?)`).bind(DRAFT_ID, NOW, NOW),
  ]);
  const [owner, peer, reviewer, speaker, formAdmin] = await Promise.all([
    createSession(env.DB, { personId: "per_mrq_34_owner", userAgent: "mrq-34-owner" }),
    createSession(env.DB, { personId: "per_mrq_34_peer", userAgent: "mrq-34-peer" }),
    createSession(env.DB, { personId: "per_mrq_34_reviewer", userAgent: "mrq-34-reviewer" }),
    createSession(env.DB, { personId: "per_mrq_34_speaker", userAgent: "mrq-34-speaker" }),
    createSession(env.DB, { personId: "per_mrq_34_form_admin", userAgent: "mrq-34-form-admin" }),
  ]);
  ownerCookie = `mq_session=${owner.id}`;
  peerCookie = `mq_session=${peer.id}`;
  reviewerCookie = `mq_session=${reviewer.id}`;
  speakerCookie = `mq_session=${speaker.id}`;
  formAdminCookie = `mq_session=${formAdmin.id}`;
}

async function request(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

describe.sequential("MRQ-34 saved views and draft attention queue", () => {
  beforeEach(seedFixture);

  test("AC-247 · personal views capture the shared list query, stay event/person scoped, and built-ins reject mutation", async () => {
    const createdResponse = await request(`/api/v1/events/${EVENT_ID}/views`, {
      method: "POST",
      body: JSON.stringify({
        name: "Scored abstracts",
        config: { q: "secret", filters: { status: "submitted", kind: "abstract" }, sort: "score", columns: ["score", "title", "status"] },
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await json<{ id: string; name: string; built_in: boolean; config: { q: string; filters: Record<string, string>; sort: string; columns: string[] } }>(createdResponse);
    expect(created).toMatchObject({ name: "Scored abstracts", built_in: false, config: { q: "secret", filters: { status: "submitted", kind: "abstract" }, sort: "score" } });
    expect(created.config.columns).toEqual(["score", "title", "status"]);

    const ownerViews = await request(`/api/v1/events/${EVENT_ID}/views`);
    expect(ownerViews.status).toBe(200);
    expect((await json<{ data: Array<{ id: string; name: string }> }>(ownerViews)).data.map((view) => view.name)).toContain("Scored abstracts");

    const peerViews = await request(`/api/v1/events/${EVENT_ID}/views`, {}, peerCookie);
    expect(peerViews.status).toBe(200);
    expect((await json<{ data: Array<{ name: string }> }>(peerViews)).data.map((view) => view.name)).not.toContain("Scored abstracts");
    const otherEventViews = await request(`/api/v1/events/${OTHER_EVENT_ID}/views`);
    expect(otherEventViews.status).toBe(200);
    expect((await json<{ data: Array<{ name: string }> }>(otherEventViews)).data.map((view) => view.name)).not.toContain("Scored abstracts");

    const updatedResponse = await request(`/api/v1/events/${EVENT_ID}/views/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated abstracts", config: { q: "updated", filters: { status: "draft" }, sort: "updated", columns: ["missing"] } }),
    });
    expect(updatedResponse.status).toBe(200);
    expect((await json<{ name: string; config: { columns: string[] } }>(updatedResponse))).toMatchObject({ name: "Updated abstracts", config: { columns: ["title", "missing"] } });

    const immutablePatch = await request(`/api/v1/events/${EVENT_ID}/views/drafts-needing-attention`, { method: "PATCH", body: JSON.stringify({ name: "Nope" }) });
    expect(immutablePatch.status).toBe(409);
    const immutableDelete = await request(`/api/v1/events/${EVENT_ID}/views/drafts-needing-attention`, { method: "DELETE" });
    expect(immutableDelete.status).toBe(409);
    const deleted = await request(`/api/v1/events/${EVENT_ID}/views/${created.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
  });

  test("AC-248 · the fixed registry round-trips every column while Title remains mandatory", async () => {
    expect(SUBMISSION_COLUMN_REGISTRY.map((column) => [column.id, column.label])).toEqual([
      ["type", "Type"], ["id", "ID"], ["title", "Title"], ["speakers", "Speakers"], ["status", "Status"], ["tracks", "Tracks"], ["score", "Score"], ["submitted", "Submitted"], ["updated", "Last updated"], ["origin", "Origin"], ["missing", "Missing fields"],
    ]);
    const response = await request(`/api/v1/events/${EVENT_ID}/views`, { method: "POST", body: JSON.stringify({ name: "Every column", columns: SUBMISSION_COLUMN_REGISTRY.map((column) => column.id).reverse(), sort: "title" }) });
    expect(response.status).toBe(201);
    const created = await json<{ config: { columns: string[] } }>(response);
    expect(created.config.columns).toEqual(SUBMISSION_COLUMN_REGISTRY.map((column) => column.id).reverse());
    const mandatoryResponse = await request(`/api/v1/events/${EVENT_ID}/views/all-submissions`, { method: "PATCH", body: JSON.stringify({}) });
    expect(mandatoryResponse.status).toBe(409);
  });

  test("AC-249 · hidden conditional fields do not need attention, revealed fields do, and draft access never leaks content", async () => {
    const hiddenQueue = await request(`/api/v1/events/${EVENT_ID}/submissions?status=draft&per_page=50`);
    expect(hiddenQueue.status).toBe(200);
    expect(await json<{ total: number; data: unknown[] }>(hiddenQueue)).toMatchObject({ total: 0, data: [] });

    await env.DB.batch([
      env.DB.prepare("DELETE FROM submission_answers WHERE submission_id = ?").bind(DRAFT_ID),
      env.DB.prepare("INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at) VALUES ('answer_mrq_34_gate_revealed', ?, 'field_mrq_34_gate', 'Yes', NULL, ?, ?)").bind(DRAFT_ID, NOW + 1, NOW + 1),
    ]);
    const revealedQueue = await request(`/api/v1/events/${EVENT_ID}/submissions?status=draft&per_page=50`);
    expect(revealedQueue.status).toBe(200);
    expect(await json<{ total: number; data: Array<{ id: string; title: string; last_saved_at: number | null; submitter: { email: string }; missing_fields: string[] }> }>(revealedQueue)).toMatchObject({
      total: 1,
      data: [{ id: DRAFT_ID, title: "Secret draft content", submitter: { email: "speaker@mrq-34.example" }, missing_fields: ["Private context"] }],
    });

    for (const cookie of [reviewerCookie, speakerCookie]) {
      const forbidden = await request(`/api/v1/events/${EVENT_ID}/submissions?status=draft`, {}, cookie);
      expect(forbidden.status).toBe(403);
      const body = await forbidden.text();
      expect(body).not.toContain(DRAFT_ID);
      expect(body).not.toContain("Secret draft content");
    }
    expect((await request(`/api/v1/events/${EVENT_ID}/submissions?status=draft`, {}, formAdminCookie)).status).toBe(200);
    expect((await request(`/api/v1/events/${EVENT_ID}/submissions?status=draft`, {}, peerCookie)).status).toBe(200);

    const opened = await request(`/api/v1/events/${EVENT_ID}/submissions/${DRAFT_ID}`);
    expect(opened.status).toBe(200);
    const edited = await request(`/api/v1/events/${EVENT_ID}/submissions/${DRAFT_ID}`, { method: "PATCH", body: JSON.stringify({ title: "Saved draft content", abstract: "Still a draft." }) }, formAdminCookie);
    expect(edited.status).toBe(200);
    expect((await json<{ status: string; title: string }>(edited))).toMatchObject({ status: "draft", title: "Saved draft content" });
    expect((await env.DB.prepare("SELECT status FROM submissions WHERE id = ?").bind(DRAFT_ID).first<{ status: string }>())?.status).toBe("draft");
  });
});
