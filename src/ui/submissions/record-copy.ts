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
