import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

/**
 * A file answer is stored as `{"attachmentId":…,"filename":…}` and the record
 * printed that object at the organizer under the heading the speaker had
 * answered. This pins the shape the record now serves — a resolved file view
 * per file field, missing rather than raw whenever there is nothing to show —
 * and the authorization on the thumbnail those views point at.
 */

const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const ORG_ID = "org_mrq88";
const EVENT_ID = "evt_mrq88";
const ORIGIN = "https://marquee.stage11.dev";
const FORM_ID = "form_mrq88";
const SUBMISSION_ID = "sub_mrq88";
const HEADSHOT_FIELD = "field_mrq88_headshot";
const SLIDES_FIELD = "field_mrq88_slides";
const UNANSWERED_FIELD = "field_mrq88_unanswered";
const HEADSHOT_ATTACHMENT = "att_mrq88_headshot";
const PERSON_HEADSHOT_ATTACHMENT = "att_mrq112_person_headshot";
const SLIDES_ATTACHMENT = "att_mrq88_slides";
const PENDING_ATTACHMENT = "att_mrq88_pending";
const ORGANIZER = "per_mrq88_organizer";
const OUTSIDER = "per_mrq88_outsider";
const SPEAKER = "per_mrq88_speaker";
const ORGANIZER_SESSION = "sess_mrq88_organizer";
const OUTSIDER_SESSION = "sess_mrq88_outsider";

/** A real 1×1 PNG: the completion path sniffs magic bytes, so bytes must be honest. */
const PNG_BYTES = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (character) => character.charCodeAt(0));

interface RecordAnswer {
  id: string;
  key: string | null;
  label: string | null;
  type: string | null;
  value_json: unknown;
  file: null | {
    state: "ready" | "missing";
    attachment_id: string | null;
    filename: string | null;
    content_type: string | null;
    size_bytes: number | null;
    preview_url: string | null;
  };
}

/** Deterministic env per request — never whatever `.dev.vars` happens to hold. */
function runtimeEnv(): Env {
  return {
    ...env,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    UPLOAD_TOKEN_SECRET: "mrq88-upload-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "mrq88-upload-rate-secret",
    MEDIA_PUBLIC_ORIGIN: "media.marquee.test",
  } as unknown as Env;
}

async function request(path: string, sessionId?: string): Promise<Response> {
  const headers = new Headers();
  if (sessionId) headers.set("cookie", `mq_session=${sessionId}`);
  return app.request(`${ORIGIN}${path}`, { headers }, runtimeEnv());
}

async function recordAnswers(): Promise<RecordAnswer[]> {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}`, ORGANIZER_SESSION);
  expect(response.status).toBe(200);
  return (await response.json() as { answers: RecordAnswer[] }).answers;
}

function answerFor(answers: RecordAnswer[], key: string): RecordAnswer {
  const answer = answers.find((item) => item.key === key);
  expect(answer, `no answer for ${key}`).toBeDefined();
  return answer!;
}

async function storeAttachment(
  id: string,
  filename: string,
  contentType: string,
  status: "ready" | "pending",
): Promise<void> {
  const key = `uploads/${EVENT_ID}/draft_file/${id}.bin`;
  const object = await env.MEDIA.put(key, PNG_BYTES);
  await env.DB.prepare(
    `INSERT INTO attachments (id, event_id, owner_type, owner_id, filename, content_type, size_bytes, r2_key, r2_etag, sha256, status, created_at, updated_at)
     VALUES (?, ?, 'draft_file', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).bind(
    id, EVENT_ID, SUBMISSION_ID, filename, contentType, PNG_BYTES.byteLength, key,
    status === "ready" ? object?.etag ?? null : null, status, NOW, NOW,
  ).run();
}

