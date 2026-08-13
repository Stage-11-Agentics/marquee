import { beforeAll, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_mrq170_submitter_edit";
const ORG_ID = "org_mrq170_submitter_edit";
const FORM_ID = "form_mrq170_submitter_edit";
const OWNER_ID = "per_mrq170_owner";
const SUBMITTER_EMAIL = "submitter.mrq170@example.com";
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const OPEN_UNTIL = Date.UTC(2099, 0, 1);
const ORIGINAL_ABSTRACT = "The original abstract that the organizer should receive.";
const EDITED_ABSTRACT = `${ORIGINAL_ABSTRACT} Updated: now includes 2026 benchmark data.`;

type PublicState = {
  state: string;
  answers: Record<string, unknown>;
  resume_url: string | null;
  submission_editable?: boolean;
  submission_edit_reason?: string | null;
  confirmation: { portal_url: string | null } | null;
};

async function request(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
}

async function seed(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "MRQ-170 Submitter Edit Org", "mrq-170-submitters", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, "MRQ-170 Conference", "mrq-170-conference", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
      .bind(OWNER_ID, ORG_ID, "owner.mrq170@example.com", "MRQ-170 Organizer", NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'owner', ?, ?)")
      .bind("membership_mrq170_owner", ORG_ID, EVENT_ID, OWNER_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'MRQ-170 CFP', 'mrq-170-cfp', 'abstract', 'open', ?, ?, '', 3, 1, 1, 0, '[]', 0, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, 0, OPEN_UNTIL, NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_mrq170_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 0, '{}', NULL, ?, ?),
      ('field_mrq170_abstract', ?, 'abstract', 'Abstract', NULL, 'long_text', 1, 1, '{}', NULL, ?, ?),
      ('field_mrq170_name', ?, 'speaker_name', 'Primary speaker name', NULL, 'short_text', 1, 2, '{}', NULL, ?, ?),
      ('field_mrq170_email', ?, 'speaker_email', 'Primary speaker email', NULL, 'email', 1, 3, '{}', NULL, ?, ?)`)
      .bind(FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW),
  ]);
}

async function submit(): Promise<{ state: PublicState; token: string; cookie: string; submissionId: string }> {
  const response = await request("/api/v1/public/forms/mrq-170-cfp/submissions", {
    method: "POST",
    body: JSON.stringify({
      answers: {
        title: "A submission that stays editable",
        abstract: ORIGINAL_ABSTRACT,
        speaker_name: "MRQ-170 Submitter",
        speaker_email: SUBMITTER_EMAIL,
      },
    }),
  });
  expect(response.status).toBe(201);
  const state = await response.json<PublicState>();
  const resumeUrl = new URL(state.resume_url ?? "https://invalid.test");
  const token = resumeUrl.searchParams.get("resume") ?? "";
  expect(token).toHaveLength(32);

  const exchanged = await request(new URL(state.confirmation?.portal_url ?? "https://invalid.test").pathname + new URL(state.confirmation?.portal_url ?? "https://invalid.test").search);
  expect(exchanged.status).toBe(302);
  const cookie = (exchanged.headers.get("set-cookie") ?? "").split(";")[0];
  expect(cookie).toContain("mq_session=");
  const row = await env.DB.prepare("SELECT id FROM submissions WHERE resume_token_hash = ?").bind(await sha256(token)).first<{ id: string }>();
  expect(row?.id).toBeTruthy();
  return { state, token, cookie, submissionId: row!.id };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe.sequential("MRQ-170 submitter editing", () => {
  let ownerCookie = "";

  beforeAll(async () => {
    await seed();
    const session = await createSession(env.DB, { personId: OWNER_ID, roleHint: "owner", userAgent: "mrq-170-test", now: NOW });
    ownerCookie = `mq_session=${session.id}`;
  });

  test("CONTRACT · CFP-09 · a submitted abstract can be edited, survives reload, and reaches the organizer record", async () => {
    const { token, cookie, submissionId } = await submit();

    const resume = await request(`/api/v1/public/forms/mrq-170-cfp?resume=${encodeURIComponent(token)}`);
    expect(resume.status).toBe(200);
    const initial = await resume.json<PublicState>();
    expect(initial.state).toBe("submitted");
    expect(initial.submission_editable).toBe(true);
    expect(initial.answers.abstract).toBe(ORIGINAL_ABSTRACT);

    const portal = await request("/api/v1/me/portal", {}, cookie);
    expect(portal.status).toBe(200);
    const portalBody = await portal.json<{ submissions: Array<{ id: string; description: string; edit: { enabled: boolean; reason: string | null } }> }>();
    expect(portalBody.submissions[0]).toMatchObject({
      id: submissionId,
      description: ORIGINAL_ABSTRACT,
      edit: { enabled: true, reason: null },
    });

    const edited = await request(`/api/v1/public/forms/mrq-170-cfp/submissions/${encodeURIComponent(token)}`, {
      method: "PATCH",
      body: JSON.stringify({ answers: { abstract: EDITED_ABSTRACT } }),
    });
    expect(edited.status).toBe(200);
    expect((await edited.json<PublicState>()).answers.abstract).toBe(EDITED_ABSTRACT);

    const reloaded = await request(`/api/v1/public/forms/mrq-170-cfp?resume=${encodeURIComponent(token)}`);
    const afterReload = await reloaded.json<PublicState>();
    expect(afterReload.answers.abstract).toBe(EDITED_ABSTRACT);
    expect(afterReload.submission_editable).toBe(true);

    const organizer = await request(`/api/v1/events/${EVENT_ID}/submissions/${submissionId}`, {}, ownerCookie);
    expect(organizer.status).toBe(200);
    const record = await organizer.json<{ abstract: string; history: Array<{ action: string; actor_name: string | null; after: { description?: string } | null }> }>();
    expect(record.abstract).toBe(EDITED_ABSTRACT);
    expect(record.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "speaker_talk_updated",
        actor_name: "MRQ-170 Submitter",
        after: expect.objectContaining({ description: EDITED_ABSTRACT }),
      }),
    ]));
  });

  test("CONTRACT · CFP-09 · the edit control stays visible but disabled after close or decision, and tokens stay scoped", async () => {
    const { token, cookie, submissionId } = await submit();
    const wrongToken = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    const wrongTokenResponse = await request(`/api/v1/public/forms/mrq-170-cfp/submissions/${wrongToken}`, {
      method: "PATCH",
      body: JSON.stringify({ answers: { abstract: "Must not cross the token boundary." } }),
    });
    expect(wrongTokenResponse.status).toBe(403);

    await env.DB.prepare("UPDATE forms SET closes_at = ? WHERE id = ?").bind(Date.now() - 1, FORM_ID).run();
    const closedPortal = await request("/api/v1/me/portal", {}, cookie);
    const closedBody = await closedPortal.json<{ submissions: Array<{ id: string; edit: { enabled: boolean; reason: string | null } }> }>();
    expect(closedBody.submissions[0]).toMatchObject({ id: submissionId, edit: { enabled: false } });
    expect(closedBody.submissions[0].edit.reason).toContain("call for speakers is closed");
    const closedEdit = await request(`/api/v1/public/forms/mrq-170-cfp/submissions/${token}`, {
      method: "PATCH",
      body: JSON.stringify({ answers: { abstract: "Closed calls cannot accept this." } }),
    });
    expect(closedEdit.status).toBe(409);

    await env.DB.prepare("UPDATE forms SET closes_at = ?, status = 'open' WHERE id = ?").bind(OPEN_UNTIL, FORM_ID).run();
    await env.DB.prepare("UPDATE submissions SET status = 'accepted' WHERE id = ?").bind(submissionId).run();
    const decidedPortal = await request("/api/v1/me/portal", {}, cookie);
    const decidedBody = await decidedPortal.json<{ submissions: Array<{ id: string; edit: { enabled: boolean; reason: string | null } }> }>();
    expect(decidedBody.submissions[0]).toMatchObject({ id: submissionId, edit: { enabled: false } });
    expect(decidedBody.submissions[0].edit.reason).toContain("decision");
    const decidedEdit = await request(`/api/v1/public/forms/mrq-170-cfp/submissions/${token}`, {
      method: "PATCH",
      body: JSON.stringify({ answers: { abstract: "Decided submissions cannot accept this." } }),
    });
    expect(decidedEdit.status).toBe(409);
  });
});
