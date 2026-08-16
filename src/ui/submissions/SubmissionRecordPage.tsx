import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type { DecisionPlanResponse } from "../../api/decision-plan";
import { formatFileSize, type FileAnswerView } from "../../lib/file-answers";
import { eventTimeLabel, localDateTimeToInstant } from "../../lib/event-time";
import { isVisibleToAudience } from "../../lib/participants";
import { apiFetch, errorSummary, MarqueeApiError } from "../shell/api-client";
import { idempotencyKeyForCompose } from "../shell/compose-idempotency";
import { AgentBriefLauncher } from "../shell/AgentBrief";
import { Button, Card, CardBody, CardHeader, Chip, PageHeader, ReviewerName } from "../shell/components";
import { disambiguatedNames } from "../../lib/duplicate-names";
import { useEventContext } from "../shell/event-context";
import { AcceptanceReversalPanel } from "./AcceptanceReversalPanel";
import { DecisionPlanPanel } from "./DecisionPlanPanel";
import { ContentHistory } from "../history/ContentHistory";
import { groupParticipants, type Participant } from "./participant-groups";
import { decidedNote, headerChipTone, historyMoment, lastSendLine, moment, sendMoment, sendMomentFor, sendOutcome, statusLabel, type DecisionSend } from "./record-copy";
import "./record.css";
import "./submissions.css";

const SUBMISSION_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}";
const DECISION_PLAN_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/decision-plan";
const DECISION_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/decision";
const RESEND_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/decision/resend";
const CALENDAR_INVITES_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/invites";
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
const ROUTING_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/routing";
const TRACKS_ROUTE = "/api/v1/events/{eventId}/tracks";
const TAGS_ROUTE = "/api/v1/events/{eventId}/tags";
const LEVELS_ROUTE = "/api/v1/events/{eventId}/levels";
const SEARCH_ROUTE = "/api/v1/events/{eventId}/search";
const TIMELINE_ROUTE = "/api/v1/events/{eventId}/submissions/{submissionId}/timeline";
const NOTES_ROUTE = "/api/v1/submissions/{submissionId}/notes";
const NOTES_CARD_GRID_ROWS = "220px 126px";
const NOTES_CONTENT_VIEWPORT = "220px";

export interface SubmissionScheduleDraft {
  starts_at: string;
  duration_min: string;
  room_id: string;
  track_id: string;
}

/** Build the schedule write from the conference wall clock, never the browser clock. */
export function submissionScheduleRequest(
  draft: SubmissionScheduleDraft,
  timezone: string,
): { path: string; init: RequestInit; route: string } | null {
  const startsAt = localDateTimeToInstant(draft.starts_at, timezone);
  if (startsAt === null) return null;
  return {
    path: "/schedule",
    route: SCHEDULE_ROUTE,
    init: {
      method: "POST",
      body: JSON.stringify({
        starts_at: startsAt,
        duration_min: Number(draft.duration_min),
        room_id: draft.room_id,
        track_id: draft.track_id || null,
      }),
    },
  };
}

/**
 * The roles an organizer attaches after intake, in the order a program team
 * reaches for them. `submitter` is not offered: a record has exactly one and it
 * is settled at intake — the server refuses it too, so offering it here would
 * be a control whose only outcome is an error.
 */
const ATTACHABLE_ROLES = ["co_speaker", "speaker", "moderator", "chairperson", "sponsor_contact"] as const;


interface SearchResult { type: string; id: string; title: string; subtitle: string; }
interface Reviewer { id: string; name: string; kind: "human" | "agent"; company: string | null; track_ids: string[]; }
interface Assignment { assignment_id: string; reviewer_person_id: string; reviewer_name: string; reviewer_kind: "human" | "agent"; status: string; coverage: { assigned: number; reviewed: number }; }
/**
 * One recorded scorecard, plus the chair's override of it when there is one.
 * The reviewer's own score and reasoning are always present: an override
 * supersedes a judgment on the record, it does not erase it.
 */
