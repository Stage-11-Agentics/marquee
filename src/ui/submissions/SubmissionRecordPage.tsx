import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { Button, Card, CardBody, CardHeader, Chip, PageHeader } from "../shell/components";
import { AcceptanceReversalPanel } from "./AcceptanceReversalPanel";
import "./record.css";

const DEFAULT_EVENT_ID = "evt_aie-ny-2026";

interface Participant { id: string; person_id: string; name: string; email: string; company: string | null; role: string; }
interface Reviewer { id: string; name: string; company: string | null; track_ids: string[]; }
interface Assignment { assignment_id: string; reviewer_person_id: string; reviewer_name: string; status: string; coverage: { assigned: number; reviewed: number }; }
interface Round { id: string; name: string; position: number; target_reviews_per_submission: number; plan_status: string; reviewers: Assignment[]; }
interface RecordData {
  id: string; event_id: string; event_name: string; kind: "abstract" | "session"; title: string; abstract: string | null;
  status: string; stage: string; stage_label: string; bypass_evaluation: boolean; origin: string; vendor_affiliation: string;
  submitter_person_id: string; submitted_at: number | null; last_saved_at: number | null; updated_at: number; time_in_stage: string;
  slot: { day: string; time: string; room: string; building: string; duration_min: number; is_published: boolean } | null;
  format: { id: string; name: string | null } | null; wave: { id: string; name: string | null } | null;
  tracks: Array<{ id: string; name: string; color: string; is_primary: boolean }>;
  participants: Participant[]; answers: Array<{ id: string; field_id: string; label: string | null; key: string | null; value_text: string | null; value_json: unknown }>;
  decisions: Array<{ decision: string; resulting_status: string; feedback_md: string | null; decided_at: number; decided_by_name: string | null }>;
  evaluations: Array<{ round_name: string; reviewer_name: string; recommendation: string | null; score: number | null; comment: string }>;
  evaluation: { rounds: Round[]; reviewer_options: Reviewer[] };
  history: Array<{ action: string; actor_kind: string; created_at: number; after_json: unknown }>;
  actions: { can_decide: boolean; can_schedule: boolean; can_publish: boolean };
}

interface Props { eventId?: string; submissionId: string; navigate: (target: string) => void; }

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; record: RecordData };

