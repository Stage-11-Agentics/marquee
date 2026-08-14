/**
 * Every direct foreign key to `people`, in one place.
 *
 * Two callers need the same answer to the same question — "is anything still
 * pointing at this person?" — and they must never disagree. An import undo asks
 * it before removing a person it created; unlinking an attendee claim asks it
 * before removing a person the claim minted. A second inventory would be a
 * second, quieter bug: the caller that forgot a table deletes a row somebody
 * else's record still references.
 *
 * The predicates are fixed strings. `PERSON_ID` is substituted with an
 * expression the caller controls, never with anything from a request.
 */
export const PERSON_REFERENCE_CHECKS = [
  { label: "memberships", predicate: "EXISTS (SELECT 1 FROM memberships WHERE memberships.person_id = PERSON_ID)" },
  { label: "auth_sessions", predicate: "EXISTS (SELECT 1 FROM auth_sessions WHERE auth_sessions.person_id = PERSON_ID)" },
  { label: "magic_links", predicate: "EXISTS (SELECT 1 FROM magic_links WHERE magic_links.person_id = PERSON_ID)" },
  { label: "api_tokens", predicate: "EXISTS (SELECT 1 FROM api_tokens WHERE api_tokens.created_by = PERSON_ID OR api_tokens.acts_as_person_id = PERSON_ID)" },
  { label: "form_admins", predicate: "EXISTS (SELECT 1 FROM form_admins WHERE form_admins.person_id = PERSON_ID)" },
  { label: "outbox", predicate: "EXISTS (SELECT 1 FROM outbox WHERE outbox.person_id = PERSON_ID)" },
  { label: "submissions", predicate: "EXISTS (SELECT 1 FROM submissions WHERE submissions.submitter_person_id = PERSON_ID OR submissions.decided_by_person_id = PERSON_ID)" },
  { label: "submission_decisions", predicate: "EXISTS (SELECT 1 FROM submission_decisions WHERE submission_decisions.decided_by_person_id = PERSON_ID)" },
  { label: "saved_views", predicate: "EXISTS (SELECT 1 FROM saved_views WHERE saved_views.person_id = PERSON_ID)" },
  { label: "participations", predicate: "EXISTS (SELECT 1 FROM participations WHERE participations.person_id = PERSON_ID)" },
  { label: "committee_members", predicate: "EXISTS (SELECT 1 FROM committee_members WHERE committee_members.person_id = PERSON_ID)" },
  { label: "reviewer_track_scopes", predicate: "EXISTS (SELECT 1 FROM reviewer_track_scopes WHERE reviewer_track_scopes.person_id = PERSON_ID)" },
  { label: "round_assignments", predicate: "EXISTS (SELECT 1 FROM round_assignments WHERE round_assignments.reviewer_person_id = PERSON_ID)" },
  { label: "evaluations", predicate: "EXISTS (SELECT 1 FROM evaluations WHERE evaluations.reviewer_person_id = PERSON_ID OR evaluations.override_person_id = PERSON_ID)" },
  { label: "comparisons", predicate: "EXISTS (SELECT 1 FROM comparisons WHERE comparisons.reviewer_person_id = PERSON_ID)" },
  { label: "round_promotions", predicate: "EXISTS (SELECT 1 FROM round_promotions WHERE round_promotions.promoted_by = PERSON_ID)" },
  { label: "speaker_tasks", predicate: "EXISTS (SELECT 1 FROM speaker_tasks WHERE speaker_tasks.person_id = PERSON_ID)" },
  { label: "calendar_invites", predicate: "EXISTS (SELECT 1 FROM calendar_invites WHERE calendar_invites.person_id = PERSON_ID)" },
  { label: "audit_log", predicate: "EXISTS (SELECT 1 FROM audit_log WHERE audit_log.actor_person_id = PERSON_ID)" },
  { label: "file_comments", predicate: "EXISTS (SELECT 1 FROM file_comments WHERE file_comments.author_person_id = PERSON_ID)" },
  { label: "person_events", predicate: "EXISTS (SELECT 1 FROM person_events WHERE person_events.person_id = PERSON_ID OR person_events.actor_person_id = PERSON_ID)" },
  { label: "person_lists", predicate: "EXISTS (SELECT 1 FROM person_lists WHERE person_lists.created_by = PERSON_ID)" },
  { label: "person_list_members", predicate: "EXISTS (SELECT 1 FROM person_list_members WHERE person_list_members.person_id = PERSON_ID)" },
  // MRQ-208. An attendance row is a reference like any other: a person the
  // organizer imported as a ticket-holder must survive unlinking a claim, and a
  // person who attends two conferences must survive unlinking one of them.
  { label: "event_attendances", predicate: "EXISTS (SELECT 1 FROM event_attendances WHERE event_attendances.person_id = PERSON_ID)" },
] as const;

export function personReferencePredicates(personExpression: string): string[] {
  return PERSON_REFERENCE_CHECKS.map(({ predicate }) => predicate.replaceAll("PERSON_ID", personExpression));
}

export function personReferenceSelect(): string {
  return PERSON_REFERENCE_CHECKS.map(({ label, predicate }) =>
    `${predicate.replaceAll("PERSON_ID", "target.id")} AS "${label}"`).join(",\n       ");
}

export function noPersonReferencesPredicate(): string {
  return personReferencePredicates("people.id").map((predicate) => `NOT (${predicate})`).join(" AND ");
}

/** Which tables still point at this person; empty means nothing does. */
export async function personReferences(db: D1Database, personId: string): Promise<string[]> {
  const references = await db.prepare(
    `WITH target AS (SELECT ? AS id)
     SELECT ${personReferenceSelect()}
     FROM target`,
  ).bind(personId).first<Record<string, number>>();
  if (!references) return [];
  return PERSON_REFERENCE_CHECKS
    .filter(({ label }) => Number(references[label]) > 0)
    .map(({ label }) => label);
}
