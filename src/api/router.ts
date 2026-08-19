/**
 * The API app: one fixed middleware pipeline, glob-driven registration, and
 * document assembly from the very same route objects.
 *
 * `router.ts` is closed after M-07 (R5). Later tickets add route modules and
 * adapter implementations — they never edit middleware order and never append
 * a registration here. The pipeline is:
 *
 *   1. request ID / error boundary
 *   2. credential resolution (anonymous is a real principal state; a `public`
 *      route never rejects a caller over a credential it did not require)
 *   3. rate-limit selection and enforcement
 *   4. route authorization and concealment
 *   5. request validation (zod-openapi's hook, into the one envelope)
 *   6. handler
 *   7. response normalization / standard headers
 *
 * Auth-required policies fail closed when no credential adapter is installed.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";

import {
  ApiError,
  REQUEST_ID_HEADER,
  issueField,
  resolveRequestId,
} from "./errors";
import type { ApiGrant } from "./grants";
import { assembleApiDocument, registerApiComponents, type ApiDocumentBundle } from "./openapi";
import { allowAllRateLimiter, enforceRateLimit } from "./rate-limit";
import type { ApiRouteEntry, ApiRoutePolicy } from "./route";
import type { ApiEnv, ApiRuntime, CredentialResolver, Principal } from "./runtime";
import { errorFields, loggerForEnv } from "../lib/observability/log";
import { readRequestMeter } from "../lib/observability/request-instrumentation";
import {
  membershipAllowsGrant,
  roleForEvent,
  tokenHasGrant,
} from "../lib/auth/scope-resolution";
import type { MembershipRole } from "../db/schema";

/**
 * The route as documented (`/api/v1/events/{eventId}/dashboard`), never the raw
 * URL: a raw URL carries whatever free text a caller put in a query parameter,
 * which is exactly the sort of thing this layer must not record.
 */
function routeTemplateOf(context: Context<ApiEnv>): string {
  return context.get("routeTemplate") ?? "unmatched";
}

/**
 * The single funnel for every enveloped error response — validation failures,
 * thrown `ApiError`s, unexpected throws, and 404s all pass through here — which
 * is what makes it the right place to log. The `api_error` line carries the
 * SAME request id the caller is shown, so the reference code on a support
 * ticket greps straight to the line that explains it. That correlation existing
 * at both ends and being used at neither is the defect this ticket was opened
 * for.
 */
function envelopeResponse(
  context: Context<ApiEnv>,
  error: ApiError,
  unexpected?: unknown,
): Response {
  const requestId = context.get("requestId") ?? "unknown";
  const fields = errorFields(unexpected === undefined ? error : unexpected);
  context.get("logger")?.emit("api_error", unexpected === undefined ? "warn" : "error", {
    method: context.req.method,
    route: routeTemplateOf(context),
    status: error.status,
    code: error.code,
    expected: unexpected === undefined,
    error_name: fields.error_name,
    message: fields.message,
    // An expected failure is a known outcome with a known cause; a stack on
    // every 404 is noise that buries the unexpected ones.
    ...(unexpected === undefined ? {} : { stack: fields.stack }),
  });
  const response = context.json(error.toEnvelope(requestId), error.status);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  for (const [name, value] of Object.entries(error.headers ?? {})) {
    response.headers.set(name, value);
  }
  return response;
}

/**
 * One line per completed request: the live p50/p95 source, per route template.
 *
 * `d1_queries` is the N+1 detector. Duration alone says a request was slow;
 * the query count says why, and "once per row in a loop" is the usual answer.
 */
function emitRequestLine(context: Context<ApiEnv>, status: number, startedAt: number): void {
  const meter = readRequestMeter(context.env);
  context.get("logger")?.emit("http_request", status >= 500 ? "warn" : "info", {
    method: context.req.method,
    route: routeTemplateOf(context),
    status,
    duration_ms: Date.now() - startedAt,
    d1_queries: meter?.d1.queries,
    d1_ms: meter?.d1.totalMs,
    principal: context.get("principal")?.kind ?? "unresolved",
    event_id: context.req.param("eventId"),
  });
}

/**
 * `Server-Timing`, so the same numbers the log line carries also show up in the
 * browser's own network panel. Speed is a graded feature; making it visible
 * where a developer already looks is most of what makes it stay fast.
 */
function setServerTiming(context: Context<ApiEnv>, startedAt: number): void {
  const meter = readRequestMeter(context.env);
  const parts = [`total;dur=${Date.now() - startedAt}`];
  if (meter) parts.push(`d1;dur=${meter.d1.totalMs};desc="${meter.d1.queries} queries"`);
  context.header("Server-Timing", parts.join(", "));
}

