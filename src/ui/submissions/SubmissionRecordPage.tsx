import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { formatFileSize, type FileAnswerView } from "../../lib/file-answers";
import { apiFetch, errorSummary, MarqueeApiError } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip, PageHeader, ReviewerName } from "../shell/components";
import { AcceptanceReversalPanel } from "./AcceptanceReversalPanel";
import { ContentHistory } from "../history/ContentHistory";
import { decidedNote, headerChipTone, moment, statusLabel } from "./record-copy";
import "./record.css";

const SUBMISSION_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}";
const DECISION_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/decision";
const RESEND_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/decision/resend";
const SCHEDULE_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/schedule";
const PUBLISH_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/publish";
const UNPUBLISH_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/unpublish";
const ASSIGNMENT_ROUTE = "/api/v1/events/{eventId}/rounds/{roundId}/assignments";
const ASSIGNMENT_DELETE_ROUTE = "/api/v1/events/{eventId}/rounds/{roundId}/assignments/{assignmentId}";
const OVERRIDE_ROUTE = "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations/{evaluationId}/override";
const COMMS_SEND_ROUTE = "/api/v1/events/{eventId}/comms/send";
const CONTENT_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/content";
const CONTENT_RESTORE_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/content/restore";
const PARTICIPANTS_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/participants";
const PARTICIPANT_DELETE_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/participants/{participationId}";
const SEARCH_ROUTE = "/api/v1/events/{eventId}/search";

/**
 * The roles an organizer attaches after intake, in the order a program team
 * reaches for them. `submitter` is not offered: a record has exactly one and it
 * is settled at intake — the server refuses it too, so offering it here would
 * be a control whose only outcome is an error.
 */
const ATTACHABLE_ROLES = ["co_speaker", "speaker", "moderator", "chairperson", "sponsor_contact"] as const;


interface Participant { id: string; person_id: string; name: string; email: string; company: string | null; role: string; confirmation_status: "pending" | "confirmed" | "declined"; confirmed_at: number | null; invited_at: number | null; }
interface SearchResult { type: string; id: string; title: string; subtitle: string; }
interface Reviewer { id: string; name: string; kind: "human" | "agent"; company: string | null; track_ids: string[]; }
interface Assignment { assignment_id: string; reviewer_person_id: string; reviewer_name: string; reviewer_kind: "human" | "agent"; status: string; coverage: { assigned: number; reviewed: number }; }
/**
 * One recorded scorecard, plus the chair's override of it when there is one.
 * The reviewer's own score and reasoning are always present: an override
 * supersedes a judgment on the record, it does not erase it.
 */
interface EvaluationEvidence {
  abstained: boolean;
  id: string;
  round_id: string;
  round_name: string;
  reviewer_name: string;
  reviewer_kind: "human" | "agent";
  recommendation: string | null;
  score: number | null;
  comment: string;
  criteria_scores: Record<string, number | string> | null;
  override_score: number | null;
  override_comment: string | null;
  override_at: number | null;
  override_person_name: string | null;
  scale_min: number | null;
  scale_max: number | null;
}
interface RubricCriterion { id: string; name: string; kind: "numeric" | "select" | "text"; weight_pct: number; position: number }
interface Round { id: string; name: string; mode: "scorecard" | "comparison"; position: number; target_reviews_per_submission: number; plan_status: string; criteria: RubricCriterion[]; reviewers: Assignment[]; evaluations: Array<{ abstained: boolean; score: number | null; recommendation: string | null; comment: string; reviewer_kind: "human" | "agent" }>; comparisons: Array<{ ranking: unknown; submission_ids: string[]; reviewer_name: string; reviewer_kind: "human" | "agent" }>; }
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
  evaluations: EvaluationEvidence[];
  comparisons: Array<{ round_id: string; round_name: string; reviewer_name: string; reviewer_kind: "human" | "agent"; ranking: unknown; submission_ids: string[] }>;
  evaluation: { rounds: Round[]; reviewer_options: Reviewer[] };
  history: Array<{ id: string; action: string; actor_kind: string | null; actor_name: string | null; created_at: number; before: unknown; after: unknown; restorable: boolean }>;
  actions: { can_decide: boolean; can_schedule: boolean; can_publish: boolean; can_unpublish: boolean; can_edit_content: boolean; can_restore_content: boolean; can_resend_decision: boolean; can_edit_participants: boolean; can_override_scores: boolean };
}

interface Props { eventId: string; submissionId: string; navigate: (target: string) => void; }

type LoadState = { kind: "loading" } | { kind: "error"; message: string; notFound: boolean } | { kind: "ready"; record: RecordData };

/** A real 404 and a dropped connection call for different headlines — the
 * organizer's retry saw both as "not available" and repeated a request that
 * would have worked the first time. */
function isNotFound(error: unknown): boolean {
  return error instanceof MarqueeApiError && error.code === "not_found";
}

/**
 * A refusal the operator can answer: the request reached the conference, was
 * understood, and was declined on its merits. A 404 is excluded because the
 * record really is gone, and 401 because the seat is — both are the page's
 * problem, not the button's.
 */
function isRefusal(error: unknown): boolean {
  return error instanceof MarqueeApiError
    && error.status >= 400 && error.status < 500
    && error.status !== 404 && error.status !== 401;
}

/**
 * What saving actually does, said in the header rather than discovered after.
 * The three cases are genuinely different consequences, and a single generic
 * line would be wrong in two of them.
 */
function contentNote(record: RecordData): string {
  if (record.status === "draft") return "Saving keeps this record in Draft.";
  if (record.slot?.is_published) return "This Session is live on the public site.";
  return "Changes are recorded in the history below.";
}

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

function scoreText(score: number | null): string {
  return score === null ? "—" : score.toFixed(2);
}

