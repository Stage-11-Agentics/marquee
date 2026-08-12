import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { formatFileSize, readStoredFileAnswer } from "../../lib/file-answers";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, Chip, EmptyState } from "../shell/components";
import "./review.css";

const DEFAULT_EVENT_ID = "evt_aie-ny-2026";

interface Scope {
  color: string;
  id: string;
  name: string;
}

interface QueueItem {
  abstract: string | null;
  format: string | null;
  id: string;
  position: number;
  queue_id: string;
  title: string;
  tracks: Array<{ color: string; id: string; is_primary: number; name: string }>;
}

type CriterionKind = "numeric" | "select" | "text";

interface Criterion {
  id: string;
  kind: CriterionKind;
  name: string;
  options: string[] | null;
  position: number;
  scale_max: number | null;
  scale_min: number | null;
  weight_pct: number;
}

interface CompletedItem extends QueueItem {
  review: DetailReview | null;
}

interface QueueEnvelope {
  completed?: CompletedItem[];
  completed_truncated?: boolean;
  current_id?: string | null;
  current_index?: number | null;
  data: QueueItem[];
  eligible_count?: number;
  plan: { id: string; name: string };
  position?: number;
  remaining?: number;
  round: { anonymized: boolean; criteria?: Criterion[]; id: string; mode: "scorecard" | "comparison"; name: string; position?: number };
  scopes: Scope[];
  total?: number;
}

interface ReviewerRound {
  anonymized: boolean;
  id: string;
  mode: "scorecard" | "comparison";
  name: string;
  position: number;
}

interface ReviewerPlan {
  id: string;
  name: string;
  rounds: ReviewerRound[];
}

interface ReviewState {
  abstained: boolean;
  comment: string;
  /** Keyed by criterion id; a rating is a number, a dropdown or free text a string. */
  criteria: Record<string, number | string>;
  recommendation: "approve" | "maybe" | "deny" | null;
  score: number | null;
}

interface DetailField {
  key: string;
  label: string;
  required: number;
  type: string;
  value_json: string | null;
  value_text: string | null;
}

interface DetailFile {
  content_type: string;
  filename: string;
  id: string;
  size_bytes: number;
  status: string;
}

interface DetailReview {
  abstained: boolean;
  actor_id: string;
  comment: string;
  created_at: number;
  criteria_scores: Record<string, number | string> | null;
  decision_proposal: { decision: "approve" | "maybe" | "deny"; resulting_status: string } | null;
  recommendation: "approve" | "maybe" | "deny" | null;
  score: number | null;
  updated_at: number;
}

interface SubmissionDetail {
  abstract: string | null;
  answers: Array<{ field_id: string; value_json: string | null; value_text: string | null }>;
  blind_mode: boolean;
  decision_proposal: DetailReview["decision_proposal"];
  fields: DetailField[];
  files: DetailFile[];
  format: string | null;
  format_id: string | null;
  id: string;
  identity: null | {
    bio: string | null;
    company: string | null;
    email: string;
    headshot_attachment_id: string | null;
    id: string;
    name: string;
    speakers: unknown[];
  };
  kind: string;
  review: DetailReview | null;
  status: string;
  submitted_at: number | null;
  title: string;
  tracks: Array<{ color: string; id: string; is_primary: number; name: string }>;
  vendor_affiliation: string;
}

const EMPTY_REVIEW: ReviewState = { abstained: false, comment: "", criteria: {}, recommendation: null, score: null };

const DEFAULT_SCALE_MIN = 1;
const DEFAULT_SCALE_MAX = 5;

/** A rating renders as the buttons the organizer's scale actually asks for. */
function scaleSteps(criterion: Criterion): number[] {
  const min = Math.round(criterion.scale_min ?? DEFAULT_SCALE_MIN);
  const max = Math.round(criterion.scale_max ?? DEFAULT_SCALE_MAX);
  if (max <= min) return [min];
  const steps: number[] = [];
  for (let value = min; value <= max && steps.length < 20; value += 1) steps.push(value);
  return steps;
}

