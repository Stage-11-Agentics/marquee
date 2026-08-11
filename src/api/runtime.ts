/**
 * Typed adapters handed to `createApiRouter(runtime)`. The core router is
 * closed after M-07: later tickets (M-03 auth, M-29 tokens, KV rate limiting)
 * supply adapter implementations and route modules — they never edit the
 * middleware pipeline or registration code.
 */
import type { Context, Env as HonoEnv } from "hono";

import type { MembershipRole, MembershipRow } from "../db/schema";
import type { ApiGrant } from "./grants";
import type { ApiDocumentBundle } from "./openapi";
import type { AuthContext } from "../lib/auth/scope-resolution";
import type { Logger } from "../lib/observability/log";

/** Anonymous is a real principal state, not the absence of one. */
export type Principal =
  | { kind: "anonymous" }
  | {
      kind: "session";
      sessionId: string;
      personId: string;
      orgId: string;
      /** A single-use link may carry one narrow, session-bound surface hint. */
      roleHint?: string | null;
      /** Raw memberships are retained so every event check can resolve scope independently. */
      memberships: readonly MembershipRow[];
    }
  | {
      kind: "token";
      tokenId: string;
      orgId: string;
      /** A non-null issuer restriction is always enforced by the API pipeline. */
      eventId: string | null;
      /** Original scope names are preserved for the existing /auth/me contract. */
      permissions: readonly string[];
      grants: readonly ApiGrant[];
      /** An empty list means the token has no plural event restriction. */
      eventIds: readonly string[];
      /** Resolver-loaded event boundary for this organization; absent only on legacy fixtures. */
      organizationEventIds?: readonly string[];
      /** Issuer memberships are loaded by the canonical credential resolver. */
      memberships: readonly MembershipRow[];
      /** Only populated for older isolated fixtures whose token table predates created_by. */
      legacyRole?: MembershipRole;
    };

export interface CredentialResolver {
  /**
   * Resolve the request's credential into a principal. Returning
   * `{ kind: "anonymous" }` is always safe; throwing `ApiError` (401) rejects
   * a present-but-invalid credential.
   */
  resolve(context: Context<ApiEnv>): Promise<Principal>;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch seconds when the window resets. */
  reset: number;
  /** Seconds the caller should wait; required when `allowed` is false. */
  retryAfter?: number;
}

export interface RateLimitInput {
  bucket: string;
  /** Derived key: principal id, or IP + submission/draft identity. */
  key: string;
  now: number;
}

export interface RateLimiter {
  check(input: RateLimitInput): Promise<RateLimitDecision>;
}

export interface ApiRuntime {
  /**
   * When absent, credential resolution yields anonymous and every
   * auth-required route fails closed (401/403) — never open.
   */
  credentialResolver?: CredentialResolver;
  /** When absent, the built-in allow-all limiter still emits standard headers. */
  rateLimiter?: RateLimiter;
  /** Wall clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

/** Hono Variables the pipeline sets for handlers. */
export type ApiVariables = {
  requestId: string;
  principal: Principal;
  /** The composition root's auth middleware runs before the generated API router. */
  auth?: AuthContext;
  /** Request-scoped logger, already bound to this request's correlation id. */
  logger: Logger;
  /** OpenAPI-style template of the matched route, set once dispatch selects one. */
  routeTemplate?: string;
  /**
   * The assembled document, for the meta routes. A function because assembly
   * completes after registration — the two meta handlers are ordinary route
   * modules discovered by the same glob, not privileged closures.
   */
  apiDocument: () => ApiDocumentBundle;
};

/**
 * The bindings the API core itself touches. The Worker's wider `Env` is
 * structurally assignable to this, so `src/index.ts` mounts the API app
 * without the core importing the composition root.
 */
export interface ApiBindings {
  CACHE: KVNamespace;
  DB: D1Database;
  /** Optional virtual binding for embedders that compose the API directly. */
  AUTH?: CredentialResolver;
  MAIL_QUEUE: Queue<unknown>;
  /** `debug | info | warn | error`; anything else falls back to `info`. */
  LOG_LEVEL?: string;
}

/** The Hono environment every API route and middleware is typed against. */
export interface ApiEnv extends HonoEnv {
  Bindings: ApiBindings;
  Variables: ApiVariables;
}
