/**
 * Route definition factory. A route enters the registry only as one object
 * carrying both its OpenAPI definition and its handler — there is no way to
 * register a contract without a real handler (and unregistered Amendment 7
 * contracts live under `src/api/contracts/`, never in a `*.routes.ts` module).
 *
 * The definition is inferred, not widened: the handler is type-checked against
 * the route's own request/response schemas, so a handler that returns a shape
 * the document does not declare fails at compile time rather than at parity.
 */
import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { apiErrorEnvelopeSchema, type ApiErrorStatus } from "./errors";
import type { ApiGrant } from "./grants";
import type { RatePolicy } from "./rate-limit";
import type { ApiEnv } from "./runtime";

export type AuthPolicy =
  /** Anonymous callers allowed (public routes; writes may add Turnstile at the handler). */
  | { kind: "public" }
  /** Any resolved session or bearer credential. */
  | { kind: "authenticated" }
  /** Resolved credential whose effective grants include every listed grant. */
  | { kind: "grants"; grants: readonly ApiGrant[] };

/** `if-match`: mutation requires the shared If-Match/CAS precondition (R1). */
export type ConcurrencyMode = "none" | "if-match";

export interface ApiRoutePolicy {
  auth: AuthPolicy;
  rateLimit: RatePolicy;
  concurrency: ConcurrencyMode;
}

/** A route definition as authored: an OpenAPI route config plus its policy. */
export type ApiRouteDefinition = Omit<RouteConfig, "security"> & {
  operationId: string;
  policy: ApiRoutePolicy;
};

/**
 * The erased handler shape stored in the registry. Authors never write this
 * type — `defineApiRoute` checks the handler against its own route first, and
 * `createApiRouter` re-applies the route's typing at registration.
 */
export type RegisteredHandler = (
  context: Context<ApiEnv>,
) => Response | Promise<Response>;

export interface ApiRouteEntry {
  method: RouteConfig["method"];
  /** OpenAPI-style path, e.g. `/api/v1/events/{eventId}/people`. */
  path: string;
  operationId: string;
  /** The object handed to `OpenAPIHono.openapi` — the same source the document is generated from. */
  route: RouteConfig;
  handler: RegisteredHandler;
  policy: ApiRoutePolicy;
}

export function jsonResponse(schema: z.ZodType, description: string) {
  return { content: { "application/json": { schema } }, description };
}

const ERROR_DESCRIPTIONS: Record<ApiErrorStatus, string> = {
  400: "Malformed request",
  401: "Missing or invalid credential",
  403: "Authenticated but insufficient grant",
  404: "Absent or intentionally concealed",
  409: "Stale ETag or lifecycle conflict",
  422: "Syntactically valid but invalid domain state",
  429: "Rate limited",
  500: "Unexpected error",
};

/** Standard error responses in the one envelope, for route definitions. */
export function errorResponses(statuses: readonly ApiErrorStatus[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        content: { "application/json": { schema: apiErrorEnvelopeSchema } },
        description: ERROR_DESCRIPTIONS[status],
      },
    ]),
  );
}

/** Security requirement emitted per policy; public routes explicitly opt out. */
export function securityFor(auth: AuthPolicy): Record<string, string[]>[] {
  if (auth.kind === "public") return [];
  return [{ cookieAuth: [] }, { bearerAuth: [] }];
}

/**
 * Pair one OpenAPI route definition with the handler that serves it.
 *
 * `definition` is inferred, so `handler` is checked against that exact route:
 * its validated `param`/`query`/`json` inputs are typed, and its return type
 * must be one of the responses the document declares.
 */
export function defineApiRoute<const Definition extends ApiRouteDefinition>(
  definition: Definition,
  handler: RouteHandler<Definition, ApiEnv>,
): ApiRouteEntry {
  const { policy, ...config } = definition;
  const route = createRoute({ ...config, security: securityFor(policy.auth) });
  return {
    method: route.method,
    path: route.path,
    operationId: definition.operationId,
    route: route as RouteConfig,
    handler: handler as unknown as RegisteredHandler,
    policy,
  };
}

/** The well-known export every `*.routes.ts` module must provide. */
export const API_ROUTES_EXPORT = "apiRoutes";
