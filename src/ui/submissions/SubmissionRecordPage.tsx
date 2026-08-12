import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { formatFileSize, type FileAnswerView } from "../../lib/file-answers";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip, PageHeader } from "../shell/components";
import { AcceptanceReversalPanel } from "./AcceptanceReversalPanel";
import { decidedNote, moment, statusLabel } from "./record-copy";
import "./record.css";

const DEFAULT_EVENT_ID = "evt_aie-ny-2026";
const SUBMISSION_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}";
const DECISION_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/decision";
const SCHEDULE_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/schedule";
const PUBLISH_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/publish";
const ASSIGNMENT_ROUTE = "/api/v1/events/{eventId}/rounds/{roundId}/assignments";
const ASSIGNMENT_DELETE_ROUTE = "/api/v1/events/{eventId}/rounds/{roundId}/assignments/{assignmentId}";
const COMMS_SEND_ROUTE = "/api/v1/events/{eventId}/comms/send";

interface Participant { id: string; person_id: string; name: string; email: string; company: string | null; role: string; confirmation_status: "pending" | "confirmed" | "declined"; confirmed_at: number | null; invited_at: number | null; }
interface Reviewer { id: string; name: string; company: string | null; track_ids: string[]; }
interface Assignment { assignment_id: string; reviewer_person_id: string; reviewer_name: string; status: string; coverage: { assigned: number; reviewed: number }; }
interface Round { id: string; name: string; mode: "scorecard" | "comparison"; position: number; target_reviews_per_submission: number; plan_status: string; reviewers: Assignment[]; evaluations: Array<{ score: number | null; recommendation: string | null; comment: string }>; comparisons: Array<{ ranking: unknown; submission_ids: string[]; reviewer_name: string }>; }
interface RecordData {
  id: string; event_id: string; event_name: string; kind: "abstract" | "session"; title: string; abstract: string | null;
  status: string; stage: string; stage_label: string; bypass_evaluation: boolean; origin: string; vendor_affiliation: string;
  submitter_person_id: string; submitted_at: number | null; last_saved_at: number | null; updated_at: number; time_in_stage: string;
  slot: { day: string; time: string; room: string; building: string; duration_min: number; is_published: boolean } | null;
  format: { id: string; name: string | null } | null; wave: { id: string; name: string | null } | null;
  routing: { rule_id: string; name: string } | null;
  tracks: Array<{ id: string; name: string; color: string; is_primary: boolean }>;
  participants: Participant[]; answers: Array<{ id: string; field_id: string; label: string | null; key: string | null; type: string | null; value_text: string | null; value_json: unknown; file: FileAnswerView | null }>;
  decisions: Array<{ id: string; kind?: "decision" | "reversal"; decision: string; resulting_status: string; feedback_md: string | null; note?: string | null; decided_at: number; decided_by_name: string | null }>;
  evaluations: Array<{ round_id: string; round_name: string; reviewer_name: string; recommendation: string | null; score: number | null; comment: string }>;
  comparisons: Array<{ round_id: string; round_name: string; reviewer_name: string; ranking: unknown; submission_ids: string[] }>;
  evaluation: { rounds: Round[]; reviewer_options: Reviewer[] };
  history: Array<{ action: string; actor_kind: string; created_at: number; after_json: unknown }>;
  actions: { can_decide: boolean; can_schedule: boolean; can_publish: boolean };
}

interface Props { eventId?: string; submissionId: string; navigate: (target: string) => void; }

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; record: RecordData };

function answerText(answer: RecordData["answers"][number]): string {
  if (answer.value_text) return answer.value_text;
  if (answer.value_json === null || answer.value_json === undefined) return "—";
  if (Array.isArray(answer.value_json)) return answer.value_json.join(" · ") || "—";
  if (typeof answer.value_json === "object") return "—";
  return String(answer.value_json);
}

/**
 * What the speaker uploaded, not what the database stored. The crop keeps its
 * square in every state — loading, loaded, and nothing to load — so the record
 * does not reflow underneath the organizer's cursor.
 */
function FileAnswer({ label, file }: { label: string; file: FileAnswerView }): JSX.Element {
  return <div class="record-file">
    <div class="record-file-crop">{file.preview_url ? <img src={file.preview_url} alt={`${label} preview`} width={64} height={64} loading="lazy" /> : <span aria-hidden="true">{file.state === "ready" ? "File" : "None"}</span>}</div>
    <div class="record-file-meta">
      <strong>{file.state === "ready" ? file.filename : "No file uploaded"}</strong>
      <span class="tabular">{file.state === "ready" ? `${file.content_type ?? "Unknown type"} · ${formatFileSize(file.size_bytes ?? 0)}` : "Nothing was attached for this field."}</span>
    </div>
  </div>;
}

