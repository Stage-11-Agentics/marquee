/**
 * "Who speaks at this conference", defined once.
 *
 * This lives in `lib/` rather than beside the roster because both directions
 * need it: the roster narrows people to this population, and the one people
 * query narrows to it whenever a caller passes `event_id`. Keeping the
 * definition here is what lets those be the same query instead of two.
 */

/**
 * The submission states that make someone a speaker of this conference.
 *
 * `draft` is a half-typed public form nobody has submitted; `rejected` and
 * `withdrawn` are people the conference is explicitly not hosting. Listing any
 * of them on a speaker roster — and, through the board source, chasing them for
 * onboarding tasks — would make the roster a CFP funnel wearing the wrong noun.
 */
export const ROSTER_SUBMISSION_STATUSES = ["submitted", "in_review", "accepted", "waitlisted"] as const;

const ROSTER_STATUS_LIST = ROSTER_SUBMISSION_STATUSES.map((status) => `'${status}'`).join(", ");

/**
 * Build the canonical person-id population for one event.
 *
 * The default expression is a bound event id for the people and speakers
 * routes. Organization Home passes a correlated event column instead, so its
 * season counts use this exact population without running one query per row.
 * The expression is internal SQL, never request input.
 */
export function speakerRosterPersonSource(eventIdExpression = "?"): string {
  return `
  SELECT person_id FROM memberships
   WHERE event_id = ${eventIdExpression} AND role = 'speaker'
  UNION
  SELECT part.person_id FROM participations part
    JOIN submissions rostered ON rostered.id = part.submission_id
   WHERE rostered.event_id = ${eventIdExpression} AND part.role IN ('speaker', 'co_speaker')
     AND rostered.status IN (${ROSTER_STATUS_LIST})`;
}

/** Both bindings are the event id. */
export const SPEAKER_ROSTER_PERSON_SOURCE = speakerRosterPersonSource();

/**
 * The org-level returning-speaker population. One binding: the organization.
 *
 * This asks the canonical roster population once per organization event, so
 * membership-only speakers and lifecycle-filtered participations have the
 * same meaning here as they do on the event roster.
 */
export const RETURNING_SPEAKER_PERSON_SOURCE = `
  SELECT candidate.id AS person_id
    FROM people candidate
   WHERE candidate.org_id = ?
     AND (
       SELECT COUNT(*)
         FROM events roster_event
        WHERE roster_event.org_id = candidate.org_id
          AND candidate.id IN (${speakerRosterPersonSource("roster_event.id")})
     ) >= 2`;

/** Build the onboarding population with either a bound or a correlated event id. */
export function onboardingPersonSource(eventIdExpression = "?"): string {
  return `
  ${speakerRosterPersonSource(eventIdExpression)}
  UNION
  SELECT owed.person_id FROM speaker_tasks owed WHERE owed.event_id = ${eventIdExpression}`;
}

/** Three bindings: the event id, three times. */
export const ONBOARDING_PERSON_SOURCE = onboardingPersonSource();

/**
 * "Who is coming to this conference" — the attendee population, MRQ-208.
 *
 * It lives beside the speaker definition for the same reason that one does:
 * the people list narrows to it, the organizer's attendee view narrows to it,
 * and an agent verifying its own import counts it. One binding, the event id.
 *
 * Note what it does not do: an attendance row is not a membership and carries
 * no role, so nobody acquires a seat on the auth rails by being an attendee.
 */
export const ATTENDEE_PERSON_SOURCE = `
  SELECT person_id FROM event_attendances WHERE event_id = ?`;

/** Which population an `event_id` filter means. */
export const EVENT_POPULATIONS = ["roster", "attendee", "any"] as const;
export type EventPopulation = (typeof EVENT_POPULATIONS)[number];
