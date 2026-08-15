/**
 * Whether a sponsorship contact may act on a deliverable.
 *
 * "Whole sponsorship, anyone completes" (sponsors-design §5.2 ruling 1) is a
 * one-sentence ruling with two enforcement sites — the completion route and the
 * upload signer — and they must agree exactly. A contact who can complete a file
 * deliverable but cannot presign its upload has a task that opens, validates,
 * and then fails at the PUT: the dead end PHILOSOPHY forbids, arrived at through
 * two predicates that were nearly the same.
 *
 * So there is one predicate, here, and both sites call it.
 *
 * Scoping, in the order it matters:
 *   - the task must belong to a sponsorship (`sponsorship_id IS NOT NULL`), so
 *     this can never reach an ordinary speaker's work;
 *   - the sponsorship must be in the task's own conference;
 *   - the caller must be a contact of that sponsorship;
 *   - and the caller's person row must live in the conference's organization,
 *     which is what stops a contact in one organization reaching a task in
 *     another that happens to share an id shape.
 *
 * Cancelled tasks are deliberately still found. The caller decides what to say
 * about them — the completion route answers 409 "this was cancelled", which is a
 * true and useful answer, where filtering them out here would produce a 404 that
 * claims the deliverable never existed.
 */

export interface SponsorContactTaskAccess {
  taskId: string;
  eventId: string;
  sponsorshipId: string;
  /** The contact the deliverable is assigned to — not necessarily the caller. */
  assigneePersonId: string;
  cancelledAt: number | null;
}

export async function sponsorContactTaskAccess(
  db: D1Database,
  personId: string,
  taskId: string,
): Promise<SponsorContactTaskAccess | null> {
  const row = await db
    .prepare(
      `SELECT task.id AS task_id, task.event_id, task.person_id AS assignee_person_id,
         task.sponsorship_id, task.cancelled_at
       FROM speaker_tasks task
       JOIN sponsorships sponsorship
         ON sponsorship.id = task.sponsorship_id AND sponsorship.event_id = task.event_id
       JOIN sponsorship_contacts contact
         ON contact.sponsorship_id = sponsorship.id AND contact.person_id = ?
       JOIN events conference ON conference.id = task.event_id
       JOIN people person ON person.id = contact.person_id AND person.org_id = conference.org_id
       WHERE task.id = ?`,
    )
    .bind(personId, taskId)
    .first<{
      task_id: string;
      event_id: string;
      assignee_person_id: string;
      sponsorship_id: string;
      cancelled_at: number | null;
    }>();
  if (!row) return null;
  return {
    taskId: row.task_id,
    eventId: row.event_id,
    sponsorshipId: row.sponsorship_id,
    assigneePersonId: row.assignee_person_id,
    cancelledAt: row.cancelled_at,
  };
}

/** Does this person hold a sponsorship-contact seat anywhere in their organization? */
export async function isSponsorshipContact(
  db: D1Database,
  personId: string,
  orgId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present
       FROM sponsorship_contacts contact
       JOIN sponsorships sponsorship ON sponsorship.id = contact.sponsorship_id
       JOIN events conference ON conference.id = sponsorship.event_id AND conference.org_id = ?
       WHERE contact.person_id = ?
       LIMIT 1`,
    )
    .bind(orgId, personId)
    .first<{ present: number }>();
  return row !== null;
}
