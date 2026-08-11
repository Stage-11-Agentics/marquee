/**
 * The API app: one fixed middleware pipeline, glob-driven registration, and
 * document assembly from the very same route objects.
 *
 * `router.ts` is closed after M-07 (R5). Later tickets add route modules and
 * adapter implementations — they never edit middleware order and never append
 * a registration here. The pipeline is:
 *
 *   1. request ID / error boundary
 *   2. credential resolution (anonymous is a real principal state)
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
import { assembleApiDocument, registerApiComponents, type ApiDocumentBundle } from "./openapi";
import { allowAllRateLimiter, enforceRateLimit } from "./rate-limit";
import type { ApiRouteEntry, ApiRoutePolicy } from "./route";
import type { ApiEnv, ApiRuntime, Principal } from "./runtime";

function envelopeResponse(context: Context<ApiEnv>, error: ApiError): Response {
  const requestId = context.get("requestId") ?? "unknown";
  const response = context.json(error.toEnvelope(requestId), error.status);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  for (const [name, value] of Object.entries(error.headers ?? {})) {
    response.headers.set(name, value);
  }
  return response;
}

/** Step 4: authorization, with concealment rather than disclosure. */
function authorize(policy: ApiRoutePolicy, principal: Principal): void {
  if (policy.auth.kind === "public") return;
  if (principal.kind === "anonymous") throw ApiError.unauthenticated();
  if (policy.auth.kind === "authenticated") return;
  const held = new Set(principal.kind === "token" ? principal.grants : []);
  // A session principal's grants come from membership role, which M-03 supplies.
  // Until it does, a session cannot satisfy a grant-scoped route: fail closed.
  const missing = policy.auth.grants.filter((grant) => !held.has(grant));
  if (missing.length > 0) {
    throw ApiError.forbidden(
      `this credential lacks the required grant${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
    );
  }
}

function routeMiddleware(
  policy: ApiRoutePolicy,
  runtime: ApiRuntime,
): MiddlewareHandler<ApiEnv> {
  const now = runtime.now ?? Date.now;
  const limiter = runtime.rateLimiter ?? allowAllRateLimiter(now);
  return async (context, next) => {
    // 2 — credential resolution.
    const principal: Principal = runtime.credentialResolver
      ? await runtime.credentialResolver.resolve(context)
      : { kind: "anonymous" };
    context.set("principal", principal);
    // 3 — rate-limit selection and enforcement (headers land on every response).
    await enforceRateLimit(context, limiter, policy.rateLimit, principal, now);
    // 4 — authorization.
    authorize(policy, principal);
    // 5/6 — validation then handler.
    await next();
  };
}

export interface ApiApp {
  app: OpenAPIHono<ApiEnv>;
  /** Assembled once at construction, from the routes this app registered. */
  document: ApiDocumentBundle;
  entries: readonly ApiRouteEntry[];
}

/** `/api/v1/events/{eventId}` -> `/api/v1/events/:eventId`, for Hono's matcher. */
export function toRoutingPath(path: string): string {
  return path.replaceAll(/\{([^}]+)\}/g, ":$1");
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
  let assembled: ApiDocumentBundle | undefined;
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

  // 1 — request ID and the error boundary, ahead of everything else.
  app.use("*", async (context, next) => {
    const requestId = resolveRequestId(context.req.raw);
    context.set("requestId", requestId);
    context.set("apiDocument", () => {
      if (!assembled) throw new Error("api document requested before assembly");
      return assembled;
    });
    context.header(REQUEST_ID_HEADER, requestId);
    await next();
  });

  app.onError((error, context) => {
    if (error instanceof ApiError) return envelopeResponse(context, error);
    // 500s never leak a stack, SQL, bindings, or secrets — only the request id.
    console.error("api unexpected error", error);
    return envelopeResponse(
      context,
      new ApiError("internal_error", "an unexpected error occurred"),
    );
  });

  app.notFound((context) => envelopeResponse(context, ApiError.notFound()));

  registerApiComponents(app);

  for (const entry of entries) {
    app.use(toRoutingPath(entry.path), routeMiddleware(entry.policy, runtime));
    // 6/7 — the handler runs inside the pipeline; `route` and `handler` are the
    // one object the document is generated from, so parity is structural.
    app.openapi(entry.route as never, entry.handler as never);
  }

  const document = await assembleApiDocument(app, entries);
  assembled = document;
  return { app, document, entries };
}
