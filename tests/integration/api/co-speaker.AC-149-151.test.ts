import { beforeEach, describe, expect, test, vi } from "vitest";
import { SELF } from "cloudflare:test";

import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_cospeaker";
const FORM_ID = "form_cospeaker";
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
let turnstileSerial = 0;

async function request(path: string, init: RequestInit = {}, cookie = ""): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function turnstile(success: boolean): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
}

async function count(table: "people" | "submissions" | "participations" | "submission_answers" | "outbox" | "attachments"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

async function seedForm(maxSpeakers = 2): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_cospeaker", "Co-speaker Org", "co-speaker", NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, ?)").bind(EVENT_ID, "org_cospeaker", "Co-speaker Conference", "co-speaker-conference", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Co-speaker CFP', 'co-speaker-cfp', 'abstract', 'open', ?, ?, ?, 3, 1, ?, 0, '[]', 1, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, 0, Date.UTC(2099, 0, 1), "Bring another voice to the conference.", maxSpeakers, NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field-cospeaker-title', ?, 'title', 'Abstract title', NULL, 'short_text', 1, 0, '{}', NULL, ?, ?),
      ('field-cospeaker-name', ?, 'speaker_name', 'Primary speaker', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
      ('field-cospeaker-email', ?, 'speaker_email', 'Primary email', NULL, 'email', 1, 2, '{}', NULL, ?, ?),
      ('field-cospeaker-co-name', ?, 'co_speaker_name', 'Co-speaker name', NULL, 'short_text', 0, 3, '{}', NULL, ?, ?),
      ('field-cospeaker-co-email', ?, 'co_speaker_email', 'Co-speaker email', NULL, 'email', 0, 4, '{}', NULL, ?, ?)`)
      .bind(FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW),
  ]);
  turnstile(true);
}

async function submitWithCoSpeaker(): Promise<{ submissionId: string; coSpeakerId: string; inviteText: string; inviteToken: string }> {
  turnstileSerial += 1;
  const response = await request("/api/v1/public/forms/co-speaker-cfp/submissions", {
    method: "POST",
    body: JSON.stringify({
      turnstileToken: `cospeaker-pass-${turnstileSerial}`,
      answers: {
        title: "A precise invitation",
        speaker_name: "Primary Speaker",
        speaker_email: "primary@example.com",
        co_speaker_name: "Invited Co-speaker",
        co_speaker_email: "co-speaker@example.com",
      },
    }),
  });
  expect(response.status).toBe(201);
  const submission = await env.DB.prepare("SELECT id FROM submissions WHERE event_id = ? ORDER BY created_at DESC LIMIT 1").bind(EVENT_ID).first<{ id: string }>();
  const coSpeaker = await env.DB.prepare("SELECT id FROM participations WHERE submission_id = ? AND role = 'co_speaker'").bind(submission?.id).first<{ id: string }>();
  const invite = await env.DB.prepare("SELECT text FROM outbox WHERE template_key = 'added_to_submission' ORDER BY created_at DESC LIMIT 1").first<{ text: string }>();
  const inviteToken = invite?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  expect(submission?.id).toBeTruthy();
  expect(coSpeaker?.id).toBeTruthy();
  expect(invite?.text).toContain("Primary Speaker");
  expect(invite?.text).toContain("A precise invitation");
  expect(inviteToken).toBeTruthy();
  return { submissionId: submission!.id, coSpeakerId: coSpeaker!.id, inviteText: invite!.text, inviteToken: inviteToken! };
}

async function exchange(token: string): Promise<string> {
  const response = await request(`/api/v1/auth/exchange?token=${encodeURIComponent(token)}`, { redirect: "manual" });
  expect(response.status).toBe(302);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toMatch(/^mq_session=/);
  return cookie!;
}

describe.sequential("MRQ-37 co-speaker flow", () => {
  beforeEach(async () => {
    await seedForm();
  });

  test("AC-149 + AC-150 · the public submission creates one participation and one actionable invitation at the configured limit", async () => {
    const result = await submitWithCoSpeaker();
    const participations = await env.DB.prepare("SELECT role, person_id, invited_at FROM participations WHERE submission_id = ? ORDER BY role").bind(result.submissionId).all<{ role: string; person_id: string; invited_at: number | null }>();
    expect(participations.results.map((row) => row.role)).toEqual(["co_speaker", "speaker", "submitter"]);
    expect(participations.results.find((row) => row.role === "co_speaker")?.invited_at).toEqual(expect.any(Number));
    expect(result.inviteText).toContain("Add your bio and headshot");
    const invite = await env.DB.prepare("SELECT send_policy, to_email, entity_id FROM outbox WHERE template_key = 'added_to_submission'").first<{ send_policy: string; to_email: string; entity_id: string }>();
    expect(invite).toMatchObject({ send_policy: "demo_safe", to_email: "co-speaker@example.com", entity_id: result.coSpeakerId });
    expect(await count("participations")).toBe(3);
    expect(await count("outbox")).toBe(2);
  });

  test("AC-149 · a submission over the speaker limit is refused before people, submissions, participations, or mail are written", async () => {
    await env.DB.prepare("UPDATE forms SET max_speakers = 1 WHERE id = ?").bind(FORM_ID).run();
    const before = {
      people: await count("people"),
      submissions: await count("submissions"),
      participations: await count("participations"),
      outbox: await count("outbox"),
    };
    turnstileSerial += 1;
    const rejected = await request("/api/v1/public/forms/co-speaker-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: `cospeaker-limit-${turnstileSerial}`, answers: { title: "Too many voices", speaker_name: "Primary", speaker_email: "limit-primary@example.com", co_speaker_name: "Extra", co_speaker_email: "limit-extra@example.com" } }),
    });
    expect(rejected.status).toBe(422);
    const body = await rejected.text();
    expect(body).toContain("Remove an extra participant");
    expect(await count("people")).toBe(before.people);
    expect(await count("submissions")).toBe(before.submissions);
    expect(await count("participations")).toBe(before.participations);
    expect(await count("outbox")).toBe(before.outbox);

    turnstileSerial += 1;
    const positive = await request("/api/v1/public/forms/co-speaker-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: `cospeaker-positive-${turnstileSerial}`, answers: { title: "One voice is allowed", speaker_name: "Allowed Primary", speaker_email: "allowed-primary@example.com" } }),
    });
    expect(positive.status).toBe(201);
  });

  test("AC-151 · the co-speaker can update bio and headshot on the invited submission without abstract editing", async () => {
    const result = await submitWithCoSpeaker();
    const cookie = await exchange(result.inviteToken);
    await env.DB.prepare("UPDATE submissions SET status = 'accepted' WHERE id = ?").bind(result.submissionId).run();
    await env.DB.prepare(
      `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at)
       SELECT 'headshot-cospeaker', ?, 'person_headshot', person_id, 'headshots/co-speaker.png', 'co-speaker.png', 'image/png', 2048, 'ready', 'etag-cospeaker', ?, ?
       FROM participations WHERE id = ?`,
    ).bind(EVENT_ID, NOW, NOW, result.coSpeakerId).run();

    const positive = await request(`/api/v1/me/co-speaker/submissions/${encodeURIComponent(result.submissionId)}`, {}, cookie);
    expect(positive.status).toBe(200);
    const positiveBody = await positive.json<{ submission: { id: string; title: string; abstract: string | null }; participation: { role: string }; person: { bio: string | null } }>();
    expect(positiveBody.submission).toMatchObject({ id: result.submissionId, title: "A precise invitation" });
    expect(positiveBody.participation.role).toBe("co_speaker");

    const confirmed = await request(`/api/v1/me/participations/${encodeURIComponent(result.coSpeakerId)}/confirm`, { method: "POST" }, cookie);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json<{ participation: { id: string; role: string; confirmation_status: string } }>()).toMatchObject({
      participation: { id: result.coSpeakerId, role: "co_speaker", confirmation_status: "confirmed" },
    });

    const updated = await request(`/api/v1/me/co-speaker/submissions/${encodeURIComponent(result.submissionId)}/profile`, {
      method: "PATCH",
      body: JSON.stringify({ bio: "A bio supplied by the invited co-speaker.", headshot_attachment_id: "headshot-cospeaker" }),
    }, cookie);
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json<{ person: { bio: string; headshot_attachment_id: string } }>();
    expect(updatedBody.person).toMatchObject({ bio: "A bio supplied by the invited co-speaker.", headshot_attachment_id: "headshot-cospeaker" });
    const stored = await env.DB.prepare("SELECT bio, headshot_attachment_id FROM people WHERE email = 'co-speaker@example.com'").first<{ bio: string; headshot_attachment_id: string }>();
    expect(stored).toEqual({ bio: "A bio supplied by the invited co-speaker.", headshot_attachment_id: "headshot-cospeaker" });
    const talkEdit = await request(`/api/v1/me/submissions/${encodeURIComponent(result.submissionId)}/talk`, { method: "PATCH", body: JSON.stringify({ title: "Must stay read only" }) }, cookie);
    expect(talkEdit.status).toBe(403);
    expect(await talkEdit.text()).not.toContain("Must stay read only");
  });

  test("AC-151 · wrong-submission reads and writes are refused without leaking its id or title or changing row counts", async () => {
    const result = await submitWithCoSpeaker();
    const cookie = await exchange(result.inviteToken);
    const otherSubmissionId = "sub-cospeaker-other";
    const otherTitle = "Other private abstract title";
    await env.DB.prepare(
      `INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, created_at, updated_at)
       SELECT ?, event_id, form_id, kind, ?, 'Other private abstract', 'submitted', 'public', submitter_person_id, ?, ?
       FROM submissions WHERE id = ?`,
    ).bind(otherSubmissionId, otherTitle, NOW, NOW, result.submissionId).run();
    const before = {
      people: await count("people"),
      submissions: await count("submissions"),
      participations: await count("participations"),
      submission_answers: await count("submission_answers"),
      outbox: await count("outbox"),
      attachments: await count("attachments"),
    };

    const wrongRead = await request(`/api/v1/me/co-speaker/submissions/${otherSubmissionId}`, {}, cookie);
    expect(wrongRead.status).toBe(404);
    const wrongReadBody = await wrongRead.text();
    expect(wrongReadBody).not.toContain(otherSubmissionId);
    expect(wrongReadBody).not.toContain(otherTitle);
    const wrongWrite = await request(`/api/v1/me/co-speaker/submissions/${otherSubmissionId}/profile`, {
      method: "PATCH",
      body: JSON.stringify({ bio: "This must not be written" }),
    }, cookie);
    expect(wrongWrite.status).toBe(404);
    const wrongWriteBody = await wrongWrite.text();
    expect(wrongWriteBody).not.toContain(otherSubmissionId);
    expect(wrongWriteBody).not.toContain(otherTitle);
    expect(await count("people")).toBe(before.people);
    expect(await count("submissions")).toBe(before.submissions);
    expect(await count("participations")).toBe(before.participations);
    expect(await count("submission_answers")).toBe(before.submission_answers);
    expect(await count("outbox")).toBe(before.outbox);
    expect(await count("attachments")).toBe(before.attachments);

    const positive = await request(`/api/v1/me/co-speaker/submissions/${encodeURIComponent(result.submissionId)}`, {}, cookie);
    expect(positive.status).toBe(200);
    expect(await positive.text()).toContain("A precise invitation");
  });
});