export interface EvaluationEvidence {
  abstained: boolean;
  id: string;
  round_id: string;
  round_name: string;
  reviewer_person_id: string;
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
export type EvaluationPanelEvaluation = Pick<EvaluationEvidence,
  "abstained" | "id" | "reviewer_person_id" | "reviewer_name" | "reviewer_kind" | "recommendation" | "score" | "comment"
  | "criteria_scores" | "override_score" | "override_comment" | "override_person_name"
>;
interface Round { id: string; name: string; mode: "scorecard" | "comparison"; position: number; target_reviews_per_submission: number; plan_status: string; criteria: RubricCriterion[]; reviewers: Assignment[]; evaluations: EvaluationPanelEvaluation[]; comparisons: Array<{ ranking: unknown; submission_ids: string[]; reviewer_person_id: string; reviewer_name: string; reviewer_kind: "human" | "agent" }>; }
interface RecordData {
  id: string; reference_code: string | null; event_id: string; event_name: string; kind: "abstract" | "session"; title: string; abstract: string | null;
  status: string; stage: string; stage_label: string; bypass_evaluation: boolean; origin: string; vendor_affiliation: string;
  submitter_person_id: string; submitted_at: number | null; last_saved_at: number | null; updated_at: number; time_in_stage: string;
  is_published: boolean;
  publication?: { classification: string; observed_state: string | null; primary_reason_code: string; reason_codes: string[]; reason_details: Record<string, unknown>; observed_revision: { submission_updated_at: number; agenda_updated_at: number | null } | null; anomaly: "rejected" | "withdrawn" | null };
  slot: { day: string; time: string; room: string; building: string; duration_min: number; is_published: boolean } | null;
  format: { id: string; name: string | null } | null; wave: { id: string; name: string | null } | null;
  primary_track_id: string | null;
  level: { id: string; name: string | null; deleted_at: number | null } | null;
  tags: Array<{ id: string; name: string; name_key?: string; deleted_at: number | null }>;
  routing: { rule_id: string; name: string } | null;
  tracks: Array<{ id: string; name: string; color: string | null; deleted_at: number | null; is_primary: boolean }>;
  participants: Participant[]; answers: Array<{ id: string; field_id: string; label: string | null; key: string | null; type: string | null; value_text: string | null; value_json: unknown; deleted_at?: number | null; file: FileAnswerView | null }>;
  decisions: Array<{ id: string; kind?: "decision" | "reversal"; decision: string; resulting_status: string; feedback_md: string | null; note?: string | null; decided_at: number; decided_by_name: string | null }>;
  /** Who a decision mail goes to today, decided by the sender's own rule. */
  decision_recipient: { person_id: string; name: string; email: string } | null;
  /** Every decision mail this record has produced, newest first. */
  decision_sends: Array<DecisionSend & { id: string; kind: "accepted" | "rejected" }>;
  evaluations: EvaluationEvidence[];
  comparisons: Array<{ round_id: string; round_name: string; reviewer_person_id: string; reviewer_name: string; reviewer_kind: "human" | "agent"; ranking: unknown; submission_ids: string[] }>;
  evaluation: { rounds: Round[]; reviewer_options: Reviewer[] };
  history: TimelineEntry[];
  /** Everything the timeline holds, so the card knows whether there is more. */
  history_total: number;
  history_next_cursor: string | null;
  history_has_more: boolean;
  actions: { can_decide: boolean; can_schedule: boolean; can_publish: boolean; can_unpublish: boolean; can_edit_content: boolean; can_restore_content: boolean; can_resend_decision: boolean; can_send_calendar_invite: boolean; can_edit_participants: boolean; can_edit_routing: boolean; can_override_scores: boolean; can_view_notes: boolean };
}

export interface SubmissionNote {
  id: string;
  submission_id: string;
  body: string;
  author_person_id: string;
  author_name: string;
  created_at: number;
}

export type SubmissionNotesState = "loading" | "ready" | "error";

export function SubmissionNotesBody({
  state,
  notes,
  error,
  onRetry,
}: {
  state: SubmissionNotesState;
  notes: SubmissionNote[];
  error: string;
  onRetry?: () => void;
}): JSX.Element {
  if (state === "loading") {
    return <div class="record-notes-state"><span class="subtle">Loading internal notes…</span></div>;
  }
  if (state === "error") {
    return <div class="record-notes-state"><span class="record-notes-error" role="alert">{error}</span>{onRetry && <Button small onClick={onRetry}>Try notes again</Button>}</div>;
  }
  if (notes.length === 0) {
    return <div class="record-notes-state"><strong>No internal notes yet.</strong><small>Staff context only; never sent to speakers or outbound mail.</small></div>;
  }
  return <ol class="record-notes-list">{notes.map((note) => <li class="record-note" key={note.id}>
    <div class="record-note-head"><strong>{note.author_name}</strong><span>{moment(note.created_at)}</span></div>
    <p>{note.body}</p>
  </li>)}</ol>;
}

export function SubmissionNotesCardBody({
  state,
  notes,
  error,
  onRetry,
  compose,
}: {
  state: SubmissionNotesState;
  notes: SubmissionNote[];
  error: string;
  onRetry?: () => void;
  compose: JSX.Element;
}): JSX.Element {
  return <div class="record-notes-card-body" style={{ gridTemplateRows: NOTES_CARD_GRID_ROWS }}>
    <div class="record-notes-content" style={{ height: NOTES_CONTENT_VIEWPORT, maxHeight: NOTES_CONTENT_VIEWPORT, minHeight: NOTES_CONTENT_VIEWPORT, overflowY: "auto" }}><SubmissionNotesBody state={state} notes={notes} error={error} onRetry={onRetry} /></div>
    {compose}
  </div>;
}

export function EvaluationEmptyState({ navigate }: { navigate: (target: string) => void }): JSX.Element {
  return <div class="record-evaluation-empty">
    <span class="subtle">No evaluation rounds configured.</span>
    <Button small variant="primary" onClick={() => navigate("/evaluation")}>Set up evaluation</Button>
  </div>;
}

/**
 * Lens three of MRQ-211. `summary` and `detail` are composed on the server from
 * the same `audit_log` row the organization log and the person's feed read, so
 * one moment cannot be described three ways by three surfaces.
 */
interface TimelineEntry {
  id: string;
  action: string;
  summary: string;
  detail: string | null;
  actor_kind: string | null;
  actor_name: string | null;
  created_at: number;
  before: unknown;
  after: unknown;
  restorable: boolean;
}

interface TimelinePage { data: TimelineEntry[]; page: number; total: number; total_pages: number; next_cursor: string | null; has_more: boolean }

interface Props { eventId: string; submissionId: string; navigate: (target: string) => void; }

type LoadState = { kind: "loading" } | { kind: "error"; message: string; notFound: boolean } | { kind: "ready"; record: RecordData };

/**
 * Which value an editable field should hold after the record reloads.
 *
 * `reload()` runs after every successful write on this page — assigning a
 * reviewer, publishing, deciding, resending, overriding a score, editing
 * participants — and it reseeded the content editor from the server every time.
 * An organizer part-way through a long abstract lost it to any of those, with
 * no failure and no message: the eval only caught the failed-save route, but
 * there were eight.
 *
 * The signal is whether the operator has TOUCHED the field, not whether its
 * text currently differs from the server's. Comparing text loses the one case
 * that matters most: type something, save, then think better of it and put the
 * original back while the save is still in flight — the field matches the old
 * baseline again, so an equality test calls it untouched and replaces a
 * deliberate undo with the value being saved. An edit is an edit even when it
 * lands back where it started.
 */
export function adoptServerValue(edited: boolean, current: string, incoming: string): string {
  return edited ? current : incoming;
}

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

export interface SubmissionActionError {
  action: string;
  message: string;
  kind?: "missing-decision-email";
}

export type SubmissionWriteFailure =
  | { kind: "refusal"; actionError: SubmissionActionError }
  | { kind: "page"; state: Extract<LoadState, { kind: "error" }> };

export function isMissingDecisionEmail(error: unknown): boolean {
  return error instanceof MarqueeApiError
    && error.code === "unprocessable"
    && /no valid email address/i.test(error.message);
}

export function submissionWriteFailure(error: unknown, action: string): SubmissionWriteFailure {
  if (isRefusal(error)) {
    return {
      kind: "refusal",
      actionError: {
        action,
        message: errorSummary(error),
        ...(action === "approve" || action === "deny") && isMissingDecisionEmail(error) ? { kind: "missing-decision-email" } : {},
      },
    };
  }
  return {
    kind: "page",
    state: { kind: "error", message: errorSummary(error), notFound: isNotFound(error) },
  };
}

export function DecisionEmailRecovery({ speakerName, onOpen }: { speakerName: string; onOpen: () => void }): JSX.Element {
  return <>
    <span>No usable email address is on file for {speakerName}. Add one before sending this decision.</span>
    <Button small onClick={onOpen}>Open speaker record</Button>
  </>;
}

type DecisionRecommendation = "approve" | "maybe" | "deny";

function isDecisionPlanConflict(error: unknown): boolean {
  if (!(error instanceof MarqueeApiError) || error.code !== "conflict") return false;
  const details = error.details;
  return Boolean(details && typeof details === "object" && "code" in details
    && ((details as { code?: unknown }).code === "stale_plan" || (details as { code?: unknown }).code === "stale_queue_revision"));
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

/** The public agenda names speaking roles, not a submitter-only record. */
export function hasPublicSpeakingParticipant(
  participants: readonly Pick<Participant, "role">[],
): boolean {
  return participants.some((participant) => isVisibleToAudience(participant.role, "public"));
}

export interface PublicationConfirmationProps {
  publicationRequest: "publish" | "unpublish";
  hasSpeakingParticipant: boolean;
  busy: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The confirmation is its own rendered seam so the warning cannot be tested as source trivia. */
export function PublicationConfirmation({
  publicationRequest,
  hasSpeakingParticipant,
  busy,
  onConfirm,
  onCancel,
}: PublicationConfirmationProps): JSX.Element {
  const publishing = publicationRequest === "publish";
  return <div class="record-publication-confirm" role="group" aria-labelledby="record-publication-confirm-title">
    <strong id="record-publication-confirm-title">{publishing ? "Publish this session?" : "Remove this session from the public site?"}</strong>
    <span>{publishing ? "This Session's title, time, room, speakers, and description become public immediately." : "This Session disappears from the public agenda and embeds immediately."}</span>
    {publishing && !hasSpeakingParticipant && <span class="record-publication-warning" role="alert">No speaking participant is attached. The public agenda will show “Speaker to be announced”. Add a speaker before publishing.</span>}
    <div class="record-publication-confirm-actions">
      <Button type="button" small variant={publishing ? "primary" : "danger"} disabled={Boolean(busy)} onClick={onConfirm}>
        {busy === publicationRequest ? (publishing ? "Publishing…" : "Removing…") : publishing ? "Publish this session" : "Remove from public site"}
      </Button>
      <Button type="button" small variant="ghost" disabled={Boolean(busy)} onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
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

function participantConfirmationLabel(status: Participant["confirmation_status"]): string {
  if (status === "confirmed") return "Role confirmed";
  if (status === "declined") return "Role declined";
  return "Role response pending";
}

function participantConfirmationTone(status: Participant["confirmation_status"]): "success" | "alarm" | "" {
  if (status === "confirmed") return "success";
  if (status === "declined") return "alarm";
  return "";
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

/**
 * The panel is the organizer's decision surface, so a scorecard result cannot
 * stop at a count. Keep the reviewer's rating and words in one stable result
 * row, with the chair's override in its own explicitly labelled block.
 *
 * The comment body and its action each have reserved space. Expanding a long
 * comment makes that body scrollable inside the slot instead of moving the
 * assignment controls or the rest of the record underneath the operator.
 *
 * A reviewer answers two separate things: the scorecard the round defines, and
 * the free-text note beside it. Both reach this panel, each named for where it
 * came from rather than for what a chair might wish it were.
 *
 * That note is headed "Note beside the scorecard" — a description of the field,
 * not of its author, because `evaluations.comment` has more than one writer. A
 * human types it into a control their own UI calls "Committee note (optional)";
 * an agent evaluator is told to put its rationale there (`marquee review
 * submit --comment`); a Sessionize import maps "Reviewer Comment", "feedback",
 * and "review notes" into the same column. Any label naming one of those three
 * is false for the other two. What is true of all of them is that the text did
 * not come from the rubric — which is exactly the thing a chair was getting
 * wrong.
 *
 * Nothing here is a verdict. Acceptance is the organizer's own Accept/Reject
 * action on the record; every field in this panel is information for that human
 * judge. So the reviewer's recommendation and a Recommendation criterion on the
 * scorecard may legitimately disagree, and the panel shows both plainly rather
 * than resolving them — there is no precedence rule to read here, because there
 * is none to have.
 */
export function EvaluationPanelResult({ evaluation, criteria = [], displayName }: { evaluation: EvaluationPanelEvaluation; criteria?: RubricCriterion[]; displayName?: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // The free-text note beside the scorecard, whoever wrote it — not the
  // reviewer's answer to the rubric, which renders below under its own
  // criterion name.
  const committeeNote = evaluation.comment.trim();
  const isLongNote = !evaluation.abstained && committeeNote.length > 120;
  const hasOverride = evaluation.override_score !== null || Boolean(evaluation.override_comment?.trim());
  const noteId = `evaluation-panel-comment-${evaluation.id}`;

  return <article class="record-round-result" data-evaluation-panel-result={evaluation.id}>
    <div class="record-round-result-head">
      <strong><ReviewerName name={displayName ?? evaluation.reviewer_name} kind={evaluation.reviewer_kind} /></strong>
      <span class="evaluation-panel-override-slot">{hasOverride
        ? <Chip tone="warning" class="override-chip">Override</Chip>
        : <span class="evaluation-panel-override-slot-placeholder" aria-hidden="true" />}</span>
    </div>
    <div class="evaluation-panel-rating">
      <small>{evaluation.abstained ? "Reviewer outcome" : "Reviewer rating"}</small>
      <strong class="tabular">{evaluation.abstained ? "Conflict declared" : scoreText(evaluation.score)}</strong>
    </div>
    {/* Its own labelled line rather than a suffix on the rating: printed bare
        beside the score it read as the recommendation, when it is one reviewer's
        input among several and may disagree with the scorecard's own. The row is
        always here, "—" and all, so nothing below it moves. */}
    <div class="evaluation-panel-recommendation" data-evaluation-panel-recommendation="true">
      <small>Reviewer's own recommendation</small>
      <strong>{evaluation.abstained ? "—" : evaluation.recommendation || "None recorded"}</strong>
    </div>
    <div class="evaluation-panel-comment-slot">
      <small>Note beside the scorecard</small>
      <span id={noteId} class={`evaluation-panel-comment-body${expanded ? " expanded" : ""}`}>
        {evaluation.abstained ? "Reviewer recused; no recommendation recorded." : committeeNote || "—"}
      </span>
    </div>
    <div class="evaluation-panel-comment-action">
      {isLongNote
        ? <button type="button" aria-controls={noteId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Read full note"}</button>
        : <span class="evaluation-panel-comment-action-placeholder" aria-hidden="true" />}
    </div>
    {!evaluation.abstained && <ScorecardAnswers criteria={criteria} scores={evaluation.criteria_scores} />}
    {hasOverride && <div class="evaluation-panel-override" data-evaluation-panel-override="true">
      <small>Organizer override</small>
      <strong class="tabular">{scoreText(evaluation.override_score)}</strong>
      <span>{evaluation.override_comment?.trim() || "No override reason recorded."}</span>
    </div>}
  </article>;
}

function EvaluationEvidenceRow({ evaluation, displayName, criteria, canOverride, busy, error, onOverride, onClear }: {
  evaluation: EvaluationEvidence;
  /** The reviewer as this record prints them; two namesakes must be tellable apart. */
  displayName: string;
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
      {evaluation.round_name} · Scorecard · <ReviewerName name={displayName} kind={evaluation.reviewer_kind} />
      <span class="evaluation-override-slot">{overridden ? <Chip tone="warning" class="override-chip">Override</Chip> : <span class="override-chip-placeholder" aria-hidden="true" />}</span>
    </small>
    <strong class="tabular">{evaluation.abstained
      ? "Conflict declared"
      : `${scoreText(overridden ? evaluation.override_score : evaluation.score)} · ${evaluation.recommendation || "No recommendation"}`}</strong>
    <span>{evaluation.abstained ? "Reviewer recused; no recommendation recorded." : evaluation.comment || "—"}</span>
    {!evaluation.abstained && <ScorecardAnswers criteria={criteria} scores={evaluation.criteria_scores} />}
    {overridden && <span class="evaluation-superseded">
      Overridden by {evaluation.override_person_name || "a chair"} · {displayName} scored <span class="tabular">{scoreText(evaluation.score)}</span>
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
                aria-label={`Override score for ${displayName}`}
                onInput={(event) => setDraftScore(event.currentTarget.value)}
              />
            </label>
            <label class="field"><span>Why</span><input value={draftComment} aria-label={`Reason for overriding ${displayName}`} onInput={(event) => setDraftComment(event.currentTarget.value)} /></label>
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

interface RoutingOption {
  id: string;
  name: string;
  color?: string | null;
  deleted_at?: number | null;
}

function carriedRoutingOptions(active: RoutingOption[], carried: RoutingOption[]): RoutingOption[] {
  const byId = new Map(active.map((option) => [option.id, option]));
  for (const option of carried) if (!byId.has(option.id)) byId.set(option.id, option);
  return [...byId.values()];
}

/**
 * The record-side routing editor is a full replacement, not a second rule
 * evaluator. Deleted values already attached to the submission are carried
 * into the choices so loading and saving this form cannot silently discard
 * historical routing; a fresh deleted value still cannot be selected because
 * it never arrives from the active taxonomy endpoints.
 */
function SubmissionRoutingCard({ eventId, submissionId, record, busy, onSaved }: {
  eventId: string;
  submissionId: string;
  record: RecordData;
  busy: boolean;
  onSaved: () => void;
}): JSX.Element {
  const [tracks, setTracks] = useState<RoutingOption[]>([]);
  const [tags, setTags] = useState<RoutingOption[]>([]);
  const [levels, setLevels] = useState<RoutingOption[]>([]);
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [primaryTrackId, setPrimaryTrackId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [levelId, setLevelId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const currentTrackIds = record.tracks.map((track) => track.id);
    setTrackIds(currentTrackIds);
    setPrimaryTrackId(record.primary_track_id ?? record.tracks.find((track) => track.is_primary)?.id ?? currentTrackIds[0] ?? null);
    setTagIds(record.tags.map((tag) => tag.id));
    setLevelId(record.level?.id ?? "");
    setNotice("");
    setError("");
    if (!record.actions.can_edit_routing) return;

    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      apiFetch<{ data: RoutingOption[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/tracks`, { signal: controller.signal, route: TRACKS_ROUTE }),
      apiFetch<{ data: RoutingOption[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/tags`, { signal: controller.signal, route: TAGS_ROUTE }),
      apiFetch<{ data: RoutingOption[] }>(`/api/v1/events/${encodeURIComponent(eventId)}/levels`, { signal: controller.signal, route: LEVELS_ROUTE }),
    ]).then(([trackResponse, tagResponse, levelResponse]) => {
      if (controller.signal.aborted) return;
      setTracks(carriedRoutingOptions(trackResponse.data, record.tracks));
      setTags(carriedRoutingOptions(tagResponse.data, record.tags));
      setLevels(carriedRoutingOptions(levelResponse.data, record.level ? [{ id: record.level.id, name: record.level.name ?? "Archived level", deleted_at: record.level.deleted_at }] : []));
      setLoading(false);
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      setError(errorSummary(caught));
      setLoading(false);
    });
    return () => controller.abort();
  }, [eventId, record.id, record.updated_at, record.actions.can_edit_routing]);

  const toggleTrack = (id: string, checked: boolean) => {
    setTrackIds((current) => {
      const next = checked ? [...current, id] : current.filter((value) => value !== id);
      if (!checked && primaryTrackId === id) setPrimaryTrackId(next[0] ?? null);
      if (checked && primaryTrackId === null) setPrimaryTrackId(id);
      return next;
    });
  };

  const toggleTag = (id: string, checked: boolean) => {
    setTagIds((current) => checked ? [...current, id] : current.filter((value) => value !== id));
  };

  const save = async (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const selectedPrimary = primaryTrackId !== null && trackIds.includes(primaryTrackId) ? primaryTrackId : trackIds[0] ?? null;
    try {
      await apiFetch<{ data: unknown }>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/routing`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track_ids: trackIds, primary_track_id: selectedPrimary, tag_ids: tagIds, level_id: levelId || null }),
        route: ROUTING_ROUTE,
      });
      setPrimaryTrackId(selectedPrimary);
      setNotice("Routing saved.");
      onSaved();
    } catch (caught: unknown) {
      setError(errorSummary(caught));
    } finally {
      setSaving(false);
    }
  };

  if (!record.actions.can_edit_routing) return <></>;
  return <Card>
    <CardHeader title="Routing"><span class="subtle">{record.routing ? `Applied by ${record.routing.name}` : "Manual projection"}</span></CardHeader>
    <CardBody>
      <form class="record-routing-form" onSubmit={(event) => void save(event)}>
        <p class="subtle">Replace the submission's tracks, tags, and level. This is a manual projection and does not re-run public arrival rules.</p>
        <div class="record-routing-grid">
          <fieldset class="record-routing-fieldset">
            <legend>Tracks</legend>
            {loading ? <span class="subtle">Loading tracks…</span> : tracks.length === 0 ? <span class="subtle">No tracks configured.</span> : tracks.map((track) => <label class="record-routing-option" key={track.id}>
              <input type="checkbox" checked={trackIds.includes(track.id)} onChange={(event) => toggleTrack(track.id, event.currentTarget.checked)} />
              <span>{track.name}{track.deleted_at !== null && track.deleted_at !== undefined ? " · Archived" : ""}</span>
            </label>)}
            <label class="field"><span>Primary track</span><select value={primaryTrackId ?? ""} disabled={trackIds.length === 0} onChange={(event) => setPrimaryTrackId(event.currentTarget.value || null)}><option value="">No primary track</option>{tracks.filter((track) => trackIds.includes(track.id)).map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}</select></label>
          </fieldset>
          <fieldset class="record-routing-fieldset">
            <legend>Tags</legend>
            {loading ? <span class="subtle">Loading tags…</span> : tags.length === 0 ? <span class="subtle">No tags configured.</span> : tags.map((tag) => <label class="record-routing-option" key={tag.id}>
              <input type="checkbox" checked={tagIds.includes(tag.id)} onChange={(event) => toggleTag(tag.id, event.currentTarget.checked)} />
              <span>{tag.name}{tag.deleted_at !== null && tag.deleted_at !== undefined ? " · Archived" : ""}</span>
            </label>)}
          </fieldset>
          <label class="field"><span>Level</span><select value={levelId} onChange={(event) => setLevelId(event.currentTarget.value)}><option value="">No level</option>{levels.map((level) => <option value={level.id} key={level.id}>{level.name}{level.deleted_at !== null && level.deleted_at !== undefined ? " · Archived" : ""}</option>)}</select></label>
        </div>
        <div class="record-action-row"><Button variant="primary" type="submit" disabled={loading || saving || busy}>{saving ? "Saving…" : "Save routing"}</Button><span class={`record-inline-message ${error ? "error" : notice ? "notice" : ""}`} role={error ? "alert" : notice ? "status" : undefined}>{error || notice || " "}</span></div>
      </form>
    </CardBody>
  </Card>;
}

export function SubmissionRecordPage({ eventId, submissionId, navigate }: Props): JSX.Element {
  const { event } = useEventContext();
  const timezone = event?.timezone ?? null;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState("");
  const [referenceCopied, setReferenceCopied] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAbstract, setDraftAbstract] = useState("");
  const [contentError, setContentError] = useState("");
  /**
   * Keystrokes into the two content fields, and the count as of the last save
   * of them that landed. Edited means the two disagree.
   *
   * A boolean cleared on success loses the operator who keeps typing WHILE the
   * save is in flight: their keystrokes set the flag, the response clears it,
   * and the refresh then overwrites the newer text with what was sent. The
   * count taken at send is compared against the count now, so anything typed
   * after the request left still reads as edited.
   */
  const contentEdits = useRef(0);
  const contentSavedAtEdit = useRef(0);
  const [contentConfirming, setContentConfirming] = useState(false);
  const [selectedReviewers, setSelectedReviewers] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState({ starts_at: "", duration_min: "30", room_id: "", track_id: "" });
  const [publicationRequest, setPublicationRequest] = useState<"publish" | "unpublish" | null>(null);
  const [decisionRequest, setDecisionRequest] = useState<DecisionRecommendation | null>(null);
  const [decisionPlan, setDecisionPlan] = useState<DecisionPlanResponse | null>(null);
  const [decisionPlanLoading, setDecisionPlanLoading] = useState(false);
  const [decisionPlanError, setDecisionPlanError] = useState("");
  const [decisionPlanStale, setDecisionPlanStale] = useState(false);
  const [decisionPlanBusy, setDecisionPlanBusy] = useState(false);
  const [decisionConfirmPublished, setDecisionConfirmPublished] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState("");
  const decisionPlanRefreshTimerRef = useRef<number | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [decisionInternalNoteDraft, setDecisionInternalNoteDraft] = useState("");
  const [kindFeedbackBusy, setKindFeedbackBusy] = useState(false);
  const [kindFeedbackDrafted, setKindFeedbackDrafted] = useState(false);
  const [kindFeedbackNotice, setKindFeedbackNotice] = useState("");
  const [messageRecipientId, setMessageRecipientId] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const messageComposeIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [messageError, setMessageError] = useState("");
  const [messageNotice, setMessageNotice] = useState("");
  const [resendNotice, setResendNotice] = useState("");
  const [calendarInviteError, setCalendarInviteError] = useState("");
  const [calendarInviteNotice, setCalendarInviteNotice] = useState("");
  const [sendsOpen, setSendsOpen] = useState(false);
  const [overrideError, setOverrideError] = useState("");
  const [participantMode, setParticipantMode] = useState<"existing" | "new">("existing");
  const [participantRole, setParticipantRole] = useState<string>("co_speaker");
  const [participantQuery, setParticipantQuery] = useState("");
  const [participantResults, setParticipantResults] = useState<SearchResult[]>([]);
  const [participantSearchState, setParticipantSearchState] = useState<"idle" | "loading" | "error">("idle");
  // The label the row carried WHEN IT WAS CLICKED. Selecting clears the result
  // list that produced the marker, so re-deriving afterwards would drop
  // "Marcus Okafor (2)" back to plain in the line the organizer reads before
  // pressing Add.
  const [selectedParticipant, setSelectedParticipant] = useState<{ person: SearchResult; label: string } | null>(null);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantEmail, setNewParticipantEmail] = useState("");
  const [participantError, setParticipantError] = useState("");
  const [actionError, setActionError] = useState<SubmissionActionError | null>(null);
  const [notes, setNotes] = useState<SubmissionNote[]>([]);
  const [notesState, setNotesState] = useState<SubmissionNotesState>("loading");
  const [notesLoadError, setNotesLoadError] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesWriteError, setNotesWriteError] = useState("");
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesReloadKey, setNotesReloadKey] = useState(0);

  // The record opens with the newest page of its timeline; older pages are
  // fetched beside it and dropped whenever the record reloads, because a write
  // is exactly the moment the newest page changed.
  const [olderHistory, setOlderHistory] = useState<TimelineEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);

  useEffect(() => () => {
    if (decisionPlanRefreshTimerRef.current !== null) window.clearTimeout(decisionPlanRefreshTimerRef.current);
  }, []);

  const loadMoreHistory = async (): Promise<void> => {
    if (historyBusy || !historyHasMore || !historyNextCursor) return;
    setHistoryBusy(true);
    try {
      const next = await apiFetch<TimelinePage>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/timeline?page=${historyPage + 1}&cursor=${encodeURIComponent(historyNextCursor)}`,
        { route: TIMELINE_ROUTE },
      );
      // The cursor pins the prior page's last row. Newer writes cannot move
      // this boundary, so the returned page can be appended as-is.
      setOlderHistory((rows) => [...rows, ...next.data]);
      setHistoryPage(next.page);
      setHistoryNextCursor(next.next_cursor);
      setHistoryHasMore(next.has_more);
    } catch (error) {
      setActionError({ action: "timeline", message: errorSummary(error) });
    } finally {
      setHistoryBusy(false);
    }
  };

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    // A refresh is not a first load. Blanking to "loading" unmounted the whole
    // record, and with it every child's state — the score-override form's typed
    // score and comment among them, which no page-level guard can protect
    // because they do not live on the page. The record stays on screen while it
    // refetches; only the first load has nothing to show.
    setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    // The pages of timeline fetched beyond the first are dropped on every
    // reload: the record read returns a fresh page one, and keeping stale older
    // pages beside it would show one row twice the moment anything was written.
    setOlderHistory([]);
    setHistoryPage(1);
    setHistoryNextCursor(null);
    setHistoryHasMore(false);
    apiFetch<RecordData>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}`, { signal: controller.signal, route: SUBMISSION_ROUTE })
      .then((record) => { setHistoryNextCursor(record.history_next_cursor); setHistoryHasMore(record.history_has_more); setSchedule((current) => ({ ...current, room_id: current.room_id || "", track_id: current.track_id || record.tracks.find((track) => track.is_primary)?.id || "" })); setDraftTitle((current) => adoptServerValue(contentEdits.current !== contentSavedAtEdit.current, current, record.title)); setDraftAbstract((current) => adoptServerValue(contentEdits.current !== contentSavedAtEdit.current, current, record.abstract ?? "")); setMessageRecipientId((current) => current || record.participants.find((participant) => participant.role !== "submitter")?.id || record.participants[0]?.id || ""); setMessageSubject((current) => current || `A note about ${record.title}`); setMessageBody((current) => current || "Hi {{speaker.first_name}},\n\n"); setState({ kind: "ready", record }); setBusy(""); })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setState({ kind: "error", message: errorSummary(error), notFound: isNotFound(error) }); setBusy(""); } });
    return () => controller.abort();
  }, [eventId, submissionId, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    setNotesState("loading");
    setNotesLoadError("");
    setNotesWriteError("");
    setNotesDraft("");
    apiFetch<{ notes: SubmissionNote[] }>(`/api/v1/submissions/${encodeURIComponent(submissionId)}/notes`, { signal: controller.signal, route: NOTES_ROUTE })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setNotes(payload.notes);
        setNotesState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setNotesLoadError(errorSummary(error));
        setNotesState("error");
      });
    return () => controller.abort();
  }, [eventId, submissionId, notesReloadKey]);

  const appendSubmissionNote = async (event: Event) => {
    event.preventDefault();
    const body = notesDraft.trim();
    if (!body) {
      setNotesWriteError("Write an internal note before saving.");
      return;
    }
    setNotesBusy(true);
    setNotesWriteError("");
    try {
      const response = await apiFetch<{ note: SubmissionNote }>(`/api/v1/submissions/${encodeURIComponent(submissionId)}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
        route: NOTES_ROUTE,
      });
      setNotes((current) => [response.note, ...current]);
      setNotesState("ready");
      setNotesDraft("");
    } catch (error: unknown) {
      setNotesWriteError(errorSummary(error));
    } finally {
      setNotesBusy(false);
    }
  };

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
    setParticipantError("");
    return writeThenRefresh(name,
      () => apiFetch<unknown>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, route }).then(() => undefined),
      (error) => setParticipantError(errorSummary(error)));
  };

