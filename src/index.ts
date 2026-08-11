import { Hono } from "hono";

import { createApiRouter } from "./api/router";
import { setSessionCookie } from "./lib/cookies";
import { runUploadOrphanSweep } from "./lib/r2/orphan-sweep";
import { apiManifest } from "./routes/_manifest";
import { uploadsRoutes } from "./routes/uploads.direct";
import { authMiddleware } from "./lib/auth/auth-middleware";
import { MIRROR_RECONCILE_MESSAGE_TYPE, runResetJob } from "./lib/reset-demo/reset-consumer";
import { adminOpsRoutes, RESET_DEMO_MESSAGE_TYPE } from "./routes/admin-ops.endpoints";
import { authRoutes } from "./routes/auth.endpoints";

export interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  DB: D1Database;
  LOCAL_VALIDATION_TOKEN?: string;
  MAIL_QUEUE: Queue<unknown>;
  MEDIA: R2Bucket;
  MIRROR_QUEUE: Queue<unknown>;
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
  // Wrangler presents the custom-domain hostname locally, so the published
  // Turnstile test pair is the additional signal that this is development.
  if (!isLoopback(url.hostname) && !usesTurnstileTestPair(context.env)) {
    context.header(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
  }
});

app.get("/health", (context) => {
  context.header("Cache-Control", "no-store");
  return context.json({ service: "marquee", status: "ok" });
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

// MRQ-14's upload routes and MRQ-3's auth/admin-ops routes are both mounted
// ahead of the generated API router rather than joined to its glob manifest
// (deviate-with-flag on both — see PR bodies: MRQ-8/M-07 merged mid-
// implementation and reconciling either onto its declarative route-registry
// convention was not done in this pass; MRQ-59 tracks porting MRQ-14's
// version back, and MRQ-3's PR asks the Orchestrator whether it folds into
// the same follow-up). Hono matches in registration order, so unmatched
// paths still fall through to the manifest router below.
app.route("/", uploadsRoutes);
app.use("/api/*", authMiddleware);
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/admin", adminOpsRoutes);

// The API app is built from the generated route manifest. Assembly digests the
// OpenAPI document, which is async, so it is memoized on first request rather
// than awaited at module scope.
let apiApp: Promise<Awaited<ReturnType<typeof createApiRouter>>> | undefined;

app.all("/api/*", async (context) => {
  apiApp ??= createApiRouter(apiManifest);
  const { app: api } = await apiApp;
  // Unmatched `/api/*` falls through to the API app's own not-found handler,
  // so a miss returns the one error envelope with its request id like every
  // other failure — there is no second 404 shape.
  return api.fetch(context.req.raw, context.env, context.executionCtx);
});

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

const worker: ExportedHandler<Env> = {
  fetch: app.fetch,
  async queue(batch, env, _context): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body as { type?: string; job_id?: string };
      if (body?.type === RESET_DEMO_MESSAGE_TYPE && body.job_id) {
        try {
          await runResetJob(env, body.job_id);
          message.ack();
        } catch (error) {
          console.error(`reset_demo job ${body.job_id} failed`, error);
          message.retry();
        }
        continue;
      }
      // Real reconcile consumer lands with M-25/M-26; stub-ack for now so the
      // reset-demo path (which enqueues exactly one of these) doesn't stall.
      if (body?.type === MIRROR_RECONCILE_MESSAGE_TYPE) {
        message.ack();
        continue;
      }
      console.warn(`No queue handler registered for message type ${body?.type ?? "unknown"}; retrying`);
      message.retry();
    }
  },
  async scheduled(controller, env, _context): Promise<void> {
    if (controller.cron === "30 4 * * *") {
      await runUploadOrphanSweep(env.DB, env.MEDIA, Date.now());
    }
  },
};

export default worker;
