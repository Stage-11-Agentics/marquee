import type { Id } from "../../db/schema";

/**
 * The outbox's entity id names the business action that a message represents.
 * Keep the builders here so a new enqueue site has to choose and document its
 * grain instead of inventing an inline template literal next to the send.
 *
 * Revision slot: a key for a changing business artifact must carry the
 * artifact's revision (calendar `sequence` already does). Schedule updates and
 * decision notifications must use that same slot when they join this registry;
 * they must not invent a second revision format at their call site.
 *
 * The consumer's post-send audit lookup currently joins calendar rows by the
 * whole composite entity id, so it cannot recover the submission from a
 * calendar entity id and writes no per-person timeline row for calendar mail.
 * This is an explicit, known limitation deferred to the calendar-truth ticket;
 * the composite key itself remains intentional and is covered by the registry
 * inventory below.
 */

function entityId(value: string): Id {
  return value;
}

export const IDEMPOTENCY_REGISTRY = Object.freeze({
  /** Automated trigger: one configured action for the entity selected by the trigger. */
  trigger: (businessEntityId: Id): Id => entityId(businessEntityId),

  /** Initial decision mail: one notification for the submission's current decision action. */
  decision: (submissionId: Id): Id => entityId(submissionId),

  /** Decision retry/notify: the recorded decision remains the business entity. */
  decisionRetry: (decisionId: Id): Id => entityId(decisionId),

  /** Pre-close reminder: one form-closing action per form and recipient. */
  preCloseReminder: (formId: Id): Id => entityId(formId),

  /** Overdue reminder: one overdue action per speaker-task row and recipient. */
  overdueTaskReminder: (taskId: Id): Id => entityId(taskId),

  /** Co-speaker invitation: the participation row is the invitation being sent. */
  coSpeakerInvitation: (participationId: Id): Id => entityId(participationId),

  /** Public form confirmation: one confirmation for the newly created submission. */
  formConfirmation: (submissionId: Id): Id => entityId(submissionId),

  /** Draft resume link: currently one action per draft submission; Bug A adds the request tail. */
  draftResume: (submissionId: Id): Id => entityId(submissionId),

  /** Admin notification: one newly received submission per notified admin. */
  adminNotification: (submissionId: Id, adminId: Id): Id => entityId(`${submissionId}:admin:${adminId}`),

  /**
   * Attendee claim: deliberately never deduplicated. Every request is a new
   * claim-mail action, even when the code and recipient are unchanged.
   */
  attendeeClaim: (code: string, requestedAt: number): Id => entityId(`attendee_schedule_claim:${code}:${requestedAt}`),

  /** Reviewer reminder: one rung per reviewer, round, and conference-local day. */
  reviewerReminder: (roundId: Id, personId: Id, reminderDay: string): Id => entityId(`${roundId}:${personId}:${reminderDay}`),

  /** Calendar request/cancel: submission, recipient, sequence, and RFC method are the revisioned grain. */
  calendar: (submissionId: Id, personId: Id, sequence: number, method: "REQUEST" | "CANCEL"): Id =>
    entityId(`${submissionId}:${personId}:${sequence}:${method}`),

  /** Auth mail tied to a minted link: the link row is the one-time send action. */
  authLink: (linkId: Id): Id => entityId(linkId),

  /** Auth mail without a pre-minted link: one template/person/clock attempt. */
  authAttempt: (templateKey: string, personId: Id, requestedAt: number): Id => entityId(`${templateKey}:${personId}:${requestedAt}`),

  /** Ad-hoc send: preserve the recipient business entity for timeline joins. */
  customRecipient: (recipientId: Id): Id => entityId(recipientId),
});
