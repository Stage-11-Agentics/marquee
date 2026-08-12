import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { apiFetch, errorSummary, MarqueeApiError } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip, EmptyState, PageHeader, ReviewerName } from "../shell/components";
import { TokenSecretPanel } from "../shell/TokenSecretPanel";
import "./evaluation.css";


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
  committee_id: string | null;
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
    recusals: number;
    reviewed_submissions: number;
    submission_count: number;
  };
  promotions: Array<{ submission_id: string; title: string }>;
  target_reviews_per_submission: number;
}

interface CommitteeMember {
  company: string | null;
  id: string;
  kind: "human" | "agent";
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
    recusals: number;
    submissions_with_reviews: number;
    wide_spread: number;
  };
}

interface PlanSummary {
  id: string;
  name: string;
  status: string;
}

interface ReviewerProgress {
  assigned_count: number;
  outstanding_count: number;
  recusal_count: number;
  reviewed_count: number;
}

interface Track {
  color: string;
  id: string;
  name: string;
}

interface InviteResult {
  invite_sent: boolean;
  invite_suppressed: boolean;
  /** Present only on demo conferences, where the link is safe to show on screen. */
  magic_link?: string;
  person: { email: string; id: string; name: string };
  track_ids: string[];
}

interface AgentSeatResult {
  person: { id: string; kind: "agent"; name: string };
  token: { id: string; name: string; secret: string };
  track_ids: string[];
}

interface EvaluationPageProps {
  eventId: string;
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

/** Count CSV records without mistaking a quoted line break for another row. */
function csvDataRowCount(csv: string): number {
  if (!csv) return 0;
  let records = 1;
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "\n" && !quoted) {
      records += 1;
    }
  }
  if (csv.endsWith("\n")) records -= 1;
  return Math.max(0, records - 1);
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