export function SubmissionRecordPage({ eventId = DEFAULT_EVENT_ID, submissionId, navigate }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAbstract, setDraftAbstract] = useState("");
  const [selectedReviewers, setSelectedReviewers] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState({ starts_at: "", duration_min: "30", room_id: "", track_id: "" });
  const [decisionRequest, setDecisionRequest] = useState<"approve" | "maybe" | "deny" | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [messageRecipientId, setMessageRecipientId] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messageError, setMessageError] = useState("");
  const [messageNotice, setMessageNotice] = useState("");

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    apiFetch<RecordData>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}`, { signal: controller.signal, route: SUBMISSION_ROUTE })
      .then((record) => { setSchedule((current) => ({ ...current, room_id: current.room_id || "", track_id: current.track_id || record.tracks.find((track) => track.is_primary)?.id || "" })); setDraftTitle(record.title); setDraftAbstract(record.abstract ?? ""); setMessageRecipientId((current) => current || record.participants.find((participant) => participant.role !== "submitter")?.id || record.participants[0]?.id || ""); setMessageSubject((current) => current || `A note about ${record.title}`); setMessageBody((current) => current || "Hi {{speaker.first_name}},\n\n"); setState({ kind: "ready", record }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", message: errorSummary(error) }); });
    return () => controller.abort();
  }, [eventId, submissionId, reloadKey]);

  const act = async (name: string, path: string, init: RequestInit = {}, route = SUBMISSION_ROUTE) => {
    setBusy(name);
    try {
      await apiFetch<unknown>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, route });
      reload();
    } catch (error: unknown) {
      setState({ kind: "error", message: errorSummary(error) });
    } finally { setBusy(""); }
  };

  const decide = async () => {
    if (!decisionRequest) return;
    const recommendation = decisionRequest;
    setDecisionRequest(null);
    await act(recommendation, "/decision", { method: "POST", body: JSON.stringify({ recommendation, feedback_md: feedbackDraft.trim() || null }) }, DECISION_ROUTE);
    setFeedbackDraft("");
  };

  const sendMessage = async (event: Event) => {
    event.preventDefault();
    const currentRecord = state.kind === "ready" ? state.record : null;
    const recipient = currentRecord?.participants.find((participant) => participant.id === messageRecipientId);
    if (!recipient) { setMessageError("Choose a participant before sending."); return; }
    if (!messageSubject.trim() || !messageBody.trim()) { setMessageError("Subject and message are required."); return; }
    setBusy("message"); setMessageError(""); setMessageNotice("");
    try {
      const body = await apiFetch<{ queued?: number }>(`/api/v1/events/${encodeURIComponent(eventId)}/comms/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selector: { submission_ids: [submissionId], person_ids: [recipient.person_id], role: recipient.role }, subject: messageSubject.trim(), body: messageBody }),
        route: COMMS_SEND_ROUTE,
      });
      setMessageNotice(body.queued ? "Message queued in the conference outbox." : "That message was already queued for this participant.");
      reload();
    } catch (error: unknown) {
      setMessageError(errorSummary(error));
    } finally { setBusy(""); }
  };

  const assign = async (roundId: string) => {
    const reviewerPersonId = selectedReviewers[roundId];
    if (!reviewerPersonId) return;
    await act(`assign-${roundId}`, `/../../rounds/${encodeURIComponent(roundId)}/assignments`, { method: "POST", body: JSON.stringify({ submission_id: submissionId, reviewer_person_id: reviewerPersonId }) }, ASSIGNMENT_ROUTE);
  };

  const removeAssignment = async (roundId: string, assignmentId: string) => {
    await act(`remove-${assignmentId}`, `/../../rounds/${encodeURIComponent(roundId)}/assignments/${encodeURIComponent(assignmentId)}`, { method: "DELETE" }, ASSIGNMENT_DELETE_ROUTE);
  };

  const saveDraft = async (event: Event) => {
    event.preventDefault();
    await act("draft", "", { method: "PATCH", body: JSON.stringify({ title: draftTitle, abstract: draftAbstract || null }) }, SUBMISSION_ROUTE);
  };

  if (state.kind === "loading") return <div class="submission-record-page"><PageHeader title="Submission record" copy="Reading the complete conference record…" /><Card><CardBody><div class="record-state">Loading record…</div></CardBody></Card></div>;
  if (state.kind === "error") return <div class="submission-record-page"><PageHeader title="Submission record" copy="The record is not available." /><Card><CardBody><div class="record-state error"><strong>Record unavailable</strong><span>{state.message}</span><div class="record-action-row"><Button onClick={() => navigate("/submissions")}>Back to submissions</Button><Button variant="primary" onClick={reload}>Retry</Button></div></div></CardBody></Card></div>;
  const record = state.record;
  return <div class="submission-record-page">
    <PageHeader title={record.title} copy={`${record.id} · ${record.kind === "session" ? "Session" : "Abstract"} · ${record.origin} origin`} actions={<><Button onClick={() => navigate("/submissions")}>Back to submissions</Button><Chip tone={record.stage === "published" ? "success" : record.stage === "waved" ? "warning" : ""}>{record.stage_label}</Chip></>} />
    <div class="record-layout">
      <div class="record-main stack">
        <Card><CardBody><div class="record-summary"><div><span class="eyebrow">Program record</span><h2>{record.title}</h2><p>{record.abstract || "—"}</p></div><div class="record-summary-meta"><Chip>{statusLabel(record.status)}</Chip><span class="tabular">{record.time_in_stage}</span><span>{record.bypass_evaluation ? "Evaluation bypassed" : "Evaluation required"}</span></div></div><div class="record-meta-grid"><span><small>Origin</small><strong>{statusLabel(record.origin)}</strong></span><span><small>Submitted</small><strong>{moment(record.submitted_at)}</strong></span><span><small>Format</small><strong>{record.format?.name ?? "—"}</strong></span><span><small>Wave</small><strong>{record.wave?.name ?? "—"}</strong></span><span><small>Routing rule</small><strong>{record.routing?.name ?? "—"}</strong></span></div>{record.slot && <div class="record-slot"><strong>{record.slot.day} · {record.slot.time} · {record.slot.room}</strong><span>{record.slot.building} · {record.slot.duration_min} min</span>{!record.slot.is_published && <Chip tone="warning">Not yet public</Chip>}{record.slot.is_published && <Chip tone="success">Live on the public site</Chip>}</div>}</CardBody></Card>
        {record.status === "draft" && <Card><CardHeader title="Draft editor"><span class="subtle">Saving keeps this record in Draft.</span></CardHeader><CardBody><form class="record-draft-form" onSubmit={(event) => void saveDraft(event)}><label class="field"><span>Title</span><input required value={draftTitle} onInput={(event) => setDraftTitle(event.currentTarget.value)} /></label><label class="field"><span>Abstract</span><textarea rows={6} value={draftAbstract} onInput={(event) => setDraftAbstract(event.currentTarget.value)} /></label><div class="record-action-row"><Button variant="primary" type="submit" disabled={Boolean(busy)}>{busy === "draft" ? "Saving…" : "Save draft"}</Button><span class="subtle">No submit action is available from this editor.</span></div></form></CardBody></Card>}
        {record.actions.can_decide && <Card><CardHeader title="Record action"><span class="subtle">{decidedNote(record.decisions[0])}</span></CardHeader><CardBody><div class="record-action-row"><Button variant="primary" disabled={Boolean(busy)} onClick={() => { setDecisionRequest("approve"); setFeedbackDraft(""); }}>Accept</Button><Button disabled={Boolean(busy)} onClick={() => { setDecisionRequest("maybe"); setFeedbackDraft(""); }}>Maybe</Button><Button variant="danger" disabled={Boolean(busy)} onClick={() => { setDecisionRequest("deny"); setFeedbackDraft(""); }}>Reject</Button><span class="subtle">Optional feedback is rendered into the same decision message and saved on the record.</span></div></CardBody></Card>}
        {decisionRequest && <div class="record-decision-dialog" role="group" aria-labelledby="record-decision-heading"><div class="record-decision-dialog-head"><div><span class="eyebrow">Confirm record action</span><h2 id="record-decision-heading">{decisionRequest === "approve" ? "Accept this submission?" : decisionRequest === "maybe" ? "Waitlist this submission?" : "Reject this submission?"}</h2></div><button type="button" aria-label="Close decision dialog" onClick={() => setDecisionRequest(null)}>×</button></div><p>Feedback is optional. If supplied, the exact normalized note is saved on this decision row and rendered through the standard conference email.</p><label class="field"><span>Feedback for the speaker · optional</span><textarea rows={6} value={feedbackDraft} onInput={(event) => setFeedbackDraft(event.currentTarget.value)} placeholder="Share context the speaker can act on." /></label><div class="record-action-row"><Button type="button" onClick={() => setDecisionRequest(null)}>Cancel</Button><Button type="button" variant={decisionRequest === "deny" ? "danger" : "primary"} disabled={Boolean(busy)} onClick={() => void decide()}>{busy ? "Saving…" : decisionRequest === "approve" ? "Accept and notify" : decisionRequest === "maybe" ? "Waitlist and notify" : "Reject and notify"}</Button></div></div>}
        {record.decisions.length > 0 && <Card><CardHeader title="Decision history"><span class="tabular">{record.decisions.length}</span></CardHeader><CardBody><div class="record-decision-list">{record.decisions.map((decision) => <article class="record-decision" key={decision.id}><div class="record-decision-head"><strong>{decision.kind === "reversal" ? `Acceptance reversed · ${statusLabel(decision.resulting_status)}` : statusLabel(decision.resulting_status)}</strong><span>{decision.decided_by_name || "Conference team"} · {moment(decision.decided_at)}</span></div><p>{decision.note || decision.feedback_md || "No feedback recorded."}</p></article>)}</div></CardBody></Card>}
        {record.status === "accepted" && <AcceptanceReversalPanel eventId={eventId} submissionId={submissionId} onReversed={reload} />}
        {record.actions.can_schedule && <Card><CardHeader title="Working agenda"><span class="subtle">Place this Session on the private agenda.</span></CardHeader><CardBody><form class="record-schedule-form" onSubmit={(event) => { event.preventDefault(); void act("schedule", "/schedule", { method: "POST", body: JSON.stringify({ starts_at: new Date(schedule.starts_at).getTime(), duration_min: Number(schedule.duration_min), room_id: schedule.room_id, track_id: schedule.track_id || null }) }, SCHEDULE_ROUTE); }}><label class="field"><span>Starts at</span><input required type="datetime-local" value={schedule.starts_at} onInput={(event) => setSchedule({ ...schedule, starts_at: event.currentTarget.value })} /></label><label class="field"><span>Duration</span><input required type="number" min="1" value={schedule.duration_min} onInput={(event) => setSchedule({ ...schedule, duration_min: event.currentTarget.value })} /></label><label class="field"><span>Room ID</span><input required value={schedule.room_id} onInput={(event) => setSchedule({ ...schedule, room_id: event.currentTarget.value })} /></label><Button variant="primary" type="submit" disabled={Boolean(busy)}>Place on agenda</Button></form></CardBody></Card>}
        {record.actions.can_publish && <Card><CardHeader title="Public site"><span class="subtle">The working slot is private until this action is confirmed.</span></CardHeader><CardBody><div class="record-action-row"><Button variant="primary" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Make this scheduled Session public?")) void act("publish", "/publish", { method: "POST" }, PUBLISH_ROUTE); }}>Publish Session</Button><span class="subtle">The scheduled day, time, room, speakers, title, and description become public together.</span></div></CardBody></Card>}
        <Card><CardHeader title="Participants"><span class="tabular">{record.participants.length}</span></CardHeader><CardBody><div class="record-participants">{record.participants.length ? record.participants.map((participant) => <div class="record-person" key={participant.id}><strong>{participant.name}</strong><span>{statusLabel(participant.role)} · {participant.company || "Company not provided"}</span><small>{participant.email}</small><Chip tone={participant.confirmation_status === "confirmed" ? "success" : participant.confirmation_status === "declined" ? "alarm" : ""}>{participant.confirmation_status === "confirmed" ? "Role confirmed" : participant.confirmation_status === "declined" ? "Role declined" : "Role response pending"}</Chip></div>) : <div class="record-inline-empty">No participants are attached to this record yet.</div>}</div></CardBody></Card>
        <Card><CardHeader title="Message participant"><span class="subtle">Logged on this record · demo-safe</span></CardHeader><CardBody><form class="record-message-form" onSubmit={(event) => void sendMessage(event)}><label class="field"><span>Recipient and role</span><select value={messageRecipientId} onChange={(event) => setMessageRecipientId(event.currentTarget.value)}>{record.participants.map((participant) => <option value={participant.id} key={participant.id}>{participant.name} · {statusLabel(participant.role)}</option>)}</select></label><label class="field"><span>Subject</span><input required value={messageSubject} onInput={(event) => setMessageSubject(event.currentTarget.value)} /></label><label class="field"><span>Message</span><textarea required rows={5} value={messageBody} onInput={(event) => setMessageBody(event.currentTarget.value)} /><small>Use the shared merge fields, such as <code>{"{{speaker.first_name}}"}</code> and <code>{"{{submission.title}}"}</code>.</small></label><div class="record-action-row"><span class={`record-inline-message ${messageError ? "error" : messageNotice ? "notice" : ""}`}>{messageError || messageNotice}</span><Button variant="primary" type="submit" disabled={Boolean(busy)}>{busy === "message" ? "Queueing…" : "Queue message"}</Button></div></form></CardBody></Card>
        <Card><CardHeader title="Answers and evaluation evidence" /><CardBody><div class="record-answer-list">{record.answers.length ? record.answers.map((answer) => <div class="record-answer" key={answer.id}><small>{answer.label || answer.key || answer.field_id}</small>{answer.file ? <FileAnswer label={answer.label || answer.key || "File"} file={answer.file} /> : <strong>{answerText(answer)}</strong>}</div>) : <span class="subtle">No form answers recorded.</span>}{record.evaluations.map((evaluation, index) => <div class="record-answer" key={`${evaluation.round_id}-${evaluation.reviewer_name}-${index}`}><small>{evaluation.round_name} · Scorecard · {evaluation.reviewer_name}</small><strong>{evaluation.score === null ? "—" : evaluation.score.toFixed(2)} · {evaluation.recommendation || "No recommendation"}</strong><span>{evaluation.comment || "—"}</span></div>)}{record.comparisons.map((comparison, index) => <div class="record-answer" key={`${comparison.round_id}-${comparison.reviewer_name}-${index}`}><small>{comparison.round_name} · Comparison · {comparison.reviewer_name}</small><strong>{comparison.submission_ids.length} cards ranked</strong><span>{JSON.stringify(comparison.ranking)}</span></div>)}</div></CardBody></Card>
        <Card><CardHeader title="History" /><CardBody><div class="record-history">{record.history.length ? record.history.map((entry) => <div class="record-history-row" key={`${entry.created_at}-${entry.action}`}><strong>{statusLabel(entry.action)}</strong><span>{entry.actor_kind}</span><time>{moment(entry.created_at)}</time></div>) : <span class="subtle">No history recorded.</span>}</div></CardBody></Card>
      </div>
      <aside class="record-aside stack"><Card><CardHeader title="Tracks" /><CardBody><div class="track-chips">{record.tracks.length ? record.tracks.map((track) => <Chip key={track.id}>{track.name}{track.is_primary ? " · Primary" : ""}</Chip>) : <span class="subtle">No tracks assigned</span>}</div></CardBody></Card><Card><CardHeader title="Evaluation panel"><span class="subtle">Current reviewers · coverage</span></CardHeader><CardBody><div class="record-rounds">{record.evaluation.rounds.length ? record.evaluation.rounds.map((round) => <section class="record-round" key={round.id}><div class="record-round-head"><strong>{round.name}</strong><span class="tabular">{round.mode === "comparison" ? "Comparison" : "Scorecard"} · target {round.target_reviews_per_submission}</span></div>{round.evaluations.length > 0 && <div class="record-round-evidence"><small>{round.evaluations.length} scorecard result{round.evaluations.length === 1 ? "" : "s"}</small></div>}{round.comparisons.length > 0 && <div class="record-round-evidence"><small>{round.comparisons.length} comparison result{round.comparisons.length === 1 ? "" : "s"}</small></div>}{round.reviewers.map((assignment) => <div class="record-assignment" key={assignment.assignment_id}><span><strong>{assignment.reviewer_name}</strong><small>{assignment.coverage.reviewed}/{assignment.coverage.assigned} reviewed</small></span><Button small variant="ghost" disabled={Boolean(busy)} onClick={() => void removeAssignment(round.id, assignment.assignment_id)}>Remove</Button></div>)}<div class="record-assignment-add"><select aria-label={`Assign reviewer for ${round.name}`} value={selectedReviewers[round.id] ?? ""} onChange={(event) => setSelectedReviewers({ ...selectedReviewers, [round.id]: event.currentTarget.value })}><option value="">Assign reviewer…</option>{record.evaluation.reviewer_options.map((reviewer) => <option value={reviewer.id}>{reviewer.name}</option>)}</select><Button small disabled={!selectedReviewers[round.id] || Boolean(busy)} onClick={() => void assign(round.id)}>Assign</Button></div></section>) : <span class="subtle">No evaluation rounds configured</span>}</div></CardBody></Card></aside>
    </div>
  </div>;
}
