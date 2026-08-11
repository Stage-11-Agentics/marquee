import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { Button, Card, CardBody, CardHeader, Chip, EmptyState, PageHeader } from "../shell/components";
import "./evaluation.css";

const DEFAULT_EVENT_ID = "evt_aie-ny-2026";

interface Criterion {
  id: string;
  name: string;
  position: number;
  weight_pct: number;
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
    evaluations: number;
    reviewed_submissions: number;
    submission_count: number;
  };
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Evaluation request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function percent(done: number, total: number): number {
  return total === 0 ? 0 : Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

function formatDate(value: number | null): string {
  if (value === null) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(value);
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
  const [committeeName, setCommitteeName] = useState("Program reviewers");
  const [assignmentMode, setAssignmentMode] = useState<"everyone" | "n_per_submission">("n_per_submission");
  const [reviewerTarget, setReviewerTarget] = useState(3);

  const firstRound = plan?.rounds[0];
  const secondRound = plan?.rounds[1];
  const committee = plan?.committees[0];

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const summaries = await api<{ data: PlanSummary[] }>(`/api/v1/events/${eventId}/plans`);
      const current = summaries.data[0];
      if (!current) {
        setPlan(null);
        setLoading(false);
        return;
      }
      const detail = await api<Plan>(`/api/v1/events/${eventId}/plans/${current.id}`);
      setPlan(detail);
      setPlanName(detail.name);
      setInstructions(detail.instructions);
      setCriteria(detail.rounds[0]?.criteria ?? []);
      setReviewerTarget(detail.rounds[0]?.target_reviews_per_submission ?? 3);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Evaluation data is unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [eventId]);

  const savePlan = async (event: Event): Promise<void> => {
    event.preventDefault();
    try {
      const detail = await api<Plan>(`/api/v1/events/${eventId}/plans`, {
        method: "POST",
        body: JSON.stringify({
          name: planName,
          instructions,
          scale_min: 1,
          scale_max: 5,
          status: "open",
          rounds: [
            { name: "Initial screen", position: 0, mode: "scorecard", anonymized: true, target_reviews_per_submission: reviewerTarget, criteria: [{ name: "Impact", position: 0, weight_pct: 40 }, { name: "Specificity", position: 1, weight_pct: 35 }, { name: "Novelty", position: 2, weight_pct: 25 }] },
            { name: "Committee decision", position: 1, mode: "comparison", anonymized: false, target_reviews_per_submission: reviewerTarget },
          ],
        }),
      });
      setPlan(detail);
      setCriteria(detail.rounds[0]?.criteria ?? []);
      setDialog(null);
      setNotice("Evaluation plan created · two rounds ready");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Evaluation plan could not be saved");
    }
  };

  const saveScorecard = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!firstRound) return;
    try {
      await api(`/api/v1/events/${eventId}/rounds/${firstRound.id}/criteria`, { method: "PUT", body: JSON.stringify({ criteria }) });
      setDialog(null);
      setNotice("Scorecard saved · criteria total 100%");
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Scorecard could not be saved");
    }
  };

  const createCommittee = async (event: Event): Promise<void> => {
    event.preventDefault();
    try {
      await api(`/api/v1/events/${eventId}/committees`, { method: "POST", body: JSON.stringify({ name: committeeName }) });
      setDialog(null);
      setNotice("Committee created · add reviewers to begin assignment");
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Committee could not be saved");
    }
  };

  const distribute = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!firstRound || !committee) return;
    try {
      await api(`/api/v1/events/${eventId}/rounds/${firstRound.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({ committee_id: committee.id, mode: assignmentMode, reviewers_per_submission: reviewerTarget }),
      });
      setDialog(null);
      setNotice("Assignments recalculated · completed reviews were preserved");
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Assignments could not be distributed");
    }
  };

  const promotionPreview = async (): Promise<void> => {
    if (!firstRound || !secondRound) return;
    try {
      const response = await api<{ assignments: number; promoted: number }>(`/api/v1/events/${eventId}/rounds/${firstRound.id}/promote`, {
        method: "POST",
        body: JSON.stringify({ preview: true, submission_ids: [] }),
      });
      setNotice(`${response.promoted} submissions ready · ${response.assignments} committee assignments`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Promotion preview is unavailable");
    }
  };

  const criteriaTotal = useMemo(() => criteria.reduce((sum, item) => sum + Number(item.weight_pct || 0), 0), [criteria]);

  if (loading) return <div class="evaluation-loading instrument"><span class="eyebrow">Evaluation plan</span><strong>Loading conference review machinery…</strong><span class="subtle">Reading rounds, committees, and reviewer coverage.</span></div>;
  if (error && !plan) return <EmptyState title="Evaluation data unavailable" copy={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />;
  if (!plan) return <EmptyState title="No evaluation plan" copy="Set the scorecard, committee, and two review rounds before assigning abstracts." action={<Button variant="primary" onClick={() => setDialog("plan")}>Create evaluation plan</Button>} />;

  return <>
    <PageHeader title="Evaluation plan" copy="A two-round funnel turns submitted abstracts into a focused committee decision without order-dependent setup." actions={<>
      <Button onClick={() => void load()}>Refresh</Button>
      <Button onClick={() => setDialog("assignment")}>Distribute assignments</Button>
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
          <div class="evaluation-plan-heading"><div><span class="eyebrow">{plan.name}</span><h2>{plan.instructions}</h2></div><Button small onClick={() => setDialog("scorecard")}>Edit scorecard</Button></div>
          <div class="round-flow">
            {[firstRound, secondRound].map((round, index) => round ? <div class="round-card" key={round.id}>
              <span class="eyebrow">Round {index + 1}</span><strong>{round.name}</strong>
              <span class="subtle">{round.mode === "scorecard" ? "Scorecard" : "Comparison"} · {round.target_reviews_per_submission} reviews per submission</span>
              <div class="progress-track"><i style={{ width: `${percent(round.progress.evaluations, Math.max(1, round.progress.assigned_submissions * round.target_reviews_per_submission))}%` }} /></div>
              <div class="wave-date"><span class="tabular">{round.progress.evaluations}</span> complete · <span class="tabular">{Math.max(0, round.progress.assigned_submissions * round.target_reviews_per_submission - round.progress.evaluations)}</span> remaining</div>
              <div class="round-meta"><span>{round.anonymized ? "Anonymous review" : "Identity visible"}</span><span>{formatDate(round.closes_at)}</span></div>
            </div> : <div class="round-card round-empty" key={`empty-${index}`}><span class="eyebrow">Round {index + 1}</span><strong>Not configured</strong><span class="subtle">Add the next ordered round from the plan controls.</span></div>)}
            <div class="round-arrow" aria-hidden="true">→</div>
          </div>
          <div class="divider" />
          <div class="scorecard-line"><div><strong>Scorecard</strong><span>{(firstRound?.criteria ?? []).map((item) => `${item.name} ${item.weight_pct}%`).join(" · ") || "No numeric criteria · recommendation only"}</span></div><Button small onClick={() => setDialog("scorecard")}>Edit scorecard</Button></div>
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
        <CardHeader title="Program committee"><div class="card-actions"><Button small onClick={() => setDialog("committee")}>Manage</Button><Button small onClick={() => setDialog("assignment")}>Edit assignments</Button></div></CardHeader>
        <CardBody>{committee ? <><div class="committee-intro"><span>{committee.members.length} reviewers · explicit track responsibility</span><span>{firstRound?.target_reviews_per_submission ?? 0} reviews per abstract</span></div><div class="committee-list">{committee.members.map((member) => <div class="committee-person" key={member.id}><span class="mini-avatar">{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{member.name}</strong><div class="scope-chips">{member.track_scopes.map((scope) => <Chip key={scope.id}>{scope.name}</Chip>)}</div></div><span class="tabular subtle">{member.progress} / {firstRound?.progress.assigned_submissions ?? 0}</span></div>)}</div><Button class="full-width ghost" onClick={() => setDialog("committee")}>View all {committee.members.length} reviewers →</Button></> : <div class="inline-empty">No committee yet. Create one before distributing reviews.</div>}</CardBody>
      </Card>
      <Card class="promotion-card">
        <CardHeader title="Round promotion"><Chip>Funnel</Chip></CardHeader>
        <CardBody><p>Round 1 review remains separate from the Committee decision round. Preview a filtered promotion set before creating any round-two records.</p><Button variant="primary" onClick={() => { setDialog("promotion"); void promotionPreview(); }}>Preview promotions</Button></CardBody>
      </Card>
    </div>
    {dialog === "plan" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={plan ? async (event) => { event.preventDefault(); try { const updated = await api<Plan>(`/api/v1/events/${eventId}/plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ name: planName, instructions }) }); setPlan(updated); setDialog(null); setNotice("Evaluation plan updated"); } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Plan could not be saved"); } } : savePlan}><header><span class="eyebrow">Evaluation plan</span><h2>{plan ? "Edit plan" : "New evaluation plan"}</h2></header><div class="eval-dialog-body"><label class="field">Name<input value={planName} onInput={(event) => setPlanName((event.currentTarget as HTMLInputElement).value)} /></label><label class="field">Instructions<textarea rows={4} value={instructions} onInput={(event) => setInstructions((event.currentTarget as HTMLTextAreaElement).value)} /></label><div class="message-preview">Two ordered rounds ship together: Initial screen → Committee decision. Numeric scoring remains optional for reviewers.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary">Save plan</Button></footer></form></div>}
    {dialog === "scorecard" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={saveScorecard}><header><span class="eyebrow">Round 1 · Initial screen</span><h2>Edit optional scorecard</h2></header><div class="eval-dialog-body"><div class="criterion-editor">{criteria.map((criterion, index) => <div class="criterion-row" key={criterion.id}><span class="tabular">{index + 1}</span><input aria-label={`Criterion ${index + 1} name`} value={criterion.name} onInput={(event) => setCriteria(criteria.map((item) => item.id === criterion.id ? { ...item, name: (event.currentTarget as HTMLInputElement).value } : item))} /><input aria-label={`Criterion ${index + 1} weight`} type="number" min="0" max="100" value={criterion.weight_pct} onInput={(event) => setCriteria(criteria.map((item) => item.id === criterion.id ? { ...item, weight_pct: Number((event.currentTarget as HTMLInputElement).value) } : item))} /><span>%</span></div>)}</div><div class={`criterion-total ${criteriaTotal === 100 ? "valid" : "invalid"}`}><span>Total</span><strong>{criteriaTotal}%</strong><small>{criteriaTotal === 100 ? "Valid weighted rubric" : "Criteria must total exactly 100%"}</small></div><div class="message-preview">Approve, Maybe, and Deny remain available without numeric scores. Comments are always free text.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={criteriaTotal !== 100}>Save scorecard</Button></footer></form></div>}
    {dialog === "committee" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={createCommittee}><header><span class="eyebrow">Program committee</span><h2>Manage committee</h2></header><div class="eval-dialog-body"><label class="field">Committee name<input value={committeeName} onInput={(event) => setCommitteeName((event.currentTarget as HTMLInputElement).value)} /></label><div class="message-preview">Reviewer rows carry explicit track responsibilities. Scope changes recalculate queue membership without replacing completed reviews.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary">Save committee</Button></footer></form></div>}
    {dialog === "assignment" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={distribute}><header><span class="eyebrow">Round 1 · Initial screen</span><h2>Distribute assignments</h2></header><div class="eval-dialog-body"><label class="field">Assignment mode<select value={assignmentMode} onChange={(event) => setAssignmentMode((event.currentTarget as HTMLSelectElement).value as "everyone" | "n_per_submission")}><option value="n_per_submission">N reviewers per submission</option><option value="everyone">Everyone reviews everything</option></select></label><label class="field">Reviewers per submission<input type="number" min="1" value={reviewerTarget} onInput={(event) => setReviewerTarget(Number((event.currentTarget as HTMLInputElement).value))} /></label><div class="message-preview">The first load is seeded with organizer-unreviewed work. Re-running distribution is idempotent and never replaces a completed review.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!committee}>Distribute</Button></footer></form></div>}
    {dialog === "promotion" && <div class="eval-dialog-backdrop" role="presentation"><div class="eval-dialog"><header><span class="eyebrow">Round promotion</span><h2>Preview the next funnel</h2></header><div class="eval-dialog-body"><div class="promotion-preview"><strong>Filtered promotion set</strong><span>Use the submission list to narrow Round 1 before applying promotion.</span><div><span class="tabular">{firstRound?.progress.reviewed_submissions ?? 0}</span> reviewed · <span class="tabular">{secondRound?.progress.assigned_submissions ?? 0}</span> already in Committee decision</div></div></div><footer><Button onClick={() => setDialog(null)}>Done</Button></footer></div></div>}
  </>;
}
