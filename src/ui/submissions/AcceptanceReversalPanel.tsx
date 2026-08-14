import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip } from "../shell/components";
import "./reversal.css";

interface Preview {
  tasks: Array<{ id: string; title: string; status: "open" | "done"; cancelled_at: number | null }>;
  scheduled_emails: Array<{ id: string; subject: string; status: "queued" | "sent" | "suppressed" | "failed" }>;
  calendar_invites: Array<{ id: string; email: string; uid: string; sequence: number; last_method: "REQUEST" | "CANCEL"; status: string }>;
}

interface Result {
  resulting_status: "withdrawn" | "rejected" | null;
  tasks_cancelled: number;
  emails_cancelled: number;
  calendar_cancelled: number;
}

interface Props { eventId: string; submissionId: string; onReversed?: () => void; }
const REVERSAL_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/reversal";
type Choice = "cancel" | "retain";
type Choices = { tasks: Choice; emails: Choice; calendar: Choice; outcome: "withdrawn" | "rejected" };

const initialChoices: Choices = { tasks: "cancel", emails: "cancel", calendar: "cancel", outcome: "withdrawn" };

function stateLabel(status: string, cancelled = false): string {
  if (cancelled || status === "suppressed" || status === "cancelled") return "cancelled";
  return "retained";
}

type RowId = "portal-tasks" | "scheduled-emails" | "calendar-invites";

/**
 * One inventory line and, on demand, the rows behind it. The header is a
 * button rather than a link because nothing navigates: the evidence belongs
 * beside the decision, not one page away from it.
 */
