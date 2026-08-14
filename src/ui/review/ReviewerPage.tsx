import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { formatFileSize, readStoredFileAnswer } from "../../lib/file-answers";
import { ROLE_HOME } from "../../lib/auth/role-home";
import type { SocialPlatformId } from "../../lib/social-links";
import { ProfileForm, type PortalPerson } from "../portal/PortalPage";
import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, Chip, EmptyState } from "../shell/components";
import { ThemeSwitch } from "../shell/ThemeSwitch";
import { useIdentity } from "../shell/identity";
import { reviewerRevisionFor, reviewStateForRevision, reviewerRevisionId, reviewerRevisionPath } from "./reviewer-revision";
import "./review.css";


interface Scope {
  color: string;
  id: string;
  name: string;
}

interface Committee {
  id: string;
  name: string;
  role: string;
}

interface ReviewerCounts {
  reviewed: number;
  total: number;
  waiting: number;
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

export interface QueueEnvelope {
  committees?: Committee[];
  completed?: CompletedItem[];
  completed_truncated?: boolean;
  counts?: ReviewerCounts;
  current_id?: string | null;
  current_index?: number | null;
  data: QueueItem[];
  eligible_count?: number;
  plan: { id: string; name: string };
  position?: number;
  remaining?: number;
  round: { anonymized: boolean; closes_at?: number | null; criteria?: Criterion[]; id: string; mode: "scorecard" | "comparison"; name: string; position?: number };
  social_platforms?: SocialPlatformId[];
  person?: PortalPerson | null;
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

/** A rating renders the scale plus any recorded value the reviewer must be able to see. */
function ratingSteps(minValue: number | null, maxValue: number | null): number[] {
  const min = Math.round(minValue ?? DEFAULT_SCALE_MIN);
  const max = Math.round(maxValue ?? DEFAULT_SCALE_MAX);
  if (max <= min) return [min];
  const steps: number[] = [];
  for (let value = min; value <= max && steps.length < 20; value += 1) steps.push(value);
  return steps;
}

function includeRecordedStep(steps: number[], recordedValue: number | string | undefined): number[] {
  if (typeof recordedValue !== "number" || !Number.isFinite(recordedValue) || steps.includes(recordedValue)) return steps;
  return [...steps, recordedValue].sort((left, right) => left - right);
}

function scaleSteps(criterion: Criterion): number[] {
  return ratingSteps(criterion.scale_min, criterion.scale_max);
}

function scaleStepsForReview(criterion: Criterion, recordedValue: number | string | undefined): number[] {
  return includeRecordedStep(scaleSteps(criterion), recordedValue);
}

function overallScoreSteps(recordedValue: number | null): number[] {
  return includeRecordedStep(ratingSteps(DEFAULT_SCALE_MIN, DEFAULT_SCALE_MAX), recordedValue ?? undefined);
}

function isOutsideScale(value: number | string | undefined, minValue: number | null, maxValue: number | null): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const min = Math.round(minValue ?? DEFAULT_SCALE_MIN);
  const max = Math.round(maxValue ?? DEFAULT_SCALE_MAX);
  return value < min || value > max;
}

function recordedScaleNotice(value: number | string | undefined, minValue: number | null, maxValue: number | null): string | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return "Recorded value is not a finite number. Choose a replacement before saving.";
  if (!isOutsideScale(value, minValue, maxValue)) return null;
  const min = Math.round(minValue ?? DEFAULT_SCALE_MIN);
  const max = Math.round(maxValue ?? DEFAULT_SCALE_MAX);
  return `Recorded value ${value} is outside the current scale (${min}–${max}). Saving preserves it until you choose a replacement.`;
}

