import {
  createExecutionContext,
  createMessageBatch,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, expect, test, vi } from "vitest";

import { app } from "../../src/index";
import { RESET_DEMO_MESSAGE_TYPE } from "../../src/routes/admin-ops.routes";
import worker from "../../src/index";
import {
  DEMO_ORGANIZATION_ID,
  DEMO_SPEAKER_PERSON_ID,
} from "../../src/lib/reset-demo/demo-fixture";
import { reseedDemo } from "../../src/lib/reset-demo/reseed-demo";
import { readResetJob } from "../../src/lib/reset-demo/reset-jobs";
import { applyMigrations, env } from "./apply-migrations";

beforeEach(async () => {
  await applyMigrations();
});

async function dispatchResetJob(jobId: string, mirrorSend: (message: unknown) => void) {
  const batch = createMessageBatch("operations-queue", [
    { id: "msg_1", timestamp: new Date(), attempts: 1, body: { type: RESET_DEMO_MESSAGE_TYPE, job_id: jobId } },
  ]);
  const ctx = createExecutionContext();
  const testEnv = { ...env, MIRROR_QUEUE: { send: mirrorSend } as unknown as typeof env.MIRROR_QUEUE };
  await worker.queue?.(batch, testEnv, ctx);
  await waitOnExecutionContext(ctx);
}

test("AC-230 · reset-demo restores the seeded fixture within the ≤20s observable-restore budget, and is idempotent", async () => {
  await reseedDemo(env.DB);

  // Mutate: delete a demo persona (and its membership, FK-first) and leave a stray row behind.
  await env.DB.prepare("DELETE FROM memberships WHERE person_id = ?").bind(DEMO_SPEAKER_PERSON_ID).run();
  await env.DB.prepare("DELETE FROM people WHERE id = ?").bind(DEMO_SPEAKER_PERSON_ID).run();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("org_stray", "Stray", "stray", Date.now(), Date.now())
    .run();

  const startedAt = Date.now();
  const testEnv = { ...env, LOCAL_VALIDATION_TOKEN: "test-local-validation-token" };
  const postResponse = await app.request(
    "/api/v1/admin/reset-demo",
    { method: "POST", headers: { "x-marquee-local-validation": "test-local-validation-token" } },
    testEnv,
  );
  expect(postResponse.status).toBe(202);
  const { job_id: jobId } = await postResponse.json<{ job_id: string }>();

  const mirrorSend = vi.fn();
  await dispatchResetJob(jobId, mirrorSend);

  const job = await readResetJob(env.CACHE, jobId);
  expect(job?.status).toBe("done");
  expect(Date.now() - startedAt).toBeLessThan(20_000);

  const speaker = await env.DB.prepare("SELECT id FROM people WHERE id = ?")
    .bind(DEMO_SPEAKER_PERSON_ID)
    .first();
  expect(speaker).not.toBeNull();
  const strayOrg = await env.DB.prepare("SELECT id FROM organizations WHERE id = 'org_stray'").first();
  expect(strayOrg).toBeNull();
  const orgCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM organizations").first<{ n: number }>();
  expect(orgCount?.n).toBe(1);

  expect(mirrorSend).toHaveBeenCalledTimes(1);
  expect(mirrorSend.mock.calls[0][0]).toMatchObject({ type: "mirror_reconcile" });

  const mirrorOutboxCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM mirror_outbox").first<{ n: number }>();
  expect(mirrorOutboxCount?.n).toBe(0);

  // Idempotence: run twice consecutively, counts stay identical.
  const beforeCounts = await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships").first<{ n: number }>();
  await reseedDemo(env.DB);
  const afterCounts = await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships").first<{ n: number }>();
  expect(afterCounts?.n).toBe(beforeCounts?.n);
});

test("AC-230 · POST /api/v1/admin/reset-demo 403s with no demo_mode=1 event", async () => {
  const testEnv = { ...env, LOCAL_VALIDATION_TOKEN: "test-local-validation-token" };
  const response = await app.request(
    "/api/v1/admin/reset-demo",
    { method: "POST", headers: { "x-marquee-local-validation": "test-local-validation-token" } },
    testEnv,
  );
  expect(response.status).toBe(403);
});

test("CONTRACT · POST /api/v1/admin/reset-demo 401s with no local-validation header and no session", async () => {
  await reseedDemo(env.DB);
  const response = await app.request("/api/v1/admin/reset-demo", { method: "POST" }, env);
  expect(response.status).toBe(401);
});

test("CONTRACT · reset-demo run never leaves org rows behind that weren't part of the fixture", async () => {
  await reseedDemo(env.DB);
  const before = await env.DB.prepare("SELECT id FROM organizations").first<{ id: string }>();
  expect(before?.id).toBe(DEMO_ORGANIZATION_ID);
});
