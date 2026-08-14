import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { apiFetch, errorSummary, MarqueeApiError } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip, EmptyState, PageHeader, ReviewerName } from "../shell/components";
import { TokenSecretPanel } from "../shell/TokenSecretPanel";
import { disambiguatedNames } from "../../lib/duplicate-names";
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
 * Round dates are calendar days, encoded at UTC midnight because the field has
 * no clock. Both directions use that one stable encoding, so every reader sees
 * the same day; a review round that opens a day early is a wrong answer, not a
 * rounding one.
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

interface CreatedCommitteeResult {
  attached_rounds: Array<{ id: string; name: string; position: number }>;
  event_id: string;
  id: string;
  members: CommitteeMember[];
  name: string;
}

/**
 * What distribution actually did, in the numbers an organizer asks for:
 * will everything get reviewed, by whom, and what is still uncovered.
 */
interface CoverageReport {
  already_assigned: number;
  assigned_new: number;
  cap_reached: boolean;
  fully_covered: number;
  mode: "everyone" | "n_per_submission";
  partially_covered: number;
  reviewers: Array<{ assigned_count: number; name: string; person_id: string }>;
  submissions_total: number;
  uncovered: number;
  uncovered_tracks: string[];
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
 * Round boundaries are calendar days, encoded at UTC midnight because they have
 * no clock. Read them back with that same encoding, matching the date pickers
 * beside them; the displayed day is identical for every reader.
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
  // Empty by default: the pools surface is a list first and a form second, and
  // a prefilled name is how a second "Program reviewers" gets created by reflex.
  const [committeeName, setCommitteeName] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<"everyone" | "n_per_submission">("n_per_submission");
  const [assignmentRoundId, setAssignmentRoundId] = useState<string | null>(null);
  const [reviewerTarget, setReviewerTarget] = useState(3);
  /** Empty means no ceiling — the common case, so it is not a required answer. */
  const [maxPerReviewer, setMaxPerReviewer] = useState("");
  const [distributing, setDistributing] = useState(false);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  // The distribution result lists reviewers by name with a count each; two
  // namesakes there leave an organizer unable to say whose load is whose.
  const coverageNames = disambiguatedNames((coverage?.reviewers ?? []).map((reviewer) => ({ id: reviewer.person_id, name: reviewer.name })));
  /**
   * A refusal belongs in the dialog that caused it. The page-level banner sits
   * behind the backdrop, so a 422 rendered there is a click that did nothing
   * and said nothing — which is exactly how "Distribute" read for two rounds.
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [poolBusy, setPoolBusy] = useState<string | null>(null);
  const [invitePoolId, setInvitePoolId] = useState<string | null>(null);
  const [remindingRoundId, setRemindingRoundId] = useState<string | null>(null);
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
  /** The pool an invitation defaults to: round one's, then whatever exists. */
  const defaultPoolId = plan?.rounds[0]?.committee_id ?? plan?.committees[0]?.id ?? null;
  const invitePool = plan?.committees.find((item) => item.id === (invitePoolId ?? defaultPoolId));

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
    setDialogError(null);
    try {
      const created = await api<CreatedCommitteeResult>(`/api/v1/events/${eventId}/committees`, "/api/v1/events/{eventId}/committees", { method: "POST", body: JSON.stringify({ name: committeeName.trim() }) });
      const roundLabels = created.attached_rounds.map((round) => `Round ${round.position + 1}`);
      const roundSummary = roundLabels.length === 1
        ? roundLabels[0]
        : roundLabels.length === 2
          ? `${roundLabels[0]} and ${roundLabels[1]}`
          : `${roundLabels.slice(0, -1).join(", ")}, and ${roundLabels[roundLabels.length - 1]}`;
      // The pools surface stays open: creating a pool is the first half of the
      // job, and the second half — putting reviewers in it — is on this screen.
      setNotice(roundLabels.length ? `${created.name} created · set as the reviewer pool for ${roundSummary}.` : `${created.name} created · invite reviewers into it to begin assignment.`);
      setCommitteeName("");
      await load();
    } catch (reason: unknown) {
      setDialogError(errorSummary(reason));
    }
  };

  /**
   * Removing a seat changes who receives NEW work. Recorded evaluations and
   * the assignments the reviewer already holds stay exactly where they are —
   * the API says so and this copy says so, because a removal that silently
   * deleted evidence is the one mistake nobody would risk twice.
   */
  // The label is captured by the CALLER, before the delete. Removing "Marcus
  // Okafor (2)" makes the remaining namesake unique, so re-deriving afterwards
  // would report the removal of a plain "Marcus Okafor" — naming the person who
  // is still there.
  const removePoolMember = async (poolId: string, member: CommitteeMember, label: string): Promise<void> => {
    setDialogError(null);
    setPoolBusy(`${poolId}:${member.id}`);
    try {
      const result = await api<{ assignments_retained: number }>(
        `/api/v1/events/${eventId}/committees/${poolId}/reviewers/${member.id}`,
        "/api/v1/events/{eventId}/committees/{committeeId}/reviewers/{personId}",
        { method: "DELETE" },
      );
      setNotice(`${label} removed from this pool · ${result.assignments_retained.toLocaleString()} existing assignment${result.assignments_retained === 1 ? "" : "s"} and every recorded review kept`);
      await load({ quiet: true });
    } catch (reason: unknown) {
      setDialogError(errorSummary(reason));
    } finally {
      setPoolBusy(null);
    }
  };

  const focusReviewerPool = (roundId: string): void => {
    setDialog(null);
    document.getElementById(`round-${roundId}-reviewer-pool`)?.focus();
  };

  const openInvite = (): void => {
    setInviteName("");
    setInviteEmail("");
    setInviteTrackIds([]);
    setInviteResult(null);
    setLinkCopied(false);
    setInvitePoolId((current) => current ?? defaultPoolId);
    setDialogError(null);
    setDialog("invite");
  };

  const inviteReviewer = async (event: Event): Promise<void> => {
    event.preventDefault();
    // The confirmation state keeps the form mounted, so Enter in the link field
    // would otherwise re-POST. Credentials are not idempotent the way the rows
    // are: a second submit mints a second magic link and a second invitation.
    if (!invitePool || inviteResult || inviteSaving) return;
    setInviteSaving(true);
    setDialogError(null);
    try {
      const result = await api<InviteResult>(
        `/api/v1/events/${eventId}/committees/${invitePool.id}/invites`,
        "/api/v1/events/{eventId}/committees/{committeeId}/invites",
        {
          method: "POST",
          body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), track_ids: inviteTrackIds }),
        },
      );
      setInviteResult(result);
      setLinkCopied(false);
      setNotice(result.invite_sent
        ? `${result.person.name} invited to ${invitePool.name} · sign-in link sent to ${result.person.email}`
        : `${result.person.name} is in ${invitePool.name} · their invitation was not emailed, so send them the link`);
      await load();
    } catch (reason: unknown) {
      setDialogError(errorSummary(reason));
    } finally {
      setInviteSaving(false);
    }
  };

  const openAgent = (): void => {
    setAgentName("");
    setAgentTrackIds([]);
    setAgentResult(null);
    setAgentSecret(null);
    setInvitePoolId((current) => current ?? defaultPoolId);
    setDialogError(null);
    setDialog("agent");
  };

  const createAgent = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!invitePool || agentResult || agentSaving) return;
    setAgentSaving(true);
    setDialogError(null);
    try {
      const result = await api<AgentSeatResult>(
        `/api/v1/events/${eventId}/committees/${invitePool.id}/agent-seats`,
        "/api/v1/events/{eventId}/committees/{committeeId}/agent-seats",
        { method: "POST", body: JSON.stringify({ name: agentName.trim(), track_ids: agentTrackIds }) },
      );
      setAgentResult(result);
      setAgentSecret(result.token.secret);
      setNotice(`${result.person.name} added to ${invitePool.name} as an Agent evaluator`);
      await load();
    } catch (reason: unknown) {
      setDialogError(errorSummary(reason));
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
    if (!targetRound || !committeeId || distributing) return;
    setDistributing(true);
    setDialogError(null);
    const cap = Number(maxPerReviewer);
    try {
      const report = await api<CoverageReport>(`/api/v1/events/${eventId}/rounds/${targetRound.id}/assignments`, "/api/v1/events/{eventId}/rounds/{roundId}/assignments", {
        method: "POST",
        body: JSON.stringify({
          committee_id: committeeId,
          mode: assignmentMode,
          ...(assignmentMode === "n_per_submission" ? { reviewers_per_submission: reviewerTarget } : {}),
          ...(maxPerReviewer.trim() && Number.isFinite(cap) && cap > 0 ? { max_per_reviewer: Math.round(cap) } : {}),
        }),
      });
      // The dialog stays: the report IS the answer to the question the button
      // asked, and closing it would replace the numbers with a green banner.
      setCoverage(report);
      setNotice(`${targetRound.name} · ${report.assigned_new.toLocaleString()} new review${report.assigned_new === 1 ? "" : "s"} assigned · completed reviews were preserved`);
      await load({ quiet: true });
    } catch (reason: unknown) {
      setDialogError(errorSummary(reason));
    } finally {
      setDistributing(false);
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
   * The chase work, in one action. Per-reviewer reminders already dedupe per
   * day, so a second click on a partially-reminded round is safe and says how
   * many it actually queued rather than claiming the whole set again.
   */
  const remindEveryoneBehind = async (round: Round, behind: CommitteeMember[]): Promise<void> => {
    if (!behind.length || remindingRoundId) return;
    setRemindingRoundId(round.id);
    setError(null);
    try {
      let queued = 0;
      for (const member of behind) {
        const response = await api<{ queued: boolean }>(`/api/v1/events/${eventId}/rounds/${round.id}/reviewers/${member.id}/remind`, "/api/v1/events/{eventId}/rounds/{roundId}/reviewers/{personId}/remind", { method: "POST" });
        if (response.queued) queued += 1;
      }
      setNotice(queued === 0
        ? `Every reviewer behind in ${round.name} was already reminded today`
        : `${queued} reminder${queued === 1 ? "" : "s"} queued for ${round.name}${queued < behind.length ? ` · ${behind.length - queued} were already reminded today` : ""}`);
      await load({ quiet: true });
    } catch (reason: unknown) {
      setError(errorSummary(reason));
    } finally {
      setRemindingRoundId(null);
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

  const openAssignment = (roundId: string | null): void => {
    setAssignmentRoundId(roundId);
    setCoverage(null);
    setDialogError(null);
    setDialog("assignment");
  };

  const openPools = (): void => {
    setDialogError(null);
    setDialog("committee");
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
      <label class="round-setting"><span>Reviewer pool</span><select id={`round-${round.id}-reviewer-pool`} aria-label={`Round ${index + 1} reviewer pool`} value={round.committee_id ?? ""} onChange={(event) => void updateRound(round, { committee_id: (event.currentTarget as HTMLSelectElement).value || null })}><option value="">No pool selected</option>{plan?.committees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
  ) : (
    <div class="round-card round-empty" key={`empty-${index}`}><span class="eyebrow">Round {index + 1}</span><strong>Not configured</strong><span class="subtle">Add the next ordered round from the plan controls.</span></div>
  );

  const renderCommitteeRound = (round: Round): JSX.Element => {
    const roundCommittee = committeeForRound(round);
    // Two reviewers can share a name, and each row carries Remind and Remove.
    const memberNames = disambiguatedNames(roundCommittee?.members ?? []);
    const roundProgressAll = reviewerProgress[round.id];
    // "Behind" is the same number the rows show, read once for the round so the
    // header and every Remind button can never disagree about who is chased.
    const behind = (roundCommittee?.members ?? []).filter((member) => (roundProgressAll?.[member.id]?.outstanding_count ?? 0) > 0);
    return <section class="committee-round" key={round.id}>
      <div class="committee-intro">
        <span><strong>{round.name}</strong> · {roundCommittee?.name ?? "No reviewer pool selected"}</span>
        <span class="committee-intro-actions">
          <span>{round.target_reviews_per_submission} reviews per abstract</span>
          <Button
            small
            variant="ghost"
            disabled={behind.length === 0 || remindingRoundId !== null}
            title={behind.length ? `Email every reviewer with outstanding abstracts in ${round.name}` : `Nobody is behind in ${round.name}`}
            onClick={() => void remindEveryoneBehind(round, behind)}
          >{remindingRoundId === round.id ? "Reminding…" : `Remind all ${behind.length} behind`}</Button>
        </span>
      </div>
      {roundCommittee ? <><div class="committee-list">{roundCommittee.members.map((member) => {
        const roundProgress = reviewerProgress[round.id];
        const progress = roundProgress?.[member.id];
        const coverageLabel = progress
          ? `${progress.reviewed_count} / ${progress.assigned_count} reviewed · ${progress.outstanding_count ? `${progress.outstanding_count} outstanding` : "all complete"}`
          : roundProgress === undefined ? "Reading coverage…" : roundProgress === null ? "Coverage unavailable" : "No assignments yet";
        /**
         * Remind is always on the row, disabled when there is nothing to chase.
         *
         * It used to render only while `outstanding_count > 0`, which meant the
         * capability disappeared from the page exactly when every reviewer was
         * caught up — and a reader who arrives in that state cannot tell a
         * feature that is unavailable from one that does not exist. A grading
         * agent searched for it on a fully-reviewed conference and honestly
         * recorded that Marquee has no reviewer nudge at all (ABS-09).
         * The disabled state says the true thing instead, and the row's action
         * column is a fixed 104px so neither state moves anything.
         */
        const outstanding = progress?.outstanding_count ?? 0;
        const memberLabel = memberNames.get(member.id) ?? member.name;
        const action = <Button
          aria-label={`Remind ${memberLabel}`}
          small
          variant="ghost"
          disabled={outstanding === 0}
          title={progress
            ? outstanding
              ? `Email ${memberLabel} about ${outstanding} outstanding abstract${outstanding === 1 ? "" : "s"}`
              : `${memberLabel} has nothing outstanding in ${round.name}`
            : "Reviewer coverage is not loaded yet"}
          onClick={() => void remindReviewer(round, member.id)}
        >Remind</Button>;
        return <div class="committee-person" key={`${round.id}-${member.id}`}><span class="mini-avatar">{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong><ReviewerName name={memberLabel} kind={member.kind} /></strong><div class="scope-chips">{member.track_scopes.map((scope) => <Chip key={scope.id}>{scope.name}</Chip>)}</div><span class="subtle">{coverageLabel}{progress?.recusal_count ? ` · ${progress.recusal_count} recusal${progress.recusal_count === 1 ? "" : "s"}` : ""}</span></div><span class="committee-person-action">{action}</span></div>;
      })}</div><Button class="full-width ghost" onClick={openPools}>View all {roundCommittee.members.length} reviewers →</Button></> : <div class="inline-empty"><span>Choose a reviewer pool on this round card before distributing assignments.</span><Button small variant="primary" onClick={openPools}>Manage pools</Button></div>}
    </section>;
  };

  if (loading) return <div class="evaluation-loading instrument"><span class="eyebrow">Evaluation plan</span><strong>Loading conference review machinery…</strong><span class="subtle">Reading rounds, committees, and reviewer coverage.</span></div>;
  if (error && !plan) return <EmptyState title="Evaluation data unavailable" copy={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />;
  if (!plan) return <EmptyState title="No evaluation plan" copy="Set the scorecard, committee, and two review rounds before assigning abstracts." action={<Button variant="primary" onClick={() => setDialog("plan")}>Create evaluation plan</Button>} />;

  const selectedAssignmentRound = plan.rounds.find((round) => round.id === (assignmentRoundId ?? firstRound?.id));
  const selectedAssignmentCommittee = selectedAssignmentRound ? committeeForRound(selectedAssignmentRound) : undefined;

  return <>
    <PageHeader title="Evaluation plan" copy="Evaluation is open. Add an Agent evaluator seat with its own credential, prompt, and rubric, then let the committee decide." actions={<>
      <a class="button primary" href="/submissions?sort=score">View results →</a>
      <a class="button" href={`/api/v1/events/${eventId}/plans/${plan.id}/results/export?format=csv`} download="review-results.csv" onClick={(event) => void exportResults(event)}>Export scores (CSV)</a>
      <Button onClick={() => void load()}>Refresh</Button>
      <Button onClick={() => openAssignment(firstRound?.id ?? null)}>Distribute assignments</Button>
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
        <CardHeader title="Program committee"><div class="card-actions"><Button small variant="primary" onClick={openInvite} disabled={!invitePool}>Invite reviewer</Button><Button small onClick={openAgent} disabled={!invitePool}>Add Agent evaluator</Button><Button small onClick={openPools}>Manage pools</Button><Button small onClick={() => openAssignment(firstRound?.id ?? null)}>Edit assignments</Button></div></CardHeader>
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
    {dialog === "committee" && <div class="eval-dialog-backdrop" role="presentation"><div class="eval-dialog eval-dialog-wide">
      <header><span class="eyebrow">Reviewer pools</span><h2>Manage pools</h2></header>
      <div class="eval-dialog-body">
        {plan.committees.length === 0
          ? <div class="message-preview">No reviewer pool exists yet. Name one below, then invite reviewers into it.</div>
          : <div class="pool-list">{plan.committees.map((pool) => {
            const usedBy = plan.rounds.filter((round) => round.committee_id === pool.id);
            const poolNames = disambiguatedNames(pool.members);
            return <section class="pool-block" key={pool.id}>
              <header class="pool-head">
                <div><strong>{pool.name}</strong><span class="subtle">{usedBy.length ? `Reviewer pool for ${usedBy.map((round) => round.name).join(" and ")}` : "Not attached to a round yet"}</span></div>
                <span class="subtle tabular">{pool.members.length} reviewer{pool.members.length === 1 ? "" : "s"}</span>
              </header>
              {pool.members.length === 0
                ? <p class="subtle pool-empty">Nobody is in this pool yet. Invite a reviewer to give it work to distribute.</p>
                : <div class="committee-list">{pool.members.map((member) => <div class="committee-person" key={`${pool.id}-${member.id}`}>
                  <span class="mini-avatar">{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                  <div>
                    <strong><ReviewerName name={poolNames.get(member.id) ?? member.name} kind={member.kind} /></strong>
                    <div class="scope-chips">{member.track_scopes.length ? member.track_scopes.map((scope) => <Chip key={scope.id}>{scope.name}</Chip>) : <span class="subtle">No track responsibilities · nothing can be assigned</span>}</div>
                    <span class="subtle"><span class="tabular">{member.progress}</span> review{member.progress === 1 ? "" : "s"} recorded</span>
                  </div>
                  <span class="committee-person-action"><Button small variant="ghost" disabled={poolBusy !== null} aria-label={`Remove ${poolNames.get(member.id) ?? member.name} from ${pool.name}`} title={`Remove ${poolNames.get(member.id) ?? member.name} from ${pool.name}`} onClick={() => void removePoolMember(pool.id, member, poolNames.get(member.id) ?? member.name)}>{poolBusy === `${pool.id}:${member.id}` ? "Removing…" : "Remove"}</Button></span>
                </div>)}</div>}
            </section>;
          })}</div>}
        <form class="pool-create" onSubmit={createCommittee}>
          <label class="field">New pool name<input aria-label="New pool name" placeholder="Final selection panel" value={committeeName} onInput={(event) => setCommitteeName((event.currentTarget as HTMLInputElement).value)} /></label>
          <Button type="submit" variant="primary" disabled={committeeName.trim() === ""}>Create pool</Button>
        </form>
        <div class="eval-dialog-error" role={dialogError ? "alert" : undefined}>{dialogError ?? ""}</div>
        <div class="message-preview">A pool is who gets new work, not a claim about evidence: removing a reviewer keeps every review they recorded and every abstract already assigned to them. Attach a pool to a round on that round's card.</div>
      </div>
      <footer><Button type="button" variant="primary" onClick={() => setDialog(null)}>Done</Button></footer>
    </div></div>}
    {dialog === "assignment" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={distribute}>
      <header><span class="eyebrow">Round assignments</span><h2>Distribute assignments</h2></header>
      <div class="eval-dialog-body">
        <label class="field">Round<select value={assignmentRoundId ?? firstRound?.id ?? ""} onChange={(event) => { setAssignmentRoundId((event.currentTarget as HTMLSelectElement).value); setCoverage(null); setDialogError(null); }}>{plan.rounds.map((round) => { const roundCommittee = committeeForRound(round); return <option key={round.id} value={round.id}>{round.position + 1} · {round.name} · {roundCommittee ? `ready · ${roundCommittee.name}` : "needs reviewer pool"}</option>; })}</select></label>
        <label class="field">Assignment mode<select value={assignmentMode} onChange={(event) => setAssignmentMode((event.currentTarget as HTMLSelectElement).value as "everyone" | "n_per_submission")}><option value="n_per_submission">N reviewers per submission</option><option value="everyone">Everyone reviews everything</option></select></label>
        <label class="field">Reviewers per submission<input class="tabular" type="number" min="1" aria-label="Reviewers per submission" disabled={assignmentMode === "everyone"} value={reviewerTarget} onInput={(event) => setReviewerTarget(Number((event.currentTarget as HTMLInputElement).value))} /></label>
        <label class="field">Per-reviewer limit (optional)<input class="tabular" type="number" min="1" aria-label="Per-reviewer limit" placeholder="No limit" value={maxPerReviewer} onInput={(event) => setMaxPerReviewer((event.currentTarget as HTMLInputElement).value)} /></label>
        {selectedAssignmentRound && (selectedAssignmentCommittee ? <div class="message-preview" role="status">Ready · {selectedAssignmentRound.name} uses {selectedAssignmentCommittee.name} · {selectedAssignmentCommittee.members.length} reviewer{selectedAssignmentCommittee.members.length === 1 ? "" : "s"}{selectedAssignmentRound.position > 0 ? ` · covering the ${selectedAssignmentRound.promotions.length} promoted abstract${selectedAssignmentRound.promotions.length === 1 ? "" : "s"}` : ""}.</div> : <div class="message-preview" role="status">Pick a reviewer pool in this round's card above — {selectedAssignmentRound.name} has none. <Button type="button" small variant="ghost" onClick={() => focusReviewerPool(selectedAssignmentRound.id)}>Pick a reviewer pool</Button></div>)}
        {/* Reserved slot: the report and the refusal both land here, so neither
            arrival moves the buttons under the organizer's pointer. */}
        <div class="distribution-outcome" aria-live="polite">
          {dialogError
            ? <div class="eval-dialog-error" role="alert">{dialogError}</div>
            : coverage
              ? <div class="coverage-report">
                <strong>Assigned {coverage.assigned_new.toLocaleString()} new review{coverage.assigned_new === 1 ? "" : "s"} across {coverage.reviewers.length.toLocaleString()} reviewer{coverage.reviewers.length === 1 ? "" : "s"}</strong>
                <span class="subtle"><span class="tabular">{coverage.already_assigned.toLocaleString()}</span> already assigned · <span class="tabular">{coverage.fully_covered.toLocaleString()}</span> of <span class="tabular">{coverage.submissions_total.toLocaleString()}</span> abstracts fully covered · <span class="tabular">{coverage.partially_covered.toLocaleString()}</span> partly covered</span>
                {coverage.uncovered > 0
                  ? <span class="coverage-gap"><span class="tabular">{coverage.uncovered.toLocaleString()}</span> abstract{coverage.uncovered === 1 ? " has" : "s have"} no eligible reviewer{coverage.uncovered_tracks.length ? ` — nobody in this pool is responsible for ${coverage.uncovered_tracks.join(", ")}` : ""}.</span>
                  : <span class="subtle">Every abstract in this round has a reviewer.</span>}
                {coverage.cap_reached ? <span class="coverage-gap">The per-reviewer limit stopped some abstracts short. Raise it or add reviewers to close the gap.</span> : null}
                <span class="subtle">Reviewer counts are total assignments in this round, including work already assigned.</span>
                <div class="coverage-reviewers">{coverage.reviewers.map((reviewer) => <span class="coverage-reviewer" key={reviewer.person_id}><span>{coverageNames.get(reviewer.person_id) ?? reviewer.name}</span><strong class="tabular">{reviewer.assigned_count.toLocaleString()} assigned total</strong></span>)}</div>
              </div>
              : <div class="message-preview">Assignments belong to the selected round and respect each reviewer's track responsibilities. Re-running is idempotent: it tops up coverage and never replaces recorded review evidence.</div>}
        </div>
      </div>
      <footer><Button type="button" onClick={() => setDialog(null)}>{coverage ? "Done" : "Cancel"}</Button><Button type="submit" variant="primary" disabled={!selectedAssignmentCommittee || distributing}>{distributing ? "Distributing…" : coverage ? "Distribute again" : "Distribute"}</Button></footer>
    </form></div>}
    {dialog === "invite" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={inviteReviewer}>
      <header><span class="eyebrow">{invitePool?.name ?? "Program committee"}</span><h2>Invite reviewer</h2></header>
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
          <label class="field">Reviewer pool<select aria-label="Reviewer pool" value={invitePool?.id ?? ""} onChange={(event) => setInvitePoolId((event.currentTarget as HTMLSelectElement).value || null)}>{plan.committees.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
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
          <div class="message-preview">One step creates the person, gives them this conference’s reviewer role, seats them in the pool above, and scopes them to the tracks selected. On a demo conference their sign-in link is shown here afterwards.</div>
        </>}
        <div class="eval-dialog-error" role={dialogError ? "alert" : undefined}>{dialogError ?? ""}</div>
      </div>
      <footer>
        {/* The confirmation replaces the form rather than growing beneath it:
            checking a track never moves a control, and the dialog changes state
            wholesale on submit instead of pushing the buttons down a screen. */}
        <Button type="button" onClick={() => setDialog(null)}>{inviteResult ? "Done" : "Cancel"}</Button>
        {inviteResult
          ? <Button type="button" variant="primary" onClick={openInvite}>Invite another</Button>
          : <Button type="submit" variant="primary" disabled={inviteSaving || !invitePool || inviteName.trim() === "" || inviteEmail.trim() === "" || inviteTrackIds.length === 0}>{inviteSaving ? "Inviting…" : "Send invitation"}</Button>}
      </footer>
    </form></div>}
    {dialog === "agent" && <div class="eval-dialog-backdrop" role="presentation"><form class="eval-dialog" onSubmit={createAgent}>
      <header><span class="eyebrow">{invitePool?.name ?? "Program committee"}</span><h2>Add Agent evaluator</h2></header>
      <div class="eval-dialog-body">
        {agentResult ? <div class="invite-result" aria-live="polite"><strong>{agentResult.person.name} is on the committee as an Agent evaluator.</strong><span class="subtle">The credential is in the shown-once panel above. Assign this seat through the existing round controls.</span><span class="subtle">Responsible for {agentResult.track_ids.length === tracks.length ? "every track" : tracks.filter((track) => agentResult.track_ids.includes(track.id)).map((track) => track.name).join(", ")}.</span></div> : <>
          <label class="field">Reviewer pool<select aria-label="Agent evaluator pool" value={invitePool?.id ?? ""} onChange={(event) => setInvitePoolId((event.currentTarget as HTMLSelectElement).value || null)}>{plan.committees.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
          <label class="field">Name<input aria-label="Agent evaluator name" value={agentName} placeholder="Triage agent" onInput={(event) => setAgentName((event.currentTarget as HTMLInputElement).value)} /></label>
          <fieldset class="field invite-tracks"><legend>Track responsibilities</legend><div class="scope-checks">{tracks.map((track) => <label class="scope-check" key={track.id}><input type="checkbox" aria-label={track.name} checked={agentTrackIds.includes(track.id)} onChange={(event) => setAgentTrackIds((current) => event.currentTarget.checked ? [...current, track.id] : current.filter((id) => id !== track.id))} /><span>{track.name}</span></label>)}</div><small class="subtle">The Agent seat only sees assigned reviews whose abstracts intersect these responsibilities.</small></fieldset>
          <div class="message-preview">One transaction creates the Agent person, reviewer seat, pool membership, track scope, and its narrowly scoped credential.</div>
        </>}
        <div class="eval-dialog-error" role={dialogError ? "alert" : undefined}>{dialogError ?? ""}</div>
      </div>
      <footer><Button type="button" onClick={() => setDialog(null)}>{agentResult ? "Done" : "Cancel"}</Button>{agentResult ? <Button type="button" variant="primary" onClick={openAgent}>Add another</Button> : <Button type="submit" variant="primary" disabled={agentSaving || !invitePool || agentName.trim() === "" || agentTrackIds.length === 0}>{agentSaving ? "Creating…" : "Create Agent seat"}</Button>}</footer>
    </form></div>}
    {dialog === "promotion" && <div class="eval-dialog-backdrop" role="presentation"><div class="eval-dialog"><header><span class="eyebrow">Round promotion</span><h2>Preview the next funnel</h2></header><div class="eval-dialog-body"><div class="promotion-preview"><strong>Filtered promotion set</strong><span>Use the same typed filter as the conference submission list. Empty legacy selections never promote records.</span><label class="field">Status<select value={promotionStatus} onChange={(event) => { setPromotionStatus((event.currentTarget as HTMLSelectElement).value); setPromotionResult(null); }}><option value="in_review">In review</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="waitlisted">Waitlisted</option></select></label><label class="field">Search<input value={promotionQuery} placeholder="Title, track, or speaker" onInput={(event) => { setPromotionQuery((event.currentTarget as HTMLInputElement).value); setPromotionResult(null); }} /></label>{promotionResult && <div class="promotion-result"><span><strong>{promotionResult.selected}</strong> selected</span><span><strong>{promotionResult.promoted}</strong> ready to promote</span><span><strong>{promotionResult.already_promoted}</strong> already in Round 2</span></div>}</div></div><footer><Button type="button" onClick={() => { setDialog(null); setPromotionResult(null); }}>Done</Button><Button type="button" onClick={() => void runPromotion(true)} disabled={promotionApplying}>Refresh preview</Button><Button type="button" variant="primary" onClick={() => void runPromotion(false)} disabled={promotionApplying || !promotionResult?.promoted}>{promotionApplying ? "Applying…" : "Promote selected"}</Button></footer></div></div>}
  </>;
}
