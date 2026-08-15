import { beforeEach, expect, test } from "vitest";
import type { Queue } from "@cloudflare/workers-types";

import { connectMirror, disconnectMirror, mapMirror, readMirrorStatus } from "../../src/jobs/mirror/actions";
import { runOnboardingCascade } from "../../src/jobs/cascade/decisions";
import { encryptMirrorSecret, readMirrorCredential, tokenFingerprint } from "../../src/jobs/mirror/credentials";
import { FakeAirtableTransport } from "../../src/jobs/mirror/fake-transport";
import { drainMirrorOutbox } from "../../src/jobs/mirror/consumer";
import { handleMirrorWebhook, mirrorWebhookSignature, pullMirrorPayloads } from "../../src/jobs/mirror/inbound";
import { MirrorTokenBucket } from "../../src/jobs/mirror/rate-limiter";
import type { MirrorActionEnvironment } from "../../src/jobs/mirror/actions";
import type { MirrorConsumerEnvironment } from "../../src/jobs/mirror/consumer";
import type { AirtableTable, AirtableWebhookPayload } from "../../src/jobs/mirror/transport";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);
const ORG_ID = "org_mrq223";
const PERSON_ID = "per_mrq223";
const EVENT_ID = "evt_mrq223";
const SUBMISSION_ID = "sub_mrq223";
const MIRROR_SECRET = "mrq223-credential-encryption-secret";
const AIRTABLE_TOKEN = "pat_mrq223_should-never-be-stored-plaintext";
const BASE_ID = "app_mrq223_fake";

const TABLE_IDS = {
  people: "tbl_mrq223_people",
  submissions: "tbl_mrq223_submissions",
  speaker_tasks: "tbl_mrq223_tasks",
} as const;

const TABLES: readonly AirtableTable[] = [
  { id: TABLE_IDS.people, name: "People" },
  { id: TABLE_IDS.submissions, name: "Submissions" },
  { id: TABLE_IDS.speaker_tasks, name: "Speaker Tasks" },
];

