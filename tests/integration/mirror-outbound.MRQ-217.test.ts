import { beforeEach, expect, test } from "vitest";

import { dispatchPendingMirrorMessages } from "../../src/jobs/mirror/outbox";
import { drainMirrorOutbox, MAX_MIRROR_ATTEMPTS } from "../../src/jobs/mirror/consumer";
import { FakeAirtableTransport } from "../../src/jobs/mirror/fake-transport";
import { MirrorTokenBucket } from "../../src/jobs/mirror/rate-limiter";
import { encryptMirrorSecret, tokenFingerprint } from "../../src/jobs/mirror/credentials";
import type { MirrorConsumerEnvironment } from "../../src/jobs/mirror/consumer";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.now();
const ORG_ID = "org_mrq217";
const EVENT_ID = "evt_mrq217";
const PERSON_ID = "per_mrq217";
const TEMPLATE_ID = "tpl_mrq217";
const MIRROR_CREDENTIAL_SECRET = "mrq217-credential-secret";

const MIRROR_TABLE_IDS = {
  people: "tbl_people_mrq217",
  submissions: "tbl_submissions_mrq217",
  speaker_tasks: "tbl_tasks_mrq217",
} as const;

function mirrorEnvironment(overrides: Partial<MirrorConsumerEnvironment> = {}): MirrorConsumerEnvironment {
  return {
    ...env,
    MIRROR_CREDENTIAL_SECRET,
    MEDIA_PUBLIC_ORIGIN: "media.example.test",
    UPLOAD_TOKEN_SECRET: "mrq217-upload-secret",
    MIRROR_QUEUE: { send: async () => {} } as unknown as typeof env.MIRROR_QUEUE,
    ...overrides,
  } as unknown as MirrorConsumerEnvironment;
}

async function clearMirrorFixture(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mirror_credentials WHERE org_id = ?").bind(ORG_ID),
    env.DB.prepare("DELETE FROM mirror_outbox"),
    env.DB.prepare(
      "DELETE FROM mirror_state WHERE table_name IN ('people', 'submissions', 'speaker_tasks', '__mirror_suppressed__')",
    ),
    env.DB.prepare("DELETE FROM speaker_tasks WHERE id LIKE 'task_mrq217_%'"),
    env.DB.prepare("DELETE FROM task_templates WHERE id = ?").bind(TEMPLATE_ID),
    env.DB.prepare("DELETE FROM submissions WHERE id LIKE 'sub_mrq217_%'"),
    env.DB.prepare("DELETE FROM people WHERE id = ?").bind(PERSON_ID),
    env.DB.prepare("DELETE FROM events WHERE id = ?").bind(EVENT_ID),
    env.DB.prepare("DELETE FROM organizations WHERE id = ?").bind(ORG_ID),
  ]);
}

async function configureMirror(tableNames: readonly (keyof typeof MIRROR_TABLE_IDS)[]): Promise<void> {
  await env.DB.batch(
    tableNames.map((tableName) => env.DB.prepare(
      `INSERT INTO mirror_state
        (id, table_name, airtable_table_id, local_row_count, remote_row_count, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, ?, ?)`,
    ).bind(`state_mrq217_${tableName}`, tableName, MIRROR_TABLE_IDS[tableName], NOW, NOW)),
  );
}

