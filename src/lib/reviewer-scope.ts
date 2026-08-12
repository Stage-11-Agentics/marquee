import { ApiError } from "../api/errors";
import type { Principal } from "../api/runtime";
import { roleForEvent } from "./auth/scope-resolution";

/** The resource operation is recorded in the call site for auditability. */
export type ReviewerScopeOperation = "queue" | "record" | "file" | "export" | "evaluation-write" | "comparison-write";

export interface ReviewerScopeRequest {
  db: D1Database;
  principal: Principal;
  eventId: string;
  roundId: string;
  submissionId: string;
  operation: ReviewerScopeOperation;
}

export interface ReviewerQueueScopeRequest {
  db: D1Database;
  principal: Principal;
  eventId: string;
  roundEventId: string;
  roundId: string;
  submissionIds: readonly string[];
  operation: ReviewerScopeOperation;
}

export interface AuthorizedReviewerScope {
  eventId: string;
  operation: ReviewerScopeOperation;
  personId: string;
  roundId: string;
  submissionId: string;
}

/**
 * Validate a program-admin assignment before writing it. This is intentionally
 * separate from `authorizeReviewerScope`: the latter requires an existing
 * assignment, while this guard is the pre-write half of the same invariant.
 */
export async function reviewerCanBeAssignedToSubmission(
  db: D1Database,
  eventId: string,
  reviewerPersonId: string,
  submissionId: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT EXISTS (
      SELECT 1
      FROM submissions submission
      WHERE submission.id = ?
        AND submission.event_id = ?
        AND EXISTS (
          SELECT 1
          FROM memberships reviewer_membership
          WHERE reviewer_membership.event_id = submission.event_id
            AND reviewer_membership.person_id = ?
            AND reviewer_membership.role = 'reviewer'
        )
        AND EXISTS (
          SELECT 1
          FROM submission_tracks carried
          JOIN reviewer_track_scopes scope
            ON scope.event_id = submission.event_id
           AND scope.person_id = ?
           AND scope.track_id = carried.track_id
          WHERE carried.submission_id = submission.id
        )
    ) AS allowed
  `).bind(submissionId, eventId, reviewerPersonId, reviewerPersonId).first<AllowedRow>();
  return row?.allowed === 1;
}

interface AllowedRow {
  allowed: number;
}

interface RoundRow {
  event_id: string;
}

const REVIEWER_TRACK_SCOPE_SQL = `
  EXISTS (
    SELECT 1
    FROM submission_tracks carried
    JOIN reviewer_track_scopes scope
      ON scope.track_id = carried.track_id
     AND scope.event_id = submission.event_id
     AND scope.person_id = ?
    WHERE carried.submission_id = submission.id
  )
`;

const REVIEWER_ASSIGNMENT_SCOPE_SQL = `
  EXISTS (
    SELECT 1
    FROM round_assignments assignment
    LEFT JOIN committee_members member
      ON member.committee_id = assignment.committee_id
     AND member.person_id = ?
    LEFT JOIN committees committee
      ON committee.id = assignment.committee_id
    WHERE assignment.round_id = ?
      AND assignment.submission_id = submission.id
      AND assignment.status IN ('assigned', 'complete')
      AND (
        assignment.reviewer_person_id = ?
        OR (member.person_id IS NOT NULL AND committee.event_id = submission.event_id)
      )
  )
`;

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
        AND ${REVIEWER_TRACK_SCOPE_SQL}
        AND ${REVIEWER_ASSIGNMENT_SCOPE_SQL}
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
 * Authorize a candidate set with one round-scoped query per bounded chunk.
 * Queue reads already loaded and validated the round, so this preserves the
 * same track and assignment predicate without repeating a round lookup or
 * issuing one authorization query per card.
 */
export async function authorizeReviewerQueueScope(
  request: ReviewerQueueScopeRequest,
): Promise<AuthorizedReviewerScope[]> {
  const personId = reviewerPersonIdForEvent(request.principal, request.eventId);
  if (personId === null || request.roundEventId !== request.eventId) {
    throw ApiError.forbidden("reviewer resource is outside your authorized tracks");
  }

  const submissionIds = [...new Set(request.submissionIds)];
  const allowed = new Set<string>();
  // D1's bind limit is finite; the queue is small today, but chunking keeps a
  // large imported assignment batch from turning authorization into an error.
  for (let offset = 0; offset < submissionIds.length; offset += 80) {
    const chunk = submissionIds.slice(offset, offset + 80);
    const result = await request.db.prepare(`
      SELECT submission.id
      FROM submissions submission
      WHERE submission.event_id = ?
        AND submission.id IN (${chunk.map(() => "?").join(",")})
        AND ${REVIEWER_TRACK_SCOPE_SQL}
        AND ${REVIEWER_ASSIGNMENT_SCOPE_SQL}
    `).bind(
      request.eventId,
      ...chunk,
      personId,
      personId,
      request.roundId,
      personId,
    ).all<{ id: string }>();
    for (const row of result.results) allowed.add(row.id);
  }

  return submissionIds
    .filter((submissionId) => allowed.has(submissionId))
    .map((submissionId) => ({
      eventId: request.eventId,
      operation: request.operation,
      personId,
      roundId: request.roundId,
      submissionId,
    }));
}

/**
 * Reviewer identity comes from a session person or a live bound Agent seat.
 * Unbound bearer tokens intentionally identify no reviewer, so a grant alone
 * cannot be guessed into a queue assignment.
 */
export function reviewerPersonIdForEvent(principal: Principal, eventId: string): string | null {
  if (principal.kind === "anonymous") return null;
  const personId = principal.kind === "session" ? principal.personId : principal.actingPersonId;
  if (personId === null) return null;
  const reviewerMembership = principal.memberships.some(
    (membership) => membership.event_id === eventId && membership.role === "reviewer",
  );
  if (!reviewerMembership) return null;
  // Resolve the effective event role as a second event-boundary guard. The
  // explicit membership above matters because an owner/program lead may also
  // be the seeded reviewer, while an unrelated org role must not become one.
  return roleForEvent(principal.memberships, eventId) === null ? null : personId;
}
