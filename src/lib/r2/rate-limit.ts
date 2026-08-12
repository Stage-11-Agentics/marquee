/**
 * KV-backed abuse caps for the public upload-sign path: separate per-IP and
 * per-submission/draft fixed windows. KV's documented eventual consistency
 * makes these bounded-slop abuse caps, never an authorization boundary.
 */

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

export const UPLOAD_RATE_LIMITS: Readonly<Record<"ip" | "submission", RateLimitPolicy>> = Object.freeze({
  ip: { limit: 20, windowSeconds: 60 * 60 },
  submission: { limit: 10, windowSeconds: 60 * 60 },
});

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

type HmacSecret = string | Uint8Array;

async function importHmacKey(secret: HmacSecret): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey(
    "raw",
    typeof secret === "string" ? new TextEncoder().encode(secret) : new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return key;
}

/** Shared Web Crypto HMAC seam for local tokens and provider signatures. */
export async function hmacSha256(secret: HmacSecret, value: string): Promise<ArrayBuffer> {
  const key = await importHmacKey(secret);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
}

/** Verify a signature with Web Crypto so callers do not grow ad-hoc HMAC code. */
export async function verifyHmacSha256(
  secret: HmacSecret,
  value: string,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, new Uint8Array(signature), new TextEncoder().encode(value));
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const signature = await hmacSha256(secret, value);
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checkAndIncrement(
  cache: KVNamespace,
  keyName: string,
  policy: RateLimitPolicy,
  nowMs: number,
): Promise<RateLimitDecision> {
  const windowStart = Math.floor(nowMs / 1000 / policy.windowSeconds) * policy.windowSeconds;
  const kvKey = `upload-rate:${keyName}:${windowStart}`;
  const resetAt = (windowStart + policy.windowSeconds) * 1000;

  const current = Number((await cache.get(kvKey)) ?? "0");
  if (current >= policy.limit) {
    return { allowed: false, limit: policy.limit, remaining: 0, resetAt };
  }

  const next = current + 1;
  await cache.put(kvKey, String(next), { expirationTtl: policy.windowSeconds + 60 });
  return { allowed: true, limit: policy.limit, remaining: policy.limit - next, resetAt };
}

/**
 * Checks both caps without mutating either if one is already exhausted, so a
 * rejected request never partially consumes the other counter.
 */
export async function checkUploadRateLimits(params: {
  cache: KVNamespace;
  hmacSecret: string;
  ip: string;
  submissionOrDraftId: string;
  nowMs: number;
}): Promise<{ ip: RateLimitDecision; submission: RateLimitDecision }> {
  const ipKey = await hmacHex(params.hmacSecret, `ip:${params.ip}`);
  const submissionKey = await hmacHex(params.hmacSecret, `submission:${params.submissionOrDraftId}`);

  const windowStartIp = Math.floor(params.nowMs / 1000 / UPLOAD_RATE_LIMITS.ip.windowSeconds) * UPLOAD_RATE_LIMITS.ip.windowSeconds;
  const ipCurrent = Number((await params.cache.get(`upload-rate:${ipKey}:${windowStartIp}`)) ?? "0");
  const windowStartSub =
    Math.floor(params.nowMs / 1000 / UPLOAD_RATE_LIMITS.submission.windowSeconds) *
    UPLOAD_RATE_LIMITS.submission.windowSeconds;
  const subCurrent = Number((await params.cache.get(`upload-rate:${submissionKey}:${windowStartSub}`)) ?? "0");

  if (ipCurrent >= UPLOAD_RATE_LIMITS.ip.limit || subCurrent >= UPLOAD_RATE_LIMITS.submission.limit) {
    return {
      ip: {
        allowed: ipCurrent < UPLOAD_RATE_LIMITS.ip.limit,
        limit: UPLOAD_RATE_LIMITS.ip.limit,
        remaining: Math.max(0, UPLOAD_RATE_LIMITS.ip.limit - ipCurrent),
        resetAt: (windowStartIp + UPLOAD_RATE_LIMITS.ip.windowSeconds) * 1000,
      },
      submission: {
        allowed: subCurrent < UPLOAD_RATE_LIMITS.submission.limit,
        limit: UPLOAD_RATE_LIMITS.submission.limit,
        remaining: Math.max(0, UPLOAD_RATE_LIMITS.submission.limit - subCurrent),
        resetAt: (windowStartSub + UPLOAD_RATE_LIMITS.submission.windowSeconds) * 1000,
      },
    };
  }

  const [ip, submission] = await Promise.all([
    checkAndIncrement(params.cache, ipKey, UPLOAD_RATE_LIMITS.ip, params.nowMs),
    checkAndIncrement(params.cache, submissionKey, UPLOAD_RATE_LIMITS.submission, params.nowMs),
  ]);
  return { ip, submission };
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "Retry-After": String(Math.max(0, Math.ceil((decision.resetAt - Date.now()) / 1000))),
  };
}
