import type { Id } from "../../db/schema";
import { ATTENDEE_CLAIM_TEMPLATE_KEY } from "../../lib/attendee-claim-mail";

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

declare const entityIdBrand: unique symbol;

/** A value that has crossed the named idempotency registry. */
export type EntityId = Id & { readonly [entityIdBrand]: "outbox-entity-id" };

function entityId(value: string): EntityId {
  return value as EntityId;
}

export const IDEMPOTENCY_REGISTRY = Object.freeze({
  /**
   * Automated trigger: one configured action for the entity selected by the
   * trigger. The brand is advisory here: this builder accepts any Id because
   * the trigger configuration already owns the business-entity selection.
   */
  trigger: (businessEntityId: Id): EntityId => entityId(businessEntityId),

  /** Initial decision mail: one notification for the submission's current decision action. */
  decision: (submissionId: Id): EntityId => entityId(submissionId),

  /**
   * Decision retry/notify: deliberately never deduplicated. The retry paths
   * override this entity with a fresh ULID-derived hash key on every attempt;
   * the recorded decision remains the audit business entity.
   */
  decisionRetry: (decisionId: Id): EntityId => entityId(decisionId),

  /** Pre-close reminder: one form-closing action per form and recipient. */
  preCloseReminder: (formId: Id): EntityId => entityId(formId),

  /** Draft-close reminder: one reminder per draft submission and recipient. */
  draftCloseReminder: (submissionId: Id): EntityId => entityId(submissionId),

  /** Overdue reminder: one overdue action per speaker-task row and recipient. */
  overdueTaskReminder: (taskId: Id): EntityId => entityId(taskId),

  /** Co-speaker invitation: the participation row is the invitation being sent. */
  coSpeakerInvitation: (participationId: Id): EntityId => entityId(participationId),

  /** Public form confirmation: one confirmation for the newly created submission. */
  formConfirmation: (submissionId: Id): EntityId => entityId(submissionId),

  /**
   * Draft resume link: the new submission is already minted per request. Keep
   * its plain id so the consumer can join delivery back to submission history.
   */
  draftResume: (submissionId: Id): EntityId => entityId(submissionId),

  /** Admin notification: one newly received submission per notified admin. */
  adminNotification: (submissionId: Id, adminId: Id): EntityId => entityId(`${submissionId}:admin:${adminId}`),

  /**
   * Attendee claim: deliberately never deduplicated. Every request is a new
   * claim-mail action, even when the code and recipient are unchanged.
   */
  attendeeClaim: (code: string, requestedAt: number): EntityId => entityId(`${ATTENDEE_CLAIM_TEMPLATE_KEY}:${code}:${requestedAt}`),

  /** Reviewer reminder: one rung per reviewer, round, and conference-local day. */
  reviewerReminder: (roundId: Id, personId: Id, reminderDay: string): EntityId => entityId(`${roundId}:${personId}:${reminderDay}`),

  /** Calendar request/cancel: submission, recipient, sequence, and RFC method are the revisioned grain. */
  calendar: (submissionId: Id, personId: Id, sequence: number, method: "REQUEST" | "CANCEL"): EntityId =>
    entityId(`${submissionId}:${personId}:${sequence}:${method}`),

  /** Calendar REQUEST: one UID revision. The snapshot and UID own the recipient grain. */
  calendarRequest: (uid: Id, sequence: number): EntityId => entityId(`${uid}:${sequence}`),

  /** One speaker batch: the sorted covered UID/sequence set is the retry grain. */
  calendarBatch: (personId: Id, revisions: readonly { uid: Id; sequence: number }[]): EntityId => {
    const sorted = [...revisions]
      .map((revision) => `${revision.uid}:${revision.sequence}`)
      .sort()
      .join(",");
    return entityId(`${personId}:${sorted}`);
  },

  /**
   * Calendar CANCEL: one durable uid:sequence intent. The template key is the
   * method discriminator; retries reuse this exact entity id and provider key
   * so a byte-identical CANCEL cannot be sent as a second revision.
   */
  calendarCancellation: (uid: Id, sequence: number): EntityId => entityId(`${uid}:${sequence}`),

  /** Auth mail tied to a minted link: the link row is the one-time send action. */
  authLink: (linkId: Id): EntityId => entityId(linkId),

  /** Auth mail without a pre-minted link: one template/person/clock attempt. */
  authAttempt: (templateKey: string, personId: Id, requestedAt: number): EntityId => entityId(`${templateKey}:${personId}:${requestedAt}`),

  /** Ad-hoc send: preserve the recipient business entity for timeline joins. */
  customRecipient: (recipientId: Id): EntityId => entityId(recipientId),

  /**
   * Ad-hoc send idempotency seed: one durable compose id per recipient. The
   * outbox row still stores customRecipient so consumer audit joins retain the
   * recipient's business entity; this seed is used only for the hash.
   */
  customSend: (sendId: Id, recipientId: Id): EntityId => entityId(`custom:${sendId}:${recipientId}`),
});
