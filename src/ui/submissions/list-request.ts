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
 * `accepted_any` is the stored decision fact. So `?status=accepted` on a
 * conference that accepted 62 talks answers with the one talk whose onboarding
 * has finished — and reads, to anyone who typed the obvious URL, as "this
 * conference accepted one talk".
 *
 * The gap is the whole problem, not the zero: an empty list at least looks like
 * a filter that missed, while a list of one looks like an answer. Both get the
 * count of the other reading and a link to it.
 */
export function acceptedStageUndercount(status: string, stageTotal: number | null, acceptedAnyTotal: number | null): boolean {
  if (status !== "accepted" || stageTotal === null || acceptedAnyTotal === null) return false;
  return acceptedAnyTotal > stageTotal;
}

/** The dead-end half: the stage filter found nothing at all. */
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
