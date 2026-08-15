import { Hono } from "hono";

import { resolveRequestId } from "./api/errors";
import { createApiRouter } from "./api/router";
import { setSessionCookie } from "./lib/cookies";
import { runUploadOrphanSweep } from "./lib/r2/orphan-sweep";
import { apiManifest } from "./routes/_manifest";
import { createCredentialResolver } from "./lib/auth/credential-resolver";
import { MIRROR_RECONCILE_MESSAGE_TYPE, runResetJob } from "./lib/reset-demo/reset-consumer";
import { RESET_DEMO_MESSAGE_TYPE } from "./routes/admin-ops.routes";
import { processMailQueue, MAIL_MESSAGE_TYPE, runMailSchedule } from "./jobs/mail/consumer";
import { dispatchPendingMirrorMessages } from "./jobs/mirror/outbox";
import { processMirrorQueue } from "./jobs/mirror/consumer";
import { MIRROR_OUTBOX_MESSAGE_TYPE } from "./jobs/mirror/messages";
import { MAIL_SCHEDULE_CRON } from "./jobs/mail/schedule";
import type { Principal } from "./api/runtime";
import type { ApiGrant } from "./api/grants";
import { BUILD_INFO } from "./lib/observability/build-info";
import { recordCronHeartbeat } from "./lib/observability/heartbeat";
import { errorFields, loggerForEnv } from "./lib/observability/log";
import { correlateQueue, instrumentBindings } from "./lib/observability/request-instrumentation";
import { claimRoutes } from "./routes/claim.route";
import { landingRoutes } from "./routes/landing.route";
import { signinRoutes } from "./routes/signin.route";
import { publicFormRoutes } from "./routes/public-form.route";
import { publicAgendaRoutes } from "./routes/public-agenda.route";
import { embedRoutes } from "./routes/embed.route";
import { calendarRoutes } from "./routes/calendar.route";
import skill from "../SKILL.md?raw";
import { serveAssetOrNotFound } from "./routes/not-found.route";

export interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  DB: D1Database;
  LOCAL_VALIDATION_TOKEN?: string;
  /** `debug | info | warn | error`; anything else falls back to `info`. */
  LOG_LEVEL?: string;
  /** `"0"` or `"false"` turns the browser error beacon off at the source. */
  CLIENT_TELEMETRY?: string;
  /**
   * `"1"` lets an attendee's "get it by email" claim actually send. Ships off:
   * the mail plan is the constraint, not the code (design §7, Constraints).
   */
  ATTENDEE_CLAIM_MAIL?: string;
  MAIL_QUEUE: Queue<unknown>;
  RESEND_API_KEY?: string;
  /** Optional display label for the connected Resend account. */
  RESEND_ACCOUNT_NAME?: string;
  RESEND_WEBHOOK_SECRET?: string;
  MEDIA: R2Bucket;
  MIRROR_QUEUE: Queue<unknown>;
  AIRTABLE_API_KEY?: string;
  AIRTABLE_BASE_ID?: string;
  AIRTABLE_BASE?: string;
  OPERATIONS_QUEUE: Queue<unknown>;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string;
  WEBHOOK_QUEUE: Queue<unknown>;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  MEDIA_PUBLIC_ORIGIN: string;
  UPLOAD_TOKEN_SECRET: string;
  UPLOAD_RATE_LIMIT_SECRET: string;
}

type AppEnv = { Bindings: Env };

/** The queue-message envelope the composition root dispatches on. */
type QueueMessageBody = {
  type?: string;
  job_id?: string;
  /** Correlation id of the request that enqueued this message (see `enqueue`). */
  request_id?: string;
};

/** Nightly orphaned-upload sweep; the schedule is declared in `wrangler.jsonc`. */
const UPLOAD_SWEEP_CRON = "30 4 * * *";

const TURNSTILE_ALWAYS_PASS_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_ALWAYS_PASS_SECRET_KEY =
  "1x0000000000000000000000000000000AA";
const LOOPBACK_HOSTNAMES = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
]);

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

function usesTurnstileTestPair(env: Env): boolean {
  return (
    env.TURNSTILE_SITE_KEY === TURNSTILE_ALWAYS_PASS_SITE_KEY &&
    env.TURNSTILE_SECRET_KEY === TURNSTILE_ALWAYS_PASS_SECRET_KEY
  );
}

export const app = new Hono<AppEnv>();

