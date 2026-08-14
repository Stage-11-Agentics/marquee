import { ROLE_HOME } from "../../lib/auth/role-home";

export interface ReviewerRevisionReview {
  abstained: boolean;
  comment: string;
  criteria_scores: Record<string, number | string> | null;
  recommendation: "approve" | "maybe" | "deny" | null;
  score: number | null;
}

export interface ReviewerRevisionItem {
  id: string;
  review: ReviewerRevisionReview | null;
}

export interface ReviewerRevisionState {
  abstained: boolean;
  comment: string;
  criteria: Record<string, number | string>;
  recommendation: "approve" | "maybe" | "deny" | null;
  score: number | null;
}

export interface ReviewerRevisionTarget<T extends ReviewerRevisionItem> {
  item: T;
  state: ReviewerRevisionState;
}

/** The home row's only route into the specific recorded review. */
export function reviewerRevisionPath(submissionId: string): string {
  return `${ROLE_HOME.reviewer}/queue?revise=${encodeURIComponent(submissionId)}`;
}

/** Read the deep-link target without allowing an empty query value through. */
export function reviewerRevisionId(search: string): string | null {
  const id = new URLSearchParams(search).get("revise");
  return id && id.trim() ? id : null;
}

/** Resolve a deep link only against the completed records the queue returned. */
export function completedItemForRevision<T extends ReviewerRevisionItem>(
  completed: readonly T[],
  id: string | null,
): T | null {
  if (!id) return null;
  return completed.find((item) => item.id === id && item.review !== null) ?? null;
}

/** Copy the server-recorded values into the ordinary scorecard controls. */
export function reviewStateForRevision(item: ReviewerRevisionItem): ReviewerRevisionState {
  return {
    abstained: item.review?.abstained ?? false,
    comment: item.review?.comment ?? "",
    criteria: item.review?.criteria_scores ?? {},
    recommendation: item.review?.recommendation ?? null,
    score: item.review?.score ?? null,
  };
}

/**
 * Resolve the one revision entry path used by both the first render and a
 * fetched refresh. A stripped URL is allowed to fall back to the item already
 * being revised; an explicit query value always wins, including an invalid
 * value, so a stranger's record can never be opened by fallback.
 */
export function reviewerRevisionFor<T extends ReviewerRevisionItem>(
  search: string,
  completed: readonly T[],
  preservedId: string | null = null,
): ReviewerRevisionTarget<T> | null {
  const hasQueryTarget = new URLSearchParams(search).has("revise");
  const id = hasQueryTarget ? reviewerRevisionId(search) : preservedId;
  const item = completedItemForRevision(completed, id);
  return item ? { item, state: reviewStateForRevision(item) } : null;
}
