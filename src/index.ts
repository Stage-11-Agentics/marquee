import { Hono } from "hono";

import { setSessionCookie } from "./lib/cookies";

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

app.all("/api/*", (context) => {
  return context.json(
    { error: { code: "not_found", message: "API route not found" } },
    404,
  );
});

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

const worker: ExportedHandler<Env> = {
  fetch: app.fetch,
  async queue(batch, _env, _context): Promise<void> {
    console.warn(
      `No queue handler registered for ${batch.queue}; retrying ${batch.messages.length} messages`,
    );
    batch.retryAll();
  },
  async scheduled(_controller, _env, _context): Promise<void> {},
};

export default worker;
