import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-mrq249-decision";
const TOKEN = "mq_mrq249-decision-token";
const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const FIRST_SUBMISSION = "sub-mrq249-first";
const SECOND_SUBMISSION = "sub-mrq249-second";
const THIRD_SUBMISSION = "sub-mrq249-third";
const SPEAKER_ID = "person-mrq249-speaker";
const ACTOR_ID = "person-mrq249-actor";
const FIRST_NOTE = "MRQ-249 first internal note — never sent";
const SECOND_NOTE = "MRQ-249 second internal note — never sent";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const tokenHash = await sha256Hex(TOKEN);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ('org-mrq249-decision', 'MRQ-249 Org', 'mrq249-decision', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, 'org-mrq249-decision', 'Marquee Decision Summit', 'mrq249-decision', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
       VALUES
        (?, 'org-mrq249-decision', 'organizer@mrq249.test', 'Program Lead', ?, ?),
        (?, 'org-mrq249-decision', 'ada@mrq249.test', 'Ada Lovelace', ?, ?)`,
    ).bind(ACTOR_ID, NOW, NOW, SPEAKER_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq249-actor', 'org-mrq249-decision', ?, ?, 'program_lead', ?, ?)`,
    ).bind(EVENT_ID, ACTOR_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens
        (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('token-mrq249-decision', 'org-mrq249-decision', NULL, 'MRQ-249 test token', ?, 'mq_mrq249', ?, ?, ?, ?)`,
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:read", "program:write", "comms:send"], event_ids: [EVENT_ID] }), ACTOR_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, status, origin, submitter_person_id, last_write_source, submitted_at, created_at, updated_at)
       VALUES
        (?, ?, 'abstract', 'The first decision fact', 'submitted', 'public', ?, 'marquee', ?, ?, ?),
        (?, ?, 'abstract', 'The second decision fact', 'submitted', 'public', ?, 'marquee', ?, ?, ?),
        (?, ?, 'abstract', 'The third decision fact', 'submitted', 'public', ?, 'marquee', ?, ?, ?)`,
    ).bind(FIRST_SUBMISSION, EVENT_ID, SPEAKER_ID, NOW, NOW, NOW, SECOND_SUBMISSION, EVENT_ID, SPEAKER_ID, NOW, NOW, NOW, THIRD_SUBMISSION, EVENT_ID, SPEAKER_ID, NOW, NOW, NOW),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
       VALUES
        ('participation-mrq249-first', ?, ?, 'speaker', 0, ?, ?),
        ('participation-mrq249-second', ?, ?, 'speaker', 0, ?, ?),
        ('participation-mrq249-third', ?, ?, 'speaker', 0, ?, ?)`,
    ).bind(FIRST_SUBMISSION, SPEAKER_ID, NOW, NOW, SECOND_SUBMISSION, SPEAKER_ID, NOW, NOW, THIRD_SUBMISSION, SPEAKER_ID, NOW, NOW),
  ]);
}

function authHeaders(extra: Record<string, string> = {}): HeadersInit {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...extra };
}

async function applyDecision(submissionId: string, body: Record<string, unknown>): Promise<Response> {
  const planResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/${submissionId}/decision-plan`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ recommendation: body.recommendation, feedback_md: body.feedback_md }),
  });
  expect(planResponse.status).toBe(200);
  const plan = await planResponse.json<{ plan_fingerprint: string; etag: string }>();
  return SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/${submissionId}/decision`, {
    method: "POST",
    headers: authHeaders({ "if-match": plan.etag }),
    body: JSON.stringify({ ...body, plan_fingerprint: plan.plan_fingerprint }),
  });
}

function portalLinkFrom(text: string): string {
  const match = text.match(/https:\/\/marquee\.stage11\.dev\/api\/v1\/auth\/exchange\?token=[A-Za-z0-9_-]+/);
  expect(match?.[0]).toBeTruthy();
  return match![0];
}

async function expectPortalLinkWorks(link: string): Promise<string> {
  const exchange = await SELF.fetch(link, { redirect: "manual" });
  expect(exchange.status).toBe(302);
  expect(exchange.headers.get("location")).toMatch(/\/portal$/);
  const cookie = exchange.headers.get("set-cookie");
  expect(cookie).toMatch(/mq_session=/);
  return cookie!.split(";", 1)[0]!;
}

describe.sequential("MRQ-249 decision emails", () => {
  beforeAll(seedFixture, 20_000);

  test("AC-364 · MRQ-249 · default acceptance carries event facts, a recipient portal link, and an attributed private note", async () => {
    const response = await applyDecision(FIRST_SUBMISSION, {
      recommendation: "approve",
      feedback_md: "Bring the practical examples.",
      internal_note: FIRST_NOTE,
    });
    expect(response.status).toBe(200);
    const result = await response.json<{ outbox_id: string; outbox_inserted: boolean }>();
    expect(result.outbox_inserted).toBe(true);

    const outbox = await env.DB.prepare(
      "SELECT subject, text, html FROM outbox WHERE id = ?",
    ).bind(result.outbox_id).first<{ subject: string; text: string; html: string }>();
    expect(outbox?.subject).toContain("The first decision fact");
    expect(outbox?.subject).toContain("Marquee Decision Summit");
    expect(outbox?.text).toContain("Bring the practical examples.");
    expect(outbox?.text).not.toContain(FIRST_NOTE);
    expect(outbox?.text).not.toContain("{{portal.link}}");
    expect(outbox?.text).not.toMatch(/!/);
    expect(outbox?.html).toContain("Marquee Decision Summit");

    const portalLink = portalLinkFrom(outbox?.text ?? "");
    const sessionCookie = await expectPortalLinkWorks(portalLink);
    const token = new URL(portalLink).searchParams.get("token");
    expect(token).toBeTruthy();
    const magicLink = await env.DB.prepare(
      "SELECT person_id, event_id, purpose, redirect_to, expires_at, created_at, token_hash FROM magic_links WHERE token_hash = ?",
    ).bind(await sha256Hex(token!)).first<{ person_id: string; event_id: string; purpose: string; redirect_to: string; expires_at: number; created_at: number; token_hash: string }>();
    expect(magicLink).toMatchObject({ person_id: SPEAKER_ID, event_id: EVENT_ID, purpose: "portal_invite", redirect_to: "/portal" });
    expect(magicLink?.created_at).toBeDefined();
    expect(magicLink?.expires_at).toBe(magicLink!.created_at! + 15 * 24 * 60 * 60_000);

    const note = await env.DB.prepare(
      "SELECT body_md, author_person_id FROM submission_notes WHERE submission_id = ?",
    ).bind(FIRST_SUBMISSION).first<{ body_md: string; author_person_id: string }>();
    expect(note).toEqual({ body_md: FIRST_NOTE, author_person_id: ACTOR_ID });
    const portal = await SELF.fetch(`${ORIGIN}/api/v1/me/portal?eventId=${EVENT_ID}`, { headers: { cookie: sessionCookie } });
    expect(portal.status).toBe(200);
    expect(await portal.text()).not.toContain(FIRST_NOTE);
    const publicAgenda = await SELF.fetch(`${ORIGIN}/api/v1/public/agenda?event=mrq249-decision`);
    expect(await publicAgenda.text()).not.toContain(FIRST_NOTE);
  });

  test("AC-365 · MRQ-249 · edited token-deleted templates get a fallback link and markdown feedback keeps its URL", async () => {
    await env.DB.prepare(
      `INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
       VALUES ('template-mrq249-acceptance', ?, 'acceptance', 'Acceptance override', 'Decision for {{submission.title}}', 'Hi {{speaker.first_name}},\n\n{{decision.feedback}}', 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW).run();

    const feedback = "Read [the program guide](https://example.com/program-guide).";
    const response = await applyDecision(SECOND_SUBMISSION, {
      recommendation: "approve",
      feedback_md: feedback,
      internal_note: SECOND_NOTE,
    });
    expect(response.status).toBe(200);
    const result = await response.json<{ outbox_id: string }>();
    const outbox = await env.DB.prepare(
      "SELECT text, html FROM outbox WHERE id = ?",
    ).bind(result.outbox_id).first<{ text: string; html: string }>();
    const portalLink = portalLinkFrom(outbox?.text ?? "");
    expect(outbox?.text).toContain("the program guide (https://example.com/program-guide)");
    expect(outbox?.html).toContain('href="https://example.com/program-guide"');
    expect(outbox?.text).toContain(`Open your speaker portal: ${portalLink}`);
    expect(outbox?.html).toContain(portalLink);
    expect(outbox?.text).not.toContain("{{portal.link}}");
    expect(outbox?.text).not.toContain(SECOND_NOTE);
    await expectPortalLinkWorks(portalLink);
  });

  test("AC-366 · MRQ-249 · generic communications cannot send decision-only facts", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/comms/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        selector: { submission_ids: [FIRST_SUBMISSION], person_ids: [SPEAKER_ID], role: "speaker" },
        subject: "Decision facts",
        body: "{{decision.feedback}} {{portal.link}}",
      }),
    });
    expect(response.status).toBe(400);
    const message = await response.text();
    expect(message).toContain("decision.feedback");
    expect(message).toContain("portal.link");
  });

  test("AC-367 · MRQ-249 · one-off follow-ups with changed copy both queue", async () => {
    const selector = { submission_ids: [FIRST_SUBMISSION], person_ids: [SPEAKER_ID], role: "speaker" };
    const idempotencyKey = "mrq249-follow-up";
    const send = (subject: string, body: string) => SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/comms/send`, {
      method: "POST",
      headers: authHeaders({ "Idempotency-Key": idempotencyKey }),
      body: JSON.stringify({ selector, subject, body }),
    });

    const first = await send("Follow-up", "First follow-up");
    expect(first.status).toBe(202);
    const firstResult = await first.json<{ queued: number; duplicate: number; outbox_ids: string[] }>();
    expect(firstResult).toMatchObject({ queued: 1, duplicate: 0 });
    expect(firstResult.outbox_ids).toHaveLength(1);

    const changed = await send("Follow-up update", "Second follow-up");
    expect(changed.status).toBe(202);
    const changedResult = await changed.json<{ queued: number; duplicate: number; outbox_ids: string[] }>();
    expect(changedResult).toMatchObject({ queued: 1, duplicate: 0 });
    expect(changedResult.outbox_ids).toHaveLength(1);
    expect(changedResult.outbox_ids[0]).not.toBe(firstResult.outbox_ids[0]);

    const retry = await send("Follow-up update", "Second follow-up");
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ queued: 0, duplicate: 1, outbox_ids: [] });

    const rows = await env.DB.prepare(
      "SELECT id, subject, text FROM outbox WHERE id IN (?, ?)",
    ).bind(firstResult.outbox_ids[0], changedResult.outbox_ids[0]).all<{ id: string; subject: string; text: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.map((row) => row.subject)).toEqual(expect.arrayContaining(["Follow-up", "Follow-up update"]));
    expect(rows.results.map((row) => row.text)).toEqual(expect.arrayContaining(["First follow-up", "Second follow-up"]));
  });

  test("AC-368 · MRQ-249 · default rejection carries the event signoff and a working portal link", async () => {
    const response = await applyDecision(THIRD_SUBMISSION, {
      recommendation: "deny",
      feedback_md: "The program is full for this round.",
    });
    expect(response.status).toBe(200);
    const result = await response.json<{ outbox_id: string }>();
    const outbox = await env.DB.prepare("SELECT subject, text FROM outbox WHERE id = ?").bind(result.outbox_id).first<{ subject: string; text: string }>();
    expect(outbox?.subject).toContain("The third decision fact");
    expect(outbox?.subject).toContain("Marquee Decision Summit");
    expect(outbox?.text).toContain("We’re unable to include it in this program.");
    expect(outbox?.text).toContain("Marquee Decision Summit team");
    expect(outbox?.text).toContain("The program is full for this round.");
    expect(outbox?.text).not.toMatch(/!/);
    await expectPortalLinkWorks(portalLinkFrom(outbox?.text ?? ""));
  });
});
