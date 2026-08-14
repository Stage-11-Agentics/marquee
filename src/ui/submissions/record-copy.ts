/**
 * Organizer-facing copy helpers for the submission record. Kept free of JSX so
 * they can be unit-tested directly, without dragging the page's component tree
 * (and its CSS imports) into a Worker-free test.
 */

export const UNDECIDED_RECORD_ACTION_COPY = "Consequential actions stay on the record.";

export function moment(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

/**
 * History is the organizer's dispute-resolution surface: a date alone cannot
 * distinguish two edits made minutes apart. Keep the date-only `moment` for
 * compact metadata elsewhere and give the history card the actual time.
 */
export function historyMoment(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

/**
 * A send is answered by the minute it left, not the day: two attempts to the
 * same address on one afternoon are the ordinary case on this card, and a
 * date-only stamp would render them identically.
 */
export function sendMoment(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

export interface DecisionSend {
  to_email: string;
  status: "queued" | "sent" | "suppressed" | "failed";
  delivery_state: "unknown" | "delivered" | "bounced_hard" | "bounced_soft" | "complained";
  reason: string | null;
  created_at: number;
  sent_at: number | null;
  delivered_at: number | null;
}

/**
 * What became of one decision mail, in the organizer's terms. The provider's
 * verdict outranks the transport's: a row can be `sent` and still have bounced,
 * and telling an organizer "Sent" about a message that hard-bounced is exactly
 * the reassurance that keeps a speaker uninformed.
 */
export function sendOutcome(send: DecisionSend): { label: string; tone: "" | "success" | "warning" | "alarm" } {
  if (send.delivery_state === "bounced_hard") return { label: "Bounced", tone: "alarm" };
  if (send.delivery_state === "bounced_soft") return { label: "Bounced, may retry", tone: "warning" };
  if (send.delivery_state === "complained") return { label: "Marked as spam", tone: "warning" };
  if (send.delivery_state === "delivered") return { label: "Delivered", tone: "success" };
  if (send.status === "failed") return { label: "Failed to send", tone: "alarm" };
  if (send.status === "suppressed") return { label: "Held, not sent", tone: "warning" };
  if (send.status === "sent") return { label: "Sent", tone: "success" };
  return { label: "Queued", tone: "" };
}

/** The moment the outcome refers to — delivery, then dispatch, then the queue. */
export function sendMomentFor(send: DecisionSend): number {
  return send.delivered_at ?? send.sent_at ?? send.created_at;
}

/**
 * The one line above the resend button. Naming the address the last attempt
 * used is the whole point of the card: "send it again" is a trap if the
 * organizer cannot see that the last one went to a typo.
 */
export function lastSendLine(sends: readonly DecisionSend[], currentEmail: string | null): string {
  const last = sends[0];
  if (!last) return "No decision mail has been queued for this record yet.";
  const outcome = sendOutcome(last);
  const line = `Last sent to ${last.to_email} · ${sendMoment(sendMomentFor(last))} · ${outcome.label}.`;
  if (currentEmail && currentEmail.trim().toLowerCase() !== last.to_email.trim().toLowerCase()) {
    return `${line} The speaker record now reads ${currentEmail.trim()}.`;
  }
  return line;
}

export function statusLabel(value: string): string {
  if (value === "in_review") return "In review";
  if (value === "waitlisted") return "Maybe";
  return value.replace(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * The decision buttons stay live on an already-decided record so an organizer
 * can change their mind (MRQ-83), which leaves nothing on screen to say whether
 * this is a first decision or a re-decision. Naming the standing decision above
 * the buttons is that cue.
 *
 * It shares the card header's one `.subtle` slot with the undecided copy, so the
 * only way the header could change height between the two states is this string
 * wrapping to more lines. Holding it strictly shorter than the copy already
 * shipping there makes that impossible at every width — no reserved space, no
 * min-height to keep in sync with the font. The test pins that invariant.
 */
export function decidedNote(latest: { resulting_status: string; decided_at: number } | undefined): string {
  if (!latest) return UNDECIDED_RECORD_ACTION_COPY;
  return `Decided ${statusLabel(latest.resulting_status)} · ${moment(latest.decided_at)}`;
}

/**
 * The header state chip's tone. Keyed on the stored `status`, not `stage` —
 * `stage` buckets waitlisted, rejected, withdrawn, and even a stray draft into
 * one "declined" fallback (`src/api/board.ts`), which would tone a waitlisted
 * record the same alarming red as a rejected one. `status` is the one field
 * that actually distinguishes a terminal negative from an in-flight record.
 */
export function headerChipTone(record: { status: string; stage: string }): "" | "success" | "warning" | "alarm" {
  if (record.status === "rejected" || record.status === "withdrawn") return "alarm";
  if (record.status === "accepted" || record.stage === "published") return "success";
  if (record.status === "waitlisted" || record.stage === "waved") return "warning";
  return "";
}
