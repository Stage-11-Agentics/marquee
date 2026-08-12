import { env } from "cloudflare:test";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";

import { app } from "../../../src/index";

/**
 * A minimal slice of migrations/0001_init.sql covering only the tables this
 * suite exercises. `node:fs` is not usable inside the Workers-runtime test
 * isolate, so the schema is inlined rather than read from disk; column
 * shapes are copied verbatim from the real migration.
 */
const SCHEMA_SQL = `
CREATE TABLE organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE events (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
  tagline TEXT, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, timezone TEXT NOT NULL,
  venue TEXT, logo_key TEXT, accent TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live')),
  demo_mode INTEGER NOT NULL DEFAULT 0 CHECK (demo_mode IN (0, 1)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE people (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL,
  title TEXT, company TEXT, bio TEXT, headshot_attachment_id TEXT,
  social_links TEXT NOT NULL DEFAULT '[]',
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  last_write_source TEXT NOT NULL DEFAULT 'marquee' CHECK (last_write_source IN ('marquee', 'airtable')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE submissions (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, form_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('abstract', 'session')),
  bypass_evaluation INTEGER NOT NULL DEFAULT 0 CHECK (bypass_evaluation IN (0, 1)),
  title TEXT NOT NULL, abstract TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'submitted', 'in_review', 'accepted', 'waitlisted', 'rejected', 'withdrawn')
  ),
  format_id TEXT, primary_track_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('public', 'admin', 'import')),
  vendor_affiliation TEXT NOT NULL DEFAULT 'none'
    CHECK (vendor_affiliation IN ('none', 'vendor_to_fi', 'vendor_with_champion')),
  wave_id TEXT, submitter_person_id TEXT NOT NULL,
  decided_at INTEGER, decided_by_person_id TEXT, submitted_at INTEGER, last_saved_at INTEGER,
  resume_token_hash TEXT,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  external_ref TEXT, search_blob TEXT NOT NULL DEFAULT '', applied_rule_id TEXT,
  last_write_source TEXT NOT NULL DEFAULT 'marquee' CHECK (last_write_source IN ('marquee', 'airtable')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE speaker_tasks (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, template_id TEXT, person_id TEXT NOT NULL,
  submission_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('acknowledge', 'file', 'form')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  due_at INTEGER NOT NULL, completed_at INTEGER, attachment_id TEXT, response_json TEXT,
  last_write_source TEXT NOT NULL DEFAULT 'marquee' CHECK (last_write_source IN ('marquee', 'airtable')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE forms (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('abstract', 'session')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE form_fields (
  id TEXT PRIMARY KEY, form_id TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL,
  help_text TEXT,
  type TEXT NOT NULL CHECK (
    type IN ('short_text', 'long_text', 'single_select', 'multi_select', 'url', 'email', 'file', 'number')
  ),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  position INTEGER NOT NULL,
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  condition TEXT CHECK (condition IS NULL OR json_valid(condition)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (
    owner_type IN ('person_headshot', 'task_upload', 'event_logo', 'import_file', 'draft_file', 'submission_file')
  ),
  owner_id TEXT NOT NULL, r2_key TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  sha256 TEXT, r2_etag TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK (size_bytes >= 0), CHECK (status <> 'ready' OR r2_etag IS NOT NULL)
);
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL, role_hint TEXT, expires_at INTEGER NOT NULL,
  user_agent_hash TEXT NOT NULL, revoked_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
`;

beforeAll(async () => {
  // D1's exec() treats each newline as a statement boundary, so every
  // CREATE TABLE must be flattened to one line before splitting on ";".
  const flattened = SCHEMA_SQL.replaceAll(/\s+/g, " ");
  for (const statement of flattened.split(";").map((s) => s.trim()).filter(Boolean)) {
    await env.DB.exec(statement);
  }
});

const NOW = 1_800_000_000_000;