function moment(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function statusLabel(value: string): string {
  if (value === "in_review") return "In review";
  if (value === "waitlisted") return "Maybe";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SubmissionRecordPage({ eventId = DEFAULT_EVENT_ID, submissionId, navigate }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAbstract, setDraftAbstract] = useState("");
  const [selectedReviewers, setSelectedReviewers] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState({ starts_at: "", duration_min: "30", room_id: "", track_id: "" });

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(`The record request failed (${response.status}).`); return response.json() as Promise<RecordData>; })
      .then((record) => { setSchedule((current) => ({ ...current, room_id: current.room_id || "", track_id: current.track_id || record.tracks.find((track) => track.is_primary)?.id || "" })); setDraftTitle(record.title); setDraftAbstract(record.abstract ?? ""); setState({ kind: "ready", record }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", message: error instanceof Error ? error.message : "The record could not be loaded." }); });
    return () => controller.abort();
  }, [eventId, submissionId, reloadKey]);

  const act = async (name: string, path: string, init: RequestInit = {}) => {
    setBusy(name);
    try {
      const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
      if (!response.ok) throw new Error(`The action failed (${response.status}).`);
      reload();
    } catch (error: unknown) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "The action could not be completed." });
    } finally { setBusy(""); }
  };

  const decide = async (recommendation: "approve" | "maybe" | "deny") => {
    if (!window.confirm(`Confirm ${recommendation === "approve" ? "accept" : recommendation === "maybe" ? "Maybe" : "reject"} for this record?`)) return;
    await act(recommendation, "/decision", { method: "POST", body: JSON.stringify({ recommendation }) });
  };

  const assign = async (roundId: string) => {
    const reviewerPersonId = selectedReviewers[roundId];
    if (!reviewerPersonId) return;
    await act(`assign-${roundId}`, `/../../rounds/${encodeURIComponent(roundId)}/assignments`, { method: "POST", body: JSON.stringify({ submission_id: submissionId, reviewer_person_id: reviewerPersonId }) });
  };

  const removeAssignment = async (roundId: string, assignmentId: string) => {
    await act(`remove-${assignmentId}`, `/../../rounds/${encodeURIComponent(roundId)}/assignments/${encodeURIComponent(assignmentId)}`, { method: "DELETE" });
  };

  const saveDraft = async (event: Event) => {
    event.preventDefault();
    await act("draft", "", { method: "PATCH", body: JSON.stringify({ title: draftTitle, abstract: draftAbstract || null }) });
  };

  if (state.kind === "loading") return <div class="submission-record-page"><PageHeader title="Submission record" copy="Reading the complete conference record…" /><Card><CardBody><div class="record-state">Loading record…</div></CardBody></Card></div>;
  if (state.kind === "error") return <div class="submission-record-page"><PageHeader title="Submission record" copy="The record is not available." /><Card><CardBody><div class="record-state error"><strong>Record unavailable</strong><span>{state.message}</span><Button onClick={reload}>Retry</Button></div></CardBody></Card></div>;
  const record = state.record;
  return <div class="submission-record-page">
    <PageHeader title={record.title} copy={`${record.id} · ${record.kind === "session" ? "Session" : "Abstract"} · ${record.origin} origin`} actions={<><Button onClick={() => navigate("/submissions")}>Back to submissions</Button><Chip tone={record.stage === "published" ? "success" : record.stage === "waved" ? "warning" : ""}>{record.stage_label}</Chip></>} />
    <div class="record-layout">
      <div class="record-main stack">
        <Card><CardBody><div class="record-summary"><div><span class="eyebrow">Program record</span><h2>{record.title}</h2><p>{record.abstract || "—"}</p></div><div class="record-summary-meta"><Chip>{statusLabel(record.status)}</Chip><span class="tabular">{record.time_in_stage}</span><span>{record.bypass_evaluation ? "Evaluation bypassed" : "Evaluation required"}</span></div></div><div class="record-meta-grid"><span><small>Origin</small><strong>{statusLabel(record.origin)}</strong></span><span><small>Submitted</small><strong>{moment(record.submitted_at)}</strong></span><span><small>Format</small><strong>{record.format?.name ?? "—"}</strong></span><span><small>Wave</small><strong>{record.wave?.name ?? "—"}</strong></span></div>{record.slot && <div class="record-slot"><strong>{record.slot.day} · {record.slot.time} · {record.slot.room}</strong><span>{record.slot.building} · {record.slot.duration_min} min</span>{!record.slot.is_published && <Chip tone="warning">Not yet public</Chip>}{record.slot.is_published && <Chip tone="success">Live on the public site</Chip>}</div>}</CardBody></Card>
        {record.status === "draft" && <Card><CardHeader title="Draft editor"><span class="subtle">Saving keeps this record in Draft.</span></CardHeader><CardBody><form class="record-draft-form" onSubmit={(event) => void saveDraft(event)}><label class="field"><span>Title</span><input required value={draftTitle} onInput={(event) => setDraftTitle(event.currentTarget.value)} /></label><label class="field"><span>Abstract</span><textarea rows={6} value={draftAbstract} onInput={(event) => setDraftAbstract(event.currentTarget.value)} /></label><div class="record-action-row"><Button variant="primary" type="submit" disabled={Boolean(busy)}>{busy === "draft" ? "Saving…" : "Save draft"}</Button><span class="subtle">No submit action is available from this editor.</span></div></form></CardBody></Card>}
        {record.actions.can_decide && <Card><CardHeader title="Record action"><span class="subtle">Consequential actions stay on the record.</span></CardHeader><CardBody><div class="record-action-row"><Button variant="primary" disabled={Boolean(busy)} onClick={() => decide("approve")}>Accept</Button><Button disabled={Boolean(busy)} onClick={() => decide("maybe")}>Maybe</Button><Button variant="danger" disabled={Boolean(busy)} onClick={() => decide("deny")}>Reject</Button></div></CardBody></Card>}
        {record.status === "accepted" && <AcceptanceReversalPanel eventId={eventId} submissionId={submissionId} onReversed={reload} />}
        {record.actions.can_schedule && <Card><CardHeader title="Working agenda"><span class="subtle">Place this Session on the private agenda.</span></CardHeader><CardBody><form class="record-schedule-form" onSubmit={(event) => { event.preventDefault(); void act("schedule", "/schedule", { method: "POST", body: JSON.stringify({ starts_at: new Date(schedule.starts_at).getTime(), duration_min: Number(schedule.duration_min), room_id: schedule.room_id, track_id: schedule.track_id || null }) }); }}><label class="field"><span>Starts at</span><input required type="datetime-local" value={schedule.starts_at} onInput={(event) => setSchedule({ ...schedule, starts_at: event.currentTarget.value })} /></label><label class="field"><span>Duration</span><input required type="number" min="1" value={schedule.duration_min} onInput={(event) => setSchedule({ ...schedule, duration_min: event.currentTarget.value })} /></label><label class="field"><span>Room ID</span><input required value={schedule.room_id} onInput={(event) => setSchedule({ ...schedule, room_id: event.currentTarget.value })} /></label><Button variant="primary" type="submit" disabled={Boolean(busy)}>Place on agenda</Button></form></CardBody></Card>}
        {record.actions.can_publish && <Card><CardHeader title="Public site"><span class="subtle">The working slot is private until this action is confirmed.</span></CardHeader><CardBody><div class="record-action-row"><Button variant="primary" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Make this scheduled Session public?")) void act("publish", "/publish", { method: "POST" }); }}>Publish Session</Button><span class="subtle">The scheduled day, time, room, speakers, title, and description become public together.</span></div></CardBody></Card>}
        <Card><CardHeader title="Participants"><span class="tabular">{record.participants.length}</span></CardHeader><CardBody><div class="record-participants">{record.participants.map((participant) => <div class="record-person" key={participant.id}><strong>{participant.name}</strong><span>{statusLabel(participant.role)} · {participant.company || "—"}</span><small>{participant.email}</small></div>)}</div></CardBody></Card>
        <Card><CardHeader title="Answers and scores" /><CardBody><div class="record-answer-list">{record.answers.length ? record.answers.map((answer) => <div class="record-answer" key={answer.id}><small>{answer.label || answer.key || answer.field_id}</small><strong>{answer.value_text || (answer.value_json === null ? "—" : JSON.stringify(answer.value_json))}</strong></div>) : <span class="subtle">No form answers recorded.</span>}{record.evaluations.map((evaluation, index) => <div class="record-answer" key={`${evaluation.round_name}-${evaluation.reviewer_name}-${index}`}><small>{evaluation.round_name} · {evaluation.reviewer_name}</small><strong>{evaluation.score === null ? "—" : evaluation.score.toFixed(2)} · {evaluation.recommendation || "No recommendation"}</strong><span>{evaluation.comment || "—"}</span></div>)}</div></CardBody></Card>
        <Card><CardHeader title="History" /><CardBody><div class="record-history">{record.history.length ? record.history.map((entry) => <div class="record-history-row" key={`${entry.created_at}-${entry.action}`}><strong>{statusLabel(entry.action)}</strong><span>{entry.actor_kind}</span><time>{moment(entry.created_at)}</time></div>) : <span class="subtle">No history recorded.</span>}</div></CardBody></Card>
      </div>
      <aside class="record-aside stack"><Card><CardHeader title="Tracks" /><CardBody><div class="track-chips">{record.tracks.length ? record.tracks.map((track) => <Chip key={track.id}>{track.name}{track.is_primary ? " · Primary" : ""}</Chip>) : <span class="subtle">—</span>}</div></CardBody></Card><Card><CardHeader title="Evaluation panel"><span class="subtle">Current reviewers · coverage</span></CardHeader><CardBody><div class="record-rounds">{record.evaluation.rounds.length ? record.evaluation.rounds.map((round) => <section class="record-round" key={round.id}><div class="record-round-head"><strong>{round.name}</strong><span class="tabular">target {round.target_reviews_per_submission}</span></div>{round.reviewers.map((assignment) => <div class="record-assignment" key={assignment.assignment_id}><span><strong>{assignment.reviewer_name}</strong><small>{assignment.coverage.reviewed}/{assignment.coverage.assigned} reviewed</small></span><Button small variant="ghost" disabled={Boolean(busy)} onClick={() => void removeAssignment(round.id, assignment.assignment_id)}>Remove</Button></div>)}<div class="record-assignment-add"><select aria-label={`Assign reviewer for ${round.name}`} value={selectedReviewers[round.id] ?? ""} onChange={(event) => setSelectedReviewers({ ...selectedReviewers, [round.id]: event.currentTarget.value })}><option value="">Assign reviewer…</option>{record.evaluation.reviewer_options.map((reviewer) => <option value={reviewer.id}>{reviewer.name}</option>)}</select><Button small disabled={!selectedReviewers[round.id] || Boolean(busy)} onClick={() => void assign(round.id)}>Assign</Button></div></section>) : <span class="subtle">No evaluation rounds configured.</span>}</div></CardBody></Card></aside>
    </div>
  </div>;
}