function clockAt(start = NOW) {
  let now = start;
  return {
    now: () => now,
    sleep: async (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function actionEnvironment(fake: FakeAirtableTransport): MirrorActionEnvironment {
  return {
    ...env,
    MIRROR_CREDENTIAL_SECRET: MIRROR_SECRET,
    MIRROR_TRANSPORT: fake,
    MIRROR_QUEUE: undefined,
  } as unknown as MirrorActionEnvironment;
}

function consumerEnvironment(fake: FakeAirtableTransport): MirrorConsumerEnvironment {
  return {
    ...actionEnvironment(fake),
    MIRROR_QUEUE: { send: async () => {} },
  } as unknown as MirrorConsumerEnvironment;
}

async function count(sql: string, ...bindings: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function seedPerson(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'MRQ-223', 'mrq223', ?, ?)",
    ).bind(ORG_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people
        (id, org_id, email, name, title, company, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, 'speaker@mrq223.test', 'MRQ-223 Speaker', 'Original title', 'Original company', '[]', 0, 'marquee', ?, ?)`,
    ).bind(PERSON_ID, ORG_ID, NOW, NOW),
  ]);
}

async function connectAndMap(fake: FakeAirtableTransport): Promise<void> {
  const connected = await connectMirror(actionEnvironment(fake), {
    baseId: BASE_ID,
    orgId: ORG_ID,
    setByPersonId: PERSON_ID,
    token: AIRTABLE_TOKEN,
    now: NOW,
  });
  expect(connected.ok).toBe(true);
  if (!connected.ok) throw new Error(connected.message);

  const clock = clockAt();
  const mapped = await mapMirror(actionEnvironment(fake), {
    mapping: {
      people: TABLE_IDS.people,
      submissions: TABLE_IDS.submissions,
      speaker_tasks: TABLE_IDS.speaker_tasks,
    },
    orgId: ORG_ID,
    clock,
    now: NOW,
  });
  expect(mapped.ok).toBe(true);
  if (!mapped.ok) throw new Error(mapped.message);
}

function peoplePayload(title: string, company = "Airtable company"): AirtableWebhookPayload {
  return {
    changedTablesById: {
      [TABLE_IDS.people]: {
        changedRecordsById: {
          [PERSON_ID]: {
            current: {
              fields: {
                marquee_id: PERSON_ID,
                title,
                company,
                name: "This field is not inbound-allowlisted",
              },
            },
          },
        },
      },
    },
  };
}

function submissionPayload(status: string): AirtableWebhookPayload {
  return {
    changedTablesById: {
      [TABLE_IDS.submissions]: {
        changedRecordsById: {
          [SUBMISSION_ID]: {
            current: {
              fields: {
                marquee_id: SUBMISSION_ID,
                status,
                title: "This field is not inbound-allowlisted",
              },
            },
          },
        },
      },
    },
  };
}

async function person(): Promise<{ title: string | null; company: string | null; name: string; last_write_source: string }> {
  return (await env.DB.prepare(
    "SELECT title, company, name, last_write_source FROM people WHERE id = ?",
  ).bind(PERSON_ID).first()) as { title: string | null; company: string | null; name: string; last_write_source: string };
}

beforeEach(async () => {
  await applyMigrations();
  await seedPerson();
});

test("AC-308 · connect verifies the base before persistence and stores only encrypted provider credentials", async () => {
  const fake = new FakeAirtableTransport(() => NOW, { tables: TABLES });
  const result = await connectMirror(actionEnvironment(fake), {
    baseId: BASE_ID,
    orgId: ORG_ID,
    setByPersonId: PERSON_ID,
    token: AIRTABLE_TOKEN,
    now: NOW,
  });

  expect(result.ok).toBe(true);
  expect(fake.calls.map((call) => call.kind)).toEqual(["schema"]);
  expect(await count("SELECT COUNT(*) AS count FROM mirror_credentials WHERE org_id = ?", ORG_ID)).toBe(1);
  // AC-310's fixture prohibition matters here: connect itself has not created
  // an on-switch state row, and the fake schema call is the proof of reachability.
  expect(await count("SELECT COUNT(*) AS count FROM mirror_state")).toBe(0);

  const stored = await env.DB.prepare(
    "SELECT token_ciphertext, token_fingerprint, base_id FROM mirror_credentials WHERE org_id = ?",
  ).bind(ORG_ID).first<{ token_ciphertext: string; token_fingerprint: string; base_id: string }>();
  expect(stored?.token_ciphertext).toBeTruthy();
  expect(stored?.token_ciphertext).not.toContain(AIRTABLE_TOKEN);
  expect(stored?.token_fingerprint).toBe(await tokenFingerprint(AIRTABLE_TOKEN));
  expect(stored?.base_id).toBe(BASE_ID);
  expect((await readMirrorCredential(env.DB, actionEnvironment(fake), ORG_ID))?.token).toBe(AIRTABLE_TOKEN);
});

test("AC-310 · mapping is the reachable mirror on-switch and creates all three state rows", async () => {
  const fake = new FakeAirtableTransport(() => NOW, { tables: TABLES });

  // There is deliberately no mirror_state insert or fixture in this test.
  await connectAndMap(fake);

  const states = await env.DB.prepare(
    "SELECT table_name, airtable_table_id, webhook_id, webhook_expires_at FROM mirror_state ORDER BY table_name",
  ).all<{ table_name: string; airtable_table_id: string; webhook_id: string; webhook_expires_at: number }>();
  expect(states.results).toHaveLength(3);
  expect(states.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ table_name: "people", airtable_table_id: TABLE_IDS.people, webhook_id: "whk_fake_mrq223" }),
    expect.objectContaining({ table_name: "submissions", airtable_table_id: TABLE_IDS.submissions, webhook_id: "whk_fake_mrq223" }),
    expect.objectContaining({ table_name: "speaker_tasks", airtable_table_id: TABLE_IDS.speaker_tasks, webhook_id: "whk_fake_mrq223" }),
  ]));
  expect(fake.calls.map((call) => call.kind)).toEqual(["schema", "schema", "create_webhook"]);
  const status = await readMirrorStatus(env.DB, actionEnvironment(fake), ORG_ID);
  expect(status).toMatchObject({ configured: true, mapped: true, baseId: BASE_ID, trafficAssisted: true });
});

test("AC-313 · disconnect is explicit feed cleanup and removes the provider registration", async () => {
  const fake = new FakeAirtableTransport(() => NOW, { tables: TABLES });
  await connectAndMap(fake);
  await env.DB.prepare(
    `INSERT INTO mirror_outbox
      (id, table_name, row_id, op, payload, status, attempts, created_at, updated_at)
     VALUES ('outbox_mrq223', 'people', ?, 'upsert', ?, 'queued', 0, ?, ?)`,
  ).bind(PERSON_ID, JSON.stringify({ marquee_id: PERSON_ID }), NOW, NOW).run();

  const result = await disconnectMirror(actionEnvironment(fake), ORG_ID);
  expect(result.warning).toBeNull();
  expect(fake.calls.filter((call) => call.kind === "delete_webhook")).toEqual([
    expect.objectContaining({ webhookId: "whk_fake_mrq223" }),
  ]);
  expect(await count("SELECT COUNT(*) AS count FROM mirror_credentials WHERE org_id = ?", ORG_ID)).toBe(0);
  expect(await count("SELECT COUNT(*) AS count FROM mirror_state")).toBe(0);
  expect(await count("SELECT COUNT(*) AS count FROM mirror_outbox WHERE drained_at IS NULL")).toBe(0);
});

test("AC-226 · one signed inbound edit applies allowlisted fields and drops the rest without a cascade", async () => {
  const fake = new FakeAirtableTransport(() => NOW, { tables: TABLES });
  await connectAndMap(fake);
  fake.payloads.push(peoplePayload("Changed in Airtable"));

  const result = await pullMirrorPayloads(actionEnvironment(fake), {
    transport: fake,
    ...clockAt(),
  });
  expect(result).toMatchObject({ applied: 1, dropped: 1, payloads: 1, cursor: "1" });
  expect(await person()).toMatchObject({
    title: "Changed in Airtable",
    company: "Airtable company",
    name: "MRQ-223 Speaker",
    last_write_source: "airtable",
  });
  expect(await count("SELECT COUNT(*) AS count FROM mirror_outbox WHERE drained_at IS NULL")).toBe(0);
});

test("CONTRACT · inbound accepted status stops before tasks and mail until the recovery action is clicked", async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, 'MRQ-223 Event', 'mrq223-event', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO task_templates
        (id, event_id, name, kind, description, due_at, position, auto_assign, created_at, updated_at)
       VALUES ('template_mrq223', ?, 'Speaker details', 'acknowledge', '', ?, 0, 1, ?, ?)`,
    ).bind(EVENT_ID, NOW + 7 * 86_400_000, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO email_templates
        (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
       VALUES ('email_mrq223_acceptance', ?, 'acceptance', 'Acceptance', 'Accepted', 'Accepted.', 1, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at)
       VALUES (?, ?, 'session', 'MRQ-223 session', 'submitted', 'admin', ?, ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, PERSON_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
       VALUES ('participation_mrq223', ?, ?, 'speaker', 0, ?, ?)`,
    ).bind(SUBMISSION_ID, PERSON_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submission_decisions
        (id, event_id, submission_id, decision, resulting_status, feedback_md,
         decided_by_person_id, decided_at, outbox_id, created_at, updated_at)
       VALUES ('decision_mrq223', ?, ?, 'approve', 'accepted', NULL, ?, ?, NULL, ?, ?)`,
    ).bind(EVENT_ID, SUBMISSION_ID, PERSON_ID, NOW, NOW, NOW),
  ]);

  const fake = new FakeAirtableTransport(() => NOW, { tables: TABLES });
  await connectAndMap(fake);
  fake.payloads.push(submissionPayload("accepted"));
  const pulled = await pullMirrorPayloads(actionEnvironment(fake), { transport: fake, ...clockAt() });
  expect(pulled).toMatchObject({ applied: 1, dropped: 1 });
  expect(await count("SELECT COUNT(*) AS count FROM speaker_tasks WHERE submission_id = ?", SUBMISSION_ID)).toBe(0);
  expect(await count("SELECT COUNT(*) AS count FROM outbox WHERE event_id = ?", EVENT_ID)).toBe(0);

  const resumed = await runOnboardingCascade({
    db: env.DB,
    queue: { send: async () => {} } as unknown as Queue<unknown>,
    eventId: EVENT_ID,
    submissionId: SUBMISSION_ID,
    actor: { kind: "user", personId: PERSON_ID, requestId: "req_mrq223" },
    now: NOW,
  });
  expect(resumed).toMatchObject({ outcome: "succeeded", tasksAssigned: 1, notificationsQueued: 1 });
  expect(await count("SELECT COUNT(*) AS count FROM speaker_tasks WHERE submission_id = ?", SUBMISSION_ID)).toBe(1);
  expect(await count("SELECT COUNT(*) AS count FROM outbox WHERE event_id = ?", EVENT_ID)).toBe(1);
});

test("AC-227 · three local and Airtable bounces settle without an echo loop", async () => {
  const fake = new FakeAirtableTransport(() => NOW, { tables: TABLES });
  await connectAndMap(fake);
  let now = NOW;
  const clock = {
    now: () => now,
    sleep: async (milliseconds: number) => { now += milliseconds; },
  };
  const environment = consumerEnvironment(fake);
  const limiter = new MirrorTokenBucket(clock);

  const local = async (title: string) => {
    now += 1;
    await env.DB.prepare(
      "UPDATE people SET title = ?, last_write_source = 'marquee', updated_at = ? WHERE id = ?",
    ).bind(title, now, PERSON_ID).run();
    const drained = await drainMirrorOutbox(env.DB, environment, [], {
      limiter,
      now: clock.now,
      sleep: clock.sleep,
      transport: fake,
    });
    expect(drained.drained).toBeGreaterThan(0);
  };
  const inbound = async (title: string) => {
    fake.payloads.push(peoplePayload(title));
    const pulled = await pullMirrorPayloads(actionEnvironment(fake), {
      limiter,
      now: clock.now,
      sleep: clock.sleep,
      transport: fake,
    });
    expect(pulled.applied).toBe(1);
    expect(await count("SELECT COUNT(*) AS count FROM mirror_outbox WHERE drained_at IS NULL")).toBe(0);
  };

  await local("Local one");
  await inbound("Airtable one");
  await local("Local two");
  await inbound("Airtable two");
  await local("Local three");

  const patchCalls = fake.calls.filter((call) => call.kind === "patch");
  expect(patchCalls).toHaveLength(3);
  expect(patchCalls.map((call) => call.records.at(-1)?.fields.title)).toEqual([
    "Local one",
    "Local two",
    "Local three",
  ]);
  expect((await person()).title).toBe("Local three");
  expect(await count("SELECT COUNT(*) AS count FROM mirror_outbox WHERE drained_at IS NULL")).toBe(0);
});

test("CONTRACT · a signed webhook is only a cursor-pull trigger and rejects an invalid signature", async () => {
  const fake = new FakeAirtableTransport(() => NOW, { tables: TABLES });
  await connectAndMap(fake);
  const storedSecret = btoa(fake.webhookSecret);
  const body = JSON.stringify({ type: "ping" });
  const signature = await mirrorWebhookSignature(body, storedSecret);

  fake.payloads.push(peoplePayload("Signed Airtable edit"));
  const accepted = await handleMirrorWebhook(
    actionEnvironment(fake),
    new Request("https://marquee.stage11.dev/mirror/webhook", {
      method: "POST",
      body,
      headers: { "X-Airtable-Webhook-Signature": signature },
    }),
  );
  expect(accepted.status).toBe(200);
  expect(accepted.body).toMatchObject({ applied: 1, dropped: 1 });

  const callsBeforeInvalid = fake.calls.length;
  const rejected = await handleMirrorWebhook(
    actionEnvironment(fake),
    new Request("https://marquee.stage11.dev/mirror/webhook", {
      method: "POST",
      body,
      headers: { "X-Airtable-Webhook-Signature": "not-valid" },
    }),
  );
  expect(rejected).toEqual({ body: { accepted: false }, status: 401 });
  expect(fake.calls).toHaveLength(callsBeforeInvalid);
});
