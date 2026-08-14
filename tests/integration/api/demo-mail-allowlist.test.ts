/**
 * The way in to the demo-safe allowlist.
 *
 * A conference in demo mode writes every `demo_safe` message to the outbox
 * instead of sending it. The mechanism that lets a named address through has
 * always existed in the consumer; what these tests hold in place is that an
 * organizer can now name one, that naming one really changes the delivery
 * decision, and that removing it really puts the mail back in the outbox.
 *
 * Nothing here sends mail. Delivery is asserted through the suppression
 * decision and a stub provider — the whole point of the setting is that it
 * makes mail real, so proving it works must not mean mailing anybody.
 */
import { afterEach, beforeEach, expect, test } from "vitest";

import type { OutboxRow } from "../../../src/db/schema";
import { app } from "../../../src/index";
import { createSession } from "../../../src/lib/auth/auth-sessions";
import { demoMailWouldBeSuppressed, processMailOutbox, type MailProvider } from "../../../src/jobs/mail/consumer";
import { enqueueOutbox } from "../../../src/jobs/mail/outbox";
import { demoMailAllowlistFor, DEMO_MAIL_ALLOWLIST_LIMIT } from "../../../src/lib/demo-mail-allowlist";
import { applyMigrations, env } from "../apply-migrations";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const ORG = "org_allowlist";
const DEMO_EVENT = "evt_allowlist_demo";
const LIVE_EVENT = "evt_allowlist_live";
const OWNER = "per_allowlist_owner";
const OPS = "per_allowlist_ops";

interface AllowlistBody {
  data: { demo_mode: boolean; limit: number; emails: string[] };
}

function context(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

async function call(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, { ...init, headers }, env, context());
}

async function cookieFor(personId: string, label: string): Promise<string> {
  const session = await createSession(env.DB, { personId, roleHint: "organizer", userAgent: label });
  return `mq_session=${session.id}`;
}

/** Records what it was handed and reports success, so nothing leaves the test. */
function provider(): MailProvider & { sent: OutboxRow[] } {
  const result = {
    sent: [] as OutboxRow[],
    async sendBatch(rows: readonly OutboxRow[]) {
      result.sent.push(...rows);
      return rows.map((row) => `provider-${row.id}`);
    },
    async sendSingle(row: OutboxRow) {
      result.sent.push(row);
      return `provider-${row.id}`;
    },
  };
  return result;
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Allowlist Org', 'allowlist-org', ?, ?)").bind(ORG, NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Demo Conference', 'allowlist-demo', '2026-10-01', '2026-10-02', 'UTC', 'live', 1, ?, ?)").bind(DEMO_EVENT, ORG, NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Live Conference', 'allowlist-live', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)").bind(LIVE_EVENT, ORG, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, 'owner@example.com', 'Ines Okafor', ?, ?)").bind(OWNER, ORG, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, 'ops@example.com', 'Cal Renner', ?, ?)").bind(OPS, ORG, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_allowlist_owner', ?, NULL, ?, 'owner', ?, ?)").bind(ORG, OWNER, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('mem_allowlist_ops', ?, NULL, ?, 'ops', ?, ?)").bind(ORG, OPS, NOW, NOW),
  ]);
});

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM outbox WHERE event_id IN (?, ?)").bind(DEMO_EVENT, LIVE_EVENT),
    env.DB.prepare("DELETE FROM event_settings WHERE event_id IN (?, ?)").bind(DEMO_EVENT, LIVE_EVENT),
    env.DB.prepare("DELETE FROM auth_sessions WHERE person_id IN (?, ?)").bind(OWNER, OPS),
    env.DB.prepare("DELETE FROM memberships WHERE org_id = ?").bind(ORG),
    env.DB.prepare("DELETE FROM people WHERE org_id = ?").bind(ORG),
    env.DB.prepare("DELETE FROM events WHERE org_id = ?").bind(ORG),
    env.DB.prepare("DELETE FROM organizations WHERE id = ?").bind(ORG),
  ]);
});

