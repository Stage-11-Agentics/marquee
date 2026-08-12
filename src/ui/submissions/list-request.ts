export const SUBMISSIONS_PAGE_SIZE = 50;

export function buildSubmissionsQuery(params: URLSearchParams): URLSearchParams {
  const query = new URLSearchParams(params);
  query.set("per_page", String(SUBMISSIONS_PAGE_SIZE));
  return query;
}

/**
 * The request key describes the complete query sent to the list endpoint.
 * Sorting entries makes equivalent URL parameter orderings share one key.
 */
export function canonicalSubmissionsQueryKey(params: URLSearchParams): string {
  return [...buildSubmissionsQuery(params).entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function submissionsRequestKey(eventId: string, params: URLSearchParams): string {
  return `${eventId}\u0000${canonicalSubmissionsQueryKey(params)}`;
}

export function isCurrentSubmissionsRequest(requestId: number, currentRequestId: number, signal: AbortSignal): boolean {
  return requestId === currentRequestId && !signal.aborted;
}

/**
 * `accepted` is a pipeline *stage*: it holds records whose onboarding is done.
 * `accepted_any` is the stored decision fact. So a conference with 150 accepted
 * talks answers `?status=accepted` with an empty list, which reads as "nothing
 * was accepted" to anyone who typed the obvious URL. That state earns an escape
 * hatch; every other empty list already has one.
 */
export function isAcceptedStageDeadEnd(status: string, total: number | null): boolean {
  return status === "accepted" && total === 0;
}

/**
 * The same query with the stage swapped for the stored fact. Every other filter
 * survives, so the count the escape offers is the list the escape opens — a
 * promise of "N accepted overall" that showed a different N would be its own
 * small lie.
 */
export function acceptedAnyParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("status", "accepted_any");
  next.delete("page");
  return next;
}
