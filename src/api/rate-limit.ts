/**
 * Rate-limit vocabulary and shared response helpers (Amendment 7). Four
 * buckets only; "public" is a keying mode, not a fifth bucket. Enforcement
 * lives behind the `RateLimiter` adapter (KV-backed implementations plug in
 * without changing route shapes); cookie and bearer traffic share one policy
 * keyed to the effective principal.
 */
import type { Context } from "hono";

import { ApiError } from "./errors";
import type { Principal, RateLimitDecision, RateLimiter } from "./runtime";

export const RATE_BUCKETS = ["read", "write", "send", "import"] as const;
export type RateBucket = (typeof RATE_BUCKETS)[number];

/** `principal`: cookie and bearer calls keyed to the effective principal; anonymous falls back to IP. */
export const RATE_KEYINGS = ["principal", "ip_submission"] as const;
export type RateKeying = (typeof RATE_KEYINGS)[number];

export interface RatePolicy {
  bucket: RateBucket;
  keying?: RateKeying;
}

/** Default window sizes; adapters may enforce tighter numbers but the vocabulary is fixed. */
export const RATE_BUCKET_DEFAULTS: Record<RateBucket, { limit: number; windowSeconds: number }> = {
  read: { limit: 600, windowSeconds: 60 },
  write: { limit: 120, windowSeconds: 60 },
  send: { limit: 30, windowSeconds: 60 },
  import: { limit: 12, windowSeconds: 60 },
};

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
}

/**
 * Derive the limiter key for a request. `ip_submission` combines the client
 * IP with the submission/draft identity in the path when one is present.
 */
export function deriveRateKey(
  keying: RateKeying,
  principal: Principal,
  request: Request,
): string {
  const ip = clientIp(request);
  if (keying === "ip_submission") {
    const identity =
      /\/submissions\/([^/]+)/.exec(new URL(request.url).pathname)?.[1] ??
      /\/drafts\/([^/]+)/.exec(new URL(request.url).pathname)?.[1] ??
      "anonymous";
    return `ip:${ip}:submission:${identity}`;
  }
  switch (principal.kind) {
    case "session":
      return `person:${principal.personId}`;
    case "token":
      return `token:${principal.tokenId}`;
    default:
      return `ip:${ip}`;
  }
}

export function applyRateLimitHeaders(context: Context, decision: RateLimitDecision): void {
  context.header("RateLimit-Limit", String(decision.limit));
  context.header("RateLimit-Remaining", String(Math.max(0, decision.remaining)));
  context.header("RateLimit-Reset", String(decision.reset));
}

/** Allow-all limiter used when no adapter is installed; headers stay truthful. */
export function allowAllRateLimiter(now: () => number = Date.now): RateLimiter {
  return {
    async check({ bucket }) {
      const defaults = RATE_BUCKET_DEFAULTS[bucket as RateBucket] ?? RATE_BUCKET_DEFAULTS.read;
      const windowStart = Math.floor(now() / 1000 / defaults.windowSeconds) * defaults.windowSeconds;
      return {
        allowed: true,
        limit: defaults.limit,
        remaining: defaults.limit,
        reset: windowStart + defaults.windowSeconds,
      };
    },
  };
}

export async function enforceRateLimit(
  context: Context,
  limiter: RateLimiter,
  policy: RatePolicy,
  principal: Principal,
  now: () => number,
): Promise<void> {
  const key = deriveRateKey(policy.keying ?? "principal", principal, context.req.raw);
  const decision = await limiter.check({ bucket: policy.bucket, key, now: now() });
  applyRateLimitHeaders(context, decision);
  if (!decision.allowed) {
    throw ApiError.rateLimited(decision.retryAfter ?? Math.max(1, decision.reset - Math.floor(now() / 1000)));
  }
}