/**
 * The reviewer surface's one API call. It goes through the shared client, so a
 * failure here carries the server's correlation id like everywhere else — a
 * reviewer reporting "it won't save" can quote a reference instead of a status.
 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
}

function displayField(field: DetailField): string {
  if (field.value_text !== null && field.value_text !== "") return field.value_text;
  if (field.value_json === null) return "Not answered";
  let value: unknown;
  try {
    value = JSON.parse(field.value_json);
  } catch {
    return field.value_json;
  }
  // A reviewer reads the file's name and weight, never its storage payload —
  // and never its image, which blind mode exists to withhold.
  const file = readStoredFileAnswer(value);
  if (file) return `${file.filename} · ${formatFileSize(file.sizeBytes)}`;
  if (Array.isArray(value)) return value.join(" · ");
  if (typeof value === "object" && value !== null) return "Not answered";
  return String(value);
}

function recommendationLabel(value: ReviewState["recommendation"]): string {
  if (value === "approve") return "Approve";
  if (value === "maybe") return "Maybe";
  if (value === "deny") return "Deny";
  return "Choose one recommendation";
}

export function ReviewerPage({ eventId = DEFAULT_EVENT_ID }: { eventId?: string }): JSX.Element {
  const [plan, setPlan] = useState<ReviewerPlan | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [completed, setCompleted] = useState<CompletedItem[]>([]);
  const [completedTruncated, setCompletedTruncated] = useState(false);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [roundName, setRoundName] = useState("Initial review");
  const [roundMode, setRoundMode] = useState<"scorecard" | "comparison">("scorecard");
  const [blindMode, setBlindMode] = useState(true);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewState>>({});
  const [comparisonRanks, setComparisonRanks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const initialQueue = await api<QueueEnvelope>(`/api/v1/events/${eventId}/reviewer/queue`);
      const queueResponse = initialQueue.round.mode === "comparison"
        ? await api<QueueEnvelope>(`/api/v1/events/${eventId}/rounds/${initialQueue.round.id}/comparisons/next`)
        : initialQueue;
      setPlan({
        id: queueResponse.plan.id,
        name: queueResponse.plan.name,
        rounds: [{ ...queueResponse.round, position: queueResponse.round.position ?? 0 }],
      });
      setRoundId(queueResponse.round.id);
      setRoundName(queueResponse.round.name || "Initial review");
      setRoundMode(queueResponse.round.mode);
      setBlindMode(queueResponse.round.anonymized);
      setScopes(queueResponse.scopes);
      setCriteria(queueResponse.round.criteria ?? []);
      setCompleted(queueResponse.completed ?? []);
      setCompletedTruncated(Boolean(queueResponse.completed_truncated));
      setQueue(queueResponse.data);
      setCurrentId(queueResponse.current_id ?? queueResponse.data[0]?.id ?? null);
      if (queueResponse.round.mode === "comparison") {
        setComparisonRanks((previous) => {
          const next = { ...previous };
          for (const [index, item] of queueResponse.data.slice(0, 3).entries()) next[item.id] ??= index + 1;
          return next;
        });
      }
      setDrafts((previous) => {
        const next = { ...previous };
        for (const item of queueResponse.data) next[item.id] ??= { ...EMPTY_REVIEW };
        return next;
      });
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const currentIndex = useMemo(() => {
    const index = currentId === null ? -1 : queue.findIndex((item) => item.id === currentId);
    return index >= 0 ? index : 0;
  }, [currentId, queue]);
  const current = queue[currentIndex] ?? null;
  const currentReview = current ? drafts[current.id] ?? EMPTY_REVIEW : EMPTY_REVIEW;

  const exitQueue = (): void => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  };

  const updateReview = (patch: Partial<ReviewState>): void => {
    if (!current) return;
    setDrafts((previous) => ({
      ...previous,
      [current.id]: {
        ...(previous[current.id] ?? EMPTY_REVIEW),
        ...patch,
        ...(patch.recommendation ? { abstained: false } : {}),
      },
    }));
  };

  /** An emptied dropdown or textarea records nothing rather than an empty string. */
  const setCriterion = (criterionId: string, value: number | string): void => {
    if (!current) return;
    setDrafts((previous) => {
      const draft = previous[current.id] ?? EMPTY_REVIEW;
      const next = { ...draft.criteria };
      if (value === "") delete next[criterionId];
      else next[criterionId] = value;
      return { ...previous, [current.id]: { ...draft, criteria: next } };
    });
  };

  /** An emptied dropdown or textarea records nothing rather than an empty string. */
  const setCriterion = (criterionId: string, value: number | string): void => {
    if (!current) return;
    setDrafts((previous) => {
      const draft = previous[current.id] ?? EMPTY_REVIEW;
      const next = { ...draft.criteria };
      if (value === "") delete next[criterionId];
      else next[criterionId] = value;
      return { ...previous, [current.id]: { ...draft, criteria: next } };
    });
  };

  const openDetailFor = async (submissionId: string): Promise<void> => {
    if (!roundId) return;
    cardRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : cardRef.current;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await api<SubmissionDetail>(`/api/v1/events/${eventId}/rounds/${roundId}/submissions/${submissionId}`);
      setDetail(response);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetail = async (): Promise<void> => {
    if (current) await openDetailFor(current.id);
  };

  const closeDetail = (): void => {
    setDetailOpen(false);
    setDetail(null);
    requestAnimationFrame(() => cardRef.current?.focus());
  };

  const commitReview = async (review: ReviewState): Promise<void> => {
    if (!current || !roundId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/v1/events/${eventId}/rounds/${roundId}/submissions/${current.id}/evaluations`, {
        method: "POST",
        body: JSON.stringify({
          comment: review.comment,
          criteria_scores: Object.keys(review.criteria).length ? review.criteria : null,
          recommendation: review.abstained ? null : review.recommendation,
          score: review.abstained ? null : review.score,
          abstained: review.abstained ? 1 : 0,
        }),
      });
      // Keep a failed write from erasing the reviewer's in-progress scorecard.
      // The draft becomes the submitted state only after the server accepts it.
      setDrafts((previous) => ({ ...previous, [current.id]: review }));
      const oldIndex = currentIndex;
      const nextQueue = queue.filter((item) => item.id !== current.id);
      const saved = current;
      const now = Date.now();
      const optimisticReview: DetailReview = {
        abstained: review.abstained,
        actor_id: "",
        comment: review.comment,
        created_at: now,
        criteria_scores: Object.keys(review.criteria).length ? review.criteria : null,
        decision_proposal: null,
        recommendation: review.abstained ? null : review.recommendation,
        score: review.abstained ? null : review.score,
        updated_at: now,
      };
      setQueue(nextQueue);
      setCompleted((previous) => [{ ...saved, review: optimisticReview }, ...previous.filter((item) => item.id !== saved.id)]);
      setCurrentId(nextQueue[oldIndex]?.id ?? nextQueue[oldIndex - 1]?.id ?? null);
      setNotice(review.abstained ? "Conflict recorded · reopen it any time from Completed" : `${recommendationLabel(review.recommendation)} saved · reopen it any time from Completed`);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setSaving(false);
    }
  };

  const saveNext = async (): Promise<void> => {
    if (!currentReview.recommendation || currentReview.abstained) return;
    await commitReview(currentReview);
  };

  const saveRecusal = async (): Promise<void> => {
    if (!current) return;
    await commitReview({ ...(drafts[current.id] ?? EMPTY_REVIEW), abstained: true, criteria: {}, recommendation: null, score: null });
  };

  const saveComparison = async (): Promise<void> => {
    if (!roundId || queue.length < 3 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const submissionIds = queue.slice(0, 3).map((item) => item.id);
      const comparisonRankFor = (id: string, index: number): number => comparisonRanks[id] ?? index + 1;
      const ranking = [1, 2, 3]
        .map((rank) => submissionIds.filter((id, index) => comparisonRankFor(id, index) === rank))
        .filter((group) => group.length > 0);
      await api(`/api/v1/events/${eventId}/rounds/${roundId}/comparisons`, {
        method: "POST",
        body: JSON.stringify({ ranking, submission_ids: submissionIds }),
      });
      setNotice("Comparison saved · next three submissions ready");
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!detailOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    detailRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetail();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [detailOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (detailOpen || saving || !current || roundMode === "comparison") return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target?.tagName === "BUTTON" || target?.closest("[role=\"button\"]")) return;
      const key = event.key.toLowerCase();
      const recommendationKeys: Record<string, ReviewState["recommendation"]> = { a: "approve", m: "maybe", d: "deny" };
      if (recommendationKeys[key]) {
        event.preventDefault();
        updateReview({ recommendation: recommendationKeys[key] });
      } else if (/^[1-5]$/.test(event.key)) {
        event.preventDefault();
        updateReview({ score: Number(event.key) });
      } else if (event.key === "Enter" && currentReview.recommendation) {
        event.preventDefault();
        void saveNext();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, currentReview.recommendation, currentReview.score, detailOpen, roundMode, saving]);

  if (loading) return <main class="reviewer-surface instrument" aria-busy="true"><div class="reviewer-loading"><span class="eyebrow">Reviewer queue</span><strong>Loading the conference queue…</strong><span class="subtle">Applying your track responsibility before any submission fields load.</span></div></main>;
  if (error && !plan) return <main class="reviewer-surface"><div class="reviewer-frame"><EmptyState title="Reviewer queue unavailable" copy={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} /></div></main>;
  if (!plan) return <main class="reviewer-surface"><div class="reviewer-frame"><EmptyState title="No review plan" copy="A conference review round has not been configured yet." action={<Button variant="primary" onClick={exitQueue}>Return to conference</Button>} /></div></main>;

  return <main class="reviewer-surface" data-reviewer-surface="true" data-mobile-review="375px">
    <div class="reviewer-frame">
      <header class="reviewer-topline">
        <div class="reviewer-brand"><span class="brand-mark" aria-hidden="true">M</span><span>Marquee</span><span class="reviewer-slash">/</span><strong>Reviewer</strong></div>
        <div class="reviewer-top-meta"><span class="chip">{roundName}</span><span class="chip">{roundMode === "comparison" ? "Comparison mode" : "Scorecard mode"}</span><span class="chip success">{blindMode ? "Anonymous review" : "Identity visible"}</span><button type="button" class="reviewer-exit" onClick={exitQueue}>Exit queue</button></div>
      </header>
      <header class="reviewer-heading">
        <div><span class="eyebrow">{plan.name}</span><h1>{roundMode === "comparison" ? "Comparison queue" : "Reviewer queue"}</h1><p>{roundMode === "comparison" ? <><span class="tabular">{Math.min(3, queue.length)}</span> submissions loaded · rank ties are allowed</> : <><span class="tabular">{queue.length ? currentIndex + 1 : 0}</span> of <span class="tabular">{queue.length}</span> in your authorized tracks · <span class="tabular">{Math.max(0, queue.length - currentIndex - 1)}</span> remaining</>}</p></div>
        <button type="button" class="reviewer-refresh" onClick={() => void load()} disabled={loading}>Refresh queue</button>
      </header>
      <section class="reviewer-feedback-slot" data-reviewer-feedback aria-live="polite">
        {error ? <div class="reviewer-alert alarm" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div> : notice ? <div class="reviewer-alert success" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div> : <span class="reviewer-feedback-placeholder" aria-hidden="true" />}
      </section>
      <section class="reviewer-responsibility" aria-label="Your track responsibility">
        <div><span class="eyebrow">Your responsibility</span><div class="scope-row">{scopes.length ? scopes.map((scope) => <Chip key={scope.id}><span class="scope-dot" style={{ background: scope.color }} />{scope.name}</Chip>) : <span class="subtle">No track scope is assigned.</span>}</div></div>
        <p>A submission appears when any carried track intersects your scope. Record, file, export, and review access use the same rule.</p>
      </section>
      {!current ? <section class="reviewer-empty instrument"><span class="empty-mark" aria-hidden="true">✓</span><h2>{roundMode === "comparison" ? "Comparison queue clear" : "Queue clear"}</h2><p>{roundMode === "comparison" ? "There are not three authorized submissions waiting for comparison." : "There are no unreviewed submissions in your authorized tracks."}</p><button type="button" class="button" onClick={() => void load()}>Check again</button></section> : roundMode === "comparison" ? <div class="comparison-board" data-comparison-round={roundId} data-mobile-review="comparison">
        {queue.slice(0, 3).map((item, index) => <article class="card comparison-card" key={item.id}>
          <CardBody>
            <div class="review-card-chips"><span class="chip">Card {index + 1}</span><span class="chip">{item.format ?? "Abstract"}</span><span class="chip tabular">{item.id}</span></div>
            <h2>{item.title}</h2>
            <p class="review-abstract">{item.abstract ?? "No abstract was submitted."}</p>
            <button type="button" class="button small comparison-open" onClick={() => void openDetailFor(item.id)}>Open full submission</button>
            <label class="comparison-rank"><span>Rank</span><select aria-label={`Rank ${item.title}`} value={comparisonRanks[item.id] ?? index + 1} onChange={(event) => setComparisonRanks({ ...comparisonRanks, [item.id]: Number((event.currentTarget as HTMLSelectElement).value) })}><option value="1">1 · strongest</option><option value="2">2 · middle</option><option value="3">3 · third</option></select></label>
          </CardBody>
        </article>)}
        <Card class="comparison-save-card"><div class="card-head"><div><h2>Rank these three</h2><span class="subtle">Choose the same rank to record a tie.</span></div></div><CardBody><button type="button" class="button primary reviewer-save" disabled={queue.length < 3 || saving} onClick={() => void saveComparison()}>{saving ? "Saving…" : "Save comparison & next →"}</button><p class="review-shortcuts">Every card is authorized independently before evidence is stored.</p></CardBody></Card>
      </div> : <div class="reviewer-layout" data-queue-id={current.queue_id} data-queue-index={currentIndex} data-mobile-review="scorecard">
        <article ref={(element) => { cardRef.current = element; }} class="card review-submission-card" role="button" tabIndex={0} aria-label={`Open full submission ${current.id}`} onClick={() => void openDetail()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openDetail(); } }}>
          <CardBody>
            <div class="review-card-chips"><span class="chip">{current.format ?? "Abstract"}</span>{current.tracks.map((track, index) => <span class="chip" key={track.id} style={{ borderLeft: `3px solid ${track.color}` }}>{track.name}{index === 0 ? " · Primary" : ""}</span>)}<span class="chip tabular">{current.id}</span></div>
            <h2>{current.title}</h2>
            <div class="eyebrow">Abstract</div>
            <p class="review-abstract">{current.abstract ?? "No abstract was submitted."}</p>
            <div class="divider" />
            <div class="eyebrow">Evaluator view</div>
            <p class="subtle">Full abstract, conference fields, and attached files are available without exposing speaker identity.</p>
            <div class="review-open-row"><span class="subtle">Open the full submission without losing queue position</span><span class="button small" aria-hidden="true">Open full submission →</span></div>
          </CardBody>
        </article>
        <Card class="review-score-card">
          <div class="card-head"><div><h2>Your recommendation</h2><span class="subtle">Primary path · no numeric score required</span></div><span class="review-key-hint">A / M / D</span></div>
          <CardBody>
            <div class="decision-buttons" data-reviewer-controls="recommendation" role="group" aria-label="Recommendation">
              {["approve", "maybe", "deny"].map((value) => <button type="button" class={`decision-button ${currentReview.recommendation === value ? "active" : ""}`} aria-pressed={currentReview.recommendation === value} onClick={() => updateReview({ recommendation: value as ReviewState["recommendation"] })}>{recommendationLabel(value as ReviewState["recommendation"])}</button>)}
            </div>
            <div class="review-choice"><strong>{recommendationLabel(currentReview.recommendation)}</strong><span>{currentReview.recommendation ? `${recommendationLabel(currentReview.recommendation)} saves a proposal; only a program lead changes lifecycle status.` : "Approve, Maybe, and Deny do not require a scorecard."}</span></div>
            <div class="divider" />
            <div class="score-heading"><span class="subtle">Overall score (optional) · keys 1–5</span><button type="button" class="clear-score" onClick={() => updateReview({ score: null })} disabled={currentReview.score === null}>Clear</button></div>
            <div class="score-buttons" data-reviewer-controls="score" role="group" aria-label="Numeric score (optional)">{[1, 2, 3, 4, 5].map((score) => <button type="button" class={currentReview.score === score ? "active" : ""} aria-pressed={currentReview.score === score} onClick={() => updateReview({ score })}>{score}</button>)}</div>
            {criteria.length > 0 && <div class="review-criteria" data-reviewer-controls="criteria">
              <div class="divider" />
              <span class="subtle">{roundName} scorecard</span>
              {criteria.map((criterion) => <div class="review-criterion" key={criterion.id}>
                <span class="review-criterion-name">{criterion.name}{criterion.kind === "numeric" && criterion.weight_pct > 0 ? <span class="subtle tabular"> · {criterion.weight_pct}%</span> : null}</span>
                {criterion.kind === "numeric" && <div class="score-buttons" role="group" aria-label={criterion.name}>{scaleSteps(criterion).map((step) => <button type="button" key={step} class={currentReview.criteria[criterion.id] === step ? "active" : ""} aria-pressed={currentReview.criteria[criterion.id] === step} onClick={() => setCriterion(criterion.id, step)}>{step}</button>)}</div>}
                {criterion.kind === "select" && <select aria-label={criterion.name} value={String(currentReview.criteria[criterion.id] ?? "")} onChange={(event) => setCriterion(criterion.id, (event.currentTarget as HTMLSelectElement).value)}><option value="">Not answered</option>{(criterion.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>}
                {criterion.kind === "text" && <textarea aria-label={criterion.name} rows={3} value={String(currentReview.criteria[criterion.id] ?? "")} onInput={(event) => setCriterion(criterion.id, (event.currentTarget as HTMLTextAreaElement).value)} />}
              </div>)}
            </div>}
            <label class="review-comment"><span>Committee note (optional)</span><textarea data-reviewer-control="comment" value={currentReview.comment} placeholder="Context for the committee" onInput={(event) => updateReview({ comment: (event.currentTarget as HTMLTextAreaElement).value })} /></label>
            <div class="review-save-actions"><button type="button" class="button primary reviewer-save" data-reviewer-control="save-next" disabled={!currentReview.recommendation || saving} onClick={() => void saveNext()}>{saving ? "Saving…" : "Save recommendation & next →"}</button><button type="button" class="button reviewer-conflict" data-reviewer-control="declare-conflict" disabled={saving} onClick={() => void saveRecusal()}>Declare conflict</button></div>
            <p class="review-shortcuts">Keyboard: <span class="tabular">A M D</span> recommendation · <span class="tabular">1–5</span> score · <span class="tabular">Enter</span> save &amp; next</p>
          </CardBody>
        </Card>
      </div>}
      {completed.length > 0 && <section class="reviewer-completed" aria-label="Completed reviews">
        <header class="reviewer-completed-head">
          <div><span class="eyebrow">Completed</span><h2><span class="tabular">{completed.length}</span> review{completed.length === 1 ? "" : "s"} submitted</h2></div>
          <span class="subtle">{completedTruncated ? "Your most recent reviews. Reopen any of them to see exactly what was recorded." : "Reopen any of them to see exactly what was recorded."}</span>
        </header>
        <div class="reviewer-completed-list">
          {completed.map((item) => <button type="button" class="reviewer-completed-row" key={item.id} onClick={() => void openDetailFor(item.id)}>
            <span class="completed-mark" aria-hidden="true">✓</span>
            <span class="completed-title">{item.title}</span>
            <span class="chip">{item.review?.abstained ? "Conflict" : item.review ? recommendationLabel(item.review.recommendation) : "Recorded"}</span>
            <span class="completed-open">Reopen →</span>
          </button>)}
        </div>
      </section>}
    </div>
    {detailOpen && <div class="reviewer-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
      <section ref={(element) => { detailRef.current = element; }} class="reviewer-detail" role="dialog" aria-modal="true" aria-labelledby="reviewer-detail-title" tabIndex={-1} data-reviewer-detail data-mobile-review="detail">
        {detailLoading || !detail ? <div class="reviewer-detail-loading"><span class="eyebrow">Reviewer item</span><strong>Loading full submission…</strong></div> : <>
          <header class="reviewer-detail-head"><div><span class="eyebrow">{detail.blind_mode ? "Anonymous submission" : "Submission"} · queue position preserved</span><h2 id="reviewer-detail-title">{detail.title}</h2><p>{detail.blind_mode ? "Speaker identity and contact fields remain redacted while blind review is active." : "Evaluator-visible submission details."}</p></div><button type="button" class="reviewer-detail-close" onClick={closeDetail} aria-label="Close full submission">×</button></header>
          <div class="reviewer-detail-body">
            <div class="review-card-chips"><span class="chip">{detail.format ?? "Abstract"}</span>{detail.tracks.map((track, index) => <span class="chip" key={track.id} style={{ borderLeft: `3px solid ${track.color}` }}>{track.name}{index === 0 ? " · Primary" : ""}</span>)}<span class="chip tabular">{detail.id}</span></div>
            <section class="reviewer-detail-section"><h3>Full abstract</h3><p class="detail-copy">{detail.abstract ?? "No abstract was submitted."}</p></section>
            <section class="reviewer-detail-section"><h3>Evaluator-visible submission fields</h3>{detail.fields.length ? <dl class="review-field-grid">{detail.fields.map((field) => <div class="review-field" key={field.key}><dt>{field.label}</dt><dd>{displayField(field)}</dd></div>)}</dl> : <p class="subtle">No additional conference fields were submitted.</p>}</section>
            <section class="reviewer-detail-section"><h3>Speaker details{detail.blind_mode ? " · blind mode" : ""}</h3><dl class="review-field-grid">
              <div class="review-field"><dt>Speaker name</dt><dd>{detail.blind_mode ? <span class="blind-redaction">Redacted in anonymous review</span> : detail.identity?.name ?? "Not recorded"}</dd></div>
              <div class="review-field"><dt>Email</dt><dd>{detail.blind_mode ? <span class="blind-redaction">Redacted in anonymous review</span> : detail.identity?.email ?? "Not recorded"}</dd></div>
              <div class="review-field"><dt>Company / affiliation</dt><dd>{detail.blind_mode ? <span class="blind-redaction">Redacted in anonymous review</span> : detail.identity?.company ?? "Not recorded"}</dd></div>
              <div class="review-field"><dt>Biography</dt><dd>{detail.blind_mode ? <span class="blind-redaction">Redacted in anonymous review</span> : detail.identity?.bio ?? "Not recorded"}</dd></div>
            </dl></section>
            <section class="reviewer-detail-section"><h3>Attached files · {detail.files.length}</h3>{detail.files.length ? <div class="review-file-list">{detail.files.map((file) => <div class="review-file-row" key={file.id}><span class="review-file-icon">{file.content_type.split("/").pop()?.toUpperCase() ?? "FILE"}</span><div><strong>{file.filename}</strong><span>{file.content_type} · {formatFileSize(file.size_bytes)}</span></div><Chip tone={file.status === "ready" ? "success" : "warning"}>{file.status === "ready" ? "Available" : "Processing"}</Chip></div>)}</div> : <p class="subtle">No files attached to this submission.</p>}</section>
            {detail.review && <section class="reviewer-detail-section"><h3>{detail.review.abstained ? "Conflict recorded" : "Your saved review"}</h3><div class="saved-review"><strong>{detail.review.abstained ? "Declared conflict" : recommendationLabel(detail.review.recommendation)}</strong><span>{detail.review.comment || "No committee note."}</span><small>Saved by reviewer <span class="tabular">{detail.review.actor_id}</span> · {new Date(detail.review.updated_at).toLocaleString()}</small></div>
              {detail.review.criteria_scores && Object.keys(detail.review.criteria_scores).length > 0 && <dl class="review-field-grid saved-criteria" data-saved-criteria>
                {Object.entries(detail.review.criteria_scores).map(([criterionId, value]) => <div class="review-field" key={criterionId}>
                  <dt>{criteria.find((criterion) => criterion.id === criterionId)?.name ?? criterionId}</dt>
                  <dd class="tabular">{String(value)}</dd>
                </div>)}
              </dl>}
              {detail.review.score !== null && <p class="subtle">Overall score <span class="tabular">{detail.review.score}</span></p>}
            </section>}
          </div>
          <footer class="reviewer-detail-actions"><span class="subtle">Queue ID <span class="tabular">{detail.id}</span> · position <span class="tabular">{currentIndex + 1}</span> preserved</span><Button variant="primary" onClick={closeDetail}>Close &amp; return to queue</Button></footer>
        </>}
      </section>
    </div>}
  </main>;
}
