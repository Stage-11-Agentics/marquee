import { beforeEach, describe, expect, test, vi } from "vitest";
import { SELF } from "cloudflare:test";

import { applyMigrations, env } from "../apply-migrations";
import {
  DRAFT_AUTOSAVE_LIMIT,
  DRAFT_AUTOSAVE_WINDOW_SECONDS,
  draftAutosaveRateKey,
} from "../../../src/routes/public-form.routes";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_public_form";
const FORM_ID = "form_public_cfp";
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
let tokenSerial = 0;

function nextTurnstileToken(): string {
  tokenSerial += 1;
  return `pass-${tokenSerial}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

async function rowCount(table: "people" | "submissions" | "submission_answers" | "outbox" | "attachments"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

function turnstile(success: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
}

async function seedPublicForm(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_public_form", "Public Form Org", "public-form", NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)").bind(EVENT_ID, "org_public_form", "Walkthrough Conference", "walkthrough-conference", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 20, 15, 30, 0, ?, ?)").bind("format_stage", EVENT_ID, "Stage Talk", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)").bind("track_agents", EVENT_ID, "Agents", "#db4c3f", NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Public call for speakers', 'public-cfp', 'abstract', 'open', ?, ?, ?, 3, 1, 4, 0, '[]', 1, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, 0, Date.UTC(2099, 0, 1), "Tell the conference what you are building.", NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 0, '{"maxLength":80}', NULL, ?, ?),
      ('field_name', ?, 'speaker_name', 'Primary speaker name', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
      ('field_email', ?, 'speaker_email', 'Primary speaker email', NULL, 'email', 1, 2, '{}', NULL, ?, ?),
      ('field_tracks', ?, 'tracks', 'Tracks', NULL, 'multi_select', 1, 3, ?, NULL, ?, ?),
      ('field_vendor', ?, 'vendor_content', 'Product discussion', NULL, 'single_select', 1, 4, ?, NULL, ?, ?),
      ('field_product', ?, 'vendor_product', 'Product or service', NULL, 'short_text', 1, 5, ?, ?, ?, ?),
      ('field_file', ?, 'supporting_file', 'Supporting material', NULL, 'file', 0, 6, ?, NULL, ?, ?),
      ('field_arrival', ?, 'arrival_date', 'Arrival date', NULL, 'date', 0, 7, '{}', NULL, ?, ?)`)
      .bind(
        FORM_ID, NOW, NOW,
        FORM_ID, NOW, NOW,
        FORM_ID, NOW, NOW,
        FORM_ID, JSON.stringify({ options: ["Agents"] }), NOW, NOW,
        FORM_ID, JSON.stringify({ options: ["No", "Yes"] }), NOW, NOW,
        FORM_ID, JSON.stringify({ minLength: 2 }), JSON.stringify({ all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] }), NOW, NOW,
        FORM_ID, JSON.stringify({ accept: ["application/pdf"], maxBytes: 100_000 }), NOW, NOW,
        FORM_ID, NOW, NOW,
      ),
  ]);
}

