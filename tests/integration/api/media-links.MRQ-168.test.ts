import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import {
  MEDIA_LINK_POLICY,
  MEDIA_LINK_TTL_MS,
  publicMediaUrl,
  verifyMediaUrl,
} from "../../../src/lib/r2/media-links";
import { applyMigrations, env } from "../apply-migrations";

const NOW = Date.now();
const DAY = 86_400_000;
const ORIGIN = "https://marquee.stage11.dev";
const MEDIA_ORIGIN = "media.marquee.test";
const MEDIA_SECRET = "mrq168-media-link-secret";
const ORG_ID = "org_mrq168";
const EVENT_ID = "evt_mrq168";
const PERSON_ID = "per_mrq168_speaker";
const FORM_ID = "form_mrq168";
const SUBMISSION_ID = "sub_mrq168";
const TEMPLATE_ID = "tpl_mrq168";
const TASK_ID = "task_mrq168";
const PARTICIPATION_ID = "part_mrq168";
const ATTACHMENT_ID = "att_mrq168";
const MEDIA_KEY = `uploads/${EVENT_ID}/task_upload/${ATTACHMENT_ID}.pdf`;
const MEDIA_BYTES = new TextEncoder().encode("MRQ-168 media payload");

function runtimeEnv(): Env {
  return {
    ...env,
    MEDIA_PUBLIC_ORIGIN: MEDIA_ORIGIN,
    UPLOAD_TOKEN_SECRET: MEDIA_SECRET,
  } as unknown as Env;
}

async function mediaResponse(url: string): Promise<Response> {
  return app.request(url, {}, runtimeEnv());
}

async function mediaUrl(nowMs = Date.now()): Promise<string> {
  return publicMediaUrl(MEDIA_ORIGIN, { status: "ready", r2_key: MEDIA_KEY }, MEDIA_SECRET, nowMs);
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'MRQ-168 Org', 'mrq-168', ?, ?)",
    ).bind(ORG_ID, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'MRQ-168 Conference', 'mrq-168', NULL, '2026-08-20', '2026-08-22', 'UTC', 'Online', '#0b6a72', 'live', 0, ?, ?)
    `).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, social_links, is_demo, created_at, updated_at) VALUES (?, ?, 'speaker@example.com', 'Speaker', '[]', 0, ?, ?)",
    ).bind(PERSON_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO forms (id, event_id, name, slug, kind, status, closes_at, created_at, updated_at) VALUES (?, ?, 'Call for Proposals', 'cfp', 'session', 'open', NULL, ?, ?)",
    ).bind(FORM_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'session', 'MRQ-168 Session', 'An abstract', 'accepted', 'public', ?, 'MRQ-168 Session', ?, ?)
    `).bind(SUBMISSION_ID, EVENT_ID, FORM_ID, PERSON_ID, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
      VALUES (?, ?, 'Upload deck', 'file', 'Final deck.', ?, NULL, NULL, NULL, 0, 1, ?, ?)
    `).bind(TEMPLATE_ID, EVENT_ID, NOW + 2 * DAY, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, completed_at, response_json, attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Upload deck', 'file', '', ?, 'done', ?, NULL, NULL, ?, ?)
    `).bind(TASK_ID, EVENT_ID, PERSON_ID, SUBMISSION_ID, TEMPLATE_ID, NOW + 2 * DAY, NOW, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
      VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)
    `).bind(PARTICIPATION_ID, SUBMISSION_ID, PERSON_ID, NOW, NOW),
    env.DB.prepare(`
      INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, sha256, r2_etag, created_at, updated_at)
      VALUES (?, ?, 'task_upload', ?, ?, 'deck.pdf', 'application/pdf', ?, 'pending', NULL, NULL, ?, ?)
    `).bind(ATTACHMENT_ID, EVENT_ID, TASK_ID, MEDIA_KEY, MEDIA_BYTES.byteLength, NOW, NOW),
  ]);

  await env.MEDIA.put(MEDIA_KEY, MEDIA_BYTES);
  const object = await env.MEDIA.head(MEDIA_KEY);
  if (!object) throw new Error("the test media object was not stored");
  await env.DB.prepare("UPDATE attachments SET status = 'ready', r2_etag = ? WHERE id = ?").bind(object.etag, ATTACHMENT_ID).run();
  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = ? WHERE id = ?").bind(ATTACHMENT_ID, TASK_ID).run();
});

test("CONTRACT · MRQ-168 — a media URL is signed for a bounded lifetime and expires at its declared deadline", async () => {
  const mintedAt = Date.now();
  const url = new URL(await mediaUrl(mintedAt));
  const expiresAt = Number(url.searchParams.get("expires"));

  expect(expiresAt).toBe(mintedAt + MEDIA_LINK_TTL_MS);
  expect(await verifyMediaUrl(MEDIA_KEY, url, MEDIA_SECRET, mintedAt)).toBe(true);
  expect(await verifyMediaUrl(MEDIA_KEY, url, MEDIA_SECRET, expiresAt)).toBe(false);

  // The route sees the same result for a link minted before the deadline: no
  // sleep or wall-clock race is needed to prove that the boundary is enforced.
  const alreadyExpired = await mediaUrl(Date.now() - MEDIA_LINK_TTL_MS - 1);
  expect((await mediaResponse(alreadyExpired)).status).toBe(404);
});

test("CONTRACT · MRQ-168 — an outstanding link is cut off by participation revocation or attachment deletion", async () => {
  const url = await mediaUrl();
  const active = await mediaResponse(url);
  expect(active.status).toBe(200);
  expect(new TextDecoder().decode(await active.arrayBuffer())).toBe("MRQ-168 media payload");
  expect(active.headers.get("Content-Disposition")).toContain("attachment");
  expect(active.headers.get("X-Content-Type-Options")).toBe("nosniff");

  await env.DB.prepare("UPDATE participations SET confirmation_status = 'declined' WHERE id = ?").bind(PARTICIPATION_ID).run();
  expect((await mediaResponse(url)).status).toBe(404);

  await env.DB.prepare("UPDATE participations SET confirmation_status = 'confirmed' WHERE id = ?").bind(PARTICIPATION_ID).run();
  expect((await mediaResponse(url)).status).toBe(200);

  await env.DB.prepare("UPDATE speaker_tasks SET attachment_id = NULL WHERE id = ?").bind(TASK_ID).run();
  await env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(ATTACHMENT_ID).run();
  expect((await mediaResponse(url)).status).toBe(404);
});

test("CONTRACT · MRQ-168 — media remains isolated to its origin and the declared policy is truthful in OpenAPI", async () => {
  expect(MEDIA_LINK_POLICY).toBe("short-lived-revocable-capability-url");
  const url = await mediaUrl();
  const appHostUrl = new URL(url);
  appHostUrl.hostname = "marquee.stage11.dev";
  expect((await mediaResponse(appHostUrl.toString())).status).toBe(404);

  const documentResponse = await app.request(`${ORIGIN}/api/openapi.json`, {}, runtimeEnv());
  expect(documentResponse.status).toBe(200);
  const document = await documentResponse.json<{
    paths: Record<string, { get?: { description?: string } }>;
  }>();
  const mediaDescription = document.paths["/api/v1/media/{key}"].get?.description ?? "";
  const filesDescription = document.paths["/api/v1/events/{eventId}/files"].get?.description ?? "";
  expect(mediaDescription).toContain("short-lived signed URL");
  expect(mediaDescription).toContain("24 hours");
  expect(filesDescription).toContain("short-lived signed capability");
});
