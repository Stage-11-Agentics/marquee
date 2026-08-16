import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { DecisionPlanResponse } from "../../api/decision-plan";
import { Button } from "../shell/components";

export interface DecisionPlanApplyResult {
  selected: number;
  succeeded: number;
  failed: number;
  state: string;
  outbox_enqueued?: number;
  results?: Array<{
    id: string;
    outcome: string;
    resulting_status?: string | null;
    error?: string;
  }>;
}

export interface DecisionPlanSkip {
  id: string;
  title: string;
  reason: string;
}

interface DecisionPlanPanelProps {
  plan: DecisionPlanResponse | null;
  loading: boolean;
  error: string;
  stale: boolean;
  busy: boolean;
  feedback: string;
  internalNote: string;
  confirmPublished: boolean;
  publishedCount: number | null;
  onFeedbackChange: (value: string) => void;
  onInternalNoteChange: (value: string) => void;
  onConfirmPublishedChange: (value: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
  onRefresh: () => void;
}

const ROW_LABELS = {
  accept: ["Will be notified", "Already notified — will not be sent twice", "No valid address — the decision applies", "Cannot move"],
  reject: ["Will be notified", "Already notified — will not be sent twice", "No valid address — the decision applies", "Cannot move"],
  waitlist: ["Will move", "Already notified — will not be sent twice", "No valid address — the decision applies", "Cannot move"],
  withdraw: ["Will move", "Already notified — will not be sent twice", "No valid address — the decision applies", "Cannot move"],
  notify: ["Will be notified now", "Still queued — sending again would deliver twice", "Need an address first — excluded from this send", "Cannot notify"],
} as const;

const ACTION_COPY = {
  accept: { verb: "Accept", past: "accepted", question: "Accept", consequence: "The status change is the notification. Review what will happen before the wave moves." },
  reject: { verb: "Reject", past: "rejected", question: "Reject", consequence: "Each speaker receives their own rendered message. Review what will happen before the status changes." },
  waitlist: { verb: "Waitlist", past: "waitlisted", question: "Waitlist", consequence: "A waitlist saves the decision and sends no message. Waitlist feedback appears in the speaker’s portal; no email is sent. Review the records before they move." },
  withdraw: { verb: "Withdraw", past: "withdrawn", question: "Withdraw", consequence: "Withdrawal changes the record and sends no message. Review the records before they move." },
  notify: { verb: "Notify", past: "notified", question: "Notify", consequence: "Each record's own decision template renders per recipient. Records still queued from an earlier send are held in view so the duplicate-send risk is visible." },
} as const;

function displayRows(plan: DecisionPlanResponse): DecisionPlanResponse["rows"] {
  return plan.rows.length === 4 ? plan.rows : [
    { disposition: "will_send", count: 0, records: [] },
    { disposition: "already_notified", count: 0, records: [] },
    { disposition: "no_valid_address", count: 0, records: [] },
    { disposition: "cannot_move", count: 0, records: [] },
  ];
}

function planCount(plan: DecisionPlanResponse): number {
  const rows = displayRows(plan);
  return rows[0].count + rows[2].count;
}

function confirmLabel(plan: DecisionPlanResponse): string {
  const copy = ACTION_COPY[plan.action];
  const count = plan.action === "notify" ? plan.rows[0].count + plan.rows[1].count : planCount(plan);
  if (!plan.template.enabled && plan.action !== "waitlist" && plan.action !== "withdraw") {
    return `${copy.verb} ${count.toLocaleString()} · sends nothing`;
  }
  if (plan.action === "notify") return `${copy.verb} ${count.toLocaleString()} speaker${count === 1 ? "" : "s"}`;
  if (plan.action === "waitlist" || plan.action === "withdraw") return `${copy.verb} ${count.toLocaleString()}`;
  return `${copy.verb} and notify ${plan.rows[0].count.toLocaleString()}`;
}

function detailText(plan: DecisionPlanResponse, index: number): string {
  return ROW_LABELS[plan.action][index] ?? "Records";
}

export function DecisionPlanPanel({
  plan,
  loading,
  error,
  stale,
  busy,
  feedback,
  internalNote,
  confirmPublished,
  publishedCount,
  onFeedbackChange,
  onInternalNoteChange,
  onConfirmPublishedChange,
  onConfirm,
  onClose,
  onRefresh,
}: DecisionPlanPanelProps): JSX.Element {
  const [bucket, setBucket] = useState(0);

  useEffect(() => { setBucket(0); }, [plan?.plan_fingerprint]);

  const rows = plan ? displayRows(plan) : [];
  const activeRows = plan ? rows[bucket] : null;
  const copy = plan ? ACTION_COPY[plan.action] : ACTION_COPY.accept;
  const detailRecords = activeRows?.records ?? [];
  const hasFeedback = plan?.action !== "notify";

  return <section class="decision-plan-panel" aria-label="Decision plan">
    <header class="decision-plan-head">
      <div>
        <span class="eyebrow">Wave decision</span>
        <h2>{plan ? `${copy.question} ${plan.selected.toLocaleString()} ${plan.selected === 1 ? "record" : "records"}?` : "Review the decision"}</h2>
        <p>{plan ? copy.consequence : "The server is preparing the records, notification truth, and rendered recipient preview."}</p>
      </div>
      <button type="button" class="decision-plan-close" aria-label="Close decision plan" onClick={onClose}>×</button>
    </header>
    {stale && <div class="decision-plan-banner warning" role="alert"><strong>The selection or the email changed after you previewed it.</strong><span>Review the refreshed plan before sending.</span><Button type="button" small onClick={onRefresh}>Review refreshed plan</Button></div>}
    {error && !stale && <div class="decision-plan-banner error" role="alert">{error}</div>}
    {loading && <div class="decision-plan-loading" aria-live="polite">Refreshing the plan…</div>}
    {plan && <>
      <div class="decision-plan-rows" role="tablist" aria-label="Decision plan dispositions">
        {rows.map((row, index) => <button
          type="button"
          role="tab"
          aria-selected={bucket === index}
          class={`decision-plan-row ${row.count === 0 ? "zero" : ""} ${bucket === index ? "active" : ""}`}
          disabled={row.count === 0}
          onClick={() => setBucket(index)}
          key={row.disposition}
        >
          <span class="decision-plan-count">{row.count.toLocaleString()}</span>
          <span class="decision-plan-row-label">{detailText(plan, index)}</span>
          <span class="decision-plan-row-action">{row.count === 0 ? "—" : bucket === index ? "shown below" : "show"}</span>
        </button>)}
      </div>
      <div class="decision-plan-detail" role="tabpanel">
        {detailRecords.length > 0
          ? detailRecords.slice(0, 200).map((record) => <div class="decision-plan-detail-row" key={record.id}><span><strong>{record.title}</strong> <small>{record.id}</small></span><span>{record.reason}</span></div>)
          : <div class="decision-plan-detail-empty">No records in this group.</div>}
        {detailRecords.length > 200 && <div class="decision-plan-detail-row"><span>+ {(detailRecords.length - 200).toLocaleString()} more</span><span>Export lists every record.</span></div>}
      </div>
      {!plan.template.enabled && plan.action !== "waitlist" && plan.action !== "withdraw" && <div class="decision-plan-banner warning"><strong>The {plan.template.key} template is disabled in Comms.</strong><span>The decision will commit and nothing will send. This button stays enabled as an advisory action.</span></div>}
      <div class="decision-plan-safety">Demo safety: {plan.demo_suppressed.toLocaleString()} of {rows[0].count.toLocaleString()} message{rows[0].count === 1 ? "" : "s"} will be suppressed to the outbox.</div>
      {plan.recipient_preview && <div class="decision-plan-preview"><strong>Preview · rendered for {plan.recipient_preview.to_email}</strong><span>Every recipient gets their own render.</span><div class="decision-plan-preview-meta">To {plan.recipient_preview.to_email} · {plan.recipient_preview.subject}</div><div class="decision-plan-preview-body" dangerouslySetInnerHTML={{ __html: plan.recipient_preview.html }} /><div class="decision-plan-feedback-echo">{plan.feedback_md ? `Feedback: ${plan.feedback_md}` : hasFeedback ? "Feedback appears here and in the portal." : "The stored decision feedback appears in this message."}</div></div>}
      {hasFeedback && <label class="decision-plan-feedback field"><span>Feedback for the speakers (optional)</span><textarea rows={4} value={feedback} onInput={(event) => onFeedbackChange(event.currentTarget.value)} placeholder="Rendered into each message and shown in each portal." /></label>}
      {hasFeedback && <label class="decision-plan-feedback field"><span>Internal note (optional)</span><textarea rows={3} maxLength={5000} value={internalNote} onInput={(event) => onInternalNoteChange(event.currentTarget.value)} placeholder="Keep context for the conference team." /><small>Saved with the proposal. Never sent.</small></label>}
      {publishedCount !== null && publishedCount > 0 && plan.action !== "notify" && <label class="decision-plan-published"><input type="checkbox" checked={confirmPublished} onChange={(event) => onConfirmPublishedChange(event.currentTarget.checked)} /><span>{publishedCount.toLocaleString()} published record{publishedCount === 1 ? "" : "s"} stay unchanged unless you explicitly confirm the live write.</span></label>}
      {plan.zero_effect && <div class="decision-plan-zero-effect">Nothing would change: {plan.zero_effect.reason}</div>}
      <footer class="decision-plan-actions"><Button type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="button" variant={plan.action === "reject" ? "danger" : "primary"} disabled={busy || loading || stale} onClick={onConfirm}>{busy ? "Saving…" : confirmLabel(plan)}</Button></footer>
    </>}
  </section>;
}

interface DecisionPlanResultModalProps {
  plan: DecisionPlanResponse;
  result: DecisionPlanApplyResult;
  skips: DecisionPlanSkip[];
  onClose: () => void;
}

export function DecisionPlanResultModal({ plan, result, skips, onClose }: DecisionPlanResultModalProps): JSX.Element {
  const copy = ACTION_COPY[plan.action];
  return <div class="decision-plan-result-backdrop" role="presentation"><section class="decision-plan-result" role="dialog" aria-modal="true" aria-labelledby="decision-plan-result-heading">
    <header class="decision-plan-head"><div><span class="eyebrow">Wave decision · result</span><h2 id="decision-plan-result-heading">{result.succeeded.toLocaleString()} {copy.past}{result.failed ? ` · ${result.failed.toLocaleString()} could not move` : ""}</h2><p>Every skipped record is named below.</p></div><button type="button" class="decision-plan-close" aria-label="Close result" onClick={onClose}>×</button></header>
    <div class="decision-plan-result-body">{skips.length > 0 ? skips.map((skip) => <div class="decision-plan-detail-row" key={`${skip.id}:${skip.reason}`}><span><strong>{skip.title}</strong> <small>{skip.id}</small></span><span>{skip.reason}</span></div>) : <p>Every selected record completed cleanly.</p>}</div>
    <footer class="decision-plan-actions"><Button type="button" variant="primary" onClick={onClose}>Done</Button></footer>
  </section></div>;
}
