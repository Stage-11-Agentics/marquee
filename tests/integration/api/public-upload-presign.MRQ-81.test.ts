/**
 * MRQ-81: the public presign refused every image on every public form, because
 * it resolved its policy from the owner type alone. `policyFor("draft_file")`
 * with no config narrows to documents, so the CFP headshot — a required field
 * whose own accept list asks for JPEG and PNG — came back `rejected: extension`
 * and the form could never be completed.
 *
 * The accept list now comes from the form field the draft belongs to, read
 * server-side. These tests hold both halves of that: the image a field asks for
 * is signed, and a stranger still cannot name a field to widen what they may
 * upload.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "../../../src/index";
import { mintMagicLink } from "../../../src/lib/auth/magic-links";
import { draftResumeRedirectTo } from "../../../src/routes/public-form.shared";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_upload_presign";
const FORM_ID = "form_upload_presign";
const NOW = Date.UTC(2026, 7, 11, 16, 0, 0);
let tokenSerial = 0;

function nextTurnstileToken(): string {
  tokenSerial += 1;
  return `presign-pass-${tokenSerial}`;
}

function turnstile(success: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
}

/**
 * Deterministic signing values, supplied per request rather than inherited from
 * whatever `.dev.vars` the machine happens to hold. Presigning is an HMAC over
 * strings, so fake credentials sign perfectly well — and a test that only
 * passes on a developer's machine because it holds live R2 credentials is not
 * hermetic, however green it looks locally.
 */
const TEST_ENV = {
  ...env,
  TURNSTILE_SECRET_KEY: "fake-turnstile-secret",
  R2_ACCOUNT_ID: "fake-account",
  R2_BUCKET_NAME: "fake-bucket",
  R2_ACCESS_KEY_ID: "fake-key-id",
  R2_SECRET_ACCESS_KEY: "fake-secret-key",
  MEDIA_PUBLIC_ORIGIN: "media.marquee.test",
  UPLOAD_TOKEN_SECRET: "fake-token-secret",
  UPLOAD_RATE_LIMIT_SECRET: "fake-rate-limit-secret",
} as unknown as Parameters<typeof app.fetch>[1];

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), TEST_ENV);
}

async function seed(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_upload_presign", "Presign Org", "presign-org", NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)").bind(EVENT_ID, "org_upload_presign", "Presign Conference", "presign-conference", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Call for speakers', 'presign-cfp', 'abstract', 'open', ?, ?, 'Tell us.', 3, 1, 4, 0, '[]', 1, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, 0, Date.UTC(2099, 0, 1), NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_email', ?, 'speaker_email', 'Primary speaker email', NULL, 'email', 1, 0, '{}', NULL, ?, ?),
      ('field_headshot', ?, 'headshot', 'Headshot', NULL, 'file', 0, 1, ?, NULL, ?, ?),
      ('field_slides', ?, 'supporting_file', 'Supporting material', NULL, 'file', 0, 2, ?, NULL, ?, ?),
      ('field_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 3, '{}', NULL, ?, ?)`)
      .bind(
        FORM_ID, NOW, NOW,
        FORM_ID, JSON.stringify({ accept: ["image/jpeg", "image/png"], maxBytes: 5_242_880 }), NOW, NOW,
        FORM_ID, JSON.stringify({ accept: ["application/pdf"], maxBytes: 100_000 }), NOW, NOW,
        FORM_ID, NOW, NOW,
      ),
  ]);
}

async function createDraft(): Promise<{ draftId: string; resumeToken: string }> {
  const response = await request("/api/v1/public/forms/presign-cfp/drafts", {
    method: "POST",
    body: JSON.stringify({
      turnstileToken: nextTurnstileToken(),
      email: "presign@example.com",
      answers: { speaker_email: "presign@example.com" },
    }),
  });
  expect(response.status).toBe(201);
  const body = await response.json<{ draft_id: string; resume_token: string }>();
  return { draftId: body.draft_id, resumeToken: body.resume_token };
}

async function sign(draft: { draftId: string; resumeToken: string }, file: { fieldKey: string; filename: string; contentType: string; sizeBytes?: number }) {
  return request("/api/v1/public/uploads/sign", {
    method: "POST",
    body: JSON.stringify({
      draftId: draft.draftId,
      resumeToken: draft.resumeToken,
      fieldKey: file.fieldKey,
      turnstileToken: nextTurnstileToken(),
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes ?? 22_785,
    }),
  });
}