function RecordedScaleNote({ value, min, max }: { value: number | string | undefined; min: number | null; max: number | null }): JSX.Element {
  const message = recordedScaleNotice(value, min, max);
  return <p class="reviewer-recorded-scale-note" aria-hidden={message ? undefined : "true"}>{message ?? " "}</p>;
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

function formatRoundClose(value: number | null): string | null {
  if (value === null) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function committeeRoleLabel(role: string): string {
  return role.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** A home revision is a real link; the queue keeps its in-place revision action. */
export function ReviewerRevisionAction({
  isHome,
  onRevision,
  submissionId,
}: {
  isHome: boolean;
  onRevision: () => void;
  submissionId: string;
}): JSX.Element {
  if (isHome) return <a class="button small" href={reviewerRevisionPath(submissionId)}>Revise this review</a>;
  return <Button small onClick={onRevision}>Revise this review</Button>;
}

export interface ReviewerPageProps {
  eventId: string;
  initialQueue?: QueueEnvelope;
  /** Test/SSR seam; the browser uses its real location when this is omitted. */
  locationSearch?: string;
  mode?: "home" | "queue";
}

export function ReviewerPage({ eventId, initialQueue, locationSearch: locationSearchOverride, mode = "queue" }: ReviewerPageProps): JSX.Element {
  // Anonymity runs one way: the reviewer must not see the speaker. Hiding the
  // reviewer from themselves buys nothing and costs attribution — every review
  // recorded here lands under this name on the organizer's record, so the name
  // belongs on screen while the review is being written.
  const identity = useIdentity();
  const isHome = mode === "home";
  const initialSearch = locationSearchOverride ?? (typeof window === "undefined" ? "" : window.location.search);
  const initialCounts = initialQueue?.counts ?? {
    reviewed: initialQueue?.completed?.length ?? 0,
    total: (initialQueue?.remaining ?? initialQueue?.data.length ?? 0) + (initialQueue?.completed?.length ?? 0),
    waiting: initialQueue?.remaining ?? initialQueue?.data.length ?? 0,
  };
  const initialPlan: ReviewerPlan | null = initialQueue ? {
    id: initialQueue.plan.id,
    name: initialQueue.plan.name,
    rounds: [{ ...initialQueue.round, position: initialQueue.round.position ?? 0 }],
  } : null;
  const initialRevisionTarget = initialQueue && !isHome
    ? reviewerRevisionFor(initialSearch, initialQueue.completed ?? [])
    : null;
  const initialRevision = initialRevisionTarget?.item ?? null;
  const initialDrafts = Object.fromEntries([
    ...(initialQueue?.data ?? []).map((item) => [item.id, { ...EMPTY_REVIEW }] as const),
    ...(initialRevisionTarget ? [[initialRevisionTarget.item.id, initialRevisionTarget.state] as const] : []),
  ]) as Record<string, ReviewState>;
  const [plan, setPlan] = useState<ReviewerPlan | null>(initialPlan);
  const [roundId, setRoundId] = useState<string | null>(initialQueue?.round.id ?? null);
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue?.data ?? []);
  const [completed, setCompleted] = useState<CompletedItem[]>(initialQueue?.completed ?? []);
  const [completedTruncated, setCompletedTruncated] = useState(Boolean(initialQueue?.completed_truncated));
  const [criteria, setCriteria] = useState<Criterion[]>(initialQueue?.round.criteria ?? []);
  const [scopes, setScopes] = useState<Scope[]>(initialQueue?.scopes ?? []);
  const [committees, setCommittees] = useState<Committee[]>(initialQueue?.committees ?? []);
  const [counts, setCounts] = useState<ReviewerCounts>(initialCounts);
  const [profile, setProfile] = useState<PortalPerson | null>(initialQueue?.person ?? null);
  const [socialPlatforms, setSocialPlatforms] = useState<SocialPlatformId[]>(initialQueue?.social_platforms ?? []);
  const [profileEditing, setProfileEditing] = useState(false);
  const [roundClosesAt, setRoundClosesAt] = useState<number | null>(initialQueue?.round.closes_at ?? null);
  const [roundName, setRoundName] = useState(initialQueue?.round.name || "Initial review");
  const [roundMode, setRoundMode] = useState<"scorecard" | "comparison">(initialQueue?.round.mode ?? "scorecard");
  const [blindMode, setBlindMode] = useState(initialQueue?.round.anonymized ?? true);
  const [currentId, setCurrentId] = useState<string | null>(initialQueue?.current_id ?? initialQueue?.data[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, ReviewState>>(initialDrafts);
  const [comparisonRanks, setComparisonRanks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(!initialQueue);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  /**
   * The review being revised, if any.
   *
   * A recorded review used to be readable only as four sections down inside
   * the full-submission modal, and correctable not at all — even though the
   * write endpoint has always been an upsert. Revision re-enters the ordinary
   * review layout with the stored values in place, so "see exactly what you
   * recorded" and "change it" are the same screen.
  */
  const [revising, setRevisingState] = useState<CompletedItem | null>(initialRevision);
  const revisingRef = useRef<CompletedItem | null>(initialRevision);
  const setRevising = (item: CompletedItem | null): void => {
    revisingRef.current = item;
    setRevisingState(item);
  };
  const cardRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const initialQueue = await api<QueueEnvelope>(`/api/v1/events/${eventId}/reviewer/queue`);
      const queueResponse = !isHome && initialQueue.round.mode === "comparison"
        ? await api<QueueEnvelope>(`/api/v1/events/${eventId}/rounds/${initialQueue.round.id}/comparisons/next`)
        : initialQueue;
      const initialCounts = initialQueue.counts ?? {
        reviewed: initialQueue.completed?.length ?? 0,
        total: (initialQueue.remaining ?? initialQueue.data.length) + (initialQueue.completed?.length ?? 0),
        waiting: initialQueue.remaining ?? initialQueue.data.length,
      };
      const responseCounts = queueResponse.counts ?? initialCounts;
      setPlan({
        id: queueResponse.plan.id,
        name: queueResponse.plan.name,
        rounds: [{ ...queueResponse.round, position: queueResponse.round.position ?? 0 }],
      });
      setRoundId(queueResponse.round.id);
      setRoundName(queueResponse.round.name || initialQueue.round.name || "Initial review");
      setRoundMode(queueResponse.round.mode);
      setBlindMode(queueResponse.round.anonymized ?? initialQueue.round.anonymized);
      setRoundClosesAt(queueResponse.round.closes_at ?? initialQueue.round.closes_at ?? null);
      setScopes(queueResponse.scopes ?? initialQueue.scopes);
      setCommittees(queueResponse.committees ?? initialQueue.committees ?? []);
      setCounts(responseCounts);
      setProfile(queueResponse.person ?? initialQueue.person ?? null);
      setSocialPlatforms(queueResponse.social_platforms ?? initialQueue.social_platforms ?? []);
      setCriteria(queueResponse.round.criteria ?? initialQueue.round.criteria ?? []);
      const loadedCompleted = queueResponse.completed ?? initialQueue.completed ?? [];
      setCompleted(loadedCompleted);
      setCompletedTruncated(Boolean(queueResponse.completed_truncated ?? initialQueue.completed_truncated));
      setQueue(queueResponse.data);
      setCurrentId(queueResponse.current_id ?? queueResponse.data[0]?.id ?? null);
      if (queueResponse.round.mode === "comparison") {
        setComparisonRanks((previous) => {
          const next = { ...previous };
          for (const [index, item] of queueResponse.data.slice(0, 3).entries()) next[item.id] ??= index + 1;
          return next;
        });
      }
      const revisionTarget = !isHome
        ? reviewerRevisionFor(window.location.search, loadedCompleted, revisingRef.current?.id ?? null)
        : null;
      setDrafts((previous) => {
        const next = { ...previous };
        for (const item of queueResponse.data) next[item.id] ??= { ...EMPTY_REVIEW };
        if (revisionTarget) next[revisionTarget.item.id] ??= revisionTarget.state;
        return next;
      });
      const revision = revisionTarget?.item ?? null;
      setRevising(revision);
      if (revision && reviewerRevisionId(window.location.search)) {
        const url = new URL(window.location.href);
        url.searchParams.delete("revise");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      } else if (!isHome && new URLSearchParams(window.location.search).has("revise")) {
        setError("That saved review is no longer available in this round.");
      }
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setLoading(false);
    }
  }, [eventId, initialQueue, isHome]);

  useEffect(() => { if (!initialQueue) void load(); }, [initialQueue, load]);

  const currentIndex = useMemo(() => {
    const index = currentId === null ? -1 : queue.findIndex((item) => item.id === currentId);
    return index >= 0 ? index : 0;
  }, [currentId, queue]);
  const current = revising ?? queue[currentIndex] ?? null;
  const currentReview = current ? drafts[current.id] ?? EMPTY_REVIEW : EMPTY_REVIEW;

  const returnHome = (): void => { window.location.assign(ROLE_HOME.reviewer); };

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

  /** Re-enter the review layout with what the reviewer already recorded. */
  const openRevision = (item: CompletedItem): void => {
    setDrafts((previous) => ({
      ...previous,
      [item.id]: reviewStateForRevision(item),
    }));
    setError(null);
    setNotice(null);
    setRevising(item);
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: "start" }));
  };

  const leaveRevision = (): void => {
    setRevising(null);
    setNotice(null);
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
      if (revising) {
        const savedAt = Date.now();
        const updated: DetailReview = {
          abstained: review.abstained,
          actor_id: revising.review?.actor_id ?? "",
          comment: review.comment,
          created_at: revising.review?.created_at ?? savedAt,
          criteria_scores: Object.keys(review.criteria).length ? review.criteria : null,
          decision_proposal: null,
          recommendation: review.abstained ? null : review.recommendation,
          score: review.abstained ? null : review.score,
          updated_at: savedAt,
        };
        setCompleted((previous) => previous.map((item) => item.id === revising.id ? { ...item, review: updated } : item));
        setRevising(null);
        setNotice(review.abstained ? "Conflict recorded · your review was replaced by the conflict" : `Review updated · ${recommendationLabel(review.recommendation)} recorded`);
        return;
      }
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
      setCounts((previous) => ({ ...previous, reviewed: previous.reviewed + 1, waiting: Math.max(0, previous.waiting - 1) }));
      setCurrentId(nextQueue[oldIndex]?.id ?? nextQueue[oldIndex - 1]?.id ?? null);
      setNotice(review.abstained ? "Conflict recorded · reopen it any time from your reviewer home" : `${recommendationLabel(review.recommendation)} saved · reopen it any time from your reviewer home`);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setSaving(false);
    }
  };

  const saveNext = async (): Promise<void> => {
    if (!currentReview.recommendation) return;
    if (currentReview.abstained && !revising) return;
    await commitReview({ ...currentReview, abstained: false });
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
      if (isHome || detailOpen || saving || !current || roundMode === "comparison") return;
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
  }, [current, currentReview.recommendation, currentReview.score, detailOpen, isHome, roundMode, saving]);

  if (loading) return <main class="reviewer-surface instrument" aria-busy="true"><div class="reviewer-loading"><span class="eyebrow">Reviewer {isHome ? "home" : "queue"}</span><strong>Loading your reviewer seat…</strong><span class="subtle">Applying your track responsibility before any submission fields load.</span></div></main>;
  if (error && !plan) return <main class="reviewer-surface"><div class="reviewer-frame"><EmptyState title="Reviewer seat unavailable" copy={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} /></div></main>;
  if (!plan) return <main class="reviewer-surface"><div class="reviewer-frame"><EmptyState title="No review plan" copy="A conference review round has not been configured yet." action={<Button variant="primary" onClick={returnHome}>Return to conference reviewer home</Button>} /></div></main>;

  return <main class="reviewer-surface" data-reviewer-surface="true" data-mobile-review="375px">
    <div class="reviewer-frame">
      <header class="reviewer-topline">
        <a class="reviewer-brand" href={ROLE_HOME.reviewer} aria-label="Marquee reviewer home"><span class="brand-mark" aria-hidden="true">M</span><span>Marquee</span><span class="reviewer-slash">/</span><strong>{isHome ? "Reviewer home" : "Reviewer"}</strong></a>
        <div class="reviewer-top-meta">
          <span class="chip reviewer-whoami" title="The reviewer this queue belongs to">{identity ? `Reviewing as ${identity.name}` : "Reviewing as you"}</span>
          {isHome ? <span class="chip">Reviewer seat</span> : <><span class="chip">{roundName}</span><span class="chip">{roundMode === "comparison" ? "Comparison mode" : "Scorecard mode"}</span><span class="chip success">{blindMode ? "Anonymous review" : "Identity visible"}</span><a class="reviewer-exit" href={ROLE_HOME.reviewer}>Exit queue</a></>}
          <ThemeSwitch />
        </div>
      </header>
      <header class="reviewer-heading">
        <div><span class="eyebrow">{plan.name}</span><h1>{isHome ? "Reviewer home" : roundMode === "comparison" ? "Comparison queue" : "Reviewer queue"}</h1><p>{isHome ? "Your assignment, responsibility, reviews, and profile." : roundMode === "comparison" ? <><span class="tabular">{counts.reviewed}</span> of <span class="tabular">{counts.total}</span> reviews submitted · <span class="tabular">{Math.min(3, queue.length)}</span> submissions loaded · rank ties are allowed</> : <><span class="tabular">{counts.reviewed}</span> of <span class="tabular">{counts.total}</span> reviews submitted · <span class="tabular">{queue.length ? currentIndex + 1 : 0}</span> of <span class="tabular">{queue.length}</span> waiting</>}</p></div>
        <button type="button" class="reviewer-refresh" onClick={() => void load()} disabled={loading}>{isHome ? "Refresh home" : "Refresh queue"}</button>
      </header>
      <section class="reviewer-feedback-slot" data-reviewer-feedback aria-live="polite">
        {error ? <div class="reviewer-alert alarm" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div> : notice ? <div class="reviewer-alert success" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div> : <span class="reviewer-feedback-placeholder" aria-hidden="true" />}
      </section>
      {isHome ? <>
        <section class="reviewer-home-block reviewer-assignment" aria-labelledby="reviewer-assignment-heading">
          <header class="reviewer-home-block-head">
            <div><span class="eyebrow">Your assignment</span><h2 id="reviewer-assignment-heading">{roundName}</h2><p>{roundMode === "comparison" ? "Compare three submissions at a time." : "Review assigned submissions at your own pace."}</p></div>
            <div class="reviewer-assignment-chips"><span class="chip">{roundMode === "comparison" ? "Comparison mode" : "Scorecard mode"}</span><span class="chip success">{blindMode ? "Anonymous review" : "Identity visible"}</span></div>
          </header>
          <div class="reviewer-home-stat-grid" aria-label="Review progress">
            <div class="reviewer-home-stat"><span>Waiting</span><strong class="tabular">{counts.waiting}</strong><small>to review</small></div>
            <div class="reviewer-home-stat"><span>Reviewed</span><strong class="tabular">{counts.reviewed}</strong><small>submitted</small></div>
            <div class="reviewer-home-stat"><span>Assignment</span><strong class="tabular">{counts.total}</strong><small>in this round</small></div>
          </div>
          <div class="reviewer-assignment-foot">
            <span class="reviewer-close-date">{roundClosesAt !== null ? `Closes ${formatRoundClose(roundClosesAt)}` : <span aria-hidden="true" />}</span>
            {counts.waiting > 0 ? <a class="button primary reviewer-home-cta" href="/reviewer/queue">Start reviewing <span aria-hidden="true">→</span></a> : <div class="reviewer-home-clear"><span class="completed-mark" aria-hidden="true">✓</span><strong>Queue clear</strong><span>Everything assigned to you is reviewed.</span></div>}
          </div>
        </section>

        <section class="reviewer-home-block reviewer-responsibility" aria-label="Your track responsibility">
          <div><span class="eyebrow">Your responsibility</span><div class="scope-row">{scopes.length ? scopes.map((scope) => <Chip key={scope.id}><span class="scope-dot" style={{ background: scope.color }} />{scope.name}</Chip>) : <span class="subtle">No track scope is assigned.</span>}</div></div>
          <div class="reviewer-responsibility-copy"><p>A submission appears when it is assigned to you in this round and carries a track in your scope. Record, file, export, and review access use the same rule.</p>{committees.length ? <div class="reviewer-committee-list"><span class="eyebrow">Your committees</span>{committees.map((committee) => <span class="reviewer-committee" key={committee.id}><strong>{committee.name}</strong><span>{committeeRoleLabel(committee.role)}</span></span>)}</div> : null}</div>
        </section>

        <section class="reviewer-home-block reviewer-home-reviews" aria-labelledby="reviewer-reviews-heading">
          <header class="reviewer-home-block-head">
            <div><span class="eyebrow">Your reviews</span><h2 id="reviewer-reviews-heading"><span class="tabular">{counts.reviewed}</span> review{counts.reviewed === 1 ? "" : "s"} submitted</h2></div>
            <span class="subtle">{completedTruncated ? "Most recent reviews shown" : "Saved recommendations"}</span>
          </header>
          <div class="reviewer-completed-list">
            {completed.length ? completed.map((item) => <button type="button" class="reviewer-completed-row" key={item.id} onClick={() => void openDetailFor(item.id)}>
              <span class="completed-mark" aria-hidden="true">✓</span><span class="completed-title">{item.title}</span><span class="chip">{item.review?.abstained ? "Conflict" : item.review ? recommendationLabel(item.review.recommendation) : "Recorded"}</span><span class="completed-open">Read / Reopen →</span>
            </button>) : <div class="reviewer-home-empty"><strong>No reviews recorded in this round yet.</strong><span>When you save a recommendation, it will stay here with the decision you gave.</span></div>}
          </div>
        </section>

        <section class="reviewer-home-block reviewer-profile-panel" aria-labelledby="reviewer-profile-heading">
          <header class="reviewer-home-block-head">
            <div><span class="eyebrow">Your profile</span><h2 id="reviewer-profile-heading">What the conference team sees</h2></div>
            {profile ? <button type="button" class="reviewer-profile-toggle" onClick={() => setProfileEditing((current) => !current)}>{profileEditing ? "Close editor" : "Edit profile"}</button> : null}
          </header>
          <div class="reviewer-profile-body">
            {!profile ? <div class="reviewer-home-empty"><strong>Profile details are unavailable.</strong><span>Refresh the reviewer home to load your profile.</span></div> : profileEditing ? <ProfileForm eventId={eventId} person={profile} platforms={socialPlatforms} onSaved={async (next) => { setProfile(next); setProfileEditing(false); setNotice("Profile saved · your reviewer record is up to date"); }} /> : <div class="reviewer-profile-summary"><div><strong>{profile.name}</strong><span>{profile.email}</span></div><dl><div><dt>Title</dt><dd>{profile.title || "Not added"}</dd></div><div><dt>Company</dt><dd>{profile.company || "Not added"}</dd></div><div class="reviewer-profile-bio"><dt>Bio</dt><dd>{profile.bio || "No bio added yet."}</dd></div></dl><p class="subtle">{profile.social_links.length ? `${profile.social_links.length} social link${profile.social_links.length === 1 ? "" : "s"} on file` : "No social links on file"} · {profile.headshot_attachment_id ? "Headshot on file" : "No headshot on file"}</p></div>}
          </div>
        </section>
      </> : <>
        {!current ? <section class="reviewer-empty instrument"><span class="empty-mark" aria-hidden="true">✓</span><h2>{roundMode === "comparison" ? "Comparison queue clear" : "Queue clear"}</h2><p>{roundMode === "comparison" ? "There are not three submissions assigned to you within your track responsibility waiting for comparison." : "There are no unreviewed submissions assigned to you within your track responsibility."}</p><a class="button" href={ROLE_HOME.reviewer}>Return to reviewer home</a><button type="button" class="button" onClick={() => void load()}>Check again</button></section> : roundMode === "comparison" ? <div class="comparison-board" data-comparison-round={roundId} data-mobile-review="comparison">
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
          <div class="card-head"><div><h2>Your recommendation</h2><span class="subtle">{revising ? `Recorded ${new Date(revising.review?.updated_at ?? Date.now()).toLocaleString()} · saving updates your review` : "Primary path · no numeric score required"}</span></div><span class="review-key-hint">A / M / D</span></div>
          <CardBody>
            <div class="decision-buttons" data-reviewer-controls="recommendation" role="group" aria-label="Recommendation">
              {["approve", "maybe", "deny"].map((value) => <button type="button" class={`decision-button ${currentReview.recommendation === value ? "active" : ""}`} aria-pressed={currentReview.recommendation === value} onClick={() => updateReview({ recommendation: value as ReviewState["recommendation"] })}>{recommendationLabel(value as ReviewState["recommendation"])}</button>)}
            </div>
            <div class="review-choice"><strong>{recommendationLabel(currentReview.recommendation)}</strong><span>{currentReview.recommendation ? `${recommendationLabel(currentReview.recommendation)} saves a proposal; only a program lead changes lifecycle status.` : "Approve, Maybe, and Deny do not require a scorecard."}</span></div>
            <div class="divider" />
            <div class="score-heading"><span class="subtle">Overall score (optional) · keys 1–5</span><button type="button" class="clear-score" onClick={() => updateReview({ score: null })} disabled={currentReview.score === null}>Clear</button></div>
            <div class="score-buttons" data-reviewer-controls="score" role="group" aria-label="Numeric score (optional)">{overallScoreSteps(currentReview.score).map((score) => <button type="button" class={`${currentReview.score === score ? "active" : ""}${isOutsideScale(score, DEFAULT_SCALE_MIN, DEFAULT_SCALE_MAX) ? " recorded-out-of-range" : ""}`} aria-pressed={currentReview.score === score} onClick={() => updateReview({ score })}>{score}</button>)}</div>
            <RecordedScaleNote value={currentReview.score ?? undefined} min={DEFAULT_SCALE_MIN} max={DEFAULT_SCALE_MAX} />
            {criteria.length > 0 && <div class="review-criteria" data-reviewer-controls="criteria">
              <div class="divider" />
              <span class="subtle">{roundName} scorecard</span>
              {criteria.map((criterion) => <div class="review-criterion" key={criterion.id}>
                <span class="review-criterion-name">{criterion.name}{criterion.kind === "numeric" && criterion.weight_pct > 0 ? <span class="subtle tabular"> · {criterion.weight_pct}%</span> : null}</span>
                {criterion.kind === "numeric" && <><div class="score-buttons" role="group" aria-label={criterion.name}>{scaleStepsForReview(criterion, currentReview.criteria[criterion.id]).map((step) => <button type="button" key={step} class={`${currentReview.criteria[criterion.id] === step ? "active" : ""}${isOutsideScale(step, criterion.scale_min, criterion.scale_max) ? " recorded-out-of-range" : ""}`} aria-pressed={currentReview.criteria[criterion.id] === step} onClick={() => setCriterion(criterion.id, step)}>{step}</button>)}</div><RecordedScaleNote value={currentReview.criteria[criterion.id]} min={criterion.scale_min} max={criterion.scale_max} /></>}
                {criterion.kind === "select" && <select aria-label={criterion.name} value={String(currentReview.criteria[criterion.id] ?? "")} onChange={(event) => setCriterion(criterion.id, (event.currentTarget as HTMLSelectElement).value)}><option value="">Not answered</option>{(criterion.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>}
                {criterion.kind === "text" && <textarea aria-label={criterion.name} rows={3} value={String(currentReview.criteria[criterion.id] ?? "")} onInput={(event) => setCriterion(criterion.id, (event.currentTarget as HTMLTextAreaElement).value)} />}
              </div>)}
            </div>}
            <label class="review-comment"><span>Committee note (optional)</span><textarea data-reviewer-control="comment" value={currentReview.comment} placeholder="Context for the committee" onInput={(event) => updateReview({ comment: (event.currentTarget as HTMLTextAreaElement).value })} /></label>
            <div class="review-save-actions"><button type="button" class="button primary reviewer-save" data-reviewer-control="save-next" disabled={!currentReview.recommendation || saving} onClick={() => void saveNext()}>{saving ? "Saving…" : revising ? "Update review" : "Save recommendation & next →"}</button><button type="button" class="button reviewer-conflict" data-reviewer-control="declare-conflict" disabled={saving} onClick={() => void saveRecusal()}>Declare conflict</button>{revising ? <button type="button" class="button reviewer-leave-revision" data-reviewer-control="leave-revision" disabled={saving} onClick={leaveRevision}>Back to queue</button> : null}</div>
            <p class="review-shortcuts">Keyboard: <span class="tabular">A M D</span> recommendation · <span class="tabular">1–5</span> score · <span class="tabular">Enter</span> save &amp; next</p>
          </CardBody>
        </Card>
      </div>}
      </>}
    </div>
    {detailOpen && <div class="reviewer-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
      <section ref={(element) => { detailRef.current = element; }} class="reviewer-detail" role="dialog" aria-modal="true" aria-labelledby="reviewer-detail-title" tabIndex={-1} data-reviewer-detail data-mobile-review="detail">
        {detailLoading || !detail ? <div class="reviewer-detail-loading"><span class="eyebrow">Reviewer item</span><strong>Loading full submission…</strong></div> : <>
          <header class="reviewer-detail-head"><div><span class="eyebrow">{detail.blind_mode ? "Anonymous submission" : "Submission"} · queue position preserved</span><h2 id="reviewer-detail-title">{detail.title}</h2><p>{detail.blind_mode ? "Speaker identity and contact fields remain redacted while blind review is active." : "Evaluator-visible submission details."}</p></div><button type="button" class="reviewer-detail-close" onClick={closeDetail} aria-label="Close full submission">×</button></header>
          <div class="reviewer-detail-body">
            <div class="review-card-chips"><span class="chip">{detail.format ?? "Abstract"}</span>{detail.tracks.map((track, index) => <span class="chip" key={track.id} style={{ borderLeft: `3px solid ${track.color}` }}>{track.name}{index === 0 ? " · Primary" : ""}</span>)}<span class="chip tabular">{detail.id}</span></div>
            {detail.review && <section class="reviewer-detail-section reviewer-detail-record"><h3>{detail.review.abstained ? "Conflict recorded" : "Your saved review"}</h3><div class="saved-review"><strong>{detail.review.abstained ? "Declared conflict" : recommendationLabel(detail.review.recommendation)}</strong><span>{detail.review.comment || "No committee note."}</span><small>Saved by reviewer <span class="tabular">{detail.review.actor_id}</span> · {new Date(detail.review.updated_at).toLocaleString()}</small></div>
              {detail.review.criteria_scores && Object.keys(detail.review.criteria_scores).length > 0 && <dl class="review-field-grid saved-criteria" data-saved-criteria>
                {Object.entries(detail.review.criteria_scores).map(([criterionId, value]) => <div class="review-field" key={criterionId}>
                  <dt>{criteria.find((criterion) => criterion.id === criterionId)?.name ?? criterionId}</dt>
                  <dd class="tabular">{String(value)}</dd>
                </div>)}
              </dl>}
              {detail.review.score !== null && <p class="subtle">Overall score <span class="tabular">{detail.review.score}</span></p>}
              <div class="saved-review-actions"><ReviewerRevisionAction isHome={isHome} submissionId={detail.id} onRevision={() => { const item = completed.find((entry) => entry.id === detail.id); closeDetail(); if (item) openRevision(item); }} /></div>
            </section>}
            <section class="reviewer-detail-section"><h3>Full abstract</h3><p class="detail-copy">{detail.abstract ?? "No abstract was submitted."}</p></section>
            <section class="reviewer-detail-section"><h3>Evaluator-visible submission fields</h3>{detail.fields.length ? <dl class="review-field-grid">{detail.fields.map((field) => <div class="review-field" key={field.key}><dt>{field.label}</dt><dd>{displayField(field)}</dd></div>)}</dl> : <p class="subtle">No additional conference fields were submitted.</p>}</section>
            <section class="reviewer-detail-section"><h3>Speaker details{detail.blind_mode ? " · blind mode" : ""}</h3><dl class="review-field-grid">
              <div class="review-field"><dt>Speaker name</dt><dd>{detail.blind_mode ? <span class="blind-redaction">Redacted in anonymous review</span> : detail.identity?.name ?? "Not recorded"}</dd></div>
              <div class="review-field"><dt>Email</dt><dd>{detail.blind_mode ? <span class="blind-redaction">Redacted in anonymous review</span> : detail.identity?.email ?? "Not recorded"}</dd></div>
              <div class="review-field"><dt>Company / affiliation</dt><dd>{detail.blind_mode ? <span class="blind-redaction">Redacted in anonymous review</span> : detail.identity?.company ?? "Not recorded"}</dd></div>
              <div class="review-field"><dt>Biography</dt><dd>{detail.blind_mode ? <span class="blind-redaction">Redacted in anonymous review</span> : detail.identity?.bio ?? "Not recorded"}</dd></div>
            </dl></section>
            <section class="reviewer-detail-section"><h3>Attached files · {detail.files.length}</h3>{detail.files.length ? <div class="review-file-list">{detail.files.map((file) => <div class="review-file-row" key={file.id}><span class="review-file-icon">{file.content_type.split("/").pop()?.toUpperCase() ?? "FILE"}</span><div><strong>{file.filename}</strong><span>{file.content_type} · {formatFileSize(file.size_bytes)}</span></div><Chip tone={file.status === "ready" ? "success" : "warning"}>{file.status === "ready" ? "Available" : "Processing"}</Chip></div>)}</div> : <p class="subtle">No files attached to this submission.</p>}</section>
          </div>
          <footer class="reviewer-detail-actions"><span class="subtle">Queue ID <span class="tabular">{detail.id}</span> · position <span class="tabular">{currentIndex + 1}</span> preserved</span><Button variant="primary" onClick={closeDetail}>Close &amp; return to {isHome ? "home" : "queue"}</Button></footer>
        </>}
      </section>
    </div>}
  </main>;
}
