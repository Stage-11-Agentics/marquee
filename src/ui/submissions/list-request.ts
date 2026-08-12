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