describe.sequential("MRQ-81 public upload presign", () => {
  beforeEach(async () => {
    await seed();
    turnstile(true);
  });

  test("CONTRACT · a public headshot field signs the image it asks for", async () => {
    const draft = await createDraft();
    const response = await sign(draft, { fieldKey: "headshot", filename: "headshot.png", contentType: "image/png" });
    expect(response.status).toBe(200);
    const body = await response.json<{ attachmentId: string; putUrl: string; completionToken: string; maxBytes: number }>();
    expect(body.attachmentId).toBeTruthy();
    expect(body.putUrl).toBeTruthy();
    expect(body.completionToken).toBeTruthy();
    // The field's own ceiling, not the generic default.
    expect(body.maxBytes).toBe(5_242_880);

    const row = await env.DB.prepare("SELECT owner_type, owner_id, content_type, status FROM attachments WHERE id = ?1").bind(body.attachmentId).first<{ owner_type: string; owner_id: string; content_type: string; status: string }>();
    expect(row).toMatchObject({ owner_type: "draft_file", owner_id: draft.draftId, content_type: "image/png", status: "pending" });
  });

  test("CONTRACT · a JPEG is signed for the same field, so the label's promise of JPG or PNG holds", async () => {
    const draft = await createDraft();
    expect((await sign(draft, { fieldKey: "headshot", filename: "headshot.jpg", contentType: "image/jpeg" })).status).toBe(200);
  });

  test("CONTRACT · each field's own accept list binds, in both directions", async () => {
    const draft = await createDraft();
    const documentToImageField = await sign(draft, { fieldKey: "headshot", filename: "deck.pdf", contentType: "application/pdf", sizeBytes: 2_048 });
    expect(documentToImageField.status).toBe(400);
    expect(await documentToImageField.text()).toContain("rejected: extension");

    const imageToDocumentField = await sign(draft, { fieldKey: "supporting_file", filename: "headshot.png", contentType: "image/png", sizeBytes: 2_048 });
    expect(imageToDocumentField.status).toBe(400);
    expect(await imageToDocumentField.text()).toContain("rejected: extension");

    expect((await sign(draft, { fieldKey: "supporting_file", filename: "deck.pdf", contentType: "application/pdf", sizeBytes: 2_048 })).status).toBe(200);
  });

  test("CONTRACT · the field key is resolved against the form, so a stranger cannot invent an upload slot", async () => {
    const draft = await createDraft();
    // No such field.
    const invented = await sign(draft, { fieldKey: "not_a_field", filename: "headshot.png", contentType: "image/png" });
    expect(invented.status).toBe(404);
    // A real field of the wrong type is not an upload slot either.
    const notAFileField = await sign(draft, { fieldKey: "title", filename: "headshot.png", contentType: "image/png" });
    expect(notAFileField.status).toBe(404);
  });

  test("CONTRACT · the field's declared ceiling is enforced at sign time", async () => {
    const draft = await createDraft();
    const tooLarge = await sign(draft, { fieldKey: "supporting_file", filename: "deck.pdf", contentType: "application/pdf", sizeBytes: 200_000 });
    expect(tooLarge.status).toBe(400);
    expect(await tooLarge.text()).toContain("rejected: too_large");
  });

  test("CONTRACT · the presign stays behind Turnstile and the draft's own resume token", async () => {
    // This contract binds real conferences. The fixture event is demo_mode = 1
    // and demo conferences are exempt from the bot gate (publicTurnstileExempt),
    // so drop it to a real conference to measure what this test names.
    await env.DB.prepare("UPDATE events SET demo_mode = 0 WHERE id = ?").bind(EVENT_ID).run();
    const draft = await createDraft();

    const noToken = await request("/api/v1/public/uploads/sign", {
      method: "POST",
      body: JSON.stringify({ draftId: draft.draftId, resumeToken: draft.resumeToken, fieldKey: "headshot", filename: "headshot.png", contentType: "image/png", sizeBytes: 2_048 }),
    });
    expect(noToken.status).toBe(403);

    turnstile(false);
    const failedToken = await sign(draft, { fieldKey: "headshot", filename: "headshot.png", contentType: "image/png" });
    expect(failedToken.status).toBe(403);

    turnstile(true);
    const wrongResume = await sign({ draftId: draft.draftId, resumeToken: "not-the-resume-token-for-this-draft" }, { fieldKey: "headshot", filename: "headshot.png", contentType: "image/png" });
    expect(wrongResume.status).toBe(403);
  });

  test("CONTRACT · MRQ-247 · public upload accepts both raw and submission-bound reminder capabilities while open", async () => {
    const draft = await createDraft();
    const submitter = await env.DB.prepare("SELECT submitter_person_id AS id FROM submissions WHERE id = ?").bind(draft.draftId).first<{ id: string }>();
    const reminder = await mintMagicLink(env.DB, {
      personId: submitter!.id,
      eventId: EVENT_ID,
      purpose: "draft_resume",
      redirectTo: draftResumeRedirectTo("presign-cfp", draft.draftId),
    });
    expect((await sign(draft, { fieldKey: "headshot", filename: "raw.png", contentType: "image/png" })).status).toBe(200);
    expect((await sign({ draftId: draft.draftId, resumeToken: reminder.token }, { fieldKey: "headshot", filename: "reminder.png", contentType: "image/png" })).status).toBe(200);
  });

  test("CONTRACT · MRQ-247 · closed-form uploads say the call is closed for raw and reminder capabilities", async () => {
    const draft = await createDraft();
    const submitter = await env.DB.prepare("SELECT submitter_person_id AS id FROM submissions WHERE id = ?").bind(draft.draftId).first<{ id: string }>();
    const reminder = await mintMagicLink(env.DB, {
      personId: submitter!.id,
      eventId: EVENT_ID,
      purpose: "draft_resume",
      redirectTo: draftResumeRedirectTo("presign-cfp", draft.draftId),
    });
    await env.DB.prepare("UPDATE forms SET status = 'closed' WHERE id = ?").bind(FORM_ID).run();
    for (const token of [draft.resumeToken, reminder.token]) {
      const response = await sign({ draftId: draft.draftId, resumeToken: token }, { fieldKey: "headshot", filename: "closed.png", contentType: "image/png" });
      const body = await response.text();
      expect(response.status).toBe(403);
      expect(body).toContain("This call is closed");
      expect(body).toContain("files can no longer be changed");
      expect(body).not.toContain("resume token does not match draft");
      expect(body).not.toContain("invalid token");
    }
  });

  test("CONTRACT · a submission continuing its own draft rides that draft's security check, and nothing else does", async () => {
    // A Turnstile token is single-use. Attaching a file spends one creating
    // the draft, so demanding a second one at Submit strands the submitter
    // between the two. A resume token that resolves to this form's draft is
    // the same authority autosave already accepts; anything else is not.
    // Measured on a real conference: demo conferences skip the gate entirely
    // (publicTurnstileExempt), which would make this contract unobservable.
    await env.DB.prepare("UPDATE events SET demo_mode = 0 WHERE id = ?").bind(EVENT_ID).run();
    const draft = await createDraft();
    const answers = { speaker_email: "presign@example.com", title: "Continuing my own draft" };

    const continued = await request("/api/v1/public/forms/presign-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ resumeToken: draft.resumeToken, answers }),
    });
    expect(continued.status).toBe(201);
    expect((await continued.json<{ state: string }>()).state).toBe("submitted");

    // No resume token: the full gate still stands, exactly as before.
    const anonymous = await request("/api/v1/public/forms/presign-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ answers: { speaker_email: "stranger@example.com", title: "No draft, no token" } }),
    });
    expect(anonymous.status).toBe(403);

    // A resume token that resolves to nothing is not a way around the gate.
    const forged = await request("/api/v1/public/forms/presign-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ resumeToken: "forged-resume-token-that-resolves-to-nothing", answers }),
    });
    expect(forged.status).toBe(403);

    turnstile(false);
    const failedCheck = await request("/api/v1/public/forms/presign-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: "failed", answers: { speaker_email: "failed@example.com", title: "Failed check" } }),
    });
    expect(failedCheck.status).toBe(403);
  });

  test("CONTRACT · the local upload shim is refused unless the Worker was started with it", async () => {
    // The shim exists so a checkout with no R2 account can still upload. It is
    // off by default, and off means the route does not exist at all — a deploy
    // that forgot a flag must not quietly expose a same-origin write path.
    const draft = await createDraft();
    const signed = await sign(draft, { fieldKey: "headshot", filename: "headshot.png", contentType: "image/png" });
    expect(signed.status).toBe(200);
    const { attachmentId } = await signed.json<{ attachmentId: string }>();

    const put = await request(`/api/v1/uploads/local/${attachmentId}?expires=${Date.now() + 60_000}&token=anything`, {
      method: "PUT",
      body: "not-really-an-image",
    });
    expect(put.status).toBe(404);

    const object = await env.MEDIA.list();
    expect(object.objects).toHaveLength(0);
  });
});