async function seedOrgEventDraft(overrides: {
  draftId: string;
  resumeToken: string;
  eventId: string;
  demoMode?: 0 | 1;
}) {
  const resumeHash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(overrides.resumeToken)),
  ).toString("hex");

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org1','Org','org', ?1, ?1)`,
    ).bind(NOW),
    env.DB.prepare(
      `INSERT OR IGNORE INTO events (id, org_id, name, slug, status, timezone, starts_on, ends_on, created_at, updated_at, demo_mode)
       VALUES (?1, 'org1', 'Event', ?1, 'live', 'UTC', '2026-01-01', '2026-01-02', ?2, ?2, ?3)`,
    ).bind(overrides.eventId, NOW, overrides.demoMode ?? 0),
    env.DB.prepare(
      `INSERT OR IGNORE INTO people (id, org_id, email, name, created_at, updated_at) VALUES ('person1','org1','p@example.com','Person', ?1, ?1)`,
    ).bind(NOW),
    // The presign resolves a draft file's accepted types from the form field
    // it names, so a draft is only presignable through a form that declares
    // that field. `deck` is what every case below uploads to.
    env.DB.prepare(
      `INSERT OR IGNORE INTO forms (id, event_id, name, slug, kind, created_at, updated_at)
       VALUES (?1, ?2, 'Call for speakers', 'cfp', 'abstract', ?3, ?3)`,
    ).bind(`form-${overrides.eventId}`, overrides.eventId, NOW),
    env.DB.prepare(
      `INSERT OR IGNORE INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at)
       VALUES (?1, ?2, 'deck', 'Slides', 'file', 0, 0, ?3, ?4, ?4)`,
    ).bind(`field-deck-${overrides.eventId}`, `form-${overrides.eventId}`, JSON.stringify({ accept: ["application/pdf"] }), NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, form_id, submitter_person_id, title, kind, status, origin, last_write_source, search_blob, resume_token_hash, created_at, updated_at)
       VALUES (?1, ?2, ?5, 'person1', 'Draft', 'abstract', 'draft', 'public', 'marquee', '', ?3, ?4, ?4)`,
    ).bind(overrides.draftId, overrides.eventId, resumeHash, NOW, `form-${overrides.eventId}`),
  ]);
}

function stubTurnstile(success: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 })),
  );
}

const BASE_ENV = {
  ...env,
  TURNSTILE_SECRET_KEY: "test-secret",
  R2_ACCOUNT_ID: "fake-account",
  R2_BUCKET_NAME: "fake-bucket",
  R2_ACCESS_KEY_ID: "fake-key-id",
  R2_SECRET_ACCESS_KEY: "fake-secret-key",
  MEDIA_PUBLIC_ORIGIN: "media.marquee.test",
  UPLOAD_TOKEN_SECRET: "fake-token-secret",
  UPLOAD_RATE_LIMIT_SECRET: "fake-rate-limit-secret",
};

function signRequest(body: unknown) {
  return new Request("https://marquee.stage11.dev/api/v1/public/uploads/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare(`DELETE FROM attachments`)]);
});

test("AC-231 · public upload presign fails closed without valid in-scope Turnstile authorization — missing token", async () => {
  await seedOrgEventDraft({ draftId: "sub-missing", resumeToken: "tok-missing", eventId: "evt1" });
  stubTurnstile(false);
  const response = await app.fetch(
    signRequest({
      draftId: "sub-missing",
      resumeToken: "tok-missing",
      fieldKey: "deck",
      turnstileToken: "",
      filename: "deck.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
    }),
    BASE_ENV,
  );
  expect(response.status).toBe(403);
  const attachments = await env.DB.prepare(`SELECT COUNT(*) as n FROM attachments`).first<{ n: number }>();
  expect(attachments?.n).toBe(0);
});

test("AC-231 · public upload presign fails closed when Turnstile rejects a non-empty token", async () => {
  await seedOrgEventDraft({ draftId: "sub-turnstile-failed", resumeToken: "tok-turnstile-failed", eventId: "evt1" });
  stubTurnstile(false);
  const response = await app.fetch(
    signRequest({
      draftId: "sub-turnstile-failed",
      resumeToken: "tok-turnstile-failed",
      fieldKey: "deck",
      turnstileToken: "siteverify-rejected",
      filename: "deck.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
    }),
    BASE_ENV,
  );
  expect(response.status).toBe(403);
  const attachments = await env.DB.prepare(`SELECT COUNT(*) as n FROM attachments`).first<{ n: number }>();
  expect(attachments?.n).toBe(0);
});

test("AC-231 · a demo-mode conference presigns without Turnstile, so an automated reader is not locked out of the public form", async () => {
  await seedOrgEventDraft({
    draftId: "sub-demo",
    resumeToken: "tok-demo",
    eventId: "evt-demo",
    demoMode: 1,
  });
  // Rejecting every token proves the gate was SKIPPED rather than satisfied:
  // if the exemption were absent this stub would fail the request closed.
  stubTurnstile(false);
  const response = await app.fetch(
    signRequest({
      draftId: "sub-demo",
      resumeToken: "tok-demo",
      fieldKey: "deck",
      turnstileToken: "",
      filename: "deck.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
    }),
    BASE_ENV,
  );
  expect(response.status).toBe(200);
});

test("AC-231 · a demo-mode presign still requires the draft's own resume token", async () => {
  await seedOrgEventDraft({
    draftId: "sub-demo-authz",
    resumeToken: "tok-demo-authz",
    eventId: "evt-demo-authz",
    demoMode: 1,
  });
  stubTurnstile(true);
  const response = await app.fetch(
    signRequest({
      draftId: "sub-demo-authz",
      resumeToken: "not-the-right-token",
      fieldKey: "deck",
      turnstileToken: "valid-but-irrelevant",
      filename: "deck.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
    }),
    BASE_ENV,
  );
  expect(response.status).toBe(403);
});

test("AC-231 · one verified Turnstile token mints one presign, then no second row or object", async () => {
  await seedOrgEventDraft({ draftId: "sub-replay", resumeToken: "tok-replay", eventId: "evt-replay" });
  stubTurnstile(true);
  const requestBody = {
    draftId: "sub-replay",
    resumeToken: "tok-replay",
    fieldKey: "deck",
    turnstileToken: "one-token-one-presign",
    filename: "deck.pdf",
    contentType: "application/pdf",
    sizeBytes: 100,
  };

  const firstResponse = await app.fetch(signRequest(requestBody), BASE_ENV);
  expect(firstResponse.status).toBe(200);
  const firstSigned = (await firstResponse.json()) as { attachmentId: string; putUrl: string };
  const firstRow = await env.DB.prepare(`SELECT r2_key FROM attachments WHERE id = ?1`)
    .bind(firstSigned.attachmentId)
    .first<{ r2_key: string }>();
  expect(firstRow?.r2_key).toBeTruthy();
  expect(new URL(firstSigned.putUrl).pathname).toContain(firstRow!.r2_key);

  // Positive control: the first presign is usable at its generated key.
  await env.MEDIA.put(firstRow!.r2_key, new Uint8Array([37, 80, 68, 70]));
  const objectsBeforeReplay = await env.MEDIA.list({ prefix: "uploads/evt-replay/" });
  expect(objectsBeforeReplay.objects).toHaveLength(1);

  const secondResponse = await app.fetch(signRequest(requestBody), BASE_ENV);
  expect(secondResponse.status).toBe(403);
  const rowsAfterReplay = await env.DB.prepare(`SELECT COUNT(*) as n FROM attachments WHERE event_id = ?1`)
    .bind("evt-replay")
    .first<{ n: number }>();
  const objectsAfterReplay = await env.MEDIA.list({ prefix: "uploads/evt-replay/" });
  expect(rowsAfterReplay?.n).toBe(1);
  expect(objectsAfterReplay.objects).toHaveLength(1);
  expect(objectsAfterReplay.objects[0]?.key).toBe(firstRow!.r2_key);
});

test("AC-231 · a public request whose draft/resume-token ownership is out of scope fails closed with zero side effects", async () => {
  await seedOrgEventDraft({ draftId: "sub-scope", resumeToken: "tok-scope", eventId: "evt1" });
  stubTurnstile(true);
  const response = await app.fetch(
    signRequest({
      draftId: "sub-scope",
      resumeToken: "wrong-token-entirely",
      fieldKey: "deck",
      turnstileToken: "valid-scope",
      filename: "deck.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
    }),
    BASE_ENV,
  );
  expect(response.status).toBe(403);
  const attachments = await env.DB.prepare(`SELECT COUNT(*) as n FROM attachments`).first<{ n: number }>();
  expect(attachments?.n).toBe(0);
});

test("AC-231 · missing authentication on the speaker task-upload route fails closed", async () => {
  const response = await app.fetch(
    new Request("https://marquee.stage11.dev/api/v1/me/uploads/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerType: "task_upload",
        ownerId: "task1",
        filename: "deck.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
      }),
    }),
    BASE_ENV,
  );
  expect(response.status).toBe(401);
});

test("AC-232 · extension/MIME rejection prevents any side effect", async () => {
  await seedOrgEventDraft({ draftId: "sub-ext", resumeToken: "tok-ext", eventId: "evt1" });
  stubTurnstile(true);
  const response = await app.fetch(
    signRequest({
      draftId: "sub-ext",
      resumeToken: "tok-ext",
      fieldKey: "deck",
      turnstileToken: "valid-ext",
      filename: "deck.exe",
      contentType: "application/octet-stream",
      sizeBytes: 100,
    }),
    BASE_ENV,
  );
  expect(response.status).toBe(400);
  const attachments = await env.DB.prepare(`SELECT COUNT(*) as n FROM attachments`).first<{ n: number }>();
  expect(attachments?.n).toBe(0);
});

test("AC-232 · a completed upload with a magic-byte mismatch is rejected and the R2 object is deleted", async () => {
  await seedOrgEventDraft({ draftId: "sub-sniff", resumeToken: "tok-sniff", eventId: "evt1" });
  stubTurnstile(true);
  const signResponse = await app.fetch(
    signRequest({
      draftId: "sub-sniff",
      resumeToken: "tok-sniff",
      fieldKey: "deck",
      turnstileToken: "valid-sniff",
      filename: "deck.pdf",
      contentType: "application/pdf",
      sizeBytes: 11,
    }),
    BASE_ENV,
  );
  expect(signResponse.status).toBe(200);
  const signed = (await signResponse.json()) as { attachmentId: string; completionToken: string };

  const row = await env.DB.prepare(`SELECT r2_key FROM attachments WHERE id = ?1`)
    .bind(signed.attachmentId)
    .first<{ r2_key: string }>();
  await env.MEDIA.put(row!.r2_key, "not a real pdf");

  const completeResponse = await app.fetch(
    new Request(`https://marquee.stage11.dev/api/v1/public/uploads/${signed.attachmentId}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completionToken: signed.completionToken }),
    }),
    BASE_ENV,
  );
  expect(completeResponse.status).toBe(409);
  const headAfter = await env.MEDIA.head(row!.r2_key);
  expect(headAfter).toBeNull();
});

