/**
 * Telemetry: the browser's beacon in, and the deep diagnostics probe out.
 *
 * Two rules govern this module, and both are promises to the organizer whose
 * speaker data is in this database:
 *
 *   1. NOTHING HERE IS PERSISTED. The beacon writes one log line and returns.
 *      There is no table, no migration, no retention policy to get wrong,
 *      and nothing to leak later.
 *   2. NOTHING HERE PHONES HOME. The beacon posts to this Worker — the
 *      organizer's own deployment — and to nowhere else. There is no vendor,
 *      no DSN, no third-party script. `docs/OBSERVABILITY.md` states this in
 *      full and the README states it again.
 *
 * The report fields are capped hard at the schema, before anything is logged,
 * because a browser is an untrusted caller and an uncapped free-text field on a
 * public endpoint is a cost incident waiting for a bored visitor.
 */
import { z } from "@hono/zod-openapi";

import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { BUILD_INFO } from "../lib/observability/build-info";
import { readCronHeartbeats } from "../lib/observability/heartbeat";
import { errorFields } from "../lib/observability/log";
import type { Env } from "../index";

/** Caps mirror the log builder's own limits; nothing longer is ever useful. */
const MESSAGE_MAX = 300;
const STACK_MAX = 1_500;
const ROUTE_MAX = 200;
const TOKEN_MAX = 64;

const cappedString = (max: number) => z.string().min(1).max(max);

const clientErrorReport = z.object({
  kind: z.enum(["error", "rejection", "boundary"]),
  message: cappedString(MESSAGE_MAX),
  stack: z.string().max(STACK_MAX).optional(),
  /** Route template of the screen that failed; never a full URL with a query. */
  route: cappedString(ROUTE_MAX),
  build: cappedString(TOKEN_MAX),
  /** Ephemeral per-tab id, generated in the browser, never stored anywhere. */
  session: cappedString(TOKEN_MAX),
  /** How many identical reports the client collapsed into this one. */
  occurrences: z.number().int().min(1).max(10_000).optional(),
});

const webVitalReport = z.object({
  kind: z.literal("web_vital"),
  metric: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  value: z.number().min(0).max(3_600_000),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  route: cappedString(ROUTE_MAX),
  build: cappedString(TOKEN_MAX),
  session: cappedString(TOKEN_MAX),
});

const clientReportSchema = z
  .discriminatedUnion("kind", [clientErrorReport, webVitalReport])
  .openapi("ClientTelemetryReport");

const acceptedSchema = z.object({ recorded: z.boolean() }).openapi("ClientTelemetryAccepted");

const postClientError = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/telemetry/client-errors",
    operationId: "postClientErrorReport",
    summary: "Record one browser error or Web Vital",
    description:
      "Accepts a single capped report from the browser and writes it to this deployment's logs. Nothing is persisted, and the report is never forwarded anywhere. Public because errors happen on public pages, where there is no session to attach.",
    tags: ["Telemetry"],
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    request: {
      body: { content: { "application/json": { schema: clientReportSchema } }, required: true },
    },
    responses: {
      202: jsonResponse(acceptedSchema, "The report was logged."),
      ...errorResponses([400, 429, 500]),
    },
  },
  (context) => {
    const report = context.req.valid("json");
    // The real off switch. `CLIENT_TELEMETRY=0` and the endpoint stops
    // recording regardless of what any browser sends — an operator who turns
    // this off does not have to trust that every client honoured it.
    const setting = (context.env as { CLIENT_TELEMETRY?: string }).CLIENT_TELEMETRY;
    if (setting === "0" || setting === "false" || setting === "off") {
      return context.json({ recorded: false }, 202);
    }
    const logger = context.get("logger");
    if (report.kind === "web_vital") {
      logger?.emit("web_vital", "info", {
        metric: report.metric,
        value: Math.round(report.value),
        rating: report.rating,
        route: report.route,
      });
    } else {
      logger?.emit("client_error", "warn", {
        kind: report.kind,
        message: report.message,
        stack: report.stack,
        route: report.route,
        build: report.build,
        session: report.session,
        occurrences: report.occurrences ?? 1,
      });
    }
    return context.json({ recorded: true }, 202);
  },
);

const probeSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  duration_ms: z.number(),
  detail: z.string().optional(),
});

const diagnosticsSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    build: z.object({ sha: z.string(), built_at: z.string() }),
    migration: z.string(),
    probes: z.array(probeSchema),
    crons: z.array(
      z.object({
        cron: z.string(),
        last_success_at: z.number(),
        age_ms: z.number(),
        stale: z.boolean(),
      }),
    ),
    checked_at: z.string(),
  })
  .openapi("Diagnostics");

type Probe = z.infer<typeof probeSchema>;

/** Run one probe, timing it, and turn any throw into a failed probe rather than a 500. */
async function probe(name: string, run: () => Promise<string | undefined>): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const detail = await run();
    return { name, ok: true, duration_ms: Date.now() - startedAt, ...(detail ? { detail } : {}) };
  } catch (error) {
    return {
      name,
      ok: false,
      duration_ms: Date.now() - startedAt,
      detail: errorFields(error).message,
    };
  }
}

const getDiagnostics = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/telemetry/diagnostics",
    operationId: "getDiagnostics",
    summary: "Deep health probe across every binding",
    description:
      "Touches D1, KV, R2, the queue bindings and the cron heartbeats, and returns a verdict with per-probe timings. One curl answers 'is it broken, and where'. Unlike /health — which stays a cheap liveness probe and touches nothing — this costs real work, so it requires a credential.",
    tags: ["Telemetry"],
    policy: {
      auth: { kind: "authenticated" },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(diagnosticsSchema, "The probe result and its verdict."),
      ...errorResponses([401, 429, 500]),
    },
  },
  async (context) => {
    // The API core's bindings are a subset of the Worker's; the probe is the
    // one place that legitimately needs the wider set.
    const env = context.env as unknown as Env;
    const probes: Probe[] = await Promise.all([
      probe("d1", async () => {
        const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        if (row?.ok !== 1) throw new Error("D1 did not answer a trivial select");
        return undefined;
      }),
      probe("kv", async () => {
        await env.CACHE.get("observability:probe");
        return undefined;
      }),
      probe("r2", async () => {
        await env.MEDIA.head("observability/probe");
        return undefined;
      }),
      probe("queues", async () => {
        const missing = (["MAIL_QUEUE", "MIRROR_QUEUE", "OPERATIONS_QUEUE", "WEBHOOK_QUEUE"] as const)
          .filter((binding) => typeof env[binding]?.send !== "function");
        if (missing.length > 0) throw new Error(`missing queue bindings: ${missing.join(", ")}`);
        return "4 bindings present";
      }),
    ]);

    const migration = await env.DB.prepare(
      "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1",
    )
      .first<{ name: string }>()
      .then((row) => row?.name ?? "unknown")
      .catch(() => "unknown");

    const crons = await readCronHeartbeats(env.CACHE).catch(() => []);
    const status = probes.every((each) => each.ok) ? "ok" : "degraded";
    context.get("logger")?.emit("diagnostics", status === "ok" ? "info" : "warn", {
      verdict: status,
      duration_ms: probes.reduce((total, each) => total + each.duration_ms, 0),
      failing: probes.filter((each) => !each.ok).map((each) => each.name).join(",") || undefined,
    });
    context.header("Cache-Control", "no-store");
    return context.json(
      {
        status,
        build: { sha: BUILD_INFO.sha, built_at: BUILD_INFO.built_at },
        migration,
        probes,
        crons,
        checked_at: new Date().toISOString(),
      },
      200,
    );
  },
);

export const apiRoutes = [postClientError, getDiagnostics];