app.use("*", async (context, next) => {
  const url = new URL(context.req.url);

  if (url.protocol !== "https:" && !isLoopback(url.hostname)) {
    url.protocol = "https:";
    return context.redirect(url.toString(), 308);
  }

  await next();
  // The D1 trigger is the after-write hook. Queue dispatch is deliberately
  // post-response and non-fatal: a committed local write remains committed if
  // Queue is temporarily unavailable, and the outbox is still the recovery
  // record. With no key/base this path returns before touching D1 or Queue.
  const dispatch = dispatchPendingMirrorMessages(
    context.env,
    resolveRequestId(context.req.raw),
  ).catch((error) => {
    loggerForEnv(context.env, { requestId: resolveRequestId(context.req.raw) }).emit("queue_error", "error", {
      queue: "marquee-mirror",
      message_type: MIRROR_OUTBOX_MESSAGE_TYPE,
      ...errorFields(error),
    });
    return 0;
  });
  try {
    context.executionCtx.waitUntil(dispatch);
  } catch {
    // Hono's direct `app.request` test helper has no ExecutionContext. Awaiting
    // here keeps fake-queue assertions deterministic without changing Worker
    // behavior, where the dispatch remains outside the response path.
    await dispatch;
  }
  // Wrangler presents the custom-domain hostname locally, so the published
  // Turnstile test pair is the additional signal that this is development.
  if (!isLoopback(url.hostname) && !usesTurnstileTestPair(context.env)) {
    context.header(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
  }
});

// `/health` stays a cheap liveness probe — no binding is touched, so it answers
// under load and under partial failure alike. It gains only the build stamp,
// which turns "which version is this?" from a guess into a curl. The deep probe
// that does touch bindings is `/api/v1/telemetry/diagnostics`.
app.get("/health", (context) => {
  context.header("Cache-Control", "no-store");
  return context.json({
    service: "marquee",
    status: "ok",
    build: BUILD_INFO.sha,
    built_at: BUILD_INFO.built_at,
  });
});

app.get("/__validation/session-cookie", (context) => {
  const expectedToken = context.env.LOCAL_VALIDATION_TOKEN;
  if (
    expectedToken === undefined ||
    context.req.header("x-marquee-local-validation") !== expectedToken
  ) {
    return context.notFound();
  }

  setSessionCookie(context, "local-validation", 60);
  context.header("Cache-Control", "no-store");
  return context.json({ cookie: "mq_session", status: "set" });
});

app.route("/", landingRoutes);
app.route("/", claimRoutes);
app.route("/", signinRoutes);
app.route("/", publicFormRoutes);
app.route("/", publicAgendaRoutes);
app.route("/", embedRoutes);
app.route("/", calendarRoutes);
// Keep the canonical repository skill fetchable by agents; the assets router
// would otherwise turn this unknown path into the SPA shell.
app.get("/SKILL.md", () => new Response(skill, {
  headers: {
    "Cache-Control": "public, max-age=300",
    "Content-Type": "text/markdown; charset=utf-8",
  },
}));
// The API app is built from the generated route manifest. Assembly digests the
// OpenAPI document, which is async, so it is memoized on first request rather
// than awaited at module scope.
let apiApp: Promise<Awaited<ReturnType<typeof createApiRouter>>> | undefined;

app.all("/api/*", async (context) => {
  apiApp ??= createApiRouter(apiManifest, {
    credentialResolver: createCredentialResolver(),
  });
  const { app: api } = await apiApp;
  // The bindings are instrumented HERE, before the API app sees them, because
  // this is the last point at which one object can be handed to every handler.
  // A per-request copy carries a metered D1 and correlated queues; the real env
  // is shared by every request the isolate serves and must not be mutated.
  const instrumented = instrumentBindings(context.env, resolveRequestId(context.req.raw));
  // Unmatched `/api/*` falls through to the API app's own not-found handler,
  // so a miss returns the one error envelope with its request id like every
  // other failure — there is no second 404 shape.
  // The nested API app does not use ExecutionContext. Omitting the optional
  // third argument also keeps direct in-process `app.fetch` probes equivalent
  // to Worker requests, where no execution context is supplied.
  return api.fetch(context.req.raw, instrumented);
});

// Not `ASSETS.fetch` alone. With `not_found_handling: "none"` in wrangler.jsonc
// an asset miss reaches this Worker instead of being answered with the SPA
// shell under a 200, and this handler is where the site finally decides whether
// a path is a page. See src/routes/not-found.route.tsx.
app.all("*", serveAssetOrNotFound);

const worker: ExportedHandler<Env> = {
  fetch: app.fetch,
  async queue(batch, env, _context): Promise<void> {
    const logger = loggerForEnv(env);
    const mailMessages = batch.messages.filter(
      (message) => (message.body as { type?: string })?.type === MAIL_MESSAGE_TYPE,
    );
    if (mailMessages.length > 0) {
      const startedAt = Date.now();
      try {
        await processMailQueue(batch, env);
        logger.emit("queue_message", "info", {
          queue: batch.queue,
          message_type: MAIL_MESSAGE_TYPE,
          outcome: "processed",
          batch_size: mailMessages.length,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        logger.emit("queue_error", "error", {
          queue: batch.queue,
          message_type: MAIL_MESSAGE_TYPE,
          ...errorFields(error),
        });
        throw error;
      }
    }
    const mirrorMessages = batch.messages.filter((message) => {
      const body = message.body as { type?: string };
      return body?.type === MIRROR_OUTBOX_MESSAGE_TYPE || body?.type === MIRROR_RECONCILE_MESSAGE_TYPE;
    });
    if (mirrorMessages.length > 0) {
      const startedAt = Date.now();
      try {
        await processMirrorQueue(batch, env);
        logger.emit("queue_message", "info", {
          queue: batch.queue,
          message_type: "mirror",
          outcome: "processed",
          batch_size: mirrorMessages.length,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        logger.emit("queue_error", "error", {
          queue: batch.queue,
          message_type: "mirror",
          ...errorFields(error),
        });
        throw error;
      }
    }
    for (const message of batch.messages) {
      const body = message.body as QueueMessageBody;
      if (
        body?.type === MAIL_MESSAGE_TYPE
        || body?.type === MIRROR_OUTBOX_MESSAGE_TYPE
        || body?.type === MIRROR_RECONCILE_MESSAGE_TYPE
      ) continue;
      // The producer stamps the originating request id into the message body,
      // so the acceptance a human clicked and the mail the queue sent four
      // invocations later share one correlation id.
      const messageLogger = logger.withRequestId(body?.request_id);
      if (body?.type === RESET_DEMO_MESSAGE_TYPE && body.job_id) {
        const startedAt = Date.now();
        try {
          await runResetJob(env, body.job_id);
          message.ack();
          messageLogger.emit("queue_message", "info", {
            queue: batch.queue,
            message_type: body.type,
            outcome: "acked",
            job_id: body.job_id,
            duration_ms: Date.now() - startedAt,
          });
        } catch (error) {
          messageLogger.emit("queue_error", "error", {
            queue: batch.queue,
            message_type: body.type,
            job_id: body.job_id,
            ...errorFields(error),
          });
          message.retry();
        }
        continue;
      }
      messageLogger.emit("queue_message", "warn", {
        queue: batch.queue,
        message_type: body?.type ?? "unknown",
        outcome: "no_handler_retried",
      });
      message.retry();
    }
  },
  async scheduled(controller, env, _context): Promise<void> {
    // A cron that never fires leaves no trace at all, so every run — including
    // the ones with nothing to do — records an outcome, and every success
    // stamps a heartbeat the diagnostics probe can read back. Silence then
    // means "the trigger did not fire", not "we did not look".
    // A cron run gets its own correlation id, and the queue it writes to is
    // stamped with it — so the mail a scheduled run enqueued is followable back
    // to the run, exactly as an organizer's click is.
    const runId = crypto.randomUUID();
    const logger = loggerForEnv(env, { requestId: runId });
    const startedAt = Date.now();
    try {
      let outcome = "ran";
      if (controller.cron === MAIL_SCHEDULE_CRON) {
        await runMailSchedule(env.DB, correlateQueue(env.MAIL_QUEUE, runId), Date.now());
      } else if (controller.cron === UPLOAD_SWEEP_CRON) {
        await runUploadOrphanSweep(env.DB, env.MEDIA, Date.now());
      } else {
        outcome = "no_handler";
      }
      await recordCronHeartbeat(env.CACHE, controller.cron);
      logger.emit("cron_run", "info", {
        cron: controller.cron,
        outcome,
        duration_ms: Date.now() - startedAt,
      });
    } catch (error) {
      logger.emit("cron_error", "error", { cron: controller.cron, ...errorFields(error) });
      throw error;
    }
  },
};

export default worker;