/**
 * Step 2: resolution, which reports what the credential is — never what the
 * route will do about it. That decision belongs to the policy, one step later.
 *
 * A resolver signals a present-but-invalid credential by throwing 401, and on
 * every route that needs a principal the pipeline lets that 401 stand. A
 * `public` route is the one place where it must not: such a route serves
 * callers carrying no credential at all, so a caller carrying a dead one can
 * only be treated the same way — as anonymous, which is a real principal state
 * in this pipeline and not the absence of one.
 *
 * Without this, a stale `mq_session` cookie locks a browser out of the very
 * public routes that exist to get it back in — sign-in and sign-out — and the
 * cookie is HttpOnly, so nothing on the page can clear it. The rejection is
 * remembered (`credentialRejected`) so those handlers can help the browser
 * recover instead of merely tolerating it.
 *
 * Only a 401 degrades. A resolver failing for any other reason — a 500 out of
 * D1 — is a broken request, not an anonymous one, and still fails loudly.
 */
async function resolvePrincipal(
  context: Context<ApiEnv>,
  resolver: CredentialResolver | undefined,
  policy: ApiRoutePolicy,
): Promise<Principal> {
  if (!resolver) return { kind: "anonymous" };
  try {
    return await resolver.resolve(context);
  } catch (error) {
    const rejected = error instanceof ApiError && error.status === 401;
    if (!rejected || policy.auth.kind !== "public") throw error;
    context.set("credentialRejected", true);
    return { kind: "anonymous" };
  }
}