test("CONTRACT · a demo conference starts with nobody receiving real email, and says so", async () => {
  const response = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, await cookieFor(OWNER, "allowlist-empty"));
  expect(response.status).toBe(200);
  const body = await response.json<AllowlistBody>();
  expect(body.data).toEqual({ demo_mode: true, limit: DEMO_MAIL_ALLOWLIST_LIMIT, emails: [] });
  expect(await demoMailWouldBeSuppressed(env.DB, DEMO_EVENT, "judge@example.com")).toBe(true);
});

test("CONTRACT · naming an address makes its mail real and leaves every other address held", async () => {
  const cookie = await cookieFor(OWNER, "allowlist-add");
  const saved = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: ["judge@example.com"] }),
  });
  expect(saved.status).toBe(200);
  expect((await saved.json<AllowlistBody>()).data.emails).toEqual(["judge@example.com"]);

  expect(await demoMailWouldBeSuppressed(env.DB, DEMO_EVENT, "judge@example.com")).toBe(false);
  expect(await demoMailWouldBeSuppressed(env.DB, DEMO_EVENT, "someone.else@example.com")).toBe(true);
});

test("CONTRACT · removing the last address puts every message back in the outbox", async () => {
  const cookie = await cookieFor(OWNER, "allowlist-remove");
  await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: ["judge@example.com"] }),
  });
  const cleared = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: [] }),
  });
  expect(cleared.status).toBe(200);
  expect((await cleared.json<AllowlistBody>()).data.emails).toEqual([]);
  expect(await demoMailWouldBeSuppressed(env.DB, DEMO_EVENT, "judge@example.com")).toBe(true);
});

test("CONTRACT · an address is stored the way it is compared, and a repeat is one address", async () => {
  const cookie = await cookieFor(OWNER, "allowlist-normalize");
  const saved = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: ["  Judge@Example.COM  ", "judge@example.com", "second@example.org"] }),
  });
  expect(saved.status).toBe(200);
  expect((await saved.json<AllowlistBody>()).data.emails).toEqual(["judge@example.com", "second@example.org"]);
  expect(await demoMailAllowlistFor(env.DB, DEMO_EVENT)).toEqual(["judge@example.com", "second@example.org"]);
  // Matching is case-insensitive at the decision, not only at the keyboard.
  expect(await demoMailWouldBeSuppressed(env.DB, DEMO_EVENT, "JUDGE@example.com")).toBe(false);
});

test("CONTRACT · an incomplete address is refused and the stored list is untouched", async () => {
  const cookie = await cookieFor(OWNER, "allowlist-invalid");
  await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: ["judge@example.com"] }),
  });
  const rejected = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: ["judge@example.com", "not-an-address"] }),
  });
  expect(rejected.status).toBe(422);
  expect(await demoMailAllowlistFor(env.DB, DEMO_EVENT)).toEqual(["judge@example.com"]);
});

/**
 * A rejected value is whatever was pasted, not an address. Quoting all 254
 * characters back puts an unbounded string into the one line the operator has
 * to read — on screen it overruns the space reserved for it, and the message
 * that gets lost is the reason their paste was refused.
 */
test("CONTRACT · a rejection quotes back enough to recognise, not the whole paste", async () => {
  const cookie = await cookieFor(OWNER, "allowlist-long");
  const monster = "x".repeat(254);
  const rejected = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: [monster] }),
  });
  expect(rejected.status).toBe(422);
  const message = (await rejected.json<{ error: { message: string } }>()).error.message;
  expect(message).toBe(`${"x".repeat(47)}… is not a complete email address`);
  expect(message.length).toBeLessThan(100);
  expect(await demoMailAllowlistFor(env.DB, DEMO_EVENT)).toEqual([]);
});

test("CONTRACT · the list is capped, and the cap counts distinct addresses", async () => {
  const cookie = await cookieFor(OWNER, "allowlist-cap");
  const tooMany = Array.from({ length: DEMO_MAIL_ALLOWLIST_LIMIT + 1 }, (_, index) => `judge${index}@example.com`);
  const rejected = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: tooMany }),
  });
  expect(rejected.status).toBe(422);
  expect(await demoMailAllowlistFor(env.DB, DEMO_EVENT)).toEqual([]);

  // A repeated spelling is one address, so it must not spend a slot.
  const atCap = tooMany.slice(0, DEMO_MAIL_ALLOWLIST_LIMIT);
  const accepted = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: [...atCap, atCap[0].toUpperCase()] }),
  });
  expect(accepted.status).toBe(200);
  expect((await accepted.json<AllowlistBody>()).data.emails).toHaveLength(DEMO_MAIL_ALLOWLIST_LIMIT);
});