async function storePersonHeadshotAttachment(id: string, personId: string): Promise<void> {
  const key = `uploads/${EVENT_ID}/person_headshot/${id}.png`;
  const object = await env.MEDIA.put(key, PNG_BYTES);
  await env.DB.prepare(
    `INSERT INTO attachments (id, event_id, owner_type, owner_id, filename, content_type, size_bytes, r2_key, r2_etag, sha256, status, created_at, updated_at)
     VALUES (?, ?, 'person_headshot', ?, 'headshot.png', 'image/png', ?, ?, ?, NULL, 'ready', ?, ?)`,
  ).bind(id, EVENT_ID, personId, PNG_BYTES.byteLength, key, object?.etag ?? null, NOW, NOW).run();
  await env.DB.prepare("UPDATE people SET headshot_attachment_id = ? WHERE id = ?").bind(id, personId).run();
}

function fileAnswerValue(attachmentId: string, filename: string, contentType: string): string {
  return JSON.stringify({ attachmentId, filename, contentType, sizeBytes: PNG_BYTES.byteLength });
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'File Answers Conference', 'file-answers', ?, ?)").bind(ORG_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'File Answers 2026', 'file-answers-2026', NULL, '2026-10-12', '2026-10-13', 'America/New_York', 'Example Hall', '#0b6a72', 'live', 0, ?, ?)`).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'organizer@example.com', 'Alex Chen', '[]', 0, ?, ?)").bind(ORGANIZER, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'outsider@example.com', 'Jamie Lee', '[]', 0, ?, ?)").bind(OUTSIDER, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'speaker@example.com', 'Robin Alvarez', '[]', 0, ?, ?)").bind(SPEAKER, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq88_owner', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, ORGANIZER, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq88_speaker', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, OUTSIDER, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)").bind(ORGANIZER_SESSION, ORGANIZER, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'speaker', ?, 'fixture', NULL, ?, ?)").bind(OUTSIDER_SESSION, OUTSIDER, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, created_at, updated_at) VALUES (?, ?, 'Call for Proposals', 'cfp', 'session', 'open', NULL, ?, ?)").bind(FORM_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, condition, help_text, created_at, updated_at) VALUES (?, ?, 'headshot', 'Headshot', 'file', 1, 0, '{}', NULL, NULL, ?, ?)").bind(HEADSHOT_FIELD, FORM_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, condition, help_text, created_at, updated_at) VALUES (?, ?, 'slides', 'Slides', 'file', 0, 1, '{}', NULL, NULL, ?, ?)").bind(SLIDES_FIELD, FORM_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, condition, help_text, created_at, updated_at) VALUES (?, ?, 'supporting_file', 'Supporting file', 'file', 0, 2, '{}', NULL, NULL, ?, ?)").bind(UNANSWERED_FIELD, FORM_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'session', 'Shipping the whole loop', 'An abstract', 'submitted', 'public', ?, 'Shipping the whole loop', ?, ?)`).bind(SUBMISSION_ID, EVENT_ID, FORM_ID, SPEAKER, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES ('par_mrq88', ?, ?, 'speaker', 0, 'pending', ?, ?)").bind(SUBMISSION_ID, SPEAKER, NOW, NOW),
  ]);

  await storeAttachment(HEADSHOT_ATTACHMENT, "headshot.png", "image/png", "ready");
  await storePersonHeadshotAttachment(PERSON_HEADSHOT_ATTACHMENT, SPEAKER);
  await storeAttachment(SLIDES_ATTACHMENT, "deck.pdf", "application/pdf", "ready");
  await storeAttachment(PENDING_ATTACHMENT, "never-arrived.png", "image/png", "pending");

  await env.DB.batch([
    env.DB.prepare("INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at) VALUES ('ans_mrq88_headshot', ?, ?, NULL, ?, ?, ?)")
      .bind(SUBMISSION_ID, HEADSHOT_FIELD, fileAnswerValue(HEADSHOT_ATTACHMENT, "headshot.png", "image/png"), NOW, NOW),
    env.DB.prepare("INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at) VALUES ('ans_mrq88_slides', ?, ?, NULL, ?, ?, ?)")
      .bind(SUBMISSION_ID, SLIDES_FIELD, fileAnswerValue(SLIDES_ATTACHMENT, "deck.pdf", "application/pdf"), NOW, NOW),
  ]);
});

test("CONTRACT · an image file answer resolves to a filename, a type, a size, and a thumbnail", async () => {
  const answer = answerFor(await recordAnswers(), "headshot");
  expect(answer.type).toBe("file");
  expect(answer.file).toEqual({
    state: "ready",
    attachment_id: HEADSHOT_ATTACHMENT,
    filename: "headshot.png",
    content_type: "image/png",
    size_bytes: PNG_BYTES.byteLength,
    preview_url: `/api/v1/events/${EVENT_ID}/attachments/${HEADSHOT_ATTACHMENT}/preview`,
  });
});

test("CONTRACT · a non-image file answer resolves without offering a thumbnail", async () => {
  const answer = answerFor(await recordAnswers(), "slides");
  expect(answer.file?.state).toBe("ready");
  expect(answer.file?.filename).toBe("deck.pdf");
  expect(answer.file?.preview_url).toBeNull();
});

test("CONTRACT · a file field the speaker never answered is listed as missing", async () => {
  const answer = answerFor(await recordAnswers(), "supporting_file");
  expect(answer.label).toBe("Supporting file");
  expect(answer.value_json).toBeNull();
  expect(answer.file?.state).toBe("missing");
  expect(answer.file?.preview_url).toBeNull();
});

test("CONTRACT · a file answer whose bytes never arrived reads as missing, not as a broken image", async () => {
  await env.DB.prepare("UPDATE submission_answers SET value_json = ? WHERE id = 'ans_mrq88_headshot'")
    .bind(fileAnswerValue(PENDING_ATTACHMENT, "never-arrived.png", "image/png")).run();
  const answer = answerFor(await recordAnswers(), "headshot");
  expect(answer.file?.state).toBe("missing");
  expect(answer.file?.filename).toBeNull();
  expect(answer.file?.preview_url).toBeNull();
});

test("CONTRACT · the thumbnail serves the image inline, sandboxed, and never sniffable", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/attachments/${HEADSHOT_ATTACHMENT}/preview`, ORGANIZER_SESSION);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-disposition")).toBe('inline; filename="headshot.png"');
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
});

