import { Hono } from "hono";
import type { Context } from "hono";

import type { Env } from "../index";
import type { EventRow } from "../db/schema";
import { forbidden, getAuth, unauthorized } from "../lib/auth/auth-middleware";
import { authHasRole } from "../lib/auth/scope-resolution";
import { createResetJob, readResetJob } from "../lib/reset-demo/reset-jobs";

export const RESET_DEMO_MESSAGE_TYPE = "reset_demo";

export const adminOpsRoutes = new Hono<{ Bindings: Env }>();

/**
 * AC-230 / US-73: restores the seeded demo state. Manual-invocation only —
 * nothing in this module is reachable from a cron trigger. The route fails
 * closed like the demo login: with no `demo_mode = 1` event there is nothing
 * to reset and the answer is 403. Invocation requires an owner/program_lead
 * session for the demo event (the in-product button), or the loopback-only
 * local-validation header (the npm script; the token is undefined in
 * production, so that path is closed there).
 *
 * The reseed itself runs on the operations queue: the route enqueues it and
 * returns a job id the button polls (SPEC §4.1).
 */
adminOpsRoutes.post("/reset-demo", async (context) => {
  const event = await context.env.DB.prepare(
    "SELECT * FROM events WHERE demo_mode = 1 ORDER BY created_at ASC LIMIT 1",
  ).first<EventRow>();
  if (!event) {
    return context.json(
      { error: { code: "demo_disabled", message: "Reset is only available in demo mode" } },
      403,
    );
  }

  if (!passesLocalValidation(context) && !passesSessionScope(context, event.id)) {
    return getAuth(context)
      ? forbidden(context, "Reset requires an owner or program lead of the demo event")
      : unauthorized(context);
  }

  const job = await createResetJob(context.env.CACHE);
  await context.env.OPERATIONS_QUEUE.send({
    type: RESET_DEMO_MESSAGE_TYPE,
    job_id: job.id,
  });
  context.header("Cache-Control", "no-store");
  return context.json({ ok: true, job_id: job.id, status: job.status }, 202);
});

adminOpsRoutes.get("/reset-demo/:jobId", async (context) => {
  const job = await readResetJob(context.env.CACHE, context.req.param("jobId"));
  if (!job) {
    return context.json(
      { error: { code: "not_found", message: "Unknown reset job" } },
      404,
    );
  }
  context.header("Cache-Control", "no-store");
  return context.json(job);
});

function passesLocalValidation(context: Context<{ Bindings: Env }>): boolean {
  const expected = context.env.LOCAL_VALIDATION_TOKEN;
  return (
    expected !== undefined &&
    context.req.header("x-marquee-local-validation") === expected
  );
}

function passesSessionScope(
  context: Context<{ Bindings: Env }>,
  eventId: string,
): boolean {
  const auth = getAuth(context);
  if (!auth) return false;
  return authHasRole(auth, "program_lead", eventId);
}