export function EvaluationPage({ eventId }: EvaluationPageProps): JSX.Element {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"plan" | "scorecard" | "committee" | "invite" | "agent" | "assignment" | "promotion" | null>(null);
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
  const [reviewerProgress, setReviewerProgress] = useState<Record<string, Record<string, ReviewerProgress> | null>>({});
  const [tracks, setTracks] = useState<Track[]>([]);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTrackIds, setInviteTrackIds] = useState<string[]>([]);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentTrackIds, setAgentTrackIds] = useState<string[]>([]);
  const [agentResult, setAgentResult] = useState<AgentSeatResult | null>(null);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentSecret, setAgentSecret] = useState<string | null>(null);

  const firstRound = plan?.rounds[0];
  const secondRound = plan?.rounds[1];

  const committeeForRound = (round: Round): Plan["committees"][number] | undefined =>
    plan?.committees.find((item) => item.id === round.committee_id);
  const committee = plan?.committees[0];

  const load = async ({ quiet = false }: { quiet?: boolean } = {}): Promise<void> => {
    if (!quiet) setLoading(true);
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
      setRoundDrafts(Object.fromEntries(detail.rounds.map((round) => [round.id, round.name])));
      setReviewerTarget(detail.rounds[0]?.target_reviews_per_submission ?? 3);
      setLoading(false);
      const progressEntries = await Promise.all(detail.rounds.map(async (round) => {
        try {
          const result = await api<{ data: Array<{ assigned_count: number; outstanding_count: number; recusal_count: number; reviewed_count: number; reviewer_person_id: string | null }> }>(
            `/api/v1/events/${eventId}/rounds/${round.id}/assignments?summary=1`,
            "/api/v1/events/{eventId}/rounds/{roundId}/assignments",
          );
          const byReviewer: Record<string, ReviewerProgress> = {};
          for (const assignment of result.data) {
            if (!assignment.reviewer_person_id) continue;
            byReviewer[assignment.reviewer_person_id] = {
              assigned_count: assignment.assigned_count,
              outstanding_count: assignment.outstanding_count,
              recusal_count: assignment.recusal_count,
              reviewed_count: assignment.reviewed_count,
            };
          }
          return [round.id, byReviewer] as const;
        } catch {
          // Coverage is a secondary affordance; one unavailable round must not
          // hide the plan or turn a healthy chair surface into an alarm.
          return [round.id, null] as const;
        }
      }));
      setReviewerProgress(Object.fromEntries(progressEntries));
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
    // The confirmation state keeps the form mounted, so Enter in the link field
    // would otherwise re-POST. Credentials are not idempotent the way the rows
    // are: a second submit mints a second magic link and a second invitation.
    if (!committee || inviteResult || inviteSaving) return;
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
        : `${result.person.name} is on the committee · their invitation was not emailed, so send them the link`);
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setInviteSaving(false);
    }
  };

  const openAgent = (): void => {
    setAgentName("");
    setAgentTrackIds([]);
    setAgentResult(null);
    setAgentSecret(null);
    setDialog("agent");
  };

  const createAgent = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!committee || agentResult || agentSaving) return;
    setAgentSaving(true);
    setError(null);
    try {
      const result = await api<AgentSeatResult>(
        `/api/v1/events/${eventId}/committees/${committee.id}/agent-seats`,
        "/api/v1/events/{eventId}/committees/{committeeId}/agent-seats",
        { method: "POST", body: JSON.stringify({ name: agentName.trim(), track_ids: agentTrackIds }) },
      );
      setAgentResult(result);
      setAgentSecret(result.token.secret);
      setNotice(`${result.person.name} added as an Agent evaluator`);
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setAgentSaving(false);
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

  const exportResults = async (event: MouseEvent): Promise<void> => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const filename = "review-results.csv";
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/events/${eventId}/plans/${plan?.id}/results/export?format=csv`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`the export request failed with status ${response.status}`);
      const csv = await response.text();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${csvDataRowCount(csv).toLocaleString()} rows · ${filename}`);
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    }
  };

  const distribute = async (event: Event): Promise<void> => {
    event.preventDefault();
    const targetRound = plan?.rounds.find((round) => round.id === (assignmentRoundId ?? firstRound?.id));
    const committeeId = targetRound?.committee_id;
    if (!targetRound || !committeeId) return;
    try {
      await api(`/api/v1/events/${eventId}/rounds/${targetRound.id}/assignments`, "/api/v1/events/{eventId}/rounds/{roundId}/assignments", {
        method: "POST",
        body: JSON.stringify({ committee_id: committeeId, mode: assignmentMode, reviewers_per_submission: reviewerTarget }),
      });
      setDialog(null);
      setNotice(`${targetRound.name} assignments recalculated · completed reviews were preserved`);
      await load();
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    }
  };

  const remindReviewer = async (round: Round, personId: string): Promise<void> => {
    try {
      const response = await api<{ queued: boolean; outstanding: number }>(`/api/v1/events/${eventId}/rounds/${round.id}/reviewers/${personId}/remind`, "/api/v1/events/{eventId}/rounds/{roundId}/reviewers/{personId}/remind", {
        method: "POST",
      });
      setNotice(response.queued ? `Reviewer reminder queued · ${response.outstanding} outstanding` : "Reviewer reminder already queued today");
      await load({ quiet: true });
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
      <div class="round-recusal-status">{round.progress.recusals === 1 ? "1 recusal · needs reassignment" : round.progress.recusals > 1 ? `${round.progress.recusals} recusals · needs reassignment` : "\u00a0"}</div>
      <div class="round-meta"><span>{round.anonymized ? "Anonymous review" : "Identity visible"}</span><span class="tabular">{formatDate(round.opens_at)} → {formatDate(round.closes_at)}</span></div>
      <label class="round-setting"><span>Reviewer pool</span><select aria-label={`Round ${index + 1} reviewer pool`} value={round.committee_id ?? ""} onChange={(event) => void updateRound(round, { committee_id: (event.currentTarget as HTMLSelectElement).value || null })}><option value="">No pool selected</option>{plan?.committees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
  ) : (
    <div class="round-card round-empty" key={`empty-${index}`}><span class="eyebrow">Round {index + 1}</span><strong>Not configured</strong><span class="subtle">Add the next ordered round from the plan controls.</span></div>
  );

  const renderCommitteeRound = (round: Round): JSX.Element => {
    const roundCommittee = committeeForRound(round);
    return <section class="committee-round" key={round.id}>
      <div class="committee-intro"><span><strong>{round.name}</strong> · {roundCommittee?.name ?? "No reviewer pool selected"}</span><span>{round.target_reviews_per_submission} reviews per abstract</span></div>
      {roundCommittee ? <><div class="committee-list">{roundCommittee.members.map((member) => {
        const roundProgress = reviewerProgress[round.id];
        const progress = roundProgress?.[member.id];
        const coverageLabel = progress
          ? `${progress.reviewed_count} / ${progress.assigned_count} reviewed`
          : roundProgress === undefined ? "Reading coverage…" : roundProgress === null ? "Coverage unavailable" : "No assignments yet";
        const action = progress?.outstanding_count
          ? <Button small variant="ghost" onClick={() => void remindReviewer(round, member.id)}>Remind</Button>
          : progress
            ? <span class="tabular subtle">{progress.reviewed_count} complete</span>
            : <span class="tabular subtle">—</span>;
        return <div class="committee-person" key={`${round.id}-${member.id}`}><span class="mini-avatar">{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong><ReviewerName name={member.name} kind={member.kind} /></strong><div class="scope-chips">{member.track_scopes.map((scope) => <Chip key={scope.id}>{scope.name}</Chip>)}</div><span class="subtle">{coverageLabel}{progress?.recusal_count ? ` · ${progress.recusal_count} recusal${progress.recusal_count === 1 ? "" : "s"}` : ""}</span></div><span class="committee-person-action">{action}</span></div>;
      })}</div><Button class="full-width ghost" onClick={() => setDialog("committee")}>View all {roundCommittee.members.length} reviewers →</Button></> : <div class="inline-empty"><span>Choose a reviewer pool on this round card before distributing assignments.</span><Button small variant="primary" onClick={() => setDialog("committee")}>Manage committee</Button></div>}
    </section>;
  };

  if (loading) return <div class="evaluation-loading instrument"><span class="eyebrow">Evaluation plan</span><strong>Loading conference review machinery…</strong><span class="subtle">Reading rounds, committees, and reviewer coverage.</span></div>;
  if (error && !plan) return <EmptyState title="Evaluation data unavailable" copy={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />;
  if (!plan) return <EmptyState title="No evaluation plan" copy="Set the scorecard, committee, and two review rounds before assigning abstracts." action={<Button variant="primary" onClick={() => setDialog("plan")}>Create evaluation plan</Button>} />;

  return <>
    <PageHeader title="Evaluation plan" copy="Evaluation is open. Add an Agent evaluator seat with its own credential, prompt, and rubric, then let the committee decide." actions={<>
      <a class="button primary" href="/submissions?sort=score">View results →</a>
      <a class="button" href={`/api/v1/events/${eventId}/plans/${plan.id}/results/export?format=csv`} download="review-results.csv" onClick={(event) => void exportResults(event)}>Export scores (CSV)</a>
      <Button onClick={() => void load()}>Refresh</Button>
      <Button onClick={() => { setAssignmentRoundId(firstRound?.id ?? null); setDialog("assignment"); }}>Distribute assignments</Button>
      <Button variant="primary" onClick={() => setDialog("plan")}>+ New evaluation plan</Button>
    </>} />
    {error && <div class="evaluation-alert alarm" role="alert">{error}</div>}
    {notice && <div class="evaluation-alert success" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}
    {agentSecret && <TokenSecretPanel secret={agentSecret} onDismiss={() => setAgentSecret(null)} onNotice={setNotice} />}
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
        </div><div class="evaluation-summary-note"><span>Recusals excluded from aggregates</span><strong class="tabular">{plan.summary.recusals.toLocaleString()}</strong></div><div class="spark" aria-label="Score distribution"><i style="height:35%" /><i style="height:52%" /><i style="height:39%" /><i style="height:71%" /><i style="height:67%" /><i style="height:81%" /><i style="height:74%" /><i style="height:92%" /><i style="height:83%" /><i style="height:96%" /></div></CardBody>
      </Card>
      <Card class="committee-card">
        <CardHeader title="Program committee"><div class="card-actions"><Button small variant="primary" onClick={openInvite} disabled={!committee}>Invite reviewer</Button><Button small onClick={openAgent} disabled={!committee}>Add Agent evaluator</Button><Button small onClick={() => setDialog("committee")}>Manage</Button><Button small onClick={() => { setAssignmentRoundId(firstRound?.id ?? null); setDialog("assignment"); }}>Edit assignments</Button></div></CardHeader>
        <CardBody>{plan.rounds.length ? plan.rounds.map(renderCommitteeRound) : <div class="inline-empty"><span>No rounds yet. Create a round before assigning reviews.</span><Button small variant="primary" onClick={() => setDialog("plan")}>Configure plan</Button></div>}</CardBody>
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
    {dialog === "assignment" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={distribute}><header><span class="eyebrow">Round assignments</span><h2>Distribute assignments</h2></header><div class="eval-dialog-body"><label class="field">Round<select value={assignmentRoundId ?? firstRound?.id ?? ""} onChange={(event) => setAssignmentRoundId((event.currentTarget as HTMLSelectElement).value)}>{plan.rounds.map((round) => <option key={round.id} value={round.id}>{round.position + 1} · {round.name}</option>)}</select></label><label class="field">Assignment mode<select value={assignmentMode} onChange={(event) => setAssignmentMode((event.currentTarget as HTMLSelectElement).value as "everyone" | "n_per_submission")}><option value="n_per_submission">N reviewers per submission</option><option value="everyone">Everyone reviews everything</option></select></label><label class="field">Reviewers per submission<input type="number" min="1" value={reviewerTarget} onInput={(event) => setReviewerTarget(Number((event.currentTarget as HTMLInputElement).value))} /></label><div class="message-preview">Assignments belong to the selected round. Re-running distribution is idempotent and never replaces completed review or comparison evidence.</div></div><footer><Button type="button" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!plan.rounds.some((round) => round.id === (assignmentRoundId ?? firstRound?.id) && Boolean(round.committee_id))}>Distribute</Button></footer></form></div>}
    {dialog === "invite" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={inviteReviewer}>
      <header><span class="eyebrow">{committee?.name ?? "Program committee"}</span><h2>Invite reviewer</h2></header>
      <div class="eval-dialog-body">
        {inviteResult ? <div class="invite-result" aria-live="polite">
          <strong>{inviteResult.person.name} is on the committee.</strong>
          <span class="subtle">Reviewing {inviteResult.track_ids.length === tracks.length ? "every track" : tracks.filter((track) => inviteResult.track_ids.includes(track.id)).map((track) => track.name).join(", ")}.</span>
          <span class="subtle">{inviteResult.invite_sent
            ? `A sign-in link was emailed to ${inviteResult.person.email}.`
            : inviteResult.invite_suppressed
              ? `The invitation to ${inviteResult.person.email} was logged rather than sent — this conference only emails addresses on its allowlist.`
              : `The invitation to ${inviteResult.person.email} could not be queued. They are on the committee; send them a sign-in link yourself.`}</span>
          {inviteResult.magic_link ? <div class="invite-link">
            <input readOnly aria-label="Reviewer sign-in link" value={inviteResult.magic_link} onFocus={(event) => (event.currentTarget as HTMLInputElement).select()} />
            <Button type="button" small onClick={() => void copyInviteLink()}>{linkCopied ? "Copied" : "Copy link"}</Button>
            <code class="invite-link-readable" aria-label="Full reviewer sign-in link">{inviteResult.magic_link}</code>
          </div> : null}
        </div> : <>
          <label class="field">Name<input aria-label="Reviewer name" value={inviteName} placeholder="Nora Vale" onInput={(event) => setInviteName((event.currentTarget as HTMLInputElement).value)} /></label>
          <label class="field">Email<input aria-label="Reviewer email" type="email" value={inviteEmail} placeholder="nora@example.org" onInput={(event) => setInviteEmail((event.currentTarget as HTMLInputElement).value)} /></label>
          <fieldset class="field invite-tracks">
            <legend>Track responsibilities</legend>
            <div class="scope-checks">{tracks.map((track) => <label class="scope-check" key={track.id}>
              <input
                type="checkbox"
                aria-label={track.name}
                checked={inviteTrackIds.includes(track.id)}
                onChange={(event) => setInviteTrackIds((event.currentTarget as HTMLInputElement).checked
                  ? [...inviteTrackIds, track.id]
                  : inviteTrackIds.filter((id) => id !== track.id))}
              />
              <span>{track.name}</span>
            </label>)}</div>
            <small class="subtle">A reviewer only sees abstracts in the tracks they are responsible for, so at least one is required. For a reviewer who already has responsibilities here, this list replaces them.</small>
          </fieldset>
          <div class="message-preview">One step creates the person, gives them this conference’s reviewer role, seats them on the committee, and scopes them to the tracks above. On a demo conference their sign-in link is shown here afterwards.</div>
        </>}
      </div>
      <footer>
        {/* The confirmation replaces the form rather than growing beneath it:
            checking a track never moves a control, and the dialog changes state
            wholesale on submit instead of pushing the buttons down a screen. */}
        <Button type="button" onClick={() => setDialog(null)}>{inviteResult ? "Done" : "Cancel"}</Button>
        {inviteResult
          ? <Button type="button" variant="primary" onClick={openInvite}>Invite another</Button>
          : <Button type="submit" variant="primary" disabled={inviteSaving || !committee || inviteName.trim() === "" || inviteEmail.trim() === "" || inviteTrackIds.length === 0}>{inviteSaving ? "Inviting…" : "Send invitation"}</Button>}
      </footer>
    </form></div>}
    {dialog === "agent" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={createAgent}>
      <header><span class="eyebrow">{committee?.name ?? "Program committee"}</span><h2>Add Agent evaluator</h2></header>
      <div class="eval-dialog-body">
        {agentResult ? <div class="invite-result" aria-live="polite"><strong>{agentResult.person.name} is on the committee as an Agent evaluator.</strong><span class="subtle">The credential is in the shown-once panel above. Assign this seat through the existing round controls.</span><span class="subtle">Responsible for {agentResult.track_ids.length === tracks.length ? "every track" : tracks.filter((track) => agentResult.track_ids.includes(track.id)).map((track) => track.name).join(", ")}.</span></div> : <>
          <label class="field">Name<input aria-label="Agent evaluator name" value={agentName} placeholder="Triage agent" onInput={(event) => setAgentName((event.currentTarget as HTMLInputElement).value)} /></label>
          <fieldset class="field invite-tracks"><legend>Track responsibilities</legend><div class="scope-checks">{tracks.map((track) => <label class="scope-check" key={track.id}><input type="checkbox" aria-label={track.name} checked={agentTrackIds.includes(track.id)} onChange={(event) => setAgentTrackIds((current) => event.currentTarget.checked ? [...current, track.id] : current.filter((id) => id !== track.id))} /><span>{track.name}</span></label>)}</div><small class="subtle">The Agent seat only sees assigned reviews whose abstracts intersect these responsibilities.</small></fieldset>
          <div class="message-preview">One transaction creates the Agent person, reviewer seat, committee membership, track scope, and its narrowly scoped credential.</div>
        </>}
      </div>
      <footer><Button type="button" onClick={() => setDialog(null)}>{agentResult ? "Done" : "Cancel"}</Button>{agentResult ? <Button type="button" variant="primary" onClick={openAgent}>Add another</Button> : <Button type="submit" variant="primary" disabled={agentSaving || !committee || agentName.trim() === "" || agentTrackIds.length === 0}>{agentSaving ? "Creating…" : "Create Agent seat"}</Button>}</footer>
    </form></div>}
    {dialog === "promotion" && <div class="eval-dialog-backdrop" role="presentation"><div class="eval-dialog"><header><span class="eyebrow">Round promotion</span><h2>Preview the next funnel</h2></header><div class="eval-dialog-body"><div class="promotion-preview"><strong>Filtered promotion set</strong><span>Use the same typed filter as the conference submission list. Empty legacy selections never promote records.</span><label class="field">Status<select value={promotionStatus} onChange={(event) => { setPromotionStatus((event.currentTarget as HTMLSelectElement).value); setPromotionResult(null); }}><option value="in_review">In review</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="waitlisted">Waitlisted</option></select></label><label class="field">Search<input value={promotionQuery} placeholder="Title, track, or speaker" onInput={(event) => { setPromotionQuery((event.currentTarget as HTMLInputElement).value); setPromotionResult(null); }} /></label>{promotionResult && <div class="promotion-result"><span><strong>{promotionResult.selected}</strong> selected</span><span><strong>{promotionResult.promoted}</strong> ready to promote</span><span><strong>{promotionResult.already_promoted}</strong> already in Round 2</span></div>}</div></div><footer><Button type="button" onClick={() => { setDialog(null); setPromotionResult(null); }}>Done</Button><Button type="button" onClick={() => void runPromotion(true)} disabled={promotionApplying}>Refresh preview</Button><Button type="button" variant="primary" onClick={() => void runPromotion(false)} disabled={promotionApplying || !promotionResult?.promoted}>{promotionApplying ? "Applying…" : "Promote selected"}</Button></footer></div></div>}
  </>;
}