test("CONTRACT · the thumbnail requires the same program access the record requires", async () => {
  const anonymous = await request(`/api/v1/events/${EVENT_ID}/attachments/${HEADSHOT_ATTACHMENT}/preview`);
  expect(anonymous.status).toBe(401);
  const speaker = await request(`/api/v1/events/${EVENT_ID}/attachments/${HEADSHOT_ATTACHMENT}/preview`, OUTSIDER_SESSION);
  expect(speaker.status).toBe(403);
});

test("CONTRACT · the thumbnail refuses anything that is not a ready raster image", async () => {
  const pdf = await request(`/api/v1/events/${EVENT_ID}/attachments/${SLIDES_ATTACHMENT}/preview`, ORGANIZER_SESSION);
  expect(pdf.status).toBe(404);
  const unreferenced = await request(`/api/v1/events/${EVENT_ID}/attachments/${PENDING_ATTACHMENT}/preview`, ORGANIZER_SESSION);
  expect(unreferenced.status).toBe(404);
  await env.DB.prepare("UPDATE attachments SET content_type = 'image/svg+xml' WHERE id = ?").bind(HEADSHOT_ATTACHMENT).run();
  const svg = await request(`/api/v1/events/${EVENT_ID}/attachments/${HEADSHOT_ATTACHMENT}/preview`, ORGANIZER_SESSION);
  expect(svg.status).toBe(404);
});

test("SPK-08 · a speaker headshot serves through the person pointer for the organizer", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/people/${SPEAKER}/headshot`, ORGANIZER_SESSION);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-disposition")).toBe('inline; filename="headshot.png"');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
});

test("SPK-08 · a person headshot does not become a cross-speaker object oracle", async () => {
  const anonymous = await request(`/api/v1/events/${EVENT_ID}/people/${SPEAKER}/headshot`);
  expect(anonymous.status).toBe(401);
  const otherSpeaker = await request(`/api/v1/events/${EVENT_ID}/people/${SPEAKER}/headshot`, OUTSIDER_SESSION);
  expect(otherSpeaker.status).toBe(403);
});