/**
 * A recorded scorecard as the chair reads it: who scored, what they scored,
 * their reasoning — and, when a chair has overridden it, the governing value
 * with the superseded one still legible underneath.
 *
 * The Override chip and the Clear button each hold a reserved slot, so toggling
 * an override never moves the controls beside them. The row itself does grow by
 * the superseded line when an override exists, and by the form while it is
 * open — both are the operator's own action, not a shift under their cursor.
 */
/**
 * A scorecard is the rubric its round defines — weighted numbers, a
 * recommendation, and whatever free text the round asks for. The aggregate and
 * the committee note are the only two of those the record used to show, so a
 * reviewer's written rationale entered against a text criterion reached nobody:
 * the person deciding accept or reject saw a number and an em dash.
 *
 * Text answers lead because they are the reasoning; the weighted numbers follow
 * as a compact line. A criterion the reviewer left unanswered is omitted rather
 * than shown empty — the rubric is not a checklist of what they owed.
 */
function ScorecardAnswers({ criteria, scores }: { criteria: RubricCriterion[]; scores: Record<string, number | string> | null }): JSX.Element | null {
  if (!scores || !criteria.length) return null;
  const answered = criteria
    .filter((criterion) => scores[criterion.id] !== undefined && String(scores[criterion.id]).trim() !== "")
    .map((criterion) => ({ criterion, value: scores[criterion.id] }));
  if (!answered.length) return null;
  const prose = answered.filter((entry) => entry.criterion.kind === "text");
  const rated = answered.filter((entry) => entry.criterion.kind !== "text");
  return <div class="evaluation-scorecard">
    {prose.map((entry) => <div class="evaluation-criterion-note" key={entry.criterion.id}>
      <small>{entry.criterion.name}</small>
      <span>{String(entry.value)}</span>
    </div>)}
    {rated.length > 0 && <div class="evaluation-criterion-scores">
      {rated.map((entry) => <span key={entry.criterion.id}>
        {entry.criterion.name}{entry.criterion.weight_pct > 0 ? ` ${entry.criterion.weight_pct}%` : ""}
        {" · "}<strong class="tabular">{String(entry.value)}</strong>
      </span>)}
    </div>}
  </div>;
}

function EvaluationEvidenceRow({ evaluation, criteria, canOverride, busy, error, onOverride, onClear }: {
  evaluation: EvaluationEvidence;
  criteria: RubricCriterion[];
  canOverride: boolean;
  busy: boolean;
  error: string;
  onOverride: (evaluation: EvaluationEvidence, score: number, comment: string) => Promise<boolean>;
  onClear: (evaluation: EvaluationEvidence) => Promise<boolean>;
}): JSX.Element {
  const overridden = evaluation.override_score !== null;
  const [open, setOpen] = useState(false);
  const [draftScore, setDraftScore] = useState(String(evaluation.override_score ?? evaluation.score ?? ""));
  const [draftComment, setDraftComment] = useState(evaluation.override_comment ?? "");
  const parsed = Number(draftScore);
  // The plan's own scale, so an out-of-range value is refused where it is typed
  // rather than by the server after the fact.
  const { scale_min: scaleMin, scale_max: scaleMax } = evaluation;
  const inRange = (scaleMin === null || parsed >= scaleMin) && (scaleMax === null || parsed <= scaleMax);
  const submittable = draftScore.trim() !== "" && Number.isFinite(parsed) && inRange;
  const scaleHint = scaleMin !== null && scaleMax !== null ? `${scaleMin}–${scaleMax}` : null;
  return <div class="record-answer record-evaluation">
    <small>
      {evaluation.round_name} · Scorecard · <ReviewerName name={evaluation.reviewer_name} kind={evaluation.reviewer_kind} />
      <span class="evaluation-override-slot">{overridden ? <Chip tone="warning" class="override-chip">Override</Chip> : <span class="override-chip-placeholder" aria-hidden="true" />}</span>
    </small>
    <strong class="tabular">{evaluation.abstained
      ? "Conflict declared"
      : `${scoreText(overridden ? evaluation.override_score : evaluation.score)} · ${evaluation.recommendation || "No recommendation"}`}</strong>
    <span>{evaluation.abstained ? "Reviewer recused; no recommendation recorded." : evaluation.comment || "—"}</span>
    {!evaluation.abstained && <ScorecardAnswers criteria={criteria} scores={evaluation.criteria_scores} />}
    {overridden && <span class="evaluation-superseded">
      Overridden by {evaluation.override_person_name || "a chair"} · {evaluation.reviewer_name} scored <span class="tabular">{scoreText(evaluation.score)}</span>
      {evaluation.override_comment ? ` · ${evaluation.override_comment}` : ""}
    </span>}
    {canOverride && !evaluation.abstained && <div class="evaluation-override-controls">
      {open
        ? <form class="evaluation-override-form" onSubmit={(event) => {
            event.preventDefault();
            if (!submittable) return;
            void onOverride(evaluation, parsed, draftComment).then((saved) => { if (saved) setOpen(false); });
          }}>
            <label class="field">
              <span>Override score{scaleHint ? ` · ${scaleHint}` : ""}</span>
              <input
                type="number"
                step="0.1"
                required
                min={scaleMin ?? undefined}
                max={scaleMax ?? undefined}
                value={draftScore}
                aria-label={`Override score for ${evaluation.reviewer_name}`}
                onInput={(event) => setDraftScore(event.currentTarget.value)}
              />
            </label>
            <label class="field"><span>Why</span><input value={draftComment} aria-label={`Reason for overriding ${evaluation.reviewer_name}`} onInput={(event) => setDraftComment(event.currentTarget.value)} /></label>
            <div class="record-action-row">
              <span class={`record-inline-message ${error ? "error" : ""}`} role={error ? "alert" : undefined}>{error || (scaleHint && !inRange && draftScore.trim() !== "" ? `This plan scores ${scaleHint}.` : "")}</span>
              <Button small variant="ghost" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
              <Button small variant="primary" type="submit" disabled={busy || !submittable}>Save override</Button>
            </div>
          </form>
        : <div class="record-action-row">
            <Button small disabled={busy} onClick={() => { setDraftScore(String(evaluation.override_score ?? evaluation.score ?? "")); setDraftComment(evaluation.override_comment ?? ""); setOpen(true); }}>{overridden ? "Edit override" : "Override score"}</Button>
            <span class="override-clear-slot">{overridden
              ? <Button small variant="ghost" disabled={busy} onClick={() => void onClear(evaluation)}>Clear override</Button>
              : <span class="override-clear-placeholder" aria-hidden="true" />}</span>
          </div>}
    </div>}
  </div>;
}