test("CONTRACT · an ops seat may read who receives real email but may not change it", async () => {
  const owner = await cookieFor(OWNER, "allowlist-owner");
  await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, owner, {
    method: "PUT",
    body: JSON.stringify({ emails: ["judge@example.com"] }),
  });

  const ops = await cookieFor(OPS, "allowlist-ops");
  const read = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, ops);
  expect(read.status).toBe(200);
  expect((await read.json<AllowlistBody>()).data.emails).toEqual(["judge@example.com"]);

  const write = await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, ops, {
    method: "PUT",
    body: JSON.stringify({ emails: [] }),
  });
  expect(write.status).toBe(403);
  expect(await demoMailAllowlistFor(env.DB, DEMO_EVENT)).toEqual(["judge@example.com"]);
});

test("CONTRACT · an anonymous caller can neither read nor change the list", async () => {
  const read = await app.request(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, {}, env, context());
  expect([401, 403]).toContain(read.status);
  const write = await app.request(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emails: ["judge@example.com"] }),
  }, env, context());
  expect([401, 403]).toContain(write.status);
  expect(await demoMailAllowlistFor(env.DB, DEMO_EVENT)).toEqual([]);
});

/**
 * The outbox badges a held message "held in demo outbox · would send in
 * production". A message that genuinely sends must not wear it — so the row an
 * allowlisted recipient leaves behind has to read `sent`, with no held reason.
 */
test("CONTRACT · an allowlisted recipient's outbox row reads sent, never held in the demo outbox", async () => {
  const cookie = await cookieFor(OWNER, "allowlist-outbox");
  await call(`/api/v1/events/${DEMO_EVENT}/demo-mail-allowlist`, cookie, {
    method: "PUT",
    body: JSON.stringify({ emails: ["judge@example.com"] }),
  });

  const allowed = await enqueueOutbox({
    db: env.DB,
    eventId: DEMO_EVENT,
    templateKey: "reminder_generic",
    entityId: "entity-allowed",
    personId: null,
    toEmail: "judge@example.com",
    data: { "speaker.first_name": "Judge" },
  });
  const held = await enqueueOutbox({
    db: env.DB,
    eventId: DEMO_EVENT,
    templateKey: "reminder_generic",
    entityId: "entity-held",
    personId: null,
    toEmail: "someone.else@example.com",
    data: { "speaker.first_name": "Someone" },
  });

  const fake = provider();
  expect(await processMailOutbox(env.DB, env, [allowed.id, held.id], { provider: fake, now: NOW, sleep: async () => undefined }))
    .toEqual({ sent: 1, suppressed: 1, failed: 0 });
  expect(fake.sent.map((row) => row.to_email)).toEqual(["judge@example.com"]);

  const rows = await env.DB.prepare("SELECT id, status, suppressed_reason FROM outbox WHERE event_id = ? ORDER BY to_email")
    .bind(DEMO_EVENT).all<{ id: string; status: string; suppressed_reason: string | null }>();
  expect(rows.results).toEqual([
    { id: allowed.id, status: "sent", suppressed_reason: null },
    { id: held.id, status: "suppressed", suppressed_reason: "demo_mode_not_allowlisted" },
  ]);
});

test("CONTRACT · outside demo mode the list is inert, and the screen is told which world it is in", async () => {
  const cookie = await cookieFor(OWNER, "allowlist-live");
  const response = await call(`/api/v1/events/${LIVE_EVENT}/demo-mail-allowlist`, cookie);
  expect(response.status).toBe(200);
  expect((await response.json<AllowlistBody>()).data.demo_mode).toBe(false);
  // Nothing is held on a live conference, listed or not.
  expect(await demoMailWouldBeSuppressed(env.DB, LIVE_EVENT, "anyone@example.com")).toBe(false);
});