test("AC-232 · a completed upload with matching magic bytes becomes ready and serves from the media host with safety headers", async () => {
  await seedOrgEventDraft({ draftId: "sub-ok", resumeToken: "tok-ok", eventId: "evt1" });
  stubTurnstile(true);
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\nreal enough for the sniffer\n");
  const signResponse = await app.fetch(
    signRequest({
      draftId: "sub-ok",
      resumeToken: "tok-ok",
      fieldKey: "deck",
      turnstileToken: "valid-ready",
      filename: "deck.pdf",
      contentType: "application/pdf",
      sizeBytes: pdfBytes.byteLength,
    }),
    BASE_ENV,
  );
  expect(signResponse.status).toBe(200);
  const signed = (await signResponse.json()) as { attachmentId: string; completionToken: string };
  const row = await env.DB.prepare(`SELECT r2_key FROM attachments WHERE id = ?1`)
    .bind(signed.attachmentId)
    .first<{ r2_key: string }>();
  await env.MEDIA.put(row!.r2_key, pdfBytes);

  const completeResponse = await app.fetch(
    new Request(`https://marquee.stage11.dev/api/v1/public/uploads/${signed.attachmentId}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completionToken: signed.completionToken }),
    }),
    BASE_ENV,
  );
  expect(completeResponse.status).toBe(200);
  const completed = (await completeResponse.json()) as { url: string };
  expect(completed.url).toContain("media.marquee.test");

  const mediaHostResponse = await app.fetch(
    new Request(`https://media.marquee.test/api/v1/media/${row!.r2_key}`),
    BASE_ENV,
  );
  expect(mediaHostResponse.status).toBe(200);
  expect(mediaHostResponse.headers.get("Content-Disposition")).toContain("attachment");
  expect(mediaHostResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");

  const appHostResponse = await app.fetch(
    new Request(`https://marquee.stage11.dev/api/v1/media/${row!.r2_key}`),
    BASE_ENV,
  );
  expect(appHostResponse.status).toBe(404);
});

test("AC-232 · per-submission upload cap returns 429 without touching the object store", async () => {
  await seedOrgEventDraft({ draftId: "sub-cap", resumeToken: "tok-cap", eventId: "evt1" });
  stubTurnstile(true);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await app.fetch(
      signRequest({
        draftId: "sub-cap",
        resumeToken: "tok-cap",
        fieldKey: "deck",
        turnstileToken: `valid-cap-${attempt}`,
        filename: "deck.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
      }),
      BASE_ENV,
    );
    lastStatus = response.status;
  }
  expect(lastStatus).toBe(429);
});
