import { PUBLISHED_SESSION_REFUSAL } from "../../lib/publication-guard";
import { isValidEmail } from "../../lib/email-validity";

export const DECISION_PLAN_DISPOSITIONS = [
  "will_send",
  "already_notified",
  "no_valid_address",
  "cannot_move",
] as const;

export type DecisionPlanDisposition = (typeof DECISION_PLAN_DISPOSITIONS)[number];
export type DecisionPlanAction = "accept" | "reject" | "waitlist" | "withdraw";

export interface DecisionPlanRecordSnapshot {
  id: string;
  title: string;
  email?: string | null;
  /** A transition error is resolved by the database-aware loader. */
  transitionError?: string | null;
  published?: boolean;
  alreadyNotified?: boolean;
  demoSuppressed?: boolean;
}

export interface DecisionPlanTemplate {
  key: string;
  subject: string;
  body_md: string;
  enabled: boolean;
}

export interface DecisionPlanRecord {
  id: string;
  title: string;
  reason: string;
  demo_suppressed: boolean;
}

export interface DecisionPlanRow {
  disposition: DecisionPlanDisposition;
  count: number;
  records: DecisionPlanRecord[];
}

export interface DecisionPlan {
  action: DecisionPlanAction;
  feedback_md: string | null;
  mail_mode: "rendered" | "none";
  template: DecisionPlanTemplate;
  demo_suppressed: number;
  rows: [DecisionPlanRow, DecisionPlanRow, DecisionPlanRow, DecisionPlanRow];
  zero_effect: { code: "zero_effect"; reason: string } | null;
}

function row(disposition: DecisionPlanDisposition): DecisionPlanRow {
  return { disposition, count: 0, records: [] };
}

function reasonFor(
  action: DecisionPlanAction,
  disposition: DecisionPlanDisposition,
  snapshot: DecisionPlanRecordSnapshot,
  template: DecisionPlanTemplate,
): string {
  if (disposition === "already_notified") return "A decision notification is already queued or settled for this record.";
  if (disposition === "no_valid_address") return "The speaker has no valid email address.";
  if (disposition === "cannot_move") {
    return snapshot.transitionError
      ?? (snapshot.published ? PUBLISHED_SESSION_REFUSAL : "This record cannot move with the selected action.");
  }
  if (action === "waitlist") return "Waitlisted decisions do not send an email.";
  if (action === "withdraw") return "Withdrawn decisions do not send an email.";
  if (!template.enabled) return "The decision template is disabled; this action will send nothing.";
  if (snapshot.demoSuppressed) return "Demo safety will keep this message in the outbox.";
  return action === "accept" ? "The acceptance email will be queued." : "The rejection email will be queued.";
}

/**
 * Pure disposition planner. All database-specific transition and notification
 * facts arrive in the snapshot, which keeps the contract deterministic and
 * makes the truth table reusable by HTTP, CLI, and UI callers.
 */
export function planBulkDecision(input: {
  action: DecisionPlanAction;
  selected: readonly DecisionPlanRecordSnapshot[];
  feedbackMd?: string | null;
  template: DecisionPlanTemplate;
  confirmPublished?: boolean;
}): DecisionPlan {
  const rows = DECISION_PLAN_DISPOSITIONS.map(row) as [
    DecisionPlanRow,
    DecisionPlanRow,
    DecisionPlanRow,
    DecisionPlanRow,
  ];
  const rowByDisposition = new Map(rows.map((item) => [item.disposition, item]));
  const feedback = input.feedbackMd?.replace(/\r\n?/g, "\n").trim() || null;
  let demoSuppressed = 0;

  for (const snapshot of input.selected) {
    const disposition: DecisionPlanDisposition = snapshot.transitionError
      || (snapshot.published && input.confirmPublished !== true ? "cannot_move" : null)
      ? "cannot_move"
      : input.action !== "waitlist" && input.action !== "withdraw" && snapshot.alreadyNotified
        ? "already_notified"
        : input.action !== "waitlist" && input.action !== "withdraw" && !isValidEmail(snapshot.email)
          ? "no_valid_address"
          : "will_send";
    const demoSuppressedForRecord = disposition === "will_send" && snapshot.demoSuppressed === true;
    if (demoSuppressedForRecord) demoSuppressed += 1;
    const target = rowByDisposition.get(disposition);
    if (!target) throw new Error(`unknown decision-plan disposition: ${disposition}`);
    target.records.push({
      id: snapshot.id,
      title: snapshot.title,
      reason: reasonFor(input.action, disposition, snapshot, input.template),
      demo_suppressed: demoSuppressedForRecord,
    });
    target.count = target.records.length;
  }

  return {
    action: input.action,
    feedback_md: feedback,
    mail_mode: input.action === "waitlist" || input.action === "withdraw" ? "none" : "rendered",
    template: input.template,
    demo_suppressed: demoSuppressed,
    rows,
    zero_effect: input.selected.length > 0 && rowByDisposition.get("will_send")!.count === 0
      ? { code: "zero_effect", reason: "No selected record can be changed with this action." }
      : null,
  };
}