  const addParticipant = async (event: Event) => {
    event.preventDefault();
    if (participantMode === "existing" && !selectedParticipant) { setParticipantError("Choose a person from the list, or add a new person."); return; }
    if (participantMode === "new" && (!newParticipantName.trim() || !newParticipantEmail.trim())) { setParticipantError("A new participant needs a name and an email address."); return; }
    const person = participantMode === "existing"
      ? { person_id: selectedParticipant!.person.id }
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
  /**
   * THE rule for a write that refreshes this record: `busy` is held until the
   * REFRESH lands, not until the write returns.
   *
   * Keeping the record rendered through a refresh is what protects child state
   * — the score-override form's typed score and comment live in the row, not on
   * the page — and it also leaves stale chips, status and actions on screen. A
   * `finally { setBusy("") }` released them the instant the write returned, so
   * for the length of the GET an operator could act on a record that had
   * already changed. Five writes did that, and patching five `finally`s is how
   * a sixth arrives wrong next week.
   *
   * So the lifecycle lives here and nowhere else: this sets busy, and the load
   * effect clears it when the record lands — on success and on failure alike,
   * or a failed refresh would leave the page disabled with nothing coming. The
   * only path that clears busy itself is the one where no refresh is coming.
   */
  const writeThenRefresh = async (name: string, run: () => Promise<void>, onFailure: (error: unknown) => void): Promise<boolean> => {
    setBusy(name);
    try {
      await run();
      reload();
      return true;
    } catch (error: unknown) {
      onFailure(error);
      setBusy("");
      return false;
    }
  };

  /** A child that does its own write and then asks the record to catch up. */
  const refreshRecord = useCallback(() => { setBusy("refresh"); reload(); }, [reload]);

  const act = async (name: string, path: string, init: RequestInit = {}, route = SUBMISSION_ROUTE): Promise<boolean> => {
    setActionError(null);
    return writeThenRefresh(name,
      () => apiFetch<unknown>(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, route }).then(() => undefined),
      (error) => {
        const failure = submissionWriteFailure(error, name);
        if (failure.kind === "refusal") setActionError(failure.actionError);
        else setState(failure.state);
      });
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

  const loadDecisionPlan = async (
    recommendation: DecisionRecommendation,
    feedback: string,
    confirmPublished = decisionConfirmPublished,
  ): Promise<void> => {
    setDecisionPlanLoading(true);
    setDecisionPlanError("");
    try {
      const plan = await apiFetch<DecisionPlanResponse>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/decision-plan`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recommendation,
            ...(feedback.trim() ? { feedback_md: feedback.trim() } : {}),
            ...(confirmPublished ? { confirm_published: true } : {}),
          }),
          route: DECISION_PLAN_ROUTE,
        },
      );
      setDecisionPlan(plan);
      setDecisionPlanStale(false);
    } catch (error: unknown) {
      setDecisionPlanError(errorSummary(error));
    } finally {
      setDecisionPlanLoading(false);
    }
  };

  const openDecisionPlan = (recommendation: DecisionRecommendation): void => {
    setDecisionRequest(recommendation);
    setFeedbackDraft("");
    setDecisionInternalNoteDraft("");
    setKindFeedbackBusy(false);
    setKindFeedbackDrafted(false);
    setKindFeedbackNotice("");
    setDecisionConfirmPublished(false);
    setDecisionPlan(null);
    setDecisionPlanError("");
    setDecisionPlanStale(false);
    setDecisionNotice("");
    void loadDecisionPlan(recommendation, "", false);
  };

  const onDecisionFeedbackChange = (value: string): void => {
    setFeedbackDraft(value);
    if (!decisionRequest || !decisionPlan) return;
    if (decisionPlanRefreshTimerRef.current !== null) window.clearTimeout(decisionPlanRefreshTimerRef.current);
    decisionPlanRefreshTimerRef.current = window.setTimeout(() => {
      decisionPlanRefreshTimerRef.current = null;
      void loadDecisionPlan(decisionRequest, value, decisionConfirmPublished);
    }, 320);
  };

  const onDecisionConfirmPublishedChange = (value: boolean): void => {
    setDecisionConfirmPublished(value);
    if (decisionRequest) void loadDecisionPlan(decisionRequest, feedbackDraft, value);
  };

  const draftKindFeedbackForRecord = async (): Promise<void> => {
    if (!decisionRequest || !decisionPlan || decisionPlan.action !== "reject") return;
    setKindFeedbackBusy(true);
    setKindFeedbackNotice("");
    try {
      const result = await apiFetch<{ paragraph: string | null; notice: string | null }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/decision-plan/kind-feedback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recommendation: decisionRequest,
            ...(decisionInternalNoteDraft.trim() ? { internal_note: decisionInternalNoteDraft.trim() } : {}),
            ...(decisionConfirmPublished ? { confirm_published: true } : {}),
          }),
          route: "/api/v1/events/{eventId}/submissions/{submissionId}/decision-plan/kind-feedback",
        },
      );
      if (result.paragraph) {
        setFeedbackDraft(result.paragraph);
        setKindFeedbackDrafted(true);
        setKindFeedbackNotice("");
      } else {
        setKindFeedbackNotice(result.notice || "Drafting unavailable — the template and your own words still work");
      }
    } catch (error: unknown) {
      setKindFeedbackNotice(errorSummary(error));
    } finally {
      setKindFeedbackBusy(false);
    }
  };

  const applyDecisionPlan = async (): Promise<void> => {
    if (!decisionRequest || !decisionPlan) return;
    setDecisionPlanBusy(true);
    setDecisionPlanError("");
    setDecisionNotice("");
    try {
      const result = await apiFetch<{ outbox_inserted?: boolean }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "if-match": decisionPlan.etag },
          body: JSON.stringify({
            recommendation: decisionRequest,
            plan_fingerprint: decisionPlan.plan_fingerprint,
            ...(feedbackDraft.trim() ? { feedback_md: feedbackDraft.trim() } : {}),
            ...(decisionInternalNoteDraft.trim() ? { internal_note: decisionInternalNoteDraft.trim() } : {}),
            ...(decisionConfirmPublished ? { confirm_published: true } : {}),
          }),
          route: DECISION_ROUTE,
        },
      );
      setDecisionRequest(null);
      setDecisionPlan(null);
      setFeedbackDraft("");
      setDecisionInternalNoteDraft("");
      setKindFeedbackDrafted(false);
      setKindFeedbackNotice("");
      setDecisionConfirmPublished(false);
      setDecisionNotice(result.outbox_inserted === false
        ? "Decision recorded; no notification was queued."
        : decisionRequest === "maybe"
          ? "Submission waitlisted."
          : `Submission ${decisionRequest === "approve" ? "accepted" : "rejected"} and notification queued.`);
      reload();
    } catch (error: unknown) {
      if (isDecisionPlanConflict(error)) setDecisionPlanStale(true);
      else setDecisionPlanError(errorSummary(error));
    } finally {
      setDecisionPlanBusy(false);
    }
  };

  const sendMessage = async (event: Event) => {
    event.preventDefault();
    const currentRecord = state.kind === "ready" ? state.record : null;
    const recipient = currentRecord?.participants.find((participant) => participant.id === messageRecipientId);
    if (!recipient) { setMessageError("Choose a participant before sending."); return; }
    if (!messageSubject.trim() || !messageBody.trim()) { setMessageError("Subject and message are required."); return; }
    setMessageError(""); setMessageNotice("");
    const sent = await writeThenRefresh("message", async () => {
      const body = await apiFetch<{ queued?: number }>(`/api/v1/events/${encodeURIComponent(eventId)}/comms/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKeyForCompose(
            messageComposeIdempotencyRef,
            JSON.stringify({ eventId, submissionId, recipientId: recipient.person_id, role: recipient.role, subject: messageSubject.trim(), body: messageBody }),
          ),
        },
        body: JSON.stringify({ selector: { submission_ids: [submissionId], person_ids: [recipient.person_id], role: recipient.role }, subject: messageSubject.trim(), body: messageBody }),
        route: COMMS_SEND_ROUTE,
      });
      setMessageNotice(body.queued ? "Message queued in the conference outbox." : "That message was already queued for this participant.");
    }, (error) => setMessageError(errorSummary(error)));
    if (sent) {
      // A successful response ends this compose. If the request failed, the
      // ref remains available for the operator's retry.
      messageComposeIdempotencyRef.current = null;
    }
  };

  const resendDecision = async () => {
    setResendNotice("");
    await writeThenRefresh("resend", async () => {
      const result = await apiFetch<{ outbox_inserted?: boolean }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/decision/resend`,
        { method: "POST", headers: { "content-type": "application/json" }, route: RESEND_ROUTE },
      );
      setResendNotice(result.outbox_inserted === false
        ? "That decision was already queued."
        : "Decision queued in the conference outbox.");
    }, (error) => setState({ kind: "error", message: errorSummary(error), notFound: isNotFound(error) }));
  };

  const resendCalendarInvite = async () => {
    setCalendarInviteError("");
    setCalendarInviteNotice("");
    await writeThenRefresh("calendar-invite", async () => {
      const result = await apiFetch<{ queued?: number }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/invites`,
        { method: "POST", headers: { "content-type": "application/json" }, route: CALENDAR_INVITES_ROUTE },
      );
      setCalendarInviteNotice(result.queued === 0
        ? "That calendar revision was already queued."
        : "Calendar invite queued in the conference outbox.");
    }, (error) => setCalendarInviteError(errorSummary(error)));
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
    setOverrideError("");
    return writeThenRefresh(`override-${evaluation.id}`,
      () => apiFetch<unknown>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${overridePath(evaluation)}`,
        { ...init, headers: { "content-type": "application/json" }, route: OVERRIDE_ROUTE },
      ).then(() => undefined),
      (error) => setOverrideError(errorSummary(error)));
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

  /**
   * This editor holds prose the organizer typed, so it does not go through
   * `act`. `act` answers a refused write beside the control and gives the page
   * to everything else — correct for assign or publish, where a lost page
   * costs a click. Here the page IS the work: a dropped connection replaced the
   * record with "Record unavailable · Your work is not lost", and Retry
   * reloaded the record, which reseeds `draftTitle` and `draftAbstract` from
   * the server and overwrites the edits with the values they replaced. The
   * reassurance was false at the moment it was shown, and a long abstract went
   * with it.
   *
   * The same reasoning already took the score override off `act`. A failed save
   * now reports beside the button, the record stays on screen, and the typed
   * title and abstract stay in the fields — so pressing Save again resubmits
   * the same work rather than a reload having eaten it. `act`'s own policy is
   * deliberately unchanged: a record that really is gone should still take the
   * page.
   */
  const saveContent = async (event: Event, confirmPublished: boolean) => {
    event.preventDefault();
    setContentConfirming(false);
    setContentError("");
    const payload: Record<string, unknown> = { title: draftTitle, abstract: draftAbstract || null };
    if (!isDraftRecord && confirmPublished) payload.confirm_published = true;
    const path = isDraftRecord ? "" : "/content";
    const route = isDraftRecord ? SUBMISSION_ROUTE : CONTENT_ROUTE;
    // Taken BEFORE the request: anything typed while it is in flight leaves the
    // count higher than this, and stays the operator's.
    const editsAtSend = contentEdits.current;
    await writeThenRefresh("content",
      () => apiFetch<unknown>(
        `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}${path}`,
        { method: "PATCH", body: JSON.stringify(payload), headers: { "content-type": "application/json" }, route },
      ).then(() => { contentSavedAtEdit.current = editsAtSend; }),
      (error) => setContentError(errorSummary(error)));
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
  const copyReferenceCode = async (): Promise<void> => {
    const code = record.reference_code;
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const input = document.createElement("textarea");
        input.value = code;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("clipboard unavailable");
      }
      setReferenceCopied(true);
      window.setTimeout(() => setReferenceCopied(false), 2400);
    } catch {
      setActionError({ action: "reference-copy", message: "The reference could not be copied. Select it and copy manually." });
    }
  };
  // Every round's rubric, so an evaluation's criteria_scores can be read back
  // as the questions the reviewer actually answered.
  const criteriaByRound = new Map(record.evaluation.rounds.map((round) => [round.id, round.criteria ?? []]));
  // Two reviewers may share a name. This picker assigns work, so the option a
  // human clicks has to name a record they can tell from its twin.
  const reviewerNames = disambiguatedNames(record.evaluation.reviewer_options);
  // The recorded evidence is its own population: a reviewer can have left the
  // pool and still have a scorecard on this record, and the override controls
  // sit right beside their name.
  const evidenceNames = disambiguatedNames([
    ...record.evaluations.map((evaluation) => ({ id: evaluation.reviewer_person_id, name: evaluation.reviewer_name })),
    ...record.comparisons.map((comparison) => ({ id: comparison.reviewer_person_id, name: comparison.reviewer_name })),
  ]);
  const participantGroups = groupParticipants(record.participants);
  // Two participants can share a name, and the recipient picker below decides
  // who a message goes to. One derivation across the record's own people, so
  // the card and the picker agree.
  const participantNames = disambiguatedNames(record.participants.map((participant) => ({ id: participant.person_id, name: participant.name })));
  // The "Choose existing person" search is its own list, and picking the wrong
  // row here adds the wrong human to the submission.
  const participantResultNames = disambiguatedNames(participantResults.map((person) => ({ id: person.id, name: person.title })));
  const hasSpeakingParticipant = hasPublicSpeakingParticipant(record.participants);
  const speakerParticipant = record.participants.find((participant) => participant.role === "speaker")
    ?? record.participants.find((participant) => participant.role === "co_speaker")
    ?? record.participants.find((participant) => participant.role !== "submitter");
  const speakerRecordHref = speakerParticipant ? `/roster?person=${encodeURIComponent(speakerParticipant.person_id)}` : "/roster";
  // Publication lives on the agenda row, not the status: a scheduled Session
  // is still `accepted`. This is the only thing that decides whether saving
  // changes what attendees see, so it is what gates the confirm.
  const isLivePublicly = record.slot?.is_published === true;
  // Page one arrives with the record; later pages sit after it in the order the
  // server returned them. No client-side re-sorting — the log's order is the
  // one thing every lens must agree on.
  const shownHistory = [...record.history, ...olderHistory];
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
    <PageHeader title="Submission record" copy={`${record.reference_code ?? record.id} · ${record.kind === "session" ? "Session" : "Abstract"} · ${record.origin} origin`} actions={<><AgentBriefLauncher surface="decision" eventId={eventId} small /><button class="chip submission-reference-copy" type="button" disabled={!record.reference_code} title={record.id} aria-label={record.reference_code ? `Copy submission reference ${record.reference_code}` : "Submission reference unavailable"} onClick={() => void copyReferenceCode()}>{referenceCopied ? "Copied" : record.reference_code ?? "No reference"}</button><Chip tone={headerChipTone(record)}>{record.stage_label}</Chip></>} />
    {record.publication?.anomaly && <div class="record-refusal" role="alert"><strong>{record.publication.anomaly === "withdrawn" ? "Withdrawn after publish" : "Rejected after publish"}</strong><span>This Session remains on the organizer board as a retained publication anomaly. Remove it from the public site deliberately when you are ready.</span></div>}
    {/* An assignment refusal answers inside the evaluation panel; every other
        declined action answers here, where the record is still on screen. */}
    {actionError && !actionError.action.startsWith("assign-") && !actionError.action.startsWith("remove-")
      && <div class="record-refusal" role="alert"><strong>That action was not applied</strong>{actionError.kind === "missing-decision-email"
        ? <DecisionEmailRecovery speakerName={speakerParticipant?.name ?? "this speaker"} onOpen={() => navigate(speakerRecordHref)} />
        : <span>{actionError.message}</span>}</div>}
    <div class="record-layout">
      <div class="record-main stack">
        <Card><CardBody><div class="record-summary"><div><span class="eyebrow">Program record</span><h2>{record.title}</h2><p>{record.abstract || "—"}</p></div><div class="record-summary-meta"><Chip>{statusLabel(record.status)}</Chip><span class="tabular">{record.time_in_stage}</span><span>{record.bypass_evaluation ? "Evaluation bypassed" : "Evaluation required"}</span></div></div><div class="record-meta-grid"><span><small>Origin</small><strong>{statusLabel(record.origin)}</strong></span><span><small>Submitted</small><strong>{moment(record.submitted_at)}</strong></span><span><small>Format</small><strong>{record.format?.name ?? "—"}</strong></span><span><small>Wave</small><strong>{record.wave?.name ?? "—"}</strong></span><span><small>Routing rule</small><strong>{record.routing?.name ?? "—"}</strong></span><span class="record-publication-status"><small>Public status</small><strong>{record.is_published ? "Live on the public site" : "Not yet public"}</strong><span>{record.is_published ? "Visible to attendees." : record.slot ? "Scheduled; publication is still off." : "Needs a room and time before it can go public."}</span></span></div>{record.slot && <div class="record-slot"><div class="record-slot-summary"><strong>{record.slot.day} · {record.slot.time} · {record.slot.room}</strong><span>{record.slot.building} · {record.slot.duration_min} min</span></div><div class="record-slot-publication"><Chip class="record-publication-chip" tone={record.slot.is_published ? "success" : "warning"}>{record.slot.is_published ? "Live on the public site" : "Not yet public"}</Chip><div class="record-publication-action" aria-live="polite">{publicationRequest ? <PublicationConfirmation publicationRequest={publicationRequest} hasSpeakingParticipant={hasSpeakingParticipant} busy={busy} onConfirm={() => void changePublication(publicationRequest === "publish")} onCancel={() => setPublicationRequest(null)} /> : publicationAction ? <Button type="button" small class="record-publication-trigger" variant={publicationAction === "publish" ? "primary" : "danger"} disabled={Boolean(busy)} onClick={() => setPublicationRequest(publicationAction)}>{publicationAction === "publish" ? "Publish this session" : "Remove from public site"}</Button> : <span class="record-publication-action-placeholder" aria-hidden="true" />}</div></div></div>}</CardBody></Card>
        {canEditContent && <Card><CardHeader title="Session content"><span class="subtle">{contentNote(record)}</span></CardHeader><CardBody><form class="record-draft-form" onSubmit={(event) => { event.preventDefault(); if (isLivePublicly && !contentConfirming) { setContentConfirming(true); return; } void saveContent(event, isLivePublicly); }}><label class="field"><span>Title</span><input required value={draftTitle} onInput={(event) => { contentEdits.current += 1; setDraftTitle(event.currentTarget.value); }} /></label><label class="field"><span>Abstract</span><textarea rows={6} value={draftAbstract} onInput={(event) => { contentEdits.current += 1; setDraftAbstract(event.currentTarget.value); }} /></label><div class="record-action-row"><Button variant="primary" type="submit" class="record-content-save" disabled={Boolean(busy)}>{busy === "content" ? "Saving…" : isLivePublicly && contentConfirming ? "Confirm public update" : "Save changes"}</Button>{/* The live-record cue is said BEFORE the first click, not after it. A
            published Session takes two deliberate clicks to save, and until the
            editor announced that up front the first click looked exactly like a
            silent write failure: enabled button, accepted click, no toast, and
            an unchanged record. A reader watching the record rather than the
            button saw nothing happen and reloaded their typing away. The guard
            itself is a feature and is untouched; only its warning moved
            earlier. */}
          <span class="subtle record-content-cue">{isLivePublicly && contentConfirming ? "This replaces what attendees see on the public agenda." : isDraftRecord ? "No submit action is available from this editor." : isLivePublicly ? "This Session is live on the public agenda; saving will ask you to confirm." : "Saved changes are recorded in the history below."}</span>
          {/* Reserved height, so a failed save answers here without moving the
              button the operator is about to press again. */}
          <span class={`record-inline-message ${contentError ? "error" : ""}`} role={contentError ? "alert" : undefined}>{contentError || " "}</span></div></form></CardBody></Card>}
        {record.actions.can_decide && <Card><CardHeader title="Record action"><span class={record.decisions.length > 0 ? "record-decision-cue" : "subtle"}>{decidedNote(record.decisions[0])}</span></CardHeader><CardBody><div class="record-action-row">{record.status !== "accepted" && <Button variant="primary" disabled={Boolean(busy) || decisionPlanLoading} onClick={() => openDecisionPlan("approve")}>Accept</Button>}{record.status !== "waitlisted" && <Button disabled={Boolean(busy) || decisionPlanLoading} onClick={() => openDecisionPlan("maybe")}>Maybe</Button>}{record.status !== "rejected" && <Button variant="danger" disabled={Boolean(busy) || decisionPlanLoading} onClick={() => openDecisionPlan("deny")}>Reject</Button>}<span class="subtle">Review the server-built plan, recipient render, and live-record guard before applying this decision.</span></div></CardBody></Card>}
        {decisionRequest && <DecisionPlanPanel
          plan={decisionPlan}
          loading={decisionPlanLoading}
          error={decisionPlanError}
          stale={decisionPlanStale}
          busy={decisionPlanBusy}
          feedback={feedbackDraft}
          internalNote={decisionInternalNoteDraft}
          confirmPublished={decisionConfirmPublished}
          publishedCount={isLivePublicly ? 1 : 0}
          onFeedbackChange={onDecisionFeedbackChange}
          onInternalNoteChange={setDecisionInternalNoteDraft}
          onConfirmPublishedChange={onDecisionConfirmPublishedChange}
          kindFeedbackBusy={kindFeedbackBusy}
          kindFeedbackDrafted={kindFeedbackDrafted}
          kindFeedbackNotice={kindFeedbackNotice}
          onDraftKindFeedback={() => void draftKindFeedbackForRecord()}
          onConfirm={() => void applyDecisionPlan()}
          onClose={() => { setDecisionRequest(null); setDecisionPlan(null); setDecisionPlanError(""); setDecisionPlanStale(false); setFeedbackDraft(""); setDecisionInternalNoteDraft(""); setKindFeedbackDrafted(false); setKindFeedbackNotice(""); }}
          onRefresh={() => decisionRequest && void loadDecisionPlan(decisionRequest, feedbackDraft, decisionConfirmPublished)}
        />}
        {decisionNotice && <p class="record-inline-message notice" role="status">{decisionNotice}</p>}
        {record.decisions.length > 0 && <Card><CardHeader title="Decision history"><span class="tabular">{record.decisions.length}</span></CardHeader><CardBody><div class="record-decision-list">{record.decisions.map((decision) => <article class="record-decision" key={decision.id}><div class="record-decision-head"><strong>{decision.kind === "reversal" ? `Acceptance reversed · ${statusLabel(decision.resulting_status)}` : statusLabel(decision.resulting_status)}</strong><span>{decision.decided_by_name || "Conference team"} · {moment(decision.decided_at)}</span></div><p>{decision.note || decision.feedback_md || "No feedback recorded."}</p></article>)}</div></CardBody></Card>}
        {record.actions.can_view_notes && <Card class="record-notes-card"><CardHeader title="Internal notes"><span class="subtle">Staff only · never sent</span></CardHeader><CardBody><SubmissionNotesCardBody
          state={notesState}
          notes={notes}
          error={notesLoadError}
          onRetry={() => setNotesReloadKey((value) => value + 1)}
          compose={<form class="record-notes-compose" onSubmit={(event) => void appendSubmissionNote(event)}><label class="field"><span>Write an internal note — never sent to the speaker</span><textarea rows={3} maxLength={5000} value={notesDraft} onInput={(event) => { setNotesDraft(event.currentTarget.value); setNotesWriteError(""); }} placeholder="Keep context for the conference team." /></label><div class="record-action-row"><span class={`record-inline-message ${notesWriteError ? "error" : ""}`} role={notesWriteError ? "alert" : undefined}>{notesWriteError || " "}</span><Button small variant="primary" type="submit" disabled={notesBusy || notesState === "loading"}>{notesBusy ? "Saving…" : "Save note"}</Button></div></form>}
        /></CardBody></Card>}
        {record.actions.can_resend_decision && <Card><CardHeader title="Decision delivery"><span class="subtle">The decision is already recorded.</span></CardHeader><CardBody>
          <p class="record-delivery-copy">If the speaker did not receive this decision, correct the address on their speaker record, then send the decision again.</p>
          {/* The address the last attempt used, named on the card. Without it
              "send it again" repeats a typo the organizer cannot see, and the
              speaker stays uninformed twice. */}
          <p class="record-delivery-last" data-send-count={record.decision_sends.length}>{lastSendLine(record.decision_sends, record.decision_recipient?.email ?? null)}</p>
          {record.decision_sends.length > 0 && <details class="record-delivery-history" open={sendsOpen} onToggle={(event) => setSendsOpen(event.currentTarget.open)}>
            <summary>{sendsOpen ? "Hide previous sends" : `Review previous sends (${record.decision_sends.length})`}</summary>
            <ul class="record-delivery-sends">{record.decision_sends.map((send) => <li key={send.id}>
              <span class="record-delivery-address">{send.to_email}</span>
              <span class="subtle">{statusLabel(send.kind)} · {sendMoment(sendMomentFor(send))}</span>
              <Chip tone={sendOutcome(send).tone}>{sendOutcome(send).label}</Chip>
              {/* A demo hold is not a fault; only an alarm outcome is coloured like one. */}
              {send.reason && <small class={sendOutcome(send).tone === "alarm" ? "record-delivery-reason alarm" : "record-delivery-reason"}>{send.reason}</small>}
            </li>)}</ul>
          </details>}
          <div class="record-action-row"><Button onClick={() => navigate(speakerRecordHref)}>Edit speaker address</Button><Button variant="primary" disabled={Boolean(busy)} onClick={() => void resendDecision()}>{busy === "resend" ? "Queueing…" : "Send decision again"}</Button></div>
          {resendNotice && <p class="record-inline-message notice" role="status">{resendNotice}</p>}
        </CardBody></Card>}
        {record.status === "accepted" && <AcceptanceReversalPanel eventId={eventId} submissionId={submissionId} onReversed={refreshRecord} />}
        {record.actions.can_schedule && <Card><CardHeader title="Working agenda"><span class="subtle">Place this Session on the private agenda.</span></CardHeader><CardBody><form class="record-schedule-form" onSubmit={(submitEvent) => { submitEvent.preventDefault(); if (!timezone) return; const request = submissionScheduleRequest(schedule, timezone); if (!request) return; void act("schedule", request.path, request.init, request.route); }}><label class="field"><span>Starts at {eventTimeLabel(timezone)}</span><input required type="datetime-local" value={schedule.starts_at} disabled={!timezone} onInput={(inputEvent) => setSchedule({ ...schedule, starts_at: inputEvent.currentTarget.value })} /></label><label class="field"><span>Duration</span><input required type="number" min="1" value={schedule.duration_min} onInput={(inputEvent) => setSchedule({ ...schedule, duration_min: inputEvent.currentTarget.value })} /></label><label class="field"><span>Room ID</span><input required value={schedule.room_id} onInput={(inputEvent) => setSchedule({ ...schedule, room_id: inputEvent.currentTarget.value })} /></label><Button variant="primary" type="submit" disabled={Boolean(busy) || !timezone}>Place on agenda</Button></form></CardBody></Card>}
        {record.actions.can_send_calendar_invite && <Card><CardHeader title="Calendar invitation"><span class="subtle">The Session is already on the working agenda.</span></CardHeader><CardBody>
          <p class="record-delivery-copy">Send this Session's calendar invitation again. This explicit record action claims a new calendar revision even when the slot has not changed.</p>
          <div class="record-action-row"><Button data-calendar-record-send="true" variant="primary" disabled={Boolean(busy)} onClick={() => void resendCalendarInvite()}>{busy === "calendar-invite" ? "Queueing…" : "Send calendar invite again"}</Button></div>
          <span class={`record-inline-message ${calendarInviteError ? "error" : ""}`} role={calendarInviteError ? "alert" : undefined}>{calendarInviteError || " "}</span>
          {calendarInviteNotice && <p class="record-inline-message notice" role="status">{calendarInviteNotice}</p>}
        </CardBody></Card>}
        <Card><CardHeader title="Participants"><span class="tabular">{participantGroups.length}</span></CardHeader><CardBody>
          <div class="record-participants">{participantGroups.length ? participantGroups.map((group) => <div class="record-person" key={group.person_id}><strong>{participantNames.get(group.person_id) ?? group.name}</strong><span>{group.company || "Company not provided"}</span><small>{group.email}</small><div class="record-person-roles" aria-label={`${participantNames.get(group.person_id) ?? group.name} roles`}>{group.participants.map((participant) => <div class="record-person-role" key={participant.id}><span class="record-person-role-name">{statusLabel(participant.role)}</span><Chip tone={participantConfirmationTone(participant.confirmation_status)}>{participantConfirmationLabel(participant.confirmation_status)}</Chip>{canEditParticipants && participant.role !== "submitter" && <Button small variant="ghost" class="record-person-remove" aria-label={`Remove the ${statusLabel(participant.role)} role from ${participantNames.get(group.person_id) ?? group.name}`} disabled={Boolean(busy)} onClick={() => void removeParticipant(participant.id)}>Remove {statusLabel(participant.role)} role</Button>}</div>)}</div></div>) : <div class="record-inline-empty">No participants are attached to this record yet.</div>}</div>
          {canEditParticipants && <form class="record-participant-add" onSubmit={(event) => void addParticipant(event)}>
            <fieldset class="record-person-picker" aria-describedby="record-participant-error">
              <legend>Add a participant</legend>
              <p class="field-note">A co-presenter who turns up after intake belongs on the record the same way the submitter does. Search people already on this conference, or add someone new.</p>
              <div class="record-picker-tabs" role="tablist" aria-label="Participant choice">
                <button type="button" role="tab" aria-selected={participantMode === "existing"} class={participantMode === "existing" ? "active" : ""} onClick={() => { setParticipantMode("existing"); setParticipantError(""); }}>Choose existing person</button>
                <button type="button" role="tab" aria-selected={participantMode === "new"} class={participantMode === "new" ? "active" : ""} onClick={() => { setParticipantMode("new"); setSelectedParticipant(null); setParticipantResults([]); setParticipantError(""); }}>Add new person</button>
              </div>
              {participantMode === "existing" && <div class="record-picker-body">
                {selectedParticipant ? <div class="record-selected-person"><span><strong>{selectedParticipant.label}</strong><small>{selectedParticipant.person.subtitle}</small></span><Button type="button" small onClick={() => { setSelectedParticipant(null); setParticipantQuery(""); }}>Change person</Button></div> : <>
                  <label class="sr-only" for="record-participant-search">Search people</label><input id="record-participant-search" value={participantQuery} onInput={(event) => { setParticipantQuery(event.currentTarget.value); setSelectedParticipant(null); setParticipantError(""); }} placeholder="Search people by name…" autoComplete="off" aria-controls="record-participant-results" />
                  <div id="record-participant-results" class="record-person-suggestions" role="listbox" aria-label="People search results">
                    {participantSearchState === "loading" && <span class="record-picker-placeholder">Searching people…</span>}
                    {participantSearchState === "error" && <span class="record-picker-placeholder error">People search unavailable. Try again.</span>}
                    {participantSearchState === "idle" && participantQuery.trim().length < 2 && <span class="record-picker-placeholder">Type at least 2 characters to search.</span>}
                    {participantSearchState === "idle" && participantQuery.trim().length >= 2 && participantResults.length === 0 && <span class="record-picker-placeholder">No matching people. Add a new person if this is a new contact.</span>}
                    {participantResults.map((person) => <button type="button" role="option" class="record-person-suggestion" key={person.id} onClick={() => { setSelectedParticipant({ person, label: participantResultNames.get(person.id) ?? person.title }); setParticipantQuery(person.title); setParticipantResults([]); setParticipantError(""); }}><strong>{participantResultNames.get(person.id) ?? person.title}</strong><small>{person.subtitle}</small></button>)}
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
        <Card><CardHeader title="Message participant"><span class="subtle">Logged on this record · demo-safe</span></CardHeader><CardBody><form class="record-message-form" onSubmit={(event) => void sendMessage(event)}><label class="field"><span>Recipient and role</span><select value={messageRecipientId} onChange={(event) => setMessageRecipientId(event.currentTarget.value)}>{record.participants.map((participant) => <option value={participant.id} key={participant.id}>{participantNames.get(participant.person_id) ?? participant.name} · {statusLabel(participant.role)}</option>)}</select></label><label class="field"><span>Subject</span><input required value={messageSubject} onInput={(event) => setMessageSubject(event.currentTarget.value)} /></label><label class="field"><span>Message</span><textarea required rows={5} value={messageBody} onInput={(event) => setMessageBody(event.currentTarget.value)} /><small>Use the shared merge fields, such as <code>{"{{speaker.first_name}}"}</code> and <code>{"{{submission.title}}"}</code>.</small></label><div class="record-action-row"><span class={`record-inline-message ${messageError ? "error" : messageNotice ? "notice" : ""}`}>{messageError || messageNotice}</span><Button variant="primary" type="submit" disabled={Boolean(busy)}>{busy === "message" ? "Queueing…" : "Queue message"}</Button></div></form></CardBody></Card>
        <Card><CardHeader title="Answers and evaluation evidence" /><CardBody><div class="record-answer-list">{record.answers.length ? record.answers.map((answer) => <div class="record-answer" key={answer.id}><small>{answer.label || answer.key || answer.field_id}{answer.deleted_at ? " · Deleted field" : ""}</small>{answer.file ? <FileAnswer label={answer.label || answer.key || "File"} file={answer.file} /> : <strong>{answerText(answer)}</strong>}</div>) : <span class="subtle">No form answers recorded.</span>}{record.evaluations.map((evaluation, index) => <EvaluationEvidenceRow key={`${evaluation.id}-${index}`} evaluation={evaluation} displayName={evidenceNames.get(evaluation.reviewer_person_id) ?? evaluation.reviewer_name} criteria={criteriaByRound.get(evaluation.round_id) ?? []} canOverride={record.actions.can_override_scores} busy={Boolean(busy)} onOverride={overrideScore} onClear={clearOverride} error={busy === `override-${evaluation.id}` ? "" : overrideError} />)}{record.comparisons.map((comparison, index) => <div class="record-answer" key={`${comparison.round_id}-${comparison.reviewer_name}-${index}`}><small>{comparison.round_name} · Comparison · <ReviewerName name={evidenceNames.get(comparison.reviewer_person_id) ?? comparison.reviewer_name} kind={comparison.reviewer_kind} /></small><strong>{comparison.submission_ids.length} cards ranked</strong><span>{JSON.stringify(comparison.ranking)}</span></div>)}</div></CardBody></Card>
        <Card><CardHeader title="Timeline"><span class="subtle">Submitted, decided, mailed — who, and when.</span></CardHeader><CardBody><ContentHistory
          entries={shownHistory}
          onRestore={record.actions.can_restore_content ? ((entryId) => void restoreVersion(entryId, isLivePublicly)) : undefined}
          busy={Boolean(busy)}
          label={statusLabel}
          moment={historyMoment}
          livePublicly={isLivePublicly}
          footer={<div class="history-foot">
            <span class="subtle tabular">{shownHistory.length} of {record.history_total}</span>
            {historyHasMore
              ? <Button small disabled={historyBusy} onClick={() => void loadMoreHistory()}>{historyBusy ? "Loading…" : "Load more"}</Button>
              : <span class="subtle">Complete</span>}
          </div>}
        /></CardBody></Card>
      </div>
      <aside class="record-aside stack">
        <Card><CardHeader title="Tracks" /><CardBody><div class="track-chips">{record.tracks.length ? record.tracks.map((track) => <Chip key={track.id}>{track.name}{track.is_primary ? " · Primary" : ""}</Chip>) : <span class="subtle">No tracks assigned</span>}</div></CardBody></Card>
        <SubmissionRoutingCard eventId={eventId} submissionId={submissionId} record={record} busy={Boolean(busy)} onSaved={refreshRecord} />
        <Card><CardHeader title="Evaluation panel"><span class="subtle">Current reviewers · coverage</span></CardHeader><CardBody><div class="record-rounds">{record.evaluation.rounds.length ? record.evaluation.rounds.map((round) => <section class="record-round" key={round.id}>
          <div class="record-round-head"><strong>{round.name}</strong><span class="tabular">{round.mode === "comparison" ? "Comparison" : "Scorecard"} · target {round.target_reviews_per_submission}</span></div>
          {round.evaluations.filter((evaluation) => !evaluation.abstained).length > 0 && <div class="record-round-evidence"><small>{round.evaluations.filter((evaluation) => !evaluation.abstained).length} scorecard result{round.evaluations.filter((evaluation) => !evaluation.abstained).length === 1 ? "" : "s"}</small></div>}
          {round.evaluations.some((evaluation) => evaluation.abstained) && <div class="record-round-evidence"><small>{round.evaluations.filter((evaluation) => evaluation.abstained).length} conflict{round.evaluations.filter((evaluation) => evaluation.abstained).length === 1 ? "" : "s"} declared</small></div>}
          {round.evaluations.length > 0 && <div class="record-round-results">
            {round.evaluations.map((evaluation, index) => <EvaluationPanelResult key={`${evaluation.id}-${index}`} evaluation={evaluation} criteria={criteriaByRound.get(round.id) ?? []} displayName={evidenceNames.get(evaluation.reviewer_person_id) ?? evaluation.reviewer_name} />)}
          </div>}
          {round.comparisons.length > 0 && <div class="record-round-evidence"><small>{round.comparisons.length} comparison result{round.comparisons.length === 1 ? "" : "s"}</small></div>}
          {round.reviewers.map((assignment) => <div class="record-assignment" key={assignment.assignment_id}><span><strong><ReviewerName name={reviewerNames.get(assignment.reviewer_person_id) ?? assignment.reviewer_name} kind={assignment.reviewer_kind} /></strong><small>{assignment.coverage.reviewed}/{assignment.coverage.assigned} reviewed</small></span><Button small variant="ghost" aria-label={`Remove ${reviewerNames.get(assignment.reviewer_person_id) ?? assignment.reviewer_name} from ${round.name}`} disabled={Boolean(busy)} onClick={() => void removeAssignment(round.id, assignment.assignment_id)}>Remove</Button></div>)}
          <div class="record-assignment-add"><div class="record-assignment-picker"><select aria-label={`Assign reviewer for ${round.name}`} value={selectedReviewers[round.id] ?? ""} onChange={(event) => setSelectedReviewers({ ...selectedReviewers, [round.id]: event.currentTarget.value })}><option value="">Assign reviewer…</option>{record.evaluation.reviewer_options.map((reviewer) => <option value={reviewer.id}>{reviewerNames.get(reviewer.id) ?? reviewer.name}{reviewer.kind === "agent" ? " · Agent" : ""}</option>)}</select>{record.evaluation.reviewer_options.find((reviewer) => reviewer.id === selectedReviewers[round.id])?.kind === "agent" && <Chip class="assignment-agent-chip">Agent</Chip>}</div><Button small disabled={!selectedReviewers[round.id] || Boolean(busy)} onClick={() => void assign(round.id)}>Assign</Button></div>{/* The refusal answers beside the control that asked, and the record stays on screen. */}<span class={`record-inline-message ${actionError && (actionError.action === `assign-${round.id}` || actionError.action.startsWith("remove-")) ? "error" : ""}`} role={actionError && (actionError.action === `assign-${round.id}` || actionError.action.startsWith("remove-")) ? "alert" : undefined}>{actionError && (actionError.action === `assign-${round.id}` || actionError.action.startsWith("remove-")) ? actionError.message : " "}</span>
        </section>) : <EvaluationEmptyState navigate={navigate} />}</div></CardBody></Card>
      </aside>
    </div>
  </div>;
}
