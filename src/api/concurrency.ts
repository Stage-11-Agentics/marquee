/**
 * Optimistic concurrency (Amendment 7, R1): strong ETags from resource
 * identity + the monotonic stored `updated_at`, and the one named
 * compare-and-swap primitive. D1 has no interactive transactions — every
 * mutable handler performs the version check inside the conditional write
 * itself, through this primitive. Route-level read-then-unconditional-write
 * and per-call-site CAS variants are defects.
 */
import { ApiError } from "./errors";

/** Strong quoted ETag: `"<id>:<updated_at>"`. Never a weak tag. */
export function strongEtag(id: string, updatedAt: number): string {
  if (id.includes('"') || id.includes(":")) {
    throw new Error(`strongEtag: id cannot contain '"' or ':' — ${id}`);
  }
  return `"${id}:${updatedAt}"`;
}

export interface ResourceVersion {
  id: string;
  updatedAt: number;
}

export function parseStrongEtag(tag: string): ResourceVersion | null {
  const match = /^"([^":]+):([0-9]+)"$/.exec(tag.trim());
  if (!match) return null;
  return { id: match[1], updatedAt: Number(match[2]) };
}

/**
 * Decode the required If-Match precondition. Missing, malformed, weak, or
 * wrong-resource tags are 400 — the client asked for a write precondition it
 * did not state correctly. A well-formed tag for a stale version is *not*
 * rejected here; that is the CAS write's 409 job.
 */
export function requireIfMatch(request: Request, resourceId: string): ResourceVersion {
  const header = request.headers.get("if-match");
  if (!header) {
    throw ApiError.badRequest(
      "If-Match header carrying the resource's current strong ETag is required",
      "if-match",
    );
  }
  if (header.trim().startsWith("W/")) {
    throw ApiError.badRequest("If-Match must be a strong ETag, not a weak one", "if-match");
  }
  const parsed = parseStrongEtag(header);
  if (!parsed || parsed.id !== resourceId) {
    throw ApiError.badRequest(
      "If-Match must be the resource's current strong ETag",
      "if-match",
    );
  }
  return parsed;
}

export type CasOutcome<TCurrent, TResult> =
  | { kind: "updated"; result: D1Result<TResult>; etag: string }
  | { kind: "missing" }
  | { kind: "stale"; current: TCurrent; etag: string };

/**
 * The one CAS primitive. Decodes nothing itself — the caller supplies the
 * already-validated expected version from `requireIfMatch`. Computes
 * `nextUpdatedAt = max(now, expectedUpdatedAt + 1)` so two writes in the
 * same wall-clock millisecond still produce distinct versions, invokes the
 * caller's conditional prepared write exactly once, and owns the
 * `meta.changes` classification:
 *
 * - 1 row  → success, returns the new strong ETag.
 * - 0 rows → re-reads via the caller's already-authorized/event-scoped
 *   `readCurrent` only to classify: absent/concealed = `missing` (404),
 *   present at another version = `stale` (409 with current ETag + summary).
 * - other  → internal invariant failure.
 *
 * The conditional write must be a single atomic SQL statement, or every
 * dependent statement conditioned on the same expected version, so stale
 * input produces zero side effects (R1).
 */
export async function compareAndSwapResource<TCurrent, TResult>(input: {
  expected: ResourceVersion;
  now: number;
  prepareWrite: (version: {
    expectedUpdatedAt: number;
    nextUpdatedAt: number;
  }) => D1PreparedStatement;
  readCurrent: () => Promise<TCurrent | null>;
  versionOf: (current: TCurrent) => ResourceVersion;
}): Promise<CasOutcome<TCurrent, TResult>> {
  const nextUpdatedAt = Math.max(input.now, input.expected.updatedAt + 1);
  const statement = input.prepareWrite({
    expectedUpdatedAt: input.expected.updatedAt,
    nextUpdatedAt,
  });
  const result = await statement.run<TResult>();
  const changes = result.meta.changes ?? 0;
  if (changes === 1) {
    return { kind: "updated", result, etag: strongEtag(input.expected.id, nextUpdatedAt) };
  }
  if (changes !== 0) {
    throw new Error(
      `compareAndSwapResource invariant: conditional write changed ${changes} rows`,
    );
  }
  const current = await input.readCurrent();
  if (current === null) return { kind: "missing" };
  const version = input.versionOf(current);
  return { kind: "stale", current, etag: strongEtag(version.id, version.updatedAt) };
}

/**
 * Turn a CAS outcome into a response or the pinned error: 404 for
 * absent/concealed, 409 in the common envelope with the current ETag header
 * and only the safe current-resource summary needed to recover.
 */
export function assertCasUpdated<TCurrent, TResult>(
  outcome: CasOutcome<TCurrent, TResult>,
  summarize?: (current: TCurrent) => unknown,
): { result: D1Result<TResult>; etag: string } {
  if (outcome.kind === "updated") {
    return { result: outcome.result, etag: outcome.etag };
  }
  if (outcome.kind === "missing") {
    throw ApiError.notFound();
  }
  throw new ApiError("conflict", "stale ETag: the resource changed since the supplied version", {
    details: summarize ? { current: summarize(outcome.current) } : undefined,
    headers: { ETag: outcome.etag },
  });
}
