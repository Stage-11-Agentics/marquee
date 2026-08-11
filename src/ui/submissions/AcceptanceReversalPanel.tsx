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

export function AcceptanceReversalPanel({ eventId, submissionId, onReversed }: Props): JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choices>(initialChoices);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

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
        <div class="reversal-rows">
          <div class="reversal-row"><span><strong>Portal tasks</strong><small>{preview.tasks.length} row(s)</small></span><span data-row-state="portal-tasks">{preview.tasks.filter((task) => task.status === "open" && task.cancelled_at === null).length} active</span></div>
          <div class="reversal-row"><span><strong>Scheduled emails</strong><small>{preview.scheduled_emails.length} row(s)</small></span><span data-row-state="scheduled-emails">{preview.scheduled_emails.filter((email) => email.status === "queued").length} queued</span></div>
          <div class="reversal-row"><span><strong>Calendar invites</strong><small>{preview.calendar_invites.length} recipient row(s)</small></span><span data-row-state="calendar-invites">{preview.calendar_invites.filter((invite) => invite.status !== "cancelled").length} active</span></div>
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