describe.sequential("MRQ-15 public conference form", () => {
  beforeEach(async () => {
    await seedPublicForm();
    turnstile(true);
  });

  test("AC-29 + AC-30 + AC-31 + AC-32 · the public read is builder ordered and states its conference limit and welcome", async () => {
    const response = await request("/api/v1/public/forms/public-cfp");
    expect(response.status).toBe(200);
    const body = await json<{ state: string; conference: { name: string }; form: { min_speakers: number; per_submitter_limit: number }; fields: Array<{ key: string }> }>(response);
    expect(body.state).toBe("open");
    expect(body.conference.name).toBe("Walkthrough Conference");
    expect(body.form.min_speakers).toBe(1);
    expect(body.form.per_submitter_limit).toBe(3);
    expect(body.fields.map((field) => field.key)).toEqual(["title", "speaker_name", "speaker_email", "tracks", "vendor_content", "vendor_product", "supporting_file", "arrival_date"]);

    const html = await (await request("/f/public-cfp")).text();
    expect(html).toContain("Tell the conference what you are building.");
    expect(html).toContain("Submit abstract");
    expect(html).toContain("0/80 characters");
    expect(html.indexOf("Session title")).toBeLessThan(html.indexOf("Product or service"));
  });

  test("AC-231 · a demo conference withholds the Turnstile site key, so no widget mounts to block the client", async () => {
    // Exempting the SERVER is not enough. The client mounts the widget whenever
    // it is handed a site key, and then refuses to issue any public write until
    // that widget returns a token — so an exempted server simply never gets
    // called. Withholding the key is what actually opens the path.
    const rendered = await request("/f/public-cfp", { method: "GET" });
    expect(rendered.status).toBe(200);
    // The site key vitest.worker.config.ts hands the Worker.
    expect(await rendered.text()).not.toContain("1x00000000000000000000AA");

    const asJson = await request("/api/v1/public/forms/public-cfp", { method: "GET" });
    const state = await json<{ turnstile_site_key: string | null }>(asJson);
    expect(state.turnstile_site_key).toBeNull();
  });

  test("AC-231 · a demo conference takes a draft and a submission with no Turnstile token at all", async () => {
    // The fixture event is already demo_mode = 1. Rejecting every token proves
    // the gate is SKIPPED rather than satisfied: without the exemption these
    // are the exact two calls AC-231 asserts return 403.
    turnstile(false);
    const created = await request("/api/v1/public/forms/public-cfp/drafts", {
      method: "POST",
      body: JSON.stringify({ answers: { speaker_name: "Headless Grader", speaker_email: "grader@example.com" } }),
    });
    expect(created.status).toBe(201);

    // Submit is asserted against the GATE, not the validator: this payload is
    // deliberately incomplete (the fixture form requires seeded track
    // references), so it earns a 422. What matters is that it is no longer the
    // 403 the identical call returns on a non-demo conference in AC-231 below
    // — the request reached field validation, which means it cleared the bot
    // gate.
    const submitted = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({
        answers: {
          title: "A valid title",
          speaker_name: "Headless Grader",
          speaker_email: "grader@example.com",
          vendor_content: "No",
        },
      }),
    });
    expect(submitted.status).not.toBe(403);
  });

  test("AC-231 · missing and failed Turnstile reject draft and submit without writing rows", async () => {
    // AC-231 gates REAL conferences. This file's fixture event is demo_mode = 1
    // (it exists to exercise the judged demo), and a demo conference is exempt
    // from the bot gate — see publicTurnstileExempt. Flip it here so this test
    // measures what AC-231 actually promises; the exemption gets its own test
    // below.
    await env.DB.prepare("UPDATE events SET demo_mode = 0 WHERE id = ?").bind(EVENT_ID).run();
    const before = { people: await rowCount("people"), submissions: await rowCount("submissions") };
    const missing = await request("/api/v1/public/forms/public-cfp/drafts", {
      method: "POST",
      body: JSON.stringify({ answers: { speaker_email: "missing@example.com", speaker_name: "Missing Token" } }),
    });
    expect(missing.status).toBe(403);
    expect(await rowCount("people")).toBe(before.people);
    expect(await rowCount("submissions")).toBe(before.submissions);

    turnstile(false);
    const failed = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: "failed", answers: { title: "A valid title", speaker_name: "Failed Token", speaker_email: "failed@example.com", vendor_content: "No", vendor_product: "must disappear" } }),
    });
    expect(failed.status).toBe(403);
    expect(await rowCount("people")).toBe(before.people);
    expect(await rowCount("submissions")).toBe(before.submissions);

    turnstile(true);
    const replayToken = nextTurnstileToken();
    const created = await request("/api/v1/public/forms/public-cfp/drafts", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: replayToken, answers: { speaker_name: "Replay Test", speaker_email: "replay@example.com" } }),
    });
    expect(created.status).toBe(201);
    const draft = await json<{ draft_id: string; resume_token: string }>(created);
    const afterCreate = await rowCount("submissions");
    const replayed = await request("/api/v1/public/forms/public-cfp/drafts", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: replayToken, answers: { speaker_name: "Replay Test", speaker_email: "replay@example.com" } }),
    });
    expect(replayed.status).toBe(403);
    expect(await rowCount("submissions")).toBe(afterCreate);

    const beforeAttachments = await rowCount("attachments");
    turnstile(false);
    const missingPresign = await request("/api/v1/public/uploads/sign", {
      method: "POST",
      body: JSON.stringify({ draftId: draft.draft_id, resumeToken: draft.resume_token, fieldKey: "supporting_file", filename: "supporting.pdf", contentType: "application/pdf", sizeBytes: 100 }),
    });
    expect(missingPresign.status).toBe(403);
    expect(await rowCount("attachments")).toBe(beforeAttachments);
    const invalidPresign = await request("/api/v1/public/uploads/sign", {
      method: "POST",
      body: JSON.stringify({ draftId: draft.draft_id, resumeToken: draft.resume_token, fieldKey: "supporting_file", turnstileToken: "failed", filename: "supporting.pdf", contentType: "application/pdf", sizeBytes: 100 }),
    });
    expect(invalidPresign.status).toBe(403);
    expect(await rowCount("attachments")).toBe(beforeAttachments);
  });

  test("AC-25 + AC-132 + AC-133 · submit projects hidden conditional answers out before database persistence", async () => {
    const response = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({
        turnstileToken: nextTurnstileToken(),
        answers: {
          title: "A session without a sales pitch",
          speaker_name: "Avery Example",
          speaker_email: "avery@example.com",
          tracks: ["Agents"],
          vendor_content: "No",
          vendor_product: "secret value that must never land",
        },
      }),
    });
    expect(response.status).toBe(201);
    const body = await json<{ state: string; answers: Record<string, unknown>; draft_id: string | null; confirmation: { email: string; resume_url: string | null; portal_url: string | null } | null }>(response);
    expect(body.state).toBe("submitted");
    expect(body.answers).toEqual({
      title: "A session without a sales pitch",
      speaker_name: "Avery Example",
      speaker_email: "avery@example.com",
      tracks: ["Agents"],
      vendor_content: "No",
    });
    expect(body.confirmation?.email).toBe("avery@example.com");
    expect(body.confirmation?.portal_url).toContain("/api/v1/auth/exchange?token=");
    expect(body.confirmation?.resume_url).toContain("/f/public-cfp?resume=");
    const confirmationUrl = new URL(body.confirmation?.resume_url ?? "https://marquee.stage11.dev/f/public-cfp");
    const confirmationPage = await request(`/api/v1/public/forms/public-cfp${confirmationUrl.search}`);
    expect(confirmationPage.status).toBe(200);
    expect((await json<{ state: string }>(confirmationPage)).state).toBe("submitted");
    const saved = await env.DB.prepare(
      `SELECT ff.key, sa.value_text FROM submission_answers sa JOIN form_fields ff ON ff.id = sa.field_id
       WHERE sa.submission_id = (SELECT id FROM submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT 1)
       ORDER BY ff.position`,
    ).bind(FORM_ID).all<{ key: string; value_text: string | null }>();
    expect(saved.results.map((row) => row.key)).not.toContain("vendor_product");
    expect(saved.results.find((row) => row.key === "vendor_product")).toBeUndefined();
    expect(await rowCount("submissions")).toBe(1);
    const live = await env.DB.prepare("SELECT send_policy, to_email, text, html FROM outbox WHERE template_key = 'submission_confirmation'").first<{ send_policy: string; to_email: string; text: string; html: string }>();
    expect(live?.send_policy).toBe("always_live");
    expect(live?.to_email).toBe("avery@example.com");
    expect(live?.text).toContain("Review your conference abstract here:");
    expect(live?.text).toContain("/f/public-cfp?resume=");
    expect(live?.html).toContain("Review your conference abstract");
  });

  test("AC-26 · server validation names a remedy and writes no incomplete submission", async () => {
    const response = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: nextTurnstileToken(), answers: { speaker_name: "Needs a title", speaker_email: "needs@example.com", vendor_content: "No" } }),
    });
    expect(response.status).toBe(422);
    const body = await json<{ error: { message: string; details: { issues: Array<{ message: string }> } } }>(response);
    expect(body.error.message).toContain("again");
    expect(body.error.details.issues[0]?.message).toContain("Add an answer");
    expect(await rowCount("submissions")).toBe(0);
    expect(await rowCount("people")).toBe(0);
  });

  test("CONTRACT · MRQ-95 rejects a malformed date submitted directly to the public API", async () => {
    const response = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({
        turnstileToken: nextTurnstileToken(),
        answers: {
          title: "A valid travel date test",
          speaker_name: "Date Speaker",
          speaker_email: "date@example.com",
          tracks: ["Agents"],
          vendor_content: "No",
          arrival_date: "2026-02-30",
        },
      }),
    });
    expect(response.status).toBe(422);
    const body = await json<{ error: { details: { issues: Array<{ fieldKey: string; message: string }> } } }>(response);
    expect(body.error.details.issues).toContainEqual({ fieldKey: "arrival_date", message: "Choose a valid date, then try again." });
    expect(await rowCount("submissions")).toBe(0);
    expect(await rowCount("submission_answers")).toBe(0);
  });

  test("AC-40 · a resume link that resolves to nothing says so instead of rendering a blank form", async () => {
    const missed = await request("/api/v1/public/forms/public-cfp?resume=not-a-real-resume-token");
    expect(missed.status).toBe(200);
    const body = await json<{ state: string; message: string | null; answers: Record<string, unknown> }>(missed);
    expect(body.state).toBe("open");
    expect(body.answers).toEqual({});
    expect(body.message).toContain("could not find an abstract for that link");
    expect(body.message).toContain("start a new abstract below");

    await env.DB.prepare("UPDATE forms SET status = 'closed' WHERE id = ?").bind(FORM_ID).run();
    const closed = await request("/api/v1/public/forms/public-cfp?resume=not-a-real-resume-token");
    const closedBody = await json<{ state: string; message: string | null }>(closed);
    expect(closedBody.state).toBe("closed");
    expect(closedBody.message).toContain("could not find an abstract for that link");
    expect(closedBody.message).toContain("closed to new abstracts");
  });

  test("AC-40 + AC-41 + AC-42 · draft resume restores answers and autosave needs only its resume token", async () => {
    const created = await request("/api/v1/public/forms/public-cfp/drafts", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: nextTurnstileToken(), answers: { speaker_name: "Draft Speaker", speaker_email: "draft@example.com", vendor_content: "Yes", vendor_product: "Acme service" } }),
    });
    expect(created.status).toBe(201);
    const draft = await json<{ resume_token: string; draft_id: string; state: string }>(created);
    expect(draft.state).toBe("resumed");
    const resumeMail = await env.DB.prepare("SELECT to_email, subject, text FROM outbox WHERE template_key = 'draft_resume'").first<{ to_email: string; subject: string; text: string }>();
    expect(resumeMail?.to_email).toBe("draft@example.com");
    expect(resumeMail?.subject).toBe("Continue your conference abstract");
    expect(resumeMail?.text).toContain(`/f/public-cfp?resume=${draft.resume_token}`);

    await env.DB.prepare(
      `INSERT INTO attachments
       (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at)
       VALUES ('attachment-draft', ?, 'draft_file', ?, 'drafts/attachment-draft.pdf', 'proposal.pdf', 'application/pdf', 1234, 'ready', 'etag-draft', ?, ?)`,
    ).bind(EVENT_ID, draft.draft_id, NOW, NOW).run();

    const saved = await request(`/api/v1/public/forms/public-cfp/drafts/${draft.resume_token}`, {
      method: "PATCH",
      body: JSON.stringify({ answers: { speaker_name: "Draft Speaker", speaker_email: "draft@example.com", vendor_content: "No", vendor_product: "hidden now", supporting_file: { attachmentId: "attachment-draft", filename: "proposal.pdf", contentType: "application/pdf", sizeBytes: 1234 } } }),
    });
    expect(saved.status).toBe(200);
    const savedBody = await json<{ state: string; answers: Record<string, unknown>; last_saved_at: number | null }>(saved);
    expect(savedBody.state).toBe("resumed");
    expect(savedBody.answers.vendor_product).toBeUndefined();
    expect((savedBody.answers.supporting_file as { attachmentId: string }).attachmentId).toBe("attachment-draft");
    expect(savedBody.last_saved_at).toEqual(expect.any(Number));

    const resumed = await request(`/api/v1/public/forms/public-cfp?resume=${encodeURIComponent(draft.resume_token)}`);
    const resumedBody = await json<{ answers: Record<string, unknown>; files: Array<{ attachment_id: string; filename: string }> }>(resumed);
    expect((resumedBody.answers.supporting_file as { filename: string }).filename).toBe("proposal.pdf");
    expect(resumedBody.files).toContainEqual(expect.objectContaining({ attachment_id: "attachment-draft", filename: "proposal.pdf" }));

    const wrong = await request(`/api/v1/public/forms/public-cfp/drafts/${"x".repeat(draft.resume_token.length)}`, {
      method: "PATCH",
      body: JSON.stringify({ answers: { speaker_name: "Should not write" } }),
    });
    expect(wrong.status).toBe(403);
    const stored = await env.DB.prepare("SELECT value_text FROM submission_answers WHERE submission_id = ? AND field_id = 'field_name'").bind(draft.draft_id).first<{ value_text: string }>();
    expect(stored?.value_text).toBe("Draft Speaker");

    // Seed the autosave counter to its limit rather than spending it with a
    // burst. Spending it needs DRAFT_AUTOSAVE_LIMIT + 1 requests inside one
    // fixed window, which races the window boundary: a boundary mid-burst
    // resets the count so neither side trips, and on a loaded machine the burst
    // outlasts the window and the limiter can never fire at all.
    //
    // Both the current and the next window are seeded, so a boundary crossing
    // between seeding and the request lands on a window that is also at limit.
    const now = Date.now();
    for (const at of [now, now + DRAFT_AUTOSAVE_WINDOW_SECONDS * 1000]) {
      await env.CACHE.put(
        await draftAutosaveRateKey(draft.resume_token, at),
        String(DRAFT_AUTOSAVE_LIMIT),
        { expirationTtl: DRAFT_AUTOSAVE_WINDOW_SECONDS * 3 },
      );
    }
    const limited = await request(`/api/v1/public/forms/public-cfp/drafts/${draft.resume_token}`, { method: "PATCH", body: JSON.stringify({ answers: { speaker_name: "Draft Speaker" } }) });
    expect(limited.status).toBe(429);
  });

  test("AC-34 + AC-37 + AC-38 + AC-39 + AC-234 · confirmation, tracks, participants, limit, close, and reopen are real states", async () => {
    await env.DB.prepare("UPDATE forms SET per_submitter_limit = 1 WHERE id = ?").bind(FORM_ID).run();
    const first = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: nextTurnstileToken(), answers: { title: "First public proposal", speaker_name: "First Speaker", speaker_email: "first@example.com", vendor_content: "No", tracks: ["Agents"] } }),
    });
    expect(first.status).toBe(201);
    const atLimit = await request("/api/v1/public/forms/public-cfp?email=first%40example.com");
    expect((await json<{ state: string }>(atLimit)).state).toBe("at_limit");
    const rejected = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: nextTurnstileToken(), answers: { title: "Second public proposal", speaker_name: "First Speaker", speaker_email: "first@example.com", tracks: ["Agents"], vendor_content: "No" } }),
    });
    expect(rejected.status).toBe(409);
    expect(await rowCount("submissions")).toBe(1);

    await env.DB.prepare("UPDATE forms SET status = 'closed' WHERE id = ?").bind(FORM_ID).run();
    const closed = await request("/api/v1/public/forms/public-cfp");
    expect(closed.status).toBe(200);
    expect((await json<{ state: string }>(closed)).state).toBe("closed");
    const closedSubmit = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({ turnstileToken: nextTurnstileToken(), answers: { title: "Closed submission", speaker_name: "Closed Speaker", speaker_email: "closed@example.com", vendor_content: "No" } }),
    });
    expect(closedSubmit.status).toBe(409);
    expect(await rowCount("submissions")).toBe(1);
    await env.DB.prepare("UPDATE forms SET status = 'open', per_submitter_limit = 3 WHERE id = ?").bind(FORM_ID).run();
    const reopened = await request("/api/v1/public/forms/public-cfp?email=new%40example.com");
    expect(reopened.status).toBe(200);
    expect((await json<{ state: string }>(reopened)).state).toBe("open");
    const tracks = await env.DB.prepare("SELECT COUNT(*) AS total FROM submission_tracks WHERE submission_id = (SELECT id FROM submissions LIMIT 1)").first<{ total: number }>();
    expect(Number(tracks?.total ?? 0)).toBe(1);
    const participants = await env.DB.prepare("SELECT role FROM participations WHERE submission_id = (SELECT id FROM submissions LIMIT 1) ORDER BY role").all<{ role: string }>();
    expect(participants.results.map((row) => row.role)).toEqual(["speaker", "submitter"]);
  });

  test("CONTRACT · MRQ-156 · a manually closed public form does not print its future close date", async () => {
    await env.DB.prepare("UPDATE forms SET status = 'closed', closes_at = ? WHERE id = ?")
      .bind(Date.UTC(2099, 0, 1), FORM_ID)
      .run();

    const response = await request("/f/public-cfp");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("Call for speakers · closed");
    expect(body).toContain("This call for speakers is closed.");
    expect(body).not.toMatch(/>Closed\s+\d[^<]*<\/span>/);
  });

  test("CONTRACT · an expired call is closed on a submitted private resume link", async () => {
    const submitted = await request("/api/v1/public/forms/public-cfp/submissions", {
      method: "POST",
      body: JSON.stringify({
        turnstileToken: nextTurnstileToken(),
        answers: {
          title: "Expired link proposal",
          speaker_name: "Expired Link Speaker",
          speaker_email: "expired-link@example.com",
          tracks: ["Agents"],
          vendor_content: "No",
        },
      }),
    });
    expect(submitted.status).toBe(201);
    const submission = await json<{ confirmation: { resume_url: string } }>(submitted);
    const resume = new URL(submission.confirmation.resume_url);

    await env.DB.prepare("UPDATE forms SET closes_at = ? WHERE id = ?").bind(Date.now() - 1, FORM_ID).run();

    const api = await request(`/api/v1/public/forms/public-cfp${resume.search}`);
    expect((await json<{ state: string; form: { status: string } }>(api))).toMatchObject({ state: "submitted", form: { status: "open" } });
    const rendered = await request(`/f/public-cfp${resume.search}`);
    const body = await rendered.text();
    expect(body).toContain("Call for speakers · closed");
    expect(body).not.toContain("Call for speakers · closes");
  });

  test("CONTRACT · public routes are present in the served OpenAPI document", async () => {
    const response = await request("/api/openapi.json");
    expect(response.status).toBe(200);
    const document = await json<{ paths: Record<string, Record<string, { operationId?: string }>> }>(response);
    expect(document.paths["/api/v1/public/forms/{slug}"]?.get?.operationId).toBe("getPublicForm");
    expect(document.paths["/api/v1/public/forms/{slug}/drafts"]?.post?.operationId).toBe("createPublicFormDraft");
    expect(document.paths["/api/v1/public/forms/{slug}/drafts/{token}"]?.patch?.operationId).toBe("autosavePublicFormDraft");
    expect(document.paths["/api/v1/public/forms/{slug}/submissions"]?.post?.operationId).toBe("submitPublicForm");
  });
});