/** Step 4: authorization, with concealment rather than disclosure. */
function authorize(
  context: Context<ApiEnv>,
  policy: ApiRoutePolicy,
  principal: Principal,
): void {
  if (policy.auth.kind === "public") return;
  if (principal.kind === "anonymous") throw ApiError.unauthenticated();
  if (policy.auth.kind === "authenticated") return;
  const eventId = context.req.param("eventId");
  const missing = policy.auth.grants.filter(
    (grant) => !principalHasGrant(principal, grant, eventId),
  );
  if (missing.length > 0) {
    throw ApiError.forbidden(
      `this credential lacks the required grant${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
    );
  }
}

function principalHasGrant(
  principal: Exclude<Principal, { kind: "anonymous" }>,
  grant: ApiGrant,
  eventId: string | undefined,
): boolean {
  if (principal.kind === "token") {
    return eventId !== undefined && tokenHasGrant(principal, grant, eventId);
  }

  if (eventId === undefined) return false;
  const role = roleForEvent(principal.memberships, eventId);
  return role !== null && membershipAllowsGrant(role, grant);
}

function routeMiddleware(
  policy: ApiRoutePolicy,
  runtime: ApiRuntime,
  routeTemplate: string,
): MiddlewareHandler<ApiEnv> {
  const now = runtime.now ?? Date.now;
  const limiter = runtime.rateLimiter ?? allowAllRateLimiter(now);
  return async (context, next) => {
    // The template is recorded before anything can throw, so a request rejected
    // by rate limiting or authorization still logs which route it was aimed at.
    context.set("routeTemplate", routeTemplate);
    // 2 — credential resolution.
    const credentialResolver = runtime.credentialResolver ?? context.env.AUTH;
    const principal = await resolvePrincipal(context, credentialResolver, policy);
    context.set("principal", principal);
    // 3 — rate-limit selection and enforcement (headers land on every response).
    await enforceRateLimit(context, limiter, policy.rateLimit, principal, now);
    // 4 — authorization.
    authorize(context, policy, principal);
    // 5/6 — validation then handler.
    await next();
  };
}

export interface ApiApp {
  app: OpenAPIHono<ApiEnv>;
  /**
   * Assembled from the routes this app registered, on the first call and once
   * per app. Deferred rather than eager: the document is read by two meta
   * routes, and building it dominates construction, so an eager assembly made
   * every cold isolate's first request — whatever it was — pay for a document
   * it would not read.
   */
  document: () => Promise<ApiDocumentBundle>;
  entries: readonly ApiRouteEntry[];
}

/** `/api/v1/events/{eventId}` -> `/api/v1/events/:eventId`, for Hono's matcher. */
export function toRoutingPath(path: string): string {
  return path.replaceAll(/\{([^}]+)\}/g, ":$1");
}

/**
 * Hono's linear route table needs static children before parameter siblings.
 * The generated manifest is sorted by operation signature for reproducible
 * OpenAPI and registry output, which can otherwise put `/reorder` behind
 * `/{fieldId}` and dispatch the static route as a field lookup.
 */
function routeSpecificity(path: string): [number, number, number] {
  const segments = path.split("/").filter(Boolean);
  const staticSegments = segments.filter((segment) => !/^\{[^}]+\}$/.test(segment)).length;
  const parameterSegments = segments.length - staticSegments;
  return [staticSegments, -parameterSegments, segments.length];
}

function compareRouteSpecificity(left: ApiRouteEntry, right: ApiRouteEntry): number {
  const leftScore = routeSpecificity(left.path);
  const rightScore = routeSpecificity(right.path);
  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) return rightScore[index] - leftScore[index];
  }
  return `${left.method} ${left.path} ${left.operationId}`.localeCompare(`${right.method} ${right.path} ${right.operationId}`);
}

/**
 * Build the API app from a route table. `entries` comes from the generated
 * manifest in production; tests pass a fixture table to the same function, so
 * the pipeline under test is the shipped pipeline.
 */
export async function createApiRouter(
  entries: readonly ApiRouteEntry[],
  runtime: ApiRuntime = {},
): Promise<ApiApp> {
  let assembled: Promise<ApiDocumentBundle> | undefined;
  const app = new OpenAPIHono<ApiEnv>({
    // 5 — validation failures use the one envelope, with a safe field path.
    defaultHook: (result, context) => {
      if (result.success) return;
      const issue = result.error.issues[0];
      return envelopeResponse(
        context,
        ApiError.badRequest(
          issue?.message ?? "request validation failed",
          issue ? issueField(issue) : undefined,
          result.error.issues.map((each) => ({
            field: issueField(each),
            message: each.message,
          })),
        ),
      );
    },
  });

  /**
   * The document, built on demand and then held. Every route below is
   * registered before any request can arrive, so the first caller always sees
   * the complete app — deferring assembly changes when the work happens, not
   * what it produces.
   *
   * Memoizing the promise rather than the value is what makes concurrent first
   * callers share one assembly instead of racing into several.
   */
  const document = (): Promise<ApiDocumentBundle> => {
    assembled ??= assembleApiDocument(app, entries);
    return assembled;
  };

  // 1 — request ID, the request-scoped logger, and the error boundary, ahead of
  // everything else. One `http_request` line per completed request; the same
  // correlation id the caller is handed in the envelope and the `X-Request-Id`
  // header is the id every line about this request carries.
  app.use("*", async (context, next) => {
    // The composition root instruments the bindings before the API app is
    // reached, and the id it used is the one everything downstream shares.
    const requestId = readRequestMeter(context.env)?.requestId ?? resolveRequestId(context.req.raw);
    context.set("requestId", requestId);
    context.set("logger", loggerForEnv(context.env, { requestId }));
    context.set("apiDocument", document);
    context.header(REQUEST_ID_HEADER, requestId);
    const startedAt = Date.now();
    try {
      await next();
      setServerTiming(context, startedAt);
      emitRequestLine(context, context.res.status, startedAt);
    } catch (error) {
      // The response does not exist yet — `onError` builds it below — so the
      // status is derived the same way `onError` derives it. Without this the
      // failing requests, the ones that matter, would be the only ones missing
      // from the request log.
      emitRequestLine(context, error instanceof ApiError ? error.status : 500, startedAt);
      throw error;
    }
  });

  app.onError((error, context) => {
    if (error instanceof ApiError) return envelopeResponse(context, error);
    // 500s never leak a stack, SQL, bindings, or secrets to the caller — only
    // the request id. The stack goes to the log line, behind the same id.
    return envelopeResponse(
      context,
      new ApiError("internal_error", "an unexpected error occurred"),
      error,
    );
  });

  app.notFound((context) => envelopeResponse(context, ApiError.notFound()));

  registerApiComponents(app);

  // Keep `entries` untouched for document/registry parity; only route
  // registration gets the specificity ordering required by the runtime.
  for (const entry of [...entries].sort(compareRouteSpecificity)) {
    const routingPath = entry.runtimePath ?? toRoutingPath(entry.path);
    // Middleware must be method-scoped: GET/POST pairs such as /org/tokens
    // intentionally carry different rate policies and must not run each
    // other's authorization pipeline.
    app.on([entry.method.toUpperCase()], routingPath, routeMiddleware(entry.policy, runtime, entry.path));
    // 6/7 — the handler runs inside the pipeline; `route` and `handler` are the
    // one object the document is generated from, so parity is structural.
    app.openapi(entry.route as never, entry.handler as never);
    // OpenAPI path parameters match one segment in Hono. Media object keys are
    // intentionally hierarchical (`uploads/{event}/{owner}/{attachment}`), so
    // that route supplies a wildcard runtime matcher while retaining the
    // standards-shaped `{key}` path in the generated document.
    if (entry.runtimePath) {
      app.on([entry.method], entry.runtimePath, entry.handler as never);
    }
  }

  return { app, document, entries };
}