export function SubmissionRecordPage({ eventId, submissionId, navigate }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAbstract, setDraftAbstract] = useState("");
  const [contentConfirming, setContentConfirming] = useState(false);
  const [selectedReviewers, setSelectedReviewers] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState({ starts_at: "", duration_min: "30", room_id: "", track_id: "" });
  const [publicationRequest, setPublicationRequest] = useState<"publish" | "unpublish" | null>(null);
  const [decisionRequest, setDecisionRequest] = useState<"approve" | "maybe" | "deny" | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [messageRecipientId, setMessageRecipientId] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messageError, setMessageError] = useState("");
  const [messageNotice, setMessageNotice] = useState("");
  const [resendNotice, setResendNotice] = useState("");
  const [overrideError, setOverrideError] = useState("");
  const [participantMode, setParticipantMode] = useState<"existing" | "new">("existing");
  const [participantRole, setParticipantRole] = useState<string>("co_speaker");
  const [participantQuery, setParticipantQuery] = useState("");
  const [participantResults, setParticipantResults] = useState<SearchResult[]>([]);
  const [participantSearchState, setParticipantSearchState] = useState<"idle" | "loading" | "error">("idle");
  const [selectedParticipant, setSelectedParticipant] = useState<SearchResult | null>(null);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantEmail, setNewParticipantEmail] = useState("");
  const [participantError, setParticipantError] = useState("");
  const [actionError, setActionError] = useState<{ action: string; message: string } | null>(null);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    apiFetch<RecordData>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}`, { signal: controller.signal, route: SUBMISSION_ROUTE })
      .then((record) => { setSchedule((current) => ({ ...current, room_id: current.room_id || "", track_id: current.track_id || record.tracks.find((track) => track.is_primary)?.id || "" })); setDraftTitle(record.title); setDraftAbstract(record.abstract ?? ""); setMessageRecipientId((current) => current || record.participants.find((participant) => participant.role !== "submitter")?.id || record.participants[0]?.id || ""); setMessageSubject((current) => current || `A note about ${record.title}`); setMessageBody((current) => current || "Hi {{speaker.first_name}},\n\n"); setState({ kind: "ready", record }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", message: errorSummary(error), notFound: isNotFound(error) }); });
    return () => controller.abort();
  }, [eventId, submissionId, reloadKey]);

  /** The create screen's picker, on the record: same search, same debounce. */
  useEffect(() => {
    const query = participantQuery.trim();
    if (participantMode !== "existing" || selectedParticipant || query.length < 2) {
      setParticipantResults([]);
      setParticipantSearchState("idle");
      return;
    }
    const controller = new AbortController();
    setParticipantSearchState("loading");
    const timer = window.setTimeout(() => {
      apiFetch<{ data: SearchResult[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/search?q=${encodeURIComponent(query)}`, { signal: controller.signal, route: SEARCH_ROUTE })
        .then((payload) => {
          if (controller.signal.aborted) return;
          setParticipantResults(payload.data.filter((result) => result.type === "Speaker"));
          setParticipantSearchState("idle");
        })
        .catch(() => { if (!controller.signal.aborted) setParticipantSearchState("error"); });
    }, 160);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [eventId, participantMode, participantQuery, selectedParticipant]);

  /**
   * Participant writes report inline, not through `act`.
   *
   * `act` replaces the whole record with an error screen, which is right for a
   * decision that failed and wrong here: "that address is already on this
   * record" must not cost the organizer the record they were reading.
   */
  const participantWrite = async (name: string, path: string, init: RequestInit, route: string) => {
    setBusy(name);
    setParticipantError("");
    try {
      await apiFetch<unknown>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, route });
      reload();
      return true;
    } catch (error: unknown) {
      setParticipantError(errorSummary(error));
      return false;
    } finally { setBusy(""); }
  };

  const addParticipant = async (event: Event) => {
    event.preventDefault();
    if (participantMode === "existing" && !selectedParticipant) { setParticipantError("Choose a person from the list, or add a new person."); return; }
    if (participantMode === "new" && (!newParticipantName.trim() || !newParticipantEmail.trim())) { setParticipantError("A new participant needs a name and an email address."); return; }
    const person = participantMode === "existing"
      ? { person_id: selectedParticipant!.id }
      : { name: newParticipantName.trim(), email: newParticipantEmail.trim() };
    const added = await participantWrite("add-participant", "/participants", { method: "POST", body: JSON.stringify({ ...person, role: participantRole }) }, PARTICIPANTS_ROUTE);
    if (!added) return;
    setSelectedParticipant(null);
    setParticipantQuery("");
    setNewParticipantName("");
    setNewParticipantEmail("");
  };

  const removeParticipant = async (participationId: string) => {
    await participantWrite(`remove-participant-${participationId}`, `/participants/${encodeURIComponent(participationId)}`, { method: "DELETE" }, PARTICIPANT_DELETE_ROUTE);
  };

  /**
   * A read that fails means the record cannot be shown. A write that is refused
   * means the record is fine and one action was declined — and the server's
   * refusals here are hand-written sentences an organizer can act on ("That
   * change would leave the program in a state it cannot review from"). Sending
   * both down the same path replaced the whole record with a full-page error
   * card the moment a guardrail did its job, so a correct refusal read as the
   * record being gone. Recoverable refusals now answer beside the control that
   * asked; everything else still takes the page, because then it is true.
   */
  const act = async (name: string, path: string, init: RequestInit = {}, route = SUBMISSION_ROUTE) => {
    setBusy(name);
    setActionError(null);
    try {
      await apiFetch<unknown>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, route });
      reload();
    } catch (error: unknown) {
      if (isRefusal(error)) setActionError({ action: name, message: errorSummary(error) });
      else setState({ kind: "error", message: errorSummary(error), notFound: isNotFound(error) });
    } finally { setBusy(""); }
  };

  const changePublication = async (published: boolean) => {
    await act(
      published ? "publish" : "unpublish",
      published ? "/publish" : "/unpublish",
      { method: "POST" },
      published ? PUBLISH_ROUTE : UNPUBLISH_ROUTE,
    );
    setPublicationRequest(null);
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

  const resendDecision = async () => {
    setBusy("resend");
    setResendNotice("");
    try {
      const result = await apiFetch<{ outbox_inserted?: boolean }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/decision/resend`,
        { method: "POST", headers: { "content-type": "application/json" }, route: RESEND_ROUTE },
      );
      setResendNotice(result.outbox_inserted === false
        ? "That decision was already queued."
        : "Decision queued in the conference outbox.");
      reload();
    } catch (error: unknown) {
      setState({ kind: "error", message: errorSummary(error), notFound: isNotFound(error) });
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

  const overridePath = (evaluation: EvaluationEvidence): string =>
    `/../../rounds/${encodeURIComponent(evaluation.round_id)}/submissions/${encodeURIComponent(submissionId)}/evaluations/${encodeURIComponent(evaluation.id)}/override`;

  /**
   * The override is the one control on this page that submits a number the
   * operator typed, so it is the one whose failure is ordinary rather than
   * exceptional. It reports inline and leaves the record standing: `act` swaps
   * the whole page for "Record unavailable", which is the right answer for a
   * dead link and the wrong one for "that score is off the plan's scale".
   */
  const writeOverride = async (evaluation: EvaluationEvidence, init: RequestInit): Promise<boolean> => {
    setBusy(`override-${evaluation.id}`);
    setOverrideError("");
    try {
      await apiFetch<unknown>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${overridePath(evaluation)}`,
        { ...init, headers: { "content-type": "application/json" }, route: OVERRIDE_ROUTE },
      );
      reload();
      return true;
    } catch (error: unknown) {
      setOverrideError(errorSummary(error));
      return false;
    } finally { setBusy(""); }
  };

  const overrideScore = async (evaluation: EvaluationEvidence, score: number, comment: string): Promise<boolean> =>
    writeOverride(evaluation, { method: "PUT", body: JSON.stringify({ score, comment: comment.trim() || undefined }) });

  const clearOverride = async (evaluation: EvaluationEvidence): Promise<boolean> =>
    writeOverride(evaluation, { method: "DELETE" });

  /**
   * One editor, two doors. A Draft saves through the drafts endpoint, which
   * owns the form-answer semantics and the form-admin permission; everything
   * else saves through the content endpoint, which requires program:write.
   * Both write the same audited before/after row, so the history reads the
   * same either way.
   */
  const isDraftRecord = state.kind === "ready" && state.record.status === "draft";

  const saveContent = async (event: Event, confirmPublished: boolean) => {
    event.preventDefault();
    setContentConfirming(false);
    const payload: Record<string, unknown> = { title: draftTitle, abstract: draftAbstract || null };
    if (isDraftRecord) {
      await act("content", "", { method: "PATCH", body: JSON.stringify(payload) }, SUBMISSION_ROUTE);
      return;
    }
    if (confirmPublished) payload.confirm_published = true;
    await act("content", "/content", { method: "PATCH", body: JSON.stringify(payload) }, CONTENT_ROUTE);
  };

  /**
   * A restore onto a live Session changes the public site exactly as an edit
   * does, so it passes the same confirmation — and only after the panel has
   * said so. Hardcoding the flag here would waive, on the restore path, the
   * guard the editor takes two deliberate clicks to clear.
   */
  const restoreVersion = async (auditId: string, live: boolean) => {
    await act("restore", "/content/restore", {
      method: "POST",
      body: JSON.stringify({ audit_id: auditId, confirm_published: live }),
    }, CONTENT_RESTORE_ROUTE);
  };

  if (state.kind === "loading") return <div class="submission-record-page"><PageHeader title="Submission record" copy="Reading the complete conference record…" /><Card><CardBody><div class="record-state">Loading record…</div></CardBody></Card></div>;
  if (state.kind === "error") return <div class="submission-record-page"><PageHeader title="Submission record" copy={state.notFound ? "This record could not be found." : "This record could not be reached right now."} /><Card><CardBody><div class="record-state error"><strong>{state.notFound ? "Record not found" : "Record unavailable"}</strong><span>{state.message}</span><div class="record-action-row"><Button onClick={() => navigate("/submissions")}>Back to submissions</Button><Button variant="primary" onClick={reload}>Retry</Button></div></div></CardBody></Card></div>;
  const record = state.record;
  // Every round's rubric, so an evaluation's criteria_scores can be read back
  // as the questions the reviewer actually answered.
  const criteriaByRound = new Map(record.evaluation.rounds.map((round) => [round.id, round.criteria ?? []]));
  const speakerParticipant = record.participants.find((participant) => participant.role === "speaker")
    ?? record.participants.find((participant) => participant.role === "co_speaker")
    ?? record.participants.find((participant) => participant.role !== "submitter");
  const speakerRecordHref = speakerParticipant ? `/roster?person=${encodeURIComponent(speakerParticipant.person_id)}` : "/roster";
  // Publication lives on the agenda row, not the status: a scheduled Session
  // is still `accepted`. This is the only thing that decides whether saving
  // changes what attendees see, so it is what gates the confirm.
  const isLivePublicly = record.slot?.is_published === true;
  const publicationAction = isLivePublicly
    ? (record.actions.can_unpublish ? "unpublish" : null)
    : (record.actions.can_publish ? "publish" : null);
  // The one gate for BOTH the editor and the restore control. Offering a
  // restore on a record whose content the server refuses to write is the same
  // defect as offering the editor there — the ticket names it once, and it
  // applies to every control that reaches the content write path.
  // Server-computed: an editable status AND this caller's program:write grant.
  // Ops staff and form admins can READ this record, so a status-only test here
  // would hand them fields whose Save returns 403 and loses what they typed.
  // Server-computed, and deliberately two flags rather than one: the editor and
  // the restore go through different endpoints with different policies. Drafts
  // save through `patchDraft` (requireDraftRead — form admins included), while
  // restore has a single door that requires `program:write` at every status.
  // One shared answer would be wrong for somebody in either direction.
  const canEditContent = record.actions.can_edit_content;
  // Server-computed from the grant the participants routes enforce, for the
  // same reason the content editor is: a Remove button that returns 403 is a
  // dead end, and the people who can read this record are not the people who
  // can change who is on stage.
  const canEditParticipants = record.actions.can_edit_participants;
  return <div class="submission-record-page">
    <PageHeader title="Submission record" copy={`${record.id} · ${record.kind === "session" ? "Session" : "Abstract"} · ${record.origin} origin`} actions={<Chip tone={headerChipTone(record)}>{record.stage_label}</Chip>} />
    {/* An assignment refusal answers inside the evaluation panel; every other
        declined action answers here, where the record is still on screen. */}
    {actionError && !actionError.action.startsWith("assign-") && !actionError.action.startsWith("remove-")
      && <div class="record-refusal" role="alert"><strong>That action was not applied</strong><span>{actionError.message}</span></div>}
    <div class="record-layout">
      <div class="record-main stack">
        <Card><CardBody><div class="record-summary"><div><span class="eyebrow">Program record</span><h2>{record.title}</h2><p>{record.abstract || "—"}</p></div><div class="record-summary-meta"><Chip>{statusLabel(record.status)}</Chip><span class="tabular">{record.time_in_stage}</span><span>{record.bypass_evaluation ? "Evaluation bypassed" : "Evaluation required"}</span></div></div><div class="record-meta-grid"><span><small>Origin</small><strong>{statusLabel(record.origin)}</strong></span><span><small>Submitted</small><strong>{moment(record.submitted_at)}</strong></span><span><small>Format</small><strong>{record.format?.name ?? "—"}</strong></span><span><small>Wave</small><strong>{record.wave?.name ?? "—"}</strong></span><span><small>Routing rule</small><strong>{record.routing?.name ?? "—"}</strong></span></div>{record.slot && <div class="record-slot"><div class="record-slot-summary"><strong>{record.slot.day} · {record.slot.time} · {record.slot.room}</strong><span>{record.slot.building} · {record.slot.duration_min} min</span></div><div class="record-slot-publication"><Chip class="record-publication-chip" tone={record.slot.is_published ? "success" : "warning"}>{record.slot.is_published ? "Live on the public site" : "Not yet public"}</Chip><div class="record-publication-action" aria-live="polite">{publicationRequest ? <div class="record-publication-confirm" role="group" aria-labelledby="record-publication-confirm-title"><strong id="record-publication-confirm-title">{publicationRequest === "publish" ? "Publish this session?" : "Remove this session from the public site?"}</strong><span>{publicationRequest === "publish" ? "This Session's title, time, room, speakers, and description become public immediately." : "This Session disappears from the public agenda and embeds immediately."}</span><div class="record-publication-confirm-actions"><Button type="button" small variant={publicationRequest === "publish" ? "primary" : "danger"} disabled={Boolean(busy)} onClick={() => void changePublication(publicationRequest === "publish")}>{busy === publicationRequest ? (publicationRequest === "publish" ? "Publishing…" : "Removing…") : publicationRequest === "publish" ? "Publish this session" : "Remove from public site"}</Button><Button type="button" small variant="ghost" disabled={Boolean(busy)} onClick={() => setPublicationRequest(null)}>Cancel</Button></div></div> : publicationAction ? <Button type="button" small class="record-publication-trigger" variant={publicationAction === "publish" ? "primary" : "danger"} disabled={Boolean(busy)} onClick={() => setPublicationRequest(publicationAction)}>{publicationAction === "publish" ? "Publish this session" : "Remove from public site"}</Button> : <span class="record-publication-action-placeholder" aria-hidden="true" />}</div></div></div>}</CardBody></Card>
        {canEditContent && <Card><CardHeader title="Session content"><span class="subtle">{contentNote(record)}</span></CardHeader><CardBody><form class="record-draft-form" onSubmit={(event) => { event.preventDefault(); if (isLivePublicly && !contentConfirming) { setContentConfirming(true); return; } void saveContent(event, isLivePublicly); }}><label class="field"><span>Title</span><input required value={draftTitle} onInput={(event) => setDraftTitle(event.currentTarget.value)} /></label><label class="field"><span>Abstract</span><textarea rows={6} value={draftAbstract} onInput={(event) => setDraftAbstract(event.currentTarget.value)} /></label><div class="record-action-row"><Button variant="primary" type="submit" class="record-content-save" disabled={Boolean(busy)}>{busy === "content" ? "Saving…" : isLivePublicly && contentConfirming ? "Confirm public update" : "Save changes"}</Button><span class="subtle record-content-cue">{isLivePublicly && contentConfirming ? "This replaces what attendees see on the public agenda." : isDraftRecord ? "No submit action is available from this editor." : "Saved changes are recorded in the history below."}</span></div></form></CardBody></Card>}
        {record.actions.can_decide && <Card><CardHeader title="Record action"><span class={record.decisions.length > 0 ? "record-decision-cue" : "subtle"}>{decidedNote(record.decisions[0])}</span></CardHeader><CardBody><div class="record-action-row">{record.status !== "accepted" && <Button variant="primary" disabled={Boolean(busy)} onClick={() => { setDecisionRequest("approve"); setFeedbackDraft(""); }}>Accept</Button>}{record.status !== "waitlisted" && <Button disabled={Boolean(busy)} onClick={() => { setDecisionRequest("maybe"); setFeedbackDraft(""); }}>Maybe</Button>}{record.status !== "rejected" && <Button variant="danger" disabled={Boolean(busy)} onClick={() => { setDecisionRequest("deny"); setFeedbackDraft(""); }}>Reject</Button>}<span class="subtle">Feedback (optional) is saved with the decision; accepted and rejected decisions also include it in the speaker email.</span></div></CardBody></Card>}
        {decisionRequest && <div class="record-decision-dialog" role="group" aria-labelledby="record-decision-heading"><div class="record-decision-dialog-head"><div><span class="eyebrow">Confirm record action</span><h2 id="record-decision-heading">{decisionRequest === "approve" ? "Accept this submission?" : decisionRequest === "maybe" ? "Waitlist this submission?" : "Reject this submission?"}</h2></div><button type="button" aria-label="Close decision dialog" onClick={() => setDecisionRequest(null)}>×</button></div><p>{decisionRequest === "maybe" ? "A waitlist does not send a message. Any feedback you add is saved with the decision." : "Feedback is optional. If you add it, the speaker will see the same words in the decision email."}</p><label class="field"><span>Feedback for the speaker (optional)</span><textarea rows={6} value={feedbackDraft} onInput={(event) => setFeedbackDraft(event.currentTarget.value)} placeholder="Share context the speaker can act on." /></label><div class="record-action-row"><Button type="button" onClick={() => setDecisionRequest(null)}>Cancel</Button><Button type="button" variant={decisionRequest === "deny" ? "danger" : "primary"} disabled={Boolean(busy)} onClick={() => void decide()}>{busy ? "Saving…" : decisionRequest === "approve" ? "Accept and notify" : decisionRequest === "maybe" ? "Waitlist" : "Reject and notify"}</Button></div></div>}
        {record.decisions.length > 0 && <Card><CardHeader title="Decision history"><span class="tabular">{record.decisions.length}</span></CardHeader><CardBody><div class="record-decision-list">{record.decisions.map((decision) => <article class="record-decision" key={decision.id}><div class="record-decision-head"><strong>{decision.kind === "reversal" ? `Acceptance reversed · ${statusLabel(decision.resulting_status)}` : statusLabel(decision.resulting_status)}</strong><span>{decision.decided_by_name || "Conference team"} · {moment(decision.decided_at)}</span></div><p>{decision.note || decision.feedback_md || "No feedback recorded."}</p></article>)}</div></CardBody></Card>}
        {record.actions.can_resend_decision && <Card><CardHeader title="Decision delivery"><span class="subtle">The decision is already recorded.</span></CardHeader><CardBody><p class="record-delivery-copy">If the speaker did not receive this decision, correct the address on their speaker record, then send the decision again.</p><div class="record-action-row"><Button onClick={() => navigate(speakerRecordHref)}>Edit speaker address</Button><Button variant="primary" disabled={Boolean(busy)} onClick={() => void resendDecision()}>{busy === "resend" ? "Queueing…" : "Send decision again"}</Button></div>{resendNotice && <p class="record-inline-message notice" role="status">{resendNotice}</p>}</CardBody></Card>}
        {record.status === "accepted" && <AcceptanceReversalPanel eventId={eventId} submissionId={submissionId} onReversed={reload} />}
        {record.actions.can_schedule && <Card><CardHeader title="Working agenda"><span class="subtle">Place this Session on the private agenda.</span></CardHeader><CardBody><form class="record-schedule-form" onSubmit={(event) => { event.preventDefault(); void act("schedule", "/schedule", { method: "POST", body: JSON.stringify({ starts_at: new Date(schedule.starts_at).getTime(), duration_min: Number(schedule.duration_min), room_id: schedule.room_id, track_id: schedule.track_id || null }) }, SCHEDULE_ROUTE); }}><label class="field"><span>Starts at</span><input required type="datetime-local" value={schedule.starts_at} onInput={(event) => setSchedule({ ...schedule, starts_at: event.currentTarget.value })} /></label><label class="field"><span>Duration</span><input required type="number" min="1" value={schedule.duration_min} onInput={(event) => setSchedule({ ...schedule, duration_min: event.currentTarget.value })} /></label><label class="field"><span>Room ID</span><input required value={schedule.room_id} onInput={(event) => setSchedule({ ...schedule, room_id: event.currentTarget.value })} /></label><Button variant="primary" type="submit" disabled={Boolean(busy)}>Place on agenda</Button></form></CardBody></Card>}
        <Card><CardHeader title="Participants"><span class="tabular">{record.participants.length}</span></CardHeader><CardBody>
          <div class="record-participants">{record.participants.length ? record.participants.map((participant) => <div class="record-person" key={participant.id}><strong>{participant.name}</strong><span>{statusLabel(participant.role)} · {participant.company || "Company not provided"}</span><small>{participant.email}</small><div class="record-person-foot"><Chip tone={participant.confirmation_status === "confirmed" ? "success" : participant.confirmation_status === "declined" ? "alarm" : ""}>{participant.confirmation_status === "confirmed" ? "Role confirmed" : participant.confirmation_status === "declined" ? "Role declined" : "Role response pending"}</Chip>{canEditParticipants && participant.role !== "submitter" && <Button small variant="ghost" class="record-person-remove" disabled={Boolean(busy)} onClick={() => void removeParticipant(participant.id)}>Remove</Button>}</div></div>) : <div class="record-inline-empty">No participants are attached to this record yet.</div>}</div>
          {canEditParticipants && <form class="record-participant-add" onSubmit={(event) => void addParticipant(event)}>
            <fieldset class="record-person-picker" aria-describedby="record-participant-error">
              <legend>Add a participant</legend>
              <p class="field-note">A co-presenter who turns up after intake belongs on the record the same way the submitter does. Search people already on this conference, or add someone new.</p>
              <div class="record-picker-tabs" role="tablist" aria-label="Participant choice">
                <button type="button" role="tab" aria-selected={participantMode === "existing"} class={participantMode === "existing" ? "active" : ""} onClick={() => { setParticipantMode("existing"); setParticipantError(""); }}>Choose existing person</button>
                <button type="button" role="tab" aria-selected={participantMode === "new"} class={participantMode === "new" ? "active" : ""} onClick={() => { setParticipantMode("new"); setSelectedParticipant(null); setParticipantResults([]); setParticipantError(""); }}>Add new person</button>
              </div>
              {participantMode === "existing" && <div class="record-picker-body">
                {selectedParticipant ? <div class="record-selected-person"><span><strong>{selectedParticipant.title}</strong><small>{selectedParticipant.subtitle}</small></span><Button type="button" small onClick={() => { setSelectedParticipant(null); setParticipantQuery(""); }}>Change person</Button></div> : <>
                  <label class="sr-only" for="record-participant-search">Search people</label><input id="record-participant-search" value={participantQuery} onInput={(event) => { setParticipantQuery(event.currentTarget.value); setSelectedParticipant(null); setParticipantError(""); }} placeholder="Search people by name…" autoComplete="off" aria-controls="record-participant-results" />
                  <div id="record-participant-results" class="record-person-suggestions" role="listbox" aria-label="People search results">
                    {participantSearchState === "loading" && <span class="record-picker-placeholder">Searching people…</span>}
                    {participantSearchState === "error" && <span class="record-picker-placeholder error">People search unavailable. Try again.</span>}
                    {participantSearchState === "idle" && participantQuery.trim().length < 2 && <span class="record-picker-placeholder">Type at least 2 characters to search.</span>}
                    {participantSearchState === "idle" && participantQuery.trim().length >= 2 && participantResults.length === 0 && <span class="record-picker-placeholder">No matching people. Add a new person if this is a new contact.</span>}
                    {participantResults.map((person) => <button type="button" role="option" class="record-person-suggestion" key={person.id} onClick={() => { setSelectedParticipant(person); setParticipantQuery(person.title); setParticipantResults([]); setParticipantError(""); }}><strong>{person.title}</strong><small>{person.subtitle}</small></button>)}
                  </div>
                </>}
              </div>}
              {participantMode === "new" && <div class="record-new-person-grid">
                <label class="field"><span>Name</span><input value={newParticipantName} onInput={(event) => { setNewParticipantName(event.currentTarget.value); setParticipantError(""); }} placeholder="Full name" /></label>
                <label class="field"><span>Email</span><input type="email" value={newParticipantEmail} onInput={(event) => { setNewParticipantEmail(event.currentTarget.value); setParticipantError(""); }} placeholder="name@example.com" /></label>
              </div>}
              <div class="record-participant-actions">
                <label class="field"><span>Role</span><select aria-label="Participant role" value={participantRole} onChange={(event) => setParticipantRole(event.currentTarget.value)}>{ATTACHABLE_ROLES.map((role) => <option value={role} key={role}>{statusLabel(role)}</option>)}</select></label>
                <Button variant="primary" type="submit" disabled={Boolean(busy)}>{busy === "add-participant" ? "Adding…" : "Add participant"}</Button>
              </div>
              <span id="record-participant-error" class={`record-inline-message ${participantError ? "error" : ""}`} role={participantError ? "alert" : undefined}>{participantError || " "}</span>
            </fieldset>
          </form>}
        </CardBody></Card>
        <Card><CardHeader title="Message participant"><span class="subtle">Logged on this record · demo-safe</span></CardHeader><CardBody><form class="record-message-form" onSubmit={(event) => void sendMessage(event)}><label class="field"><span>Recipient and role</span><select value={messageRecipientId} onChange={(event) => setMessageRecipientId(event.currentTarget.value)}>{record.participants.map((participant) => <option value={participant.id} key={participant.id}>{participant.name} · {statusLabel(participant.role)}</option>)}</select></label><label class="field"><span>Subject</span><input required value={messageSubject} onInput={(event) => setMessageSubject(event.currentTarget.value)} /></label><label class="field"><span>Message</span><textarea required rows={5} value={messageBody} onInput={(event) => setMessageBody(event.currentTarget.value)} /><small>Use the shared merge fields, such as <code>{"{{speaker.first_name}}"}</code> and <code>{"{{submission.title}}"}</code>.</small></label><div class="record-action-row"><span class={`record-inline-message ${messageError ? "error" : messageNotice ? "notice" : ""}`}>{messageError || messageNotice}</span><Button variant="primary" type="submit" disabled={Boolean(busy)}>{busy === "message" ? "Queueing…" : "Queue message"}</Button></div></form></CardBody></Card>
        <Card><CardHeader title="Answers and evaluation evidence" /><CardBody><div class="record-answer-list">{record.answers.length ? record.answers.map((answer) => <div class="record-answer" key={answer.id}><small>{answer.label || answer.key || answer.field_id}</small>{answer.file ? <FileAnswer label={answer.label || answer.key || "File"} file={answer.file} /> : <strong>{answerText(answer)}</strong>}</div>) : <span class="subtle">No form answers recorded.</span>}{record.evaluations.map((evaluation, index) => <EvaluationEvidenceRow key={`${evaluation.id}-${index}`} evaluation={evaluation} criteria={criteriaByRound.get(evaluation.round_id) ?? []} canOverride={record.actions.can_override_scores} busy={Boolean(busy)} onOverride={overrideScore} onClear={clearOverride} error={busy === `override-${evaluation.id}` ? "" : overrideError} />)}{record.comparisons.map((comparison, index) => <div class="record-answer" key={`${comparison.round_id}-${comparison.reviewer_name}-${index}`}><small>{comparison.round_name} · Comparison · <ReviewerName name={comparison.reviewer_name} kind={comparison.reviewer_kind} /></small><strong>{comparison.submission_ids.length} cards ranked</strong><span>{JSON.stringify(comparison.ranking)}</span></div>)}</div></CardBody></Card>
        <Card><CardHeader title="History"><span class="subtle">Every change, who made it, and when.</span></CardHeader><CardBody><ContentHistory entries={record.history} onRestore={record.actions.can_restore_content ? ((entryId) => void restoreVersion(entryId, isLivePublicly)) : undefined} busy={Boolean(busy)} label={statusLabel} moment={moment} livePublicly={isLivePublicly} /></CardBody></Card>
      </div>
      <aside class="record-aside stack">
        <Card><CardHeader title="Tracks" /><CardBody><div class="track-chips">{record.tracks.length ? record.tracks.map((track) => <Chip key={track.id}>{track.name}{track.is_primary ? " · Primary" : ""}</Chip>) : <span class="subtle">No tracks assigned</span>}</div></CardBody></Card>
        <Card><CardHeader title="Evaluation panel"><span class="subtle">Current reviewers · coverage</span></CardHeader><CardBody><div class="record-rounds">{record.evaluation.rounds.length ? record.evaluation.rounds.map((round) => <section class="record-round" key={round.id}>
          <div class="record-round-head"><strong>{round.name}</strong><span class="tabular">{round.mode === "comparison" ? "Comparison" : "Scorecard"} · target {round.target_reviews_per_submission}</span></div>
          {round.evaluations.filter((evaluation) => !evaluation.abstained).length > 0 && <div class="record-round-evidence"><small>{round.evaluations.filter((evaluation) => !evaluation.abstained).length} scorecard result{round.evaluations.filter((evaluation) => !evaluation.abstained).length === 1 ? "" : "s"}</small></div>}
          {round.evaluations.some((evaluation) => evaluation.abstained) && <div class="record-round-evidence"><small>{round.evaluations.filter((evaluation) => evaluation.abstained).length} conflict{round.evaluations.filter((evaluation) => evaluation.abstained).length === 1 ? "" : "s"} declared</small></div>}
          {round.comparisons.length > 0 && <div class="record-round-evidence"><small>{round.comparisons.length} comparison result{round.comparisons.length === 1 ? "" : "s"}</small></div>}
          {round.reviewers.map((assignment) => <div class="record-assignment" key={assignment.assignment_id}><span><strong><ReviewerName name={assignment.reviewer_name} kind={assignment.reviewer_kind} /></strong><small>{assignment.coverage.reviewed}/{assignment.coverage.assigned} reviewed</small></span><Button small variant="ghost" disabled={Boolean(busy)} onClick={() => void removeAssignment(round.id, assignment.assignment_id)}>Remove</Button></div>)}
          <div class="record-assignment-add"><div class="record-assignment-picker"><select aria-label={`Assign reviewer for ${round.name}`} value={selectedReviewers[round.id] ?? ""} onChange={(event) => setSelectedReviewers({ ...selectedReviewers, [round.id]: event.currentTarget.value })}><option value="">Assign reviewer…</option>{record.evaluation.reviewer_options.map((reviewer) => <option value={reviewer.id}>{reviewer.name}{reviewer.kind === "agent" ? " · Agent" : ""}</option>)}</select>{record.evaluation.reviewer_options.find((reviewer) => reviewer.id === selectedReviewers[round.id])?.kind === "agent" && <Chip class="assignment-agent-chip">Agent</Chip>}</div><Button small disabled={!selectedReviewers[round.id] || Boolean(busy)} onClick={() => void assign(round.id)}>Assign</Button></div>{/* The refusal answers beside the control that asked, and the record stays on screen. */}<span class={`record-inline-message ${actionError && (actionError.action === `assign-${round.id}` || actionError.action.startsWith("remove-")) ? "error" : ""}`} role={actionError && (actionError.action === `assign-${round.id}` || actionError.action.startsWith("remove-")) ? "alert" : undefined}>{actionError && (actionError.action === `assign-${round.id}` || actionError.action.startsWith("remove-")) ? actionError.message : " "}</span>
        </section>) : <span class="subtle">No evaluation rounds configured</span>}</div></CardBody></Card>
      </aside>
    </div>
  </div>;
}
