/**
 * Decision History is the record's audit surface, and until now the single most
 * destructive action available on the screen was the only one that left no mark
 * on it. Reversing an acceptance can cancel a real person's portal tasks, kill
 * their queued mail, and send a calendar cancellation — and afterwards the
 * history still showed only the original "Accepted". An organizer could not tell
 * a record that was never accepted from one that was accepted and then pulled.
 *
 * A reversal cannot be a `submission_decisions` row: that table CHECKs
 * `resulting_status IN ('accepted','waitlisted','rejected')`, and the default
 * reversal outcome is `withdrawn`. Relaxing the CHECK means rebuilding the table
 * in SQLite. The audit log already carries who, when, the resulting status, and
 * every branch choice, so the fix is to read what is already written.
 */

export interface DecisionHistoryEntry {
  id: string;
  kind: "decision" | "reversal";
  decision: string;
  resulting_status: string;
  feedback_md: string | null;
  /** Set on reversals: what the cascade actually did, in the organizer's words. */
  note: string | null;
  decided_at: number;
  decided_by_name: string | null;
}

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The branch choices, said the way an organizer would say them. "Retain" is
 * reported as loudly as "cancel": an organizer checking later needs to know the
 * speaker's tasks are still live just as much as they need to know they were
 * pulled, and a note that only mentions cancellations reads as a complete
 * account when it isn't.
 */
export function reversalNote(after: Row): string {
  const branch = (choice: unknown, cancelled: number, one: string, many: string, kept: string): string =>
    choice === "cancel"
      ? cancelled === 0 ? `no ${many} to cancel` : `${plural(cancelled, one, many)} cancelled`
      : kept;
  return [
    branch(after.tasks, count(after.tasks_cancelled), "speaker task", "speaker tasks", "speaker tasks kept"),
    branch(after.emails, count(after.emails_cancelled), "queued email", "queued emails", "queued emails kept"),
    branch(after.calendar, count(after.calendar_cancelled), "calendar invite", "calendar invites", "calendar invite kept"),
  ].join(", ");
}

/**
 * Merge the reversals into the decisions, newest first. Both are already sorted
 * that way individually, so this is a merge rather than a re-sort — and ties
 * matter: a reversal to `rejected` also writes its own decision row at the same
 * millisecond, and the reversal must read above the decision it caused.
 */
export function decisionHistory(decisions: Row[], reversals: Row[]): DecisionHistoryEntry[] {
  const fromDecision = (row: Row): DecisionHistoryEntry => ({
    id: String(row.id),
    kind: "decision",
    decision: String(row.decision ?? ""),
    resulting_status: String(row.resulting_status ?? ""),
    feedback_md: text(row.feedback_md),
    note: null,
    decided_at: Number(row.decided_at ?? 0),
    decided_by_name: text(row.decided_by_name),
  });
  const fromReversal = (row: Row): DecisionHistoryEntry => {
    const after: Row = typeof row.after_json === "string"
      ? ((): Row => { try { return JSON.parse(row.after_json) as Row; } catch { return {}; } })()
      : (row.after_json as Row | null) ?? {};
    return {
      id: String(row.id),
      kind: "reversal",
      decision: "reversal",
      resulting_status: String(after.status ?? ""),
      feedback_md: null,
      note: reversalNote(after),
      decided_at: Number(row.created_at ?? 0),
      decided_by_name: text(row.actor_name),
    };
  };
  return [...reversals.map(fromReversal), ...decisions.map(fromDecision)]
    .sort((left, right) => right.decided_at - left.decided_at
      // Same millisecond: the reversal is the cause, the decision row is its
      // consequence, so the reversal sorts first and the pair reads in order.
      || (left.kind === right.kind ? 0 : left.kind === "reversal" ? -1 : 1));
}
