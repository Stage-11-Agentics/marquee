import { ApiError } from "../api/errors";
import type { Principal } from "../api/runtime";
import { roleForEvent } from "./auth/scope-resolution";

/** The resource operation is recorded in the call site for auditability. */
export type ReviewerScopeOperation = "queue" | "record" | "file" | "export" | "evaluation-write";

export interface ReviewerScopeRequest {
  db: D1Database;
  principal: Principal;
  eventId: string;
  roundId: string;
  submissionId: string;
  operation: ReviewerScopeOperation;
}

export interface AuthorizedReviewerScope {
  eventId: string;
  operation: ReviewerScopeOperation;
  personId: string;
  roundId: string;
  submissionId: string;
}

interface AllowedRow {
  allowed: number;
}

interface RoundRow {
  event_id: string;
}

/**
 * The single reviewer resource-authorization path (AC-246).
 *
 * The broad `review:write` grant only establishes that a principal may reach a
 * reviewer route. This helper establishes the narrower resource authority:
 * event membership, explicit track intersection, and a direct or committee
 * assignment for this round/submission. It deliberately performs the entire
 * check before any submission or person payload is loaded, so a guessed ID
 * cannot distinguish an absent row from a hidden one.
 */
export async function authorizeReviewerScope(
  request: ReviewerScopeRequest,
): Promise<AuthorizedReviewerScope> {
  const personId = reviewerPersonIdForEvent(request.principal, request.eventId);
  if (personId === null) throw ApiError.forbidden("reviewer resource is outside your authorized tracks");

  const round = await request.db
    .prepare(`
      SELECT plan.event_id
      FROM evaluation_rounds round
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      WHERE round.id = ?
    `)
    .bind(request.roundId)
    .first<RoundRow>();

  // Conceal event, round, and submission existence behind the same response.
  if (!round || round.event_id !== request.eventId) {
    throw ApiError.forbidden("reviewer resource is outside your authorized tracks");
  }

  const allowed = await request.db
    .prepare(`
      SELECT EXISTS (
        SELECT 1
        FROM submissions submission
        WHERE submission.id = ?
          AND submission.event_id = ?
          AND EXISTS (
            SELECT 1
            FROM submission_tracks carried
            JOIN reviewer_track_scopes scope
              ON scope.track_id = carried.track_id
             AND scope.event_id = submission.event_id
             AND scope.person_id = ?
            WHERE carried.submission_id = submission.id
          )
          AND EXISTS (
            SELECT 1
            FROM round_assignments assignment
            LEFT JOIN committee_members member
              ON member.committee_id = assignment.committee_id
             AND member.person_id = ?
            WHERE assignment.round_id = ?
              AND assignment.submission_id = submission.id
              AND assignment.status IN ('assigned', 'complete')
              AND (
                assignment.reviewer_person_id = ?
                OR member.person_id IS NOT NULL
              )
          )
      ) AS allowed
    `)
    .bind(request.submissionId, request.eventId, personId, personId, request.roundId, personId)
    .first<AllowedRow>();

  if (allowed?.allowed !== 1) {
    throw ApiError.forbidden("reviewer resource is outside your authorized tracks");
  }

  return {
    eventId: request.eventId,
    operation: request.operation,
    personId,
    roundId: request.roundId,
    submissionId: request.submissionId,
  };
}

/**
 * Reviewer identity is intentionally session-backed. Bearer tokens can carry
 * `review:write` for future service integrations, but they do not identify a
 * reviewer person and therefore cannot be guessed into a queue assignment.
 */
export function reviewerPersonIdForEvent(principal: Principal, eventId: string): string | null {
  if (principal.kind !== "session") return null;
  const reviewerMembership = principal.memberships.some(
    (membership) => membership.event_id === eventId && membership.role === "reviewer",
  );
  if (!reviewerMembership) return null;
  // Resolve the effective event role as a second event-boundary guard. The
  // explicit membership above matters because an owner/program lead may also
  // be the seeded reviewer, while an unrelated org role must not become one.
  return roleForEvent(principal.memberships, eventId) === null ? null : principal.personId;
}