export function ReversalRow({ id, title, count, state, rows, empty, open, onToggle }: {
  id: RowId;
  title: string;
  count: string;
  state: string;
  rows: Array<{ id: string; label: string; detail: string }>;
  empty: string;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  return <div class="reversal-row-group">
    <button type="button" class="reversal-row reversal-row-toggle" aria-expanded={open} aria-controls={`reversal-detail-${id}`} onClick={onToggle}>
      <span><strong>{title}</strong><small>{count}</small></span>
      <span data-row-state={id}>{state}<span class="reversal-row-caret" aria-hidden="true">{open ? "▾" : "▸"}</span></span>
    </button>
    <div class="reversal-row-detail" id={`reversal-detail-${id}`} hidden={!open}>
      {rows.length === 0
        ? <p class="reversal-row-empty">{empty}</p>
        : <ul>{rows.map((row) => <li key={row.id}><span>{row.label}</span><small>{row.detail}</small></li>)}</ul>}
    </div>
  </div>;
}

export function AcceptanceReversalPanel({ eventId, submissionId, onReversed }: Props): JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choices>(initialChoices);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [expanded, setExpanded] = useState<RowId | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiFetch<{ data: Preview }>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/reversal`, { route: REVERSAL_ROUTE });
      setPreview(payload.data);
    } catch (reason) {
      setError(errorSummary(reason));
    }
  }, [eventId, submissionId]);

  useEffect(() => { void load(); }, [load]);

  async function apply(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const payload = await apiFetch<{ data?: Result; preview?: Preview }>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/reversal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(choices),
        route: REVERSAL_ROUTE,
      });
      if (!payload.data || !payload.preview) throw new Error("The reversal response was unreadable.");
      setResult(payload.data);
      setPreview(payload.preview);
      setOpen(false);
      onReversed?.();
    } catch (reason) {
      setError(errorSummary(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!preview && !error) return <Card><CardBody><span class="subtle">Loading reversal inventory…</span></CardBody></Card>;
  if (!preview) return <Card><CardBody><span class="reversal-error">{error}</span></CardBody></Card>;

  return <>
    <Card>
      <CardHeader title="Acceptance reversal"><Button variant="danger" small onClick={() => setOpen(true)}>Reverse acceptance</Button></CardHeader>
      <CardBody>
        {result && <div class="reversal-result" role="status">{result.resulting_status} · {result.tasks_cancelled} task row(s), {result.emails_cancelled} email row(s), {result.calendar_cancelled} invite(s) cancelled.</div>}
        {error && <div class="reversal-error" role="alert">{error}</div>}
        {/* Each count opens onto the rows it counts. A number alone asks the
            organizer to reverse an acceptance on faith: "2 active" is only a
            decision they can make if they can see WHICH two tasks, which
            queued mail, and whose calendar invite. The row header keeps its
            own size when it opens, so the counts never move. */}
        <div class="reversal-rows">
          <ReversalRow
            id="portal-tasks"
            title="Portal tasks"
            count={`${preview.tasks.length} row(s)`}
            state={`${preview.tasks.filter((task) => task.status === "open" && task.cancelled_at === null).length} active`}
            open={expanded === "portal-tasks"}
            onToggle={() => setExpanded(expanded === "portal-tasks" ? null : "portal-tasks")}
            empty="No portal tasks were created for this talk."
            rows={preview.tasks.map((task) => ({
              id: task.id,
              label: task.title,
              detail: task.cancelled_at !== null ? "cancelled" : task.status === "done" ? "done" : "open",
            }))}
          />
          <ReversalRow
            id="scheduled-emails"
            title="Scheduled emails"
            count={`${preview.scheduled_emails.length} row(s)`}
            state={`${preview.scheduled_emails.filter((email) => email.status === "queued").length} queued`}
            open={expanded === "scheduled-emails"}
            onToggle={() => setExpanded(expanded === "scheduled-emails" ? null : "scheduled-emails")}
            empty="No mail is scheduled against this talk."
            rows={preview.scheduled_emails.map((email) => ({ id: email.id, label: email.subject, detail: email.status }))}
          />
          <ReversalRow
            id="calendar-invites"
            title="Calendar invites"
            count={`${preview.calendar_invites.length} recipient row(s)`}
            state={`${preview.calendar_invites.filter((invite) => invite.status !== "cancelled").length} active`}
            open={expanded === "calendar-invites"}
            onToggle={() => setExpanded(expanded === "calendar-invites" ? null : "calendar-invites")}
            empty="No calendar invite has been sent for this talk."
            rows={preview.calendar_invites.map((invite) => ({
              id: invite.id,
              label: invite.email,
              detail: `${invite.status} · ${invite.last_method === "CANCEL" ? "cancellation sent" : "invite sent"}`,
            }))}
          />
        </div>
      </CardBody>
    </Card>
    {open && <div class="reversal-modal-backdrop" role="presentation"><div class="reversal-modal" role="dialog" aria-modal="true" aria-labelledby="record-reversal-title">
      <div class="reversal-modal-head"><div><span class="eyebrow">Acceptance reversal</span><h2 id="record-reversal-title">Choose what to unwind</h2></div><button type="button" class="reversal-close" aria-label="Close" onClick={() => setOpen(false)}>×</button></div>
      <p class="subtle">Every choice is applied to its underlying rows and reloaded after the write.</p>
      <label>Portal tasks<select aria-label="Portal tasks" value={choices.tasks} onChange={(event) => setChoices({ ...choices, tasks: event.currentTarget.value as Choice })}><option value="cancel">Cancel open tasks</option><option value="retain">Keep tasks active</option></select></label>
      <label>Scheduled emails<select aria-label="Scheduled emails" value={choices.emails} onChange={(event) => setChoices({ ...choices, emails: event.currentTarget.value as Choice })}><option value="cancel">Cancel queued emails</option><option value="retain">Retain queued emails</option></select></label>
      <label>Calendar invites<select aria-label="Calendar invites" value={choices.calendar} onChange={(event) => setChoices({ ...choices, calendar: event.currentTarget.value as Choice })}><option value="cancel">Send cancellation</option><option value="retain">Retain invite</option></select></label>
      <label>Resulting status<select aria-label="Resulting status" value={choices.outcome} onChange={(event) => setChoices({ ...choices, outcome: event.currentTarget.value as Choices["outcome"] })}><option value="withdrawn">Withdrawn</option><option value="rejected">Rejected</option></select></label>
      <div class="reversal-branch-summary" role="status" data-task-branch={choices.tasks}>{choices.tasks === "cancel" ? "Cancel open tasks: unfinished portal work will be cancelled and no longer chased." : "Keep tasks active: unfinished portal work will remain open and continue to be chased."}</div>
      <div class="reversal-modal-actions"><Button variant="ghost" onClick={() => setOpen(false)}>Keep acceptance</Button><Button variant="danger" onClick={() => void apply()} disabled={busy}>{busy ? "Applying…" : "Apply reversal"}</Button></div>
    </div></div>}
  </>;
}
