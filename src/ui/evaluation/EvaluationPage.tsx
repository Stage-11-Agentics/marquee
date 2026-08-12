import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { apiFetch, errorSummary, MarqueeApiError } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip, EmptyState, PageHeader } from "../shell/components";
import "./evaluation.css";

const DEFAULT_EVENT_ID = "evt_aie-ny-2026";

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

const KIND_LABEL: Record<CriterionKind, string> = {
  numeric: "Rating",
  select: "Dropdown",
  text: "Free text",
};

/**
 * Round dates are epoch milliseconds and `<input type="date">` speaks calendar
 * days, so both directions go through UTC. Reading a stored date in the browser's
 * local zone and writing it back shifts it a day for anyone west of Greenwich —
 * and a review round that opens a day early is a wrong answer, not a rounding one.
 */
function toDateInput(value: number | null): string {
  if (value === null) return "";
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

interface Round {
  anonymized: boolean;
  closes_at: number | null;
  criteria: Criterion[];
  id: string;
  mode: "scorecard" | "comparison";
  name: string;
  opens_at: number | null;
  position: number;
  progress: {
    assigned_submissions: number;
    comparisons: number;
    evaluations: number;
    reviewed_submissions: number;
    submission_count: number;
  };
  promotions: Array<{ submission_id: string; title: string }>;
  target_reviews_per_submission: number;
}

interface CommitteeMember {
  company: string | null;
  id: string;
  name: string;
  progress: number;
  track_scopes: Array<{ color: string; id: string; name: string }>;
}

interface Plan {
  committees: Array<{ id: string; members: CommitteeMember[]; name: string }>;
  id: string;
  instructions: string;
  name: string;
  rounds: Round[];
  scale_max: number | null;
  scale_min: number | null;
  status: string;
  summary: {
    evaluations: number;
    highest_score: number | null;
    submissions_with_reviews: number;
    wide_spread: number;
  };
}

interface PlanSummary {
  id: string;
  name: string;
  status: string;
}

interface EvaluationPageProps {
  eventId?: string;
}

async function api<T>(path: string, route: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    route,
  });
}

