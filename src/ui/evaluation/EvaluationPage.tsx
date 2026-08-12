import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
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

interface Track {
  color: string;
  id: string;
  name: string;
}

interface InviteResult {
  invite_sent: boolean;
  /** Present only on demo conferences, where the link is safe to show on screen. */
  magic_link?: string;
  person: { email: string; id: string; name: string };
  track_ids: string[];
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

function formatDate(value: number | null): string {
  if (value === null) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(value);
}

export function EvaluationPage({ eventId = DEFAULT_EVENT_ID }: EvaluationPageProps): JSX.Element {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"plan" | "scorecard" | "committee" | "invite" | "assignment" | "promotion" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planName, setPlanName] = useState("2026 Program Review");
  const [instructions, setInstructions] = useState("Recommend Approve, Maybe, or Deny. Numeric scoring is optional.");
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [committeeName, setCommitteeName] = useState("Program reviewers");
  const [assignmentMode, setAssignmentMode] = useState<"everyone" | "n_per_submission">("n_per_submission");
  const [assignmentRoundId, setAssignmentRoundId] = useState<string | null>(null);
  const [reviewerTarget, setReviewerTarget] = useState(3);
  const [promotionStatus, setPromotionStatus] = useState("in_review");
  const [promotionQuery, setPromotionQuery] = useState("");
  const [promotionResult, setPromotionResult] = useState<{ already_promoted: number; assignments: number; promoted: number; selected: number } | null>(null);
  const [promotionApplying, setPromotionApplying] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTrackIds, setInviteTrackIds] = useState<string[]>([]);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

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
      const [detail, trackList] = await Promise.all([
        api<Plan>(`/api/v1/events/${eventId}/plans/${current.id}`, "/api/v1/events/{eventId}/plans/{planId}"),
        // Loaded with the plan rather than on dialog open: the invite form's
        // responsibilities are the reason the dialog exists, and a form that
        // fills in a beat after it opens reads as broken.
        api<{ data: Track[] }>(`/api/v1/events/${eventId}/tracks`, "/api/v1/events/{eventId}/tracks").catch(() => ({ data: [] as Track[] })),
      ]);
      setTracks(trackList.data);
      setPlan(detail);
      setPlanName(detail.name);
      setInstructions(detail.instructions);
      setCriteria(detail.rounds[0]?.criteria ?? []);
      setReviewerTarget(detail.rounds[0]?.target_reviews_per_submission ?? 3);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setLoading(false);
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
      setError(errorSummary(reason));
    }
  };

  const saveScorecard = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!firstRound) return;
    try {
      await api(`/api/v1/events/${eventId}/rounds/${firstRound.id}/criteria`, "/api/v1/events/{eventId}/rounds/{roundId}/criteria", { method: "PUT", body: JSON.stringify({ criteria }) });
      setDialog(null);
      setNotice("Scorecard saved · criteria total 100%");
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    }
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

  const openInvite = (): void => {
    setInviteName("");
    setInviteEmail("");
    setInviteTrackIds([]);
    setInviteResult(null);
    setLinkCopied(false);
    setDialog("invite");
  };

  const inviteReviewer = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!committee) return;
    setInviteSaving(true);
    setError(null);
    try {
      const result = await api<InviteResult>(
        `/api/v1/events/${eventId}/committees/${committee.id}/invites`,
        "/api/v1/events/{eventId}/committees/{committeeId}/invites",
        {
          method: "POST",
          body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), track_ids: inviteTrackIds }),
        },
      );
      setInviteResult(result);
      setLinkCopied(false);
      setNotice(result.invite_sent
        ? `${result.person.name} invited · sign-in link sent to ${result.person.email}`
        : `${result.person.name} is on the committee · their invitation was logged, so send them the link`);
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setInviteSaving(false);
    }
  };

  const copyInviteLink = async (): Promise<void> => {
    const link = inviteResult?.magic_link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
    } catch {
      // Clipboard permission is not guaranteed; the link stays selectable in the
      // field beside this button, so the organizer is never stuck.
      setLinkCopied(false);
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

  const updateRound = async (round: Round, patch: Record<string, unknown>): Promise<void> => {
    try {
      await api(`/api/v1/events/${eventId}/rounds/${round.id}`, "/api/v1/events/{eventId}/rounds/{roundId}", { method: "PATCH", body: JSON.stringify(patch) });
      setNotice(`${round.name} settings saved · recorded evidence preserved`);
      await load();
    } catch (reason: unknown) {
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

  const criteriaTotal = useMemo(() => criteria.reduce((sum, item) => sum + Number(item.weight_pct || 0), 0), [criteria]);

  const renderRoundCard = (round: Round | undefined, index: number): JSX.Element => round ? (
    <div class="round-card" key={round.id}>
      <span class="eyebrow">Round {index + 1}</span><strong>{round.name}</strong>
      <label class="round-setting"><span>Mode</span><select aria-label={`Round ${index + 1} mode`} value={round.mode} onChange={(event) => void updateRound(round, { mode: (event.currentTarget as HTMLSelectElement).value })}><option value="scorecard">Scorecard</option><option value="comparison">Comparison</option></select></label>
      <span class="subtle">{round.target_reviews_per_submission} reviews per submission · {round.mode === "comparison" ? `${round.progress.comparisons} comparisons` : `${round.progress.evaluations} scorecards`}</span>
      <div class="progress-track"><i style={{ width: `${percent(round.mode === "comparison" ? round.progress.comparisons : round.progress.evaluations, Math.max(1, round.progress.assigned_submissions * round.target_reviews_per_submission))}%` }} /></div>
      <div class="wave-date"><span class="tabular">{round.mode === "comparison" ? round.progress.comparisons : round.progress.evaluations}</span> complete · <span class="tabular">{Math.max(0, round.progress.assigned_submissions * round.target_reviews_per_submission - (round.mode === "comparison" ? round.progress.comparisons : round.progress.evaluations))}</span> remaining</div>
      <div class="round-meta"><span>{round.anonymized ? "Anonymous review" : "Identity visible"}</span><span>{formatDate(round.closes_at)}</span></div>
    </div>
  ) : (
    <div class="round-card round-empty" key={`empty-${index}`}><span class="eyebrow">Round {index + 1}</span><strong>Not configured</strong><span class="subtle">Add the next ordered round from the plan controls.</span></div>
  );

  if (loading) return <div class="evaluation-loading instrument"><span class="eyebrow">Evaluation plan</span><strong>Loading conference review machinery…</strong><span class="subtle">Reading rounds, committees, and reviewer coverage.</span></div>;
  if (error && !plan) return <EmptyState title="Evaluation data unavailable" copy={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />;
  if (!plan) return <EmptyState title="No evaluation plan" copy="Set the scorecard, committee, and two review rounds before assigning abstracts." action={<Button variant="primary" onClick={() => setDialog("plan")}>Create evaluation plan</Button>} />;

  return <>
    <PageHeader title="Evaluation plan" copy="A two-round funnel turns submitted abstracts into a focused committee decision without order-dependent setup." actions={<>
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
          <div class="evaluation-plan-heading"><div><span class="eyebrow">{plan.name}</span><h2>{plan.instructions}</h2></div><Button small onClick={() => setDialog("scorecard")}>Edit scorecard</Button></div>
          <div class="round-flow">
            {renderRoundCard(firstRound, 0)}
            <div class="round-arrow" aria-hidden="true">→</div>
            {renderRoundCard(secondRound, 1)}
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
        <CardHeader title="Program committee"><div class="card-actions"><Button small variant="primary" onClick={openInvite} disabled={!committee}>Invite reviewer</Button><Button small onClick={() => setDialog("committee")}>Manage</Button><Button small onClick={() => { setAssignmentRoundId(firstRound?.id ?? null); setDialog("assignment"); }}>Edit assignments</Button></div></CardHeader>
        <CardBody>{committee ? <><div class="committee-intro"><span>{committee.members.length} reviewers · explicit track responsibility</span><span>{firstRound?.target_reviews_per_submission ?? 0} reviews per abstract</span></div><div class="committee-list">{committee.members.map((member) => <div class="committee-person" key={member.id}><span class="mini-avatar">{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{member.name}</strong><div class="scope-chips">{member.track_scopes.map((scope) => <Chip key={scope.id}>{scope.name}</Chip>)}</div></div><span class="tabular subtle">{member.progress} / {firstRound?.progress.assigned_submissions ?? 0}</span></div>)}</div><Button class="full-width ghost" onClick={openInvite}>+ Invite a reviewer to this committee</Button></> : <div class="inline-empty"><span>No committee yet. Create one before distributing reviews.</span><Button small variant="primary" onClick={() => setDialog("committee")}>Create committee</Button></div>}</CardBody>
      </Card>
      <Card class="promotion-card">
        <CardHeader title="Round promotion"><Chip>Funnel</Chip></CardHeader>
        <CardBody><p>Round 1 review remains separate from the Committee decision round. Preview a filtered promotion set before creating any round-two records.</p><Button variant="primary" onClick={() => { setDialog("promotion"); void runPromotion(true); }}>Preview promotions</Button>{secondRound?.promotions.length ? <span class="subtle promotion-count">{secondRound.promotions.length} submission{secondRound.promotions.length === 1 ? "" : "s"} already promoted</span> : null}</CardBody>
      </Card>
    </div>
    {dialog === "plan" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={plan ? async (event) => { event.preventDefault(); try { const updated = await api<Plan>(`/api/v1/events/${eventId}/plans/${plan.id}`, "/api/v1/events/{eventId}/plans/{planId}", { method: "PATCH", body: JSON.stringify({ name: planName, instructions }) }); setPlan(updated); setDialog(null); setNotice("Evaluation plan updated"); } catch (reason: unknown) { setError(errorSummary(reason)); } } : savePlan}><header><span class="eyebrow">Evaluation plan</span><h2>{plan ? "Edit plan" : "New evaluation plan"}</h2></header><div class="eval-dialog-body"><label class="field">Name<input value={planName} onInput={(event) => setPlanName((event.currentTarget as HTMLInputElement).value)} /></label><label class="field">Instructions<textarea rows={4} value={instructions} onInput={(event) => setInstructions((event.currentTarget as HTMLTextAreaElement).value)} /></label><div class="message-preview">Two ordered rounds ship together: Initial screen → Committee decision. Numeric scoring remains optional for reviewers.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary">Save plan</Button></footer></form></div>}
    {dialog === "scorecard" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={saveScorecard}><header><span class="eyebrow">Round 1 · Initial screen</span><h2>Edit optional scorecard</h2></header><div class="eval-dialog-body"><div class="criterion-editor">{criteria.map((criterion, index) => <div class="criterion-row" key={criterion.id}><span class="tabular">{index + 1}</span><input aria-label={`Criterion ${index + 1} name`} value={criterion.name} onInput={(event) => setCriteria(criteria.map((item) => item.id === criterion.id ? { ...item, name: (event.currentTarget as HTMLInputElement).value } : item))} /><input aria-label={`Criterion ${index + 1} weight`} type="number" min="0" max="100" value={criterion.weight_pct} onInput={(event) => setCriteria(criteria.map((item) => item.id === criterion.id ? { ...item, weight_pct: Number((event.currentTarget as HTMLInputElement).value) } : item))} /><span>%</span></div>)}</div><div class={`criterion-total ${criteriaTotal === 100 ? "valid" : "invalid"}`}><span>Total</span><strong>{criteriaTotal}%</strong><small>{criteriaTotal === 100 ? "Valid weighted rubric" : "Criteria must total exactly 100%"}</small></div><div class="message-preview">Approve, Maybe, and Deny remain available without numeric scores. Comments are always free text.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={criteriaTotal !== 100}>Save scorecard</Button></footer></form></div>}
    {dialog === "committee" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={createCommittee}><header><span class="eyebrow">Program committee</span><h2>Manage committee</h2></header><div class="eval-dialog-body"><label class="field">Committee name<input value={committeeName} onInput={(event) => setCommitteeName((event.currentTarget as HTMLInputElement).value)} /></label><div class="message-preview">Reviewer rows carry explicit track responsibilities. Scope changes recalculate queue membership without replacing completed reviews.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary">Save committee</Button></footer></form></div>}
    {dialog === "invite" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={inviteReviewer}>
      <header><span class="eyebrow">{committee?.name ?? "Program committee"}</span><h2>Invite reviewer</h2></header>
      <div class="eval-dialog-body">
        <label class="field">Name<input aria-label="Reviewer name" value={inviteName} placeholder="Nora Vale" onInput={(event) => setInviteName((event.currentTarget as HTMLInputElement).value)} /></label>
        <label class="field">Email<input aria-label="Reviewer email" type="email" value={inviteEmail} placeholder="nora@example.org" onInput={(event) => setInviteEmail((event.currentTarget as HTMLInputElement).value)} /></label>
        <fieldset class="field invite-tracks">
          <legend>Track responsibilities</legend>
          <div class="scope-checks">{tracks.map((track) => <label class="scope-check" key={track.id}>
            <input
              type="checkbox"
              checked={inviteTrackIds.includes(track.id)}
              onChange={(event) => setInviteTrackIds((event.currentTarget as HTMLInputElement).checked
                ? [...inviteTrackIds, track.id]
                : inviteTrackIds.filter((id) => id !== track.id))}
            />
            <span>{track.name}</span>
          </label>)}</div>
          <small class="subtle">A reviewer only sees abstracts in the tracks they are responsible for, so at least one is required. For a reviewer who already has responsibilities here, this list replaces them.</small>
        </fieldset>
        <div class="invite-result" aria-live="polite">
          {inviteResult ? <>
            <strong>{inviteResult.person.name} is on the committee.</strong>
            <span class="subtle">{inviteResult.invite_sent
              ? `A sign-in link was emailed to ${inviteResult.person.email}.`
              : `The invitation to ${inviteResult.person.email} was logged rather than sent — this conference only emails addresses on its allowlist. Send them the link below.`}</span>
            {inviteResult.magic_link ? <div class="invite-link">
              <input readOnly aria-label="Reviewer sign-in link" value={inviteResult.magic_link} onFocus={(event) => (event.currentTarget as HTMLInputElement).select()} />
              <Button type="button" small onClick={() => void copyInviteLink()}>{linkCopied ? "Copied" : "Copy link"}</Button>
            </div> : null}
          </> : <span class="subtle">The reviewer is created, given this conference’s reviewer role, seated on the committee, and scoped to the tracks above — in one step. On a demo conference their sign-in link also appears here.</span>}
        </div>
      </div>
      <footer>
        <Button type="button" onClick={() => setDialog(null)}>{inviteResult ? "Done" : "Cancel"}</Button>
        <Button type="submit" variant="primary" disabled={inviteSaving || !committee || inviteName.trim() === "" || inviteEmail.trim() === "" || inviteTrackIds.length === 0}>{inviteSaving ? "Inviting…" : "Send invitation"}</Button>
      </footer>
    </form></div>}
    {dialog === "assignment" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={distribute}><header><span class="eyebrow">Round assignments</span><h2>Distribute assignments</h2></header><div class="eval-dialog-body"><label class="field">Round<select value={assignmentRoundId ?? firstRound?.id ?? ""} onChange={(event) => setAssignmentRoundId((event.currentTarget as HTMLSelectElement).value)}>{plan.rounds.map((round) => <option key={round.id} value={round.id}>{round.position + 1} · {round.name}</option>)}</select></label><label class="field">Assignment mode<select value={assignmentMode} onChange={(event) => setAssignmentMode((event.currentTarget as HTMLSelectElement).value as "everyone" | "n_per_submission")}><option value="n_per_submission">N reviewers per submission</option><option value="everyone">Everyone reviews everything</option></select></label><label class="field">Reviewers per submission<input type="number" min="1" value={reviewerTarget} onInput={(event) => setReviewerTarget(Number((event.currentTarget as HTMLInputElement).value))} /></label><div class="message-preview">Assignments belong to the selected round. Re-running distribution is idempotent and never replaces completed review or comparison evidence.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!committee}>Distribute</Button></footer></form></div>}
    {dialog === "promotion" && <div class="eval-dialog-backdrop" role="presentation"><div class="eval-dialog"><header><span class="eyebrow">Round promotion</span><h2>Preview the next funnel</h2></header><div class="eval-dialog-body"><div class="promotion-preview"><strong>Filtered promotion set</strong><span>Use the same typed filter as the conference submission list. Empty legacy selections never promote records.</span><label class="field">Status<select value={promotionStatus} onChange={(event) => { setPromotionStatus((event.currentTarget as HTMLSelectElement).value); setPromotionResult(null); }}><option value="in_review">In review</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="waitlisted">Waitlisted</option></select></label><label class="field">Search<input value={promotionQuery} placeholder="Title, track, or speaker" onInput={(event) => { setPromotionQuery((event.currentTarget as HTMLInputElement).value); setPromotionResult(null); }} /></label>{promotionResult && <div class="promotion-result"><span><strong>{promotionResult.selected}</strong> selected</span><span><strong>{promotionResult.promoted}</strong> ready to promote</span><span><strong>{promotionResult.already_promoted}</strong> already in Round 2</span></div>}</div></div><footer><Button type="button" onClick={() => { setDialog(null); setPromotionResult(null); }}>Done</Button><Button type="button" onClick={() => void runPromotion(true)} disabled={promotionApplying}>Refresh preview</Button><Button type="button" variant="primary" onClick={() => void runPromotion(false)} disabled={promotionApplying || !promotionResult?.promoted}>{promotionApplying ? "Applying…" : "Promote selected"}</Button></footer></div></div>}
  </>;
}