async function seedCore(submissionCount = 1, withTask = true): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'MRQ-217 Org', 'mrq217', ?, ?)",
    ).bind(ORG_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, 'MRQ-217 Event', 'mrq217', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people
        (id, org_id, email, name, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, 'speaker@mrq217.test', 'MRQ-217 Speaker', '[]', 0, 'marquee', ?, ?)`,
    ).bind(PERSON_ID, ORG_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO task_templates
        (id, event_id, name, kind, due_offset_days, position, created_at, updated_at)
       VALUES (?, ?, 'MRQ-217 task', 'acknowledge', 7, 0, ?, ?)`,
    ).bind(TEMPLATE_ID, EVENT_ID, NOW, NOW),
  ]);

  const token = "pat_mrq217_fake";
  await env.DB.prepare(
    `INSERT INTO mirror_credentials
      (id, org_id, token_ciphertext, token_fingerprint, base_id, set_at,
       set_by_person_id, last_verified_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).bind(
    "credential_mrq217",
    ORG_ID,
    await encryptMirrorSecret(token, MIRROR_CREDENTIAL_SECRET),
    await tokenFingerprint(token),
    "app_mrq217_fake",
    NOW,
    PERSON_ID,
    NOW,
    NOW,
    NOW,
  ).run();

  await env.DB.batch(Array.from({ length: submissionCount }, (_, index) => env.DB.prepare(
    `INSERT INTO submissions
      (id, event_id, kind, bypass_evaluation, title, abstract, status, origin,
       submitter_person_id, search_blob, created_at, updated_at)
     VALUES (?, ?, 'abstract', 0, ?, 'Abstract', 'submitted', 'admin', ?, ?, ?, ?)`,
  ).bind(
    `sub_mrq217_${String(index).padStart(3, "0")}`,
    EVENT_ID,
    `MRQ-217 Submission ${index}`,
    PERSON_ID,
    `mrq217 submission ${index}`,
    NOW,
    NOW,
  )));

  if (withTask) {
    await env.DB.prepare(
      `INSERT INTO speaker_tasks
        (id, event_id, person_id, submission_id, template_id, title, kind,
         due_at, status, created_at, updated_at)
       VALUES ('task_mrq217_000', ?, ?, 'sub_mrq217_000', ?, 'Confirm details', 'acknowledge', ?, 'open', ?, ?)`,
    ).bind(EVENT_ID, PERSON_ID, TEMPLATE_ID, NOW + 7 * 86_400_000, NOW, NOW).run();
  }
}

async function outboxRows(): Promise<Array<{ table_name: string; op: string; payload: string; status: string }>> {
  const result = await env.DB.prepare(
    "SELECT table_name, op, payload, status FROM mirror_outbox ORDER BY table_name, row_id",
  ).all<{ table_name: string; op: string; payload: string; status: string }>();
  return result.results;
}

beforeEach(async () => {
  await applyMigrations();
  await clearMirrorFixture();
});

test("AC-227 · local writes feed exactly submissions, speaker_tasks, and people, with echo suppression", async () => {
  await configureMirror(["people", "submissions", "speaker_tasks"]);
  await seedCore();

  const initial = await outboxRows();
  expect(initial).toHaveLength(3);
  expect(new Set(initial.map((row) => row.table_name))).toEqual(new Set(["people", "submissions", "speaker_tasks"]));
  expect(initial.every((row) => row.op === "upsert" && row.status === "queued")).toBe(true);
  expect(initial.map((row) => JSON.parse(row.payload).marquee_id).sort()).toEqual([
    PERSON_ID,
    "sub_mrq217_000",
    "task_mrq217_000",
  ].sort());

  await env.DB.prepare(
    "UPDATE people SET title = 'Changed in Airtable', last_write_source = 'airtable', updated_at = ? WHERE id = ?",
  ).bind(NOW + 1, PERSON_ID).run();
  expect(await outboxRows()).toHaveLength(3);

  await env.DB.prepare(
    "UPDATE people SET title = 'Changed locally', last_write_source = 'marquee', updated_at = ? WHERE id = ?",
  ).bind(NOW + 2, PERSON_ID).run();
  // A queued upsert already reads current D1 truth at drain time, so the
  // derived-column update and the human update share one pending row.
  expect(await outboxRows()).toHaveLength(3);

  await env.DB.prepare("DELETE FROM speaker_tasks WHERE id = ?").bind("task_mrq217_000").run();
  const afterDelete = await outboxRows();
  expect(afterDelete).toHaveLength(4);
  expect(afterDelete.find((row) => row.table_name === "speaker_tasks" && row.op === "delete")).toMatchObject({
    table_name: "speaker_tasks",
    op: "delete",
    status: "queued",
  });
});

test("AC-225 · fake call log proves 10-record upsert batches, merge key, and <=4 requests/sec", async () => {
  await configureMirror(["submissions"]);
  await seedCore(25, false);

  let now = 1_000_000;
  const clock = {
    now: () => now,
    sleep: async (milliseconds: number) => {
      now += milliseconds;
    },
  };
  const fake = new FakeAirtableTransport(() => now);
  const limiter = new MirrorTokenBucket(clock);
  const result = await drainMirrorOutbox(
    env.DB,
    mirrorEnvironment(),
    [],
    { transport: fake, limiter, now: clock.now, sleep: clock.sleep },
  );

  expect(result).toEqual({ claimed: 25, drained: 25 });
  const patchCalls = fake.calls.filter((call) => call.kind === "patch");
  expect(patchCalls.map((call) => call.records.length)).toEqual([10, 10, 5]);
  expect(patchCalls.every((call) => call.tableId === MIRROR_TABLE_IDS.submissions)).toBe(true);
  expect(patchCalls.every((call) => call.performUpsert.fieldsToMergeOn[0] === "marquee_id" && call.performUpsert.fieldsToMergeOn.length === 1)).toBe(true);
  expect(patchCalls.map((call) => call.records.every((record) => typeof record.fields.marquee_id === "string"))).toEqual([
    true,
    true,
    true,
  ]);

  const times = patchCalls.map((call) => call.at);
  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(250);
  expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(250);
  for (const start of times) {
    expect(times.filter((time) => time - start < 1_000).length).toBeLessThanOrEqual(4);
  }

  const drained = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM mirror_outbox WHERE status = 'drained' AND drained_at IS NOT NULL",
  ).first<{ count: number }>();
  expect(Number(drained?.count)).toBe(25);
});

test("CONTRACT · missing credentials leave pending mirror work inert and the consumer stays a no-op", async () => {
  await configureMirror(["submissions"]);
  await seedCore(1, false);
  expect(await outboxRows()).toHaveLength(1);

  const sends: unknown[] = [];
  const disabled = mirrorEnvironment({
    MIRROR_CREDENTIAL_SECRET: undefined,
    MIRROR_QUEUE: { send: async (message: unknown) => sends.push(message) } as unknown as typeof env.MIRROR_QUEUE,
  });
  expect(await dispatchPendingMirrorMessages(disabled)).toBe(0);
  expect(sends).toHaveLength(0);
  expect(await outboxRows()).toHaveLength(1);
  expect(await drainMirrorOutbox(env.DB, disabled)).toEqual({ claimed: 0, drained: 0 });
  expect(await outboxRows()).toHaveLength(1);
});

test("CONTRACT · exhausted mirror rows cannot starve healthy work", async () => {
  await configureMirror(["submissions"]);
  await seedCore(2, false);

  await env.DB.prepare(
    `UPDATE mirror_outbox
        SET status = 'failed', attempts = ?, last_error = 'poison', updated_at = ?
      WHERE table_name = 'submissions' AND row_id = ?`,
  ).bind(MAX_MIRROR_ATTEMPTS, NOW, "sub_mrq217_000").run();

  const fake = new FakeAirtableTransport(() => NOW);
  const result = await drainMirrorOutbox(env.DB, mirrorEnvironment(), [], { transport: fake, now: () => NOW });
  expect(result).toEqual({ claimed: 1, drained: 1 });
  expect(fake.calls.filter((call) => call.kind === "patch").map((call) => call.records.length)).toEqual([1]);

  const rows = await env.DB.prepare(
    "SELECT row_id, status, attempts FROM mirror_outbox WHERE table_name = 'submissions' ORDER BY row_id",
  ).all<{ row_id: string; status: string; attempts: number }>();
  expect(rows.results).toEqual([
    { row_id: "sub_mrq217_000", status: "failed", attempts: MAX_MIRROR_ATTEMPTS },
    { row_id: "sub_mrq217_001", status: "drained", attempts: 1 },
  ]);
});