function percent(done: number, total: number): number {
  return total === 0 ? 0 : Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/**
 * Round boundaries are calendar days, stored as UTC midnight — so they are read
 * back in UTC, matching the date pickers beside them. Rendering the same value
 * in a western zone shows the day before, and a round the organizer set to open
 * on the 1st that reads "Jul 31" looks like the product losing their edit.
 */
function formatDate(value: number | null): string {
  if (value === null) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(value);
}

export function EvaluationPage({ eventId = DEFAULT_EVENT_ID }: EvaluationPageProps): JSX.Element {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"plan" | "scorecard" | "committee" | "assignment" | "promotion" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planName, setPlanName] = useState("2026 Program Review");
  const [instructions, setInstructions] = useState("Recommend Approve, Maybe, or Deny. Numeric scoring is optional.");
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [scorecardRoundId, setScorecardRoundId] = useState<string | null>(null);
  const [roundErrors, setRoundErrors] = useState<Record<string, string>>({});
  const [roundDrafts, setRoundDrafts] = useState<Record<string, string>>({});
  const [committeeName, setCommitteeName] = useState("Program reviewers");
  const [assignmentMode, setAssignmentMode] = useState<"everyone" | "n_per_submission">("n_per_submission");
  const [assignmentRoundId, setAssignmentRoundId] = useState<string | null>(null);
  const [reviewerTarget, setReviewerTarget] = useState(3);
  const [promotionStatus, setPromotionStatus] = useState("in_review");
  const [promotionQuery, setPromotionQuery] = useState("");
  const [promotionResult, setPromotionResult] = useState<{ already_promoted: number; assignments: number; promoted: number; selected: number } | null>(null);
  const [promotionApplying, setPromotionApplying] = useState(false);
  /**
   * Per-reviewer round progress, rolled up from the assignments endpoint's
   * already-correct assigned/reviewed counts. Null means "not loaded"; the card
   * shows an em dash rather than falling back to the plan-wide count, which
   * measured the wrong thing.
   */
  const [reviewerProgress, setReviewerProgress] = useState<Map<string, { assigned: number; reviewed: number }> | null>(null);

  const firstRound = plan?.rounds[0];
  const secondRound = plan?.rounds[1];
  const committee = plan?.committees[0];

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const summaries = await api<{ data: PlanSummary[] }>(`/api/v1/events/${eventId}/plans`, "/api/v1/events/{eventId}/plans");
      const current = summaries.data[0];
      if (!current) {
        setPlan(null);
        setLoading(false);
        return;
      }
      const detail = await api<Plan>(`/api/v1/events/${eventId}/plans/${current.id}`, "/api/v1/events/{eventId}/plans/{planId}");
      setPlan(detail);
      setPlanName(detail.name);
      setInstructions(detail.instructions);
      setRoundDrafts(Object.fromEntries(detail.rounds.map((round) => [round.id, round.name])));
      setReviewerTarget(detail.rounds[0]?.target_reviews_per_submission ?? 3);
      await loadReviewerProgress(detail.rounds[0]?.id ?? null);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setLoading(false);
    }
  };

  /**
   * One row per (submission, reviewer), each repeating that reviewer's round
   * totals; committee-assigned rows carry no reviewer and are skipped.
   */
  const loadReviewerProgress = async (roundId: string | null): Promise<void> => {
    if (!roundId) {
      setReviewerProgress(new Map());
      return;
    }
    try {
      const assignments = await api<{ data: Array<{ assigned_count: number; reviewed_count: number; reviewer_person_id: string | null }> }>(
        `/api/v1/events/${eventId}/rounds/${roundId}/assignments`,
        "/api/v1/events/{eventId}/rounds/{roundId}/assignments",
      );
      const rolled = new Map<string, { assigned: number; reviewed: number }>();
      for (const row of assignments.data) {
        if (!row.reviewer_person_id) continue;
        rolled.set(row.reviewer_person_id, {
          assigned: Number(row.assigned_count ?? 0),
          reviewed: Number(row.reviewed_count ?? 0),
        });
      }
      setReviewerProgress(rolled);
    } catch {
      setReviewerProgress(null);
    }
  };

  useEffect(() => { void load(); }, [eventId]);

  const savePlan = async (event: Event): Promise<void> => {
    event.preventDefault();
    try {
      const detail = await api<Plan>(`/api/v1/events/${eventId}/plans`, "/api/v1/events/{eventId}/plans", {
        method: "POST",
        body: JSON.stringify({
          name: planName,
          instructions,
          scale_min: 1,
          scale_max: 5,
          status: "open",
          rounds: [
            { name: "Initial review", position: 0, mode: "scorecard", anonymized: true, target_reviews_per_submission: reviewerTarget, criteria: [
              { name: "Impact", kind: "numeric", position: 0, weight_pct: 40, scale_min: 1, scale_max: 5 },
              { name: "Specificity", kind: "numeric", position: 1, weight_pct: 35, scale_min: 1, scale_max: 5 },
              { name: "Novelty", kind: "numeric", position: 2, weight_pct: 25, scale_min: 1, scale_max: 5 },
              { name: "Recommendation", kind: "select", position: 3, weight_pct: 0, options: ["Accept", "Maybe", "Reject"] },
              { name: "Comments", kind: "text", position: 4, weight_pct: 0 },
            ] },
            { name: "Final review", position: 1, mode: "scorecard", anonymized: false, target_reviews_per_submission: reviewerTarget, criteria: [
              { name: "Final score", kind: "numeric", position: 0, weight_pct: 100, scale_min: 1, scale_max: 10 },
              { name: "Comments", kind: "text", position: 1, weight_pct: 0 },
            ] },
          ],
        }),
      });
      setPlan(detail);
      setRoundDrafts(Object.fromEntries(detail.rounds.map((round) => [round.id, round.name])));
      setDialog(null);
      setNotice("Evaluation plan created · two rounds ready");
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    }
  };

  const scorecardRound = plan?.rounds.find((round) => round.id === scorecardRoundId) ?? null;

  const openScorecard = (round: Round): void => {
    setScorecardRoundId(round.id);
    setCriteria(round.criteria.map((criterion) => ({ ...criterion, options: criterion.options ? [...criterion.options] : null })));
    setDialog("scorecard");
  };

  const saveScorecard = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!scorecardRoundId) return;
    try {
      // Positions are renumbered on write: the round/position pair is unique, and
      // a gap left by a removed row would collide with the next criterion added.
      const payload = criteria.map((criterion, index) => ({
        id: criterion.id.startsWith("new-") ? undefined : criterion.id,
        kind: criterion.kind,
        name: criterion.name,
        options: criterion.kind === "select" ? criterion.options ?? [] : undefined,
        position: index,
        scale_max: criterion.kind === "numeric" ? criterion.scale_max : undefined,
        scale_min: criterion.kind === "numeric" ? criterion.scale_min : undefined,
        weight_pct: criterion.kind === "numeric" ? criterion.weight_pct : 0,
      }));
      await api(`/api/v1/events/${eventId}/rounds/${scorecardRoundId}/criteria`, "/api/v1/events/{eventId}/rounds/{roundId}/criteria", { method: "PUT", body: JSON.stringify({ criteria: payload }) });
      setDialog(null);
      setScorecardRoundId(null);
      setNotice(`${scorecardRound?.name ?? "Round"} scorecard saved · ${payload.length} criteri${payload.length === 1 ? "on" : "a"}`);
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    }
  };

  const updateCriterion = (id: string, patch: Partial<Criterion>): void => {
    setCriteria((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const changeKind = (criterion: Criterion, kind: CriterionKind): void => {
    updateCriterion(criterion.id, {
      kind,
      options: kind === "select" ? criterion.options ?? ["Accept", "Maybe", "Reject"] : null,
      scale_max: kind === "numeric" ? criterion.scale_max ?? 5 : null,
      scale_min: kind === "numeric" ? criterion.scale_min ?? 1 : null,
      weight_pct: kind === "numeric" ? criterion.weight_pct : 0,
    });
  };

  const addCriterion = (): void => {
    setCriteria((previous) => [...previous, {
      id: `new-${previous.length}-${previous.reduce((max, item) => Math.max(max, item.position), -1) + 1}`,
      kind: "numeric",
      name: "",
      options: null,
      position: previous.length,
      scale_max: 5,
      scale_min: 1,
      weight_pct: 0,
    }]);
  };

  const removeCriterion = (id: string): void => {
    setCriteria((previous) => previous.filter((item) => item.id !== id).map((item, index) => ({ ...item, position: index })));
  };

  const createCommittee = async (event: Event): Promise<void> => {
    event.preventDefault();
    try {
      await api(`/api/v1/events/${eventId}/committees`, "/api/v1/events/{eventId}/committees", { method: "POST", body: JSON.stringify({ name: committeeName }) });
      setDialog(null);
      setNotice("Committee created · add reviewers to begin assignment");
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    }
  };

  const distribute = async (event: Event): Promise<void> => {
    event.preventDefault();
    const targetRound = plan?.rounds.find((round) => round.id === (assignmentRoundId ?? firstRound?.id));
    if (!targetRound || !committee) return;
    try {
      await api(`/api/v1/events/${eventId}/rounds/${targetRound.id}/assignments`, "/api/v1/events/{eventId}/rounds/{roundId}/assignments", {
        method: "POST",
        body: JSON.stringify({ committee_id: committee.id, mode: assignmentMode, reviewers_per_submission: reviewerTarget }),
      });
      setDialog(null);
      setNotice(`${targetRound.name} assignments recalculated · completed reviews were preserved`);
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    }
  };

  /**
   * A rejected round edit belongs on the field that caused it, not in the alert
   * at the top of the page: the operator is looking at the date picker they just
   * changed, and the server already told us which field it objected to.
   */
  const updateRound = async (round: Round, patch: Record<string, unknown>): Promise<void> => {
    setRoundErrors((previous) => ({ ...previous, [round.id]: "" }));
    try {
      await api(`/api/v1/events/${eventId}/rounds/${round.id}`, "/api/v1/events/{eventId}/rounds/{roundId}", { method: "PATCH", body: JSON.stringify(patch) });
      setNotice(`${round.name} settings saved · recorded evidence preserved`);
      await load();
    } catch (reason: unknown) {
      if (reason instanceof MarqueeApiError && reason.status === 422) {
        setRoundErrors((previous) => ({ ...previous, [round.id]: reason.message }));
        setRoundDrafts((previous) => ({ ...previous, [round.id]: round.name }));
        return;
      }
      setError(errorSummary(reason));
    }
  };

  const runPromotion = async (preview: boolean): Promise<void> => {
    if (!firstRound || !secondRound) return;
    setPromotionApplying(!preview);
    try {
      const filter: Record<string, string> = { status: promotionStatus };
      if (promotionQuery.trim()) filter.q = promotionQuery.trim();
      const response = await api<{ already_promoted: number; assignments: number; promoted: number; selected: number }>(`/api/v1/events/${eventId}/rounds/${firstRound.id}/promote`, "/api/v1/events/{eventId}/rounds/{roundId}/promote", {
        method: "POST",
        body: JSON.stringify({ preview, selector: { filter } }),
      });
      setPromotionResult(response);
      setNotice(preview ? `${response.promoted} submissions ready · ${response.assignments} committee assignments` : `${response.promoted} submissions promoted to ${secondRound.name}`);
      if (!preview) await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setPromotionApplying(false);
    }
  };

  const numericCriteria = useMemo(() => criteria.filter((item) => item.kind === "numeric"), [criteria]);
  const criteriaTotal = useMemo(() => numericCriteria.reduce((sum, item) => sum + Number(item.weight_pct || 0), 0), [numericCriteria]);
  const weightsValid = numericCriteria.length === 0 || Math.abs(criteriaTotal - 100) < 0.0001;

  const commitRoundName = (round: Round): void => {
    const next = (roundDrafts[round.id] ?? round.name).trim();
    if (!next || next === round.name) {
      setRoundDrafts((previous) => ({ ...previous, [round.id]: round.name }));
      return;
    }
    void updateRound(round, { name: next });
  };

  const renderRoundCard = (round: Round | undefined, index: number): JSX.Element => round ? (
    <div class="round-card" key={round.id}>
      <span class="eyebrow">Round {index + 1}</span>
      <label class="round-setting round-name"><span>Name</span><input aria-label={`Round ${index + 1} name`} value={roundDrafts[round.id] ?? round.name} onInput={(event) => setRoundDrafts({ ...roundDrafts, [round.id]: (event.currentTarget as HTMLInputElement).value })} onBlur={() => commitRoundName(round)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); (event.currentTarget as HTMLInputElement).blur(); } }} /></label>
      <div class="round-dates">
        <label class="round-setting"><span>Opens</span><input class="tabular" type="date" aria-label={`Round ${index + 1} opens`} value={toDateInput(round.opens_at)} onChange={(event) => void updateRound(round, { opens_at: fromDateInput((event.currentTarget as HTMLInputElement).value) })} /></label>
        <label class="round-setting"><span>Closes</span><input class="tabular" type="date" aria-label={`Round ${index + 1} closes`} value={toDateInput(round.closes_at)} onChange={(event) => void updateRound(round, { closes_at: fromDateInput((event.currentTarget as HTMLInputElement).value) })} /></label>
      </div>
      <div class="round-field-error" role={roundErrors[round.id] ? "alert" : undefined}>{roundErrors[round.id] ?? ""}</div>
      <label class="round-setting"><span>Mode</span><select aria-label={`Round ${index + 1} mode`} value={round.mode} onChange={(event) => void updateRound(round, { mode: (event.currentTarget as HTMLSelectElement).value })}><option value="scorecard">Scorecard</option><option value="comparison">Comparison</option></select></label>
      <label class="round-toggle"><input type="checkbox" aria-label={`Round ${index + 1} anonymized`} checked={round.anonymized} onChange={(event) => void updateRound(round, { anonymized: (event.currentTarget as HTMLInputElement).checked })} /><span>Anonymous review · hide speaker identity from reviewers</span></label>
      <div class="round-scorecard-line"><span class="subtle">{round.criteria.length ? round.criteria.map((item) => item.name).join(" · ") : "No scorecard yet"}</span><Button small onClick={() => openScorecard(round)}>Edit scorecard</Button></div>
      <span class="subtle">{round.target_reviews_per_submission} reviews per submission · {round.mode === "comparison" ? `${round.progress.comparisons} comparisons` : `${round.progress.evaluations} scorecards`}</span>
      <div class="progress-track"><i style={{ width: `${percent(round.mode === "comparison" ? round.progress.comparisons : round.progress.evaluations, Math.max(1, round.progress.assigned_submissions * round.target_reviews_per_submission))}%` }} /></div>
      <div class="wave-date"><span class="tabular">{round.mode === "comparison" ? round.progress.comparisons : round.progress.evaluations}</span> complete · <span class="tabular">{Math.max(0, round.progress.assigned_submissions * round.target_reviews_per_submission - (round.mode === "comparison" ? round.progress.comparisons : round.progress.evaluations))}</span> remaining</div>
      <div class="round-meta"><span>{round.anonymized ? "Anonymous review" : "Identity visible"}</span><span class="tabular">{formatDate(round.opens_at)} → {formatDate(round.closes_at)}</span></div>
    </div>
  ) : (
    <div class="round-card round-empty" key={`empty-${index}`}><span class="eyebrow">Round {index + 1}</span><strong>Not configured</strong><span class="subtle">Add the next ordered round from the plan controls.</span></div>
  );

  if (loading) return <div class="evaluation-loading instrument"><span class="eyebrow">Evaluation plan</span><strong>Loading conference review machinery…</strong><span class="subtle">Reading rounds, committees, and reviewer coverage.</span></div>;
  if (error && !plan) return <EmptyState title="Evaluation data unavailable" copy={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />;
  if (!plan) return <EmptyState title="No evaluation plan" copy="Set the scorecard, committee, and two review rounds before assigning abstracts." action={<Button variant="primary" onClick={() => setDialog("plan")}>Create evaluation plan</Button>} />;

  return <>
    <PageHeader title="Evaluation plan" copy="A two-round funnel turns submitted abstracts into a focused committee decision without order-dependent setup." actions={<>
      <a class="button primary" href="/submissions?sort=score">View results →</a>
      <a class="button" href={`/api/v1/events/${eventId}/plans/${plan.id}/results/export?format=csv`} download="review-results.csv">Export scores (CSV)</a>
      <Button onClick={() => void load()}>Refresh</Button>
      <Button onClick={() => { setAssignmentRoundId(firstRound?.id ?? null); setDialog("assignment"); }}>Distribute assignments</Button>
      <Button variant="primary" onClick={() => setDialog("plan")}>+ New evaluation plan</Button>
    </>} />
    {error && <div class="evaluation-alert alarm" role="alert">{error}</div>}
    {notice && <div class="evaluation-alert success" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
    <div class="evaluation-layout">
      <Card class="evaluation-plan-card">
        <CardHeader title="Plan">
          <Chip tone={plan.status === "open" ? "success" : "warning"}>{plan.status}</Chip>
        </CardHeader>
        <CardBody>
          <div class="evaluation-plan-heading"><div><span class="eyebrow">{plan.name}</span><h2>{plan.instructions}</h2></div><Button small disabled={!firstRound} onClick={() => firstRound && openScorecard(firstRound)}>Edit round 1 scorecard</Button></div>
          <div class="round-flow">
            {renderRoundCard(firstRound, 0)}
            <div class="round-arrow" aria-hidden="true">→</div>
            {renderRoundCard(secondRound, 1)}
          </div>
          <div class="divider" />
          <div class="scorecard-line"><div><strong>{firstRound?.name ?? "Round 1"} scorecard</strong><span>{(firstRound?.criteria ?? []).map((item) => item.kind === "numeric" ? `${item.name} ${item.weight_pct}%` : `${item.name} · ${KIND_LABEL[item.kind].toLowerCase()}`).join(" · ") || "No criteria · recommendation only"}</span></div><Button small disabled={!firstRound} onClick={() => firstRound && openScorecard(firstRound)}>Edit scorecard</Button></div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Evaluation summary"><Button small onClick={() => void load()}>Updated now</Button></CardHeader>
        <CardBody><div class="metric-grid evaluation-metrics">
          <div class="metric-box"><span class="eyebrow">Evaluations</span><div class="metric">{plan.summary.evaluations.toLocaleString()}</div></div>
          <div class="metric-box"><span class="eyebrow">With ≥1 review</span><div class="metric">{plan.summary.submissions_with_reviews.toLocaleString()}</div></div>
          <div class="metric-box"><span class="eyebrow">Highest score</span><div class="metric">{plan.summary.highest_score?.toFixed(2) ?? "—"}</div></div>
          <div class="metric-box"><span class="eyebrow">Wide spread</span><div class="metric">{plan.summary.wide_spread.toLocaleString()}</div></div>
        </div><div class="spark" aria-label="Score distribution"><i style="height:35%" /><i style="height:52%" /><i style="height:39%" /><i style="height:71%" /><i style="height:67%" /><i style="height:81%" /><i style="height:74%" /><i style="height:92%" /><i style="height:83%" /><i style="height:96%" /></div></CardBody>
      </Card>
      <Card class="committee-card">
        <CardHeader title="Program committee"><div class="card-actions"><Button small onClick={() => setDialog("committee")}>Manage</Button><Button small onClick={() => { setAssignmentRoundId(firstRound?.id ?? null); setDialog("assignment"); }}>Edit assignments</Button></div></CardHeader>
        <CardBody>{committee ? <><div class="committee-intro"><span>{committee.members.length} reviewers · explicit track responsibility</span><span>{firstRound?.target_reviews_per_submission ?? 0} reviews per abstract</span></div><div class="committee-list">{committee.members.map((member) => <div class="committee-person" key={member.id}><span class="mini-avatar">{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{member.name}</strong><div class="scope-chips">{member.track_scopes.map((scope) => <Chip key={scope.id}>{scope.name}</Chip>)}</div></div><span class="tabular subtle reviewer-progress" title="Reviews submitted of reviews assigned in this round">{(() => {
  const rolled = reviewerProgress?.get(member.id);
  if (!rolled) return "—/—";
  return `${rolled.reviewed}/${rolled.assigned}`;
})()} reviewed</span></div>)}</div><Button class="full-width ghost" onClick={() => setDialog("committee")}>View all {committee.members.length} reviewers →</Button></> : <div class="inline-empty"><span>No committee yet. Create one before distributing reviews.</span><Button small variant="primary" onClick={() => setDialog("committee")}>Create committee</Button></div>}</CardBody>
      </Card>
      <Card class="promotion-card">
        <CardHeader title="Round promotion"><Chip>Funnel</Chip></CardHeader>
        <CardBody><p>Round 1 review remains separate from the Committee decision round. Preview a filtered promotion set before creating any round-two records.</p><Button variant="primary" onClick={() => { setDialog("promotion"); void runPromotion(true); }}>Preview promotions</Button>{secondRound?.promotions.length ? <span class="subtle promotion-count">{secondRound.promotions.length} submission{secondRound.promotions.length === 1 ? "" : "s"} already promoted</span> : null}</CardBody>
      </Card>
    </div>
    {dialog === "plan" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={plan ? async (event) => { event.preventDefault(); try { const updated = await api<Plan>(`/api/v1/events/${eventId}/plans/${plan.id}`, "/api/v1/events/{eventId}/plans/{planId}", { method: "PATCH", body: JSON.stringify({ name: planName, instructions }) }); setPlan(updated); setDialog(null); setNotice("Evaluation plan updated"); } catch (reason: unknown) { setError(errorSummary(reason)); } } : savePlan}><header><span class="eyebrow">Evaluation plan</span><h2>{plan ? "Edit plan" : "New evaluation plan"}</h2></header><div class="eval-dialog-body"><label class="field">Name<input value={planName} onInput={(event) => setPlanName((event.currentTarget as HTMLInputElement).value)} /></label><label class="field">Instructions<textarea rows={4} value={instructions} onInput={(event) => setInstructions((event.currentTarget as HTMLTextAreaElement).value)} /></label><div class="message-preview">Two ordered rounds ship together: Initial screen → Committee decision. Numeric scoring remains optional for reviewers.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary">Save plan</Button></footer></form></div>}
    {dialog === "scorecard" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog eval-dialog-wide" onSubmit={saveScorecard}>
      <header><span class="eyebrow">{scorecardRound ? `Round ${scorecardRound.position + 1} · ${scorecardRound.name}` : "Scorecard"}</span><h2>Edit scorecard</h2></header>
      <div class="eval-dialog-body">
        <div class="criterion-editor">
          {criteria.map((criterion, index) => <div class="criterion-row-group" key={criterion.id}>
            <div class="criterion-row">
              <span class="tabular">{index + 1}</span>
              <input aria-label={`Criterion ${index + 1} name`} placeholder="Criterion name" value={criterion.name} onInput={(event) => updateCriterion(criterion.id, { name: (event.currentTarget as HTMLInputElement).value })} />
              <select aria-label={`Criterion ${index + 1} type`} value={criterion.kind} onChange={(event) => changeKind(criterion, (event.currentTarget as HTMLSelectElement).value as CriterionKind)}>
                {(["numeric", "select", "text"] as const).map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
              </select>
              <input class="criterion-weight" aria-label={`Criterion ${index + 1} weight`} type="number" min="0" max="100" value={criterion.kind === "numeric" ? criterion.weight_pct : 0} disabled={criterion.kind !== "numeric"} onInput={(event) => updateCriterion(criterion.id, { weight_pct: Number((event.currentTarget as HTMLInputElement).value) })} />
              <span>%</span>
              <button type="button" class="criterion-remove" aria-label={`Remove criterion ${index + 1}`} onClick={() => removeCriterion(criterion.id)}>×</button>
            </div>
            <div class="criterion-detail">
              {criterion.kind === "numeric" && <><label class="field inline"><span>Scale from</span><input class="tabular" aria-label={`Criterion ${index + 1} scale minimum`} type="number" value={criterion.scale_min ?? 1} onInput={(event) => updateCriterion(criterion.id, { scale_min: Number((event.currentTarget as HTMLInputElement).value) })} /></label><label class="field inline"><span>to</span><input class="tabular" aria-label={`Criterion ${index + 1} scale maximum`} type="number" value={criterion.scale_max ?? 5} onInput={(event) => updateCriterion(criterion.id, { scale_max: Number((event.currentTarget as HTMLInputElement).value) })} /></label></>}
              {criterion.kind === "select" && <label class="field inline criterion-options"><span>Options</span><input aria-label={`Criterion ${index + 1} options`} placeholder="Accept, Maybe, Reject" value={(criterion.options ?? []).join(", ")} onInput={(event) => updateCriterion(criterion.id, { options: (event.currentTarget as HTMLInputElement).value.split(",").map((option) => option.trim()).filter(Boolean) })} /></label>}
              {criterion.kind === "text" && <span class="subtle">Reviewers answer this in their own words. Free text carries no weight.</span>}
            </div>
          </div>)}
        </div>
        <Button type="button" small onClick={addCriterion}>+ Add criterion</Button>
        <div class={`criterion-total ${weightsValid ? "valid" : "invalid"}`}><span>Total</span><strong class="tabular">{numericCriteria.length ? `${criteriaTotal}%` : "—"}</strong><small>{numericCriteria.length === 0 ? "No rating criteria · weights are not required" : weightsValid ? "Valid weighted rubric" : "Rating criteria must total exactly 100%"}</small></div>
        <div class="message-preview">Approve, Maybe, and Deny remain available without a scorecard. Rating criteria carry the weights; dropdown and free-text criteria carry none.</div>
      </div>
      <footer><Button type="button" onClick={() => { setDialog(null); setScorecardRoundId(null); }}>Cancel</Button><Button type="submit" variant="primary" disabled={!weightsValid || criteria.some((item) => !item.name.trim())}>Save scorecard</Button></footer>
    </form></div>}
    {dialog === "committee" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={createCommittee}><header><span class="eyebrow">Program committee</span><h2>Manage committee</h2></header><div class="eval-dialog-body"><label class="field">Committee name<input value={committeeName} onInput={(event) => setCommitteeName((event.currentTarget as HTMLInputElement).value)} /></label><div class="message-preview">Reviewer rows carry explicit track responsibilities. Scope changes recalculate queue membership without replacing completed reviews.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary">Save committee</Button></footer></form></div>}
    {dialog === "assignment" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={distribute}><header><span class="eyebrow">Round assignments</span><h2>Distribute assignments</h2></header><div class="eval-dialog-body"><label class="field">Round<select value={assignmentRoundId ?? firstRound?.id ?? ""} onChange={(event) => setAssignmentRoundId((event.currentTarget as HTMLSelectElement).value)}>{plan.rounds.map((round) => <option key={round.id} value={round.id}>{round.position + 1} · {round.name}</option>)}</select></label><label class="field">Assignment mode<select value={assignmentMode} onChange={(event) => setAssignmentMode((event.currentTarget as HTMLSelectElement).value as "everyone" | "n_per_submission")}><option value="n_per_submission">N reviewers per submission</option><option value="everyone">Everyone reviews everything</option></select></label><label class="field">Reviewers per submission<input type="number" min="1" value={reviewerTarget} onInput={(event) => setReviewerTarget(Number((event.currentTarget as HTMLInputElement).value))} /></label><div class="message-preview">Assignments belong to the selected round. Re-running distribution is idempotent and never replaces completed review or comparison evidence.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!committee}>Distribute</Button></footer></form></div>}
    {dialog === "promotion" && <div class="eval-dialog-backdrop" role="presentation"><div class="eval-dialog"><header><span class="eyebrow">Round promotion</span><h2>Preview the next funnel</h2></header><div class="eval-dialog-body"><div class="promotion-preview"><strong>Filtered promotion set</strong><span>Use the same typed filter as the conference submission list. Empty legacy selections never promote records.</span><label class="field">Status<select value={promotionStatus} onChange={(event) => { setPromotionStatus((event.currentTarget as HTMLSelectElement).value); setPromotionResult(null); }}><option value="in_review">In review</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="waitlisted">Waitlisted</option></select></label><label class="field">Search<input value={promotionQuery} placeholder="Title, track, or speaker" onInput={(event) => { setPromotionQuery((event.currentTarget as HTMLInputElement).value); setPromotionResult(null); }} /></label>{promotionResult && <div class="promotion-result"><span><strong>{promotionResult.selected}</strong> selected</span><span><strong>{promotionResult.promoted}</strong> ready to promote</span><span><strong>{promotionResult.already_promoted}</strong> already in Round 2</span></div>}</div></div><footer><Button type="button" onClick={() => { setDialog(null); setPromotionResult(null); }}>Done</Button><Button type="button" onClick={() => void runPromotion(true)} disabled={promotionApplying}>Refresh preview</Button><Button type="button" variant="primary" onClick={() => void runPromotion(false)} disabled={promotionApplying || !promotionResult?.promoted}>{promotionApplying ? "Applying…" : "Promote selected"}</Button></footer></div></div>}
  </>;
}
