import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

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

interface QueueEnvelope {
  current_id: string | null;
  current_index: number | null;
  data: QueueItem[];
  plan: { id: string; name: string };
  position: number;
  remaining: number;
  round: { anonymized: boolean; id: string; name: string };
  scopes: Scope[];
  total: number;
}

interface ReviewerRound {
  anonymized: boolean;
  id: string;
  name: string;
  position: number;
}

interface ReviewerPlan {
  id: string;
  name: string;
  rounds: ReviewerRound[];
}

interface ReviewState {
  comment: string;
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
  actor_id: string;
  comment: string;
  created_at: number;
  criteria_scores: Record<string, number> | null;
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

const EMPTY_REVIEW: ReviewState = { comment: "", recommendation: null, score: null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `Reviewer request failed (${response.status})`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // Keep the honest status message when an upstream error is not JSON.
    }
    throw new Error(message);
  }
  return JSON.parse(text) as T;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function displayField(field: DetailField): string {
  if (field.value_text !== null && field.value_text !== "") return field.value_text;
  if (field.value_json === null) return "Not answered";
  try {
    const value: unknown = JSON.parse(field.value_json);
    return Array.isArray(value) ? value.join(" · ") : String(value);
  } catch {
    return field.value_json;
  }
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
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [roundName, setRoundName] = useState("Initial review");
  const [blindMode, setBlindMode] = useState(true);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewState>>({});
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
      const queueResponse = await api<QueueEnvelope>(`/api/v1/events/${eventId}/reviewer/queue`);
      setPlan({
        id: queueResponse.plan.id,
        name: queueResponse.plan.name,
        rounds: [{ ...queueResponse.round, position: 0 }],
      });
      setRoundId(queueResponse.round.id);
      setRoundName(queueResponse.round.name || "Initial review");
      setBlindMode(queueResponse.round.anonymized);
      setScopes(queueResponse.scopes);
      setQueue(queueResponse.data);
      setCurrentId(queueResponse.current_id ?? queueResponse.data[0]?.id ?? null);
      setDrafts((previous) => {
        const next = { ...previous };
        for (const item of queueResponse.data) next[item.id] ??= { ...EMPTY_REVIEW };
        return next;
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Reviewer data is unavailable");
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
    setDrafts((previous) => ({ ...previous, [current.id]: { ...(previous[current.id] ?? EMPTY_REVIEW), ...patch } }));
  };

  const openDetail = async (): Promise<void> => {
    if (!current || !roundId) return;
    cardRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : cardRef.current;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await api<SubmissionDetail>(`/api/v1/events/${eventId}/rounds/${roundId}/submissions/${current.id}`);
      setDetail(response);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The full submission is unavailable");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = (): void => {
    setDetailOpen(false);
    setDetail(null);
    requestAnimationFrame(() => cardRef.current?.focus());
  };

  const saveNext = async (): Promise<void> => {
    if (!current || !roundId || !currentReview.recommendation || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/v1/events/${eventId}/rounds/${roundId}/submissions/${current.id}/evaluations`, {
        method: "POST",
        body: JSON.stringify({
          comment: currentReview.comment,
          criteria_scores: null,
          recommendation: currentReview.recommendation,
          score: currentReview.score,
        }),
      });
      const oldIndex = currentIndex;
      const nextQueue = queue.filter((item) => item.id !== current.id);
      setQueue(nextQueue);
      setCurrentId(nextQueue[oldIndex]?.id ?? nextQueue[oldIndex - 1]?.id ?? null);
      setNotice(`${recommendationLabel(currentReview.recommendation)} saved · next submission ready`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Recommendation could not be saved");
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
      if (detailOpen || saving || !current) return;
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
  }, [current, currentReview.recommendation, currentReview.score, detailOpen, saving]);

  if (loading) return <main class="reviewer-surface instrument" aria-busy="true"><div class="reviewer-loading"><span class="eyebrow">Reviewer queue</span><strong>Loading the conference queue…</strong><span class="subtle">Applying your track responsibility before any submission fields load.</span></div></main>;
  if (error && !plan) return <main class="reviewer-surface"><div class="reviewer-frame"><EmptyState title="Reviewer queue unavailable" copy={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} /></div></main>;
  if (!plan) return <main class="reviewer-surface"><div class="reviewer-frame"><EmptyState title="No review plan" copy="A conference review round has not been configured yet." /></div></main>;

  return <main class="reviewer-surface" data-reviewer-surface="true">
    <div class="reviewer-frame">
      <header class="reviewer-topline">
        <div class="reviewer-brand"><span class="brand-mark" aria-hidden="true">M</span><span>Marquee</span><span class="reviewer-slash">/</span><strong>Reviewer</strong></div>
        <div class="reviewer-top-meta"><span class="chip">{roundName}</span><span class="chip success">{blindMode ? "Anonymous review" : "Identity visible"}</span><button type="button" class="reviewer-exit" onClick={exitQueue}>Exit queue</button></div>
      </header>
      <header class="reviewer-heading">
        <div><span class="eyebrow">{plan.name}</span><h1>Reviewer queue</h1><p><span class="tabular">{queue.length ? currentIndex + 1 : 0}</span> of <span class="tabular">{queue.length}</span> in your authorized tracks · <span class="tabular">{Math.max(0, queue.length - currentIndex - 1)}</span> remaining</p></div>
        <button type="button" class="reviewer-refresh" onClick={() => void load()} disabled={loading}>Refresh queue</button>
      </header>
      {error && <div class="reviewer-alert alarm" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
      {notice && <div class="reviewer-alert success" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
      <section class="reviewer-responsibility" aria-label="Your track responsibility">
        <div><span class="eyebrow">Your responsibility</span><div class="scope-row">{scopes.length ? scopes.map((scope) => <Chip key={scope.id}><span class="scope-dot" style={{ background: scope.color }} />{scope.name}</Chip>) : <span class="subtle">No track scope is assigned.</span>}</div></div>
        <p>A submission appears when any carried track intersects your scope. Record, file, export, and review access use the same rule.</p>
      </section>
      {!current ? <section class="reviewer-empty instrument"><span class="empty-mark" aria-hidden="true">✓</span><h2>Queue clear</h2><p>There are no unreviewed submissions in your authorized tracks.</p><button type="button" class="button" onClick={() => void load()}>Check again</button></section> : <div class="reviewer-layout" data-queue-id={current.queue_id} data-queue-index={currentIndex}>
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
            <div class="decision-buttons" role="group" aria-label="Recommendation">
              {(["approve", "maybe", "deny"] as const).map((value) => <button type="button" class={`decision-button ${currentReview.recommendation === value ? "active" : ""}`} aria-pressed={currentReview.recommendation === value} onClick={() => updateReview({ recommendation: value })}>{recommendationLabel(value)}</button>)}
            </div>
            <div class="review-choice"><strong>{recommendationLabel(currentReview.recommendation)}</strong><span>{currentReview.recommendation ? `${recommendationLabel(currentReview.recommendation)} saves a proposal; only a program lead changes lifecycle status.` : "Approve, Maybe, and Deny are independent of the optional scorecard."}</span></div>
            <div class="divider" />
            <div class="score-heading"><span class="subtle">Optional scorecard · keys 1–5</span><button type="button" class="clear-score" onClick={() => updateReview({ score: null })} disabled={currentReview.score === null}>Clear</button></div>
            <div class="score-buttons" role="group" aria-label="Optional numeric score">{[1, 2, 3, 4, 5].map((score) => <button type="button" class={currentReview.score === score ? "active" : ""} aria-pressed={currentReview.score === score} onClick={() => updateReview({ score })}>{score}</button>)}</div>
            <label class="review-comment"><span>Committee note</span><textarea value={currentReview.comment} placeholder="Optional context for the committee" onInput={(event) => updateReview({ comment: (event.currentTarget as HTMLTextAreaElement).value })} /></label>
            <button type="button" class="button primary reviewer-save" disabled={!currentReview.recommendation || saving} onClick={() => void saveNext()}>{saving ? "Saving…" : "Save recommendation & next →"}</button>
            <p class="review-shortcuts">Keyboard: <span class="tabular">A M D</span> recommendation · <span class="tabular">1–5</span> score · <span class="tabular">Enter</span> save &amp; next</p>
          </CardBody>
        </Card>
      </div>}
    </div>
    {detailOpen && <div class="reviewer-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
      <section ref={(element) => { detailRef.current = element; }} class="reviewer-detail" role="dialog" aria-modal="true" aria-labelledby="reviewer-detail-title" tabIndex={-1} data-reviewer-detail>
        {detailLoading || !detail ? <div class="reviewer-detail-loading"><span class="eyebrow">Reviewer item</span><strong>Loading full submission…</strong></div> : <>
          <header class="reviewer-detail-head"><div><span class="eyebrow">{detail.blind_mode ? "Anonymous submission" : "Submission"} · queue position preserved</span><h2 id="reviewer-detail-title">{detail.title}</h2><p>{detail.blind_mode ? "Speaker identity and contact fields remain redacted while blind review is active." : "Evaluator-visible submission details."}</p></div><button type="button" class="reviewer-detail-close" onClick={closeDetail} aria-label="Close full submission">×</button></header>
          <div class="reviewer-detail-body">
            <div class="review-card-chips"><span class="chip">{detail.format ?? "Abstract"}</span>{detail.tracks.map((track, index) => <span class="chip" key={track.id} style={{ borderLeft: `3px solid ${track.color}` }}>{track.name}{index === 0 ? " · Primary" : ""}</span>)}<span class="chip tabular">{detail.id}</span></div>
            <section class="reviewer-detail-section"><h3>Full abstract</h3><p class="detail-copy">{detail.abstract ?? "No abstract was submitted."}</p></section>
            <section class="reviewer-detail-section"><h3>Evaluator-visible submission fields</h3>{detail.fields.length ? <dl class="review-field-grid">{detail.fields.map((field) => <div class="review-field" key={field.key}><dt>{field.label}</dt><dd>{displayField(field)}</dd></div>)}</dl> : <p class="subtle">No additional conference fields were submitted.</p>}</section>
            <section class="reviewer-detail-section"><h3>Speaker details · blind mode</h3><dl class="review-field-grid"><div class="review-field"><dt>Speaker name</dt><dd><span class="blind-redaction">Redacted in anonymous review</span></dd></div><div class="review-field"><dt>Email</dt><dd><span class="blind-redaction">Redacted in anonymous review</span></dd></div><div class="review-field"><dt>Company / affiliation</dt><dd><span class="blind-redaction">Redacted in anonymous review</span></dd></div><div class="review-field"><dt>Biography</dt><dd><span class="blind-redaction">Redacted in anonymous review</span></dd></div></dl></section>
            <section class="reviewer-detail-section"><h3>Attached files · {detail.files.length}</h3>{detail.files.length ? <div class="review-file-list">{detail.files.map((file) => <div class="review-file-row" key={file.id}><span class="review-file-icon">{file.content_type.split("/").pop()?.toUpperCase() ?? "FILE"}</span><div><strong>{file.filename}</strong><span>{file.content_type} · {formatBytes(file.size_bytes)}</span></div><Chip tone={file.status === "ready" ? "success" : "warning"}>{file.status === "ready" ? "Available" : "Processing"}</Chip></div>)}</div> : <p class="subtle">No files attached to this submission.</p>}</section>
            {detail.review && <section class="reviewer-detail-section"><h3>Your saved recommendation</h3><div class="saved-review"><strong>{recommendationLabel(detail.review.recommendation)}</strong><span>{detail.review.comment || "No committee note."}</span><small>Saved by reviewer <span class="tabular">{detail.review.actor_id}</span> · {new Date(detail.review.updated_at).toLocaleString()}</small></div></section>}
          </div>
          <footer class="reviewer-detail-actions"><span class="subtle">Queue ID <span class="tabular">{detail.id}</span> · position <span class="tabular">{currentIndex + 1}</span> preserved</span><Button variant="primary" onClick={closeDetail}>Close &amp; return to queue</Button></footer>
        </>}
      </section>
    </div>}
  </main>;
}
