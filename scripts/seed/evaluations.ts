/** Evaluation plans, authority, assignments, and recommendation evidence. */

import { allocateAssignments } from "../../src/lib/assignment-allocation.ts";
import { seedId, syntheticEmail } from "../../src/lib/ids.ts";
import type { SeedContext, SeedModule, SeedRow } from "./_sql.ts";
import { EVENT_ID, ORG_ID, STAFF_PERSON_ID, TRACK_IDS } from "./event.ts";
import { CODE_2025_ROSTER } from "./pool.ts";
import { poolSubmissionId } from "./pool.ts";

export const ROUND_ONE_ID = seedId("rnd", "initial-review");
export const ORGANIZER_UNREVIEWED_ASSIGNMENTS = 40;
export const AGENT_PERSON_ID = seedId("per", "evaluator-triage-agent");
export const AGENT_TOKEN_ID = seedId("tok", "evaluator-triage-agent");
export const AGENT_SUBMISSION_ID = poolSubmissionId(1);

const PLAN_ID = seedId("evp", "program-review");
const ROUND_TWO_ID = seedId("rnd", "final-selection");
const COMMITTEE_ID = seedId("com", "program-reviewers");
const REVIEWERS = [
  { key: "nora-vale", name: "Nora Vale", company: "Mosaic Relay" },
  { key: "dario-quill", name: "Dario Quill", company: "Northstar Ledger" },
  { key: "imani-sato", name: "Imani Sato", company: "Open Harbor Labs" },
] as const;

/**
 * Stored scorecard answers are keyed by criterion id, never by name.
 *
 * The reviewer surface renders and re-fills a saved review by looking each
 * criterion up by id, so a name-keyed row shows a reviewer their own scores as
 * unlabelled strangers — and renaming a criterion would orphan them for good.
 */
function criterionScores(byName: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(byName).map(([name, value]) => [seedId("rbc", `${ROUND_ONE_ID}-${name}`), value]),
  );
}

/**
 * Round one's completed reviews, two in every three carrying a real scorecard.
 *
 * A conference with one scored abstract out of a thousand cannot demonstrate
 * its own results view: the WEIGHTED SCORE column is a single number over a
 * wall of "Not scored", and sorting it high-to-low and low-to-high returns the
 * identical page — a working control that is indistinguishable from a broken
 * one, and read as broken by everyone who tries it. Enough of the round is
 * scored here for the column to rank, and the remaining third stays
 * recommendation-only on purpose: "Not scored" is a real state a real
 * conference holds, it must keep sorting last in both directions, and the
 * unweighted/weighted distinction needs a case to show.
 *
 * Deterministic in the index, like every other seeded value, so re-running
 * converges instead of reshuffling the demo under a judge.
 */
function seededScorecard(index: number): { score: number; criteria: Record<string, number> } | null {
  // Every fifth review stays recommendation-only. Five, not three: the
  // recommendation cycles on three, so a scorecard on the same modulus would
  // lock the two in phase and leave every unscored review carrying the same
  // recommendation — which is exactly the coverage AC-245 exists to keep.
  if (index % 5 === 4) return null;
  // Half-steps across the published 1–5 scale, offset per criterion so the
  // three do not move in lockstep.
  const point = (offset: number): number => 1 + (((index * 7) + offset) % 9) * 0.5;
  const criteria = { "Program fit": point(0), "Audience value": point(2), Clarity: point(4) };
  const weights = { "Program fit": 40, "Audience value": 35, Clarity: 25 } as const;
  const weighted = (criteria["Program fit"] * weights["Program fit"]
    + criteria["Audience value"] * weights["Audience value"]
    + criteria.Clarity * weights.Clarity) / 100;
  return { score: Math.round(weighted * 100) / 100, criteria: criterionScores(criteria) };
}

function table(ctx: SeedContext, name: string): SeedRow["row"][] {
  return ctx.rows.filter((entry) => entry.table === name).map((entry) => entry.row);
}

function membership(ctx: SeedContext, personId: string, role: string): void {
  ctx.add("memberships", {
    id: seedId("mem", `${personId}-${role}`),
    org_id: ORG_ID,
    event_id: EVENT_ID,
    person_id: personId,
    role,
    created_at: ctx.now,
    updated_at: ctx.now,
  });
}

function organizationMembership(ctx: SeedContext, personId: string, role: string): void {
  ctx.add("memberships", {
    id: seedId("mem", `${personId}-org-${role}`),
    org_id: ORG_ID,
    event_id: null,
    person_id: personId,
    role,
    created_at: ctx.now,
    updated_at: ctx.now,
  });
}

export function run(ctx: SeedContext): void {
  membership(ctx, STAFF_PERSON_ID, "owner");
  membership(ctx, STAFF_PERSON_ID, "program_lead");
  membership(ctx, STAFF_PERSON_ID, "reviewer");
  organizationMembership(ctx, STAFF_PERSON_ID, "owner");

  const acceptedIds = new Set(
    table(ctx, "submissions").filter((row) => row.status === "accepted").map((row) => String(row.id)),
  );
  const acceptedSpeakerIds = new Set(
    table(ctx, "participations")
      .filter((row) => acceptedIds.has(String(row.submission_id)))
      .map((row) => String(row.person_id)),
  );
  const peopleByName = new Map(
    table(ctx, "people").map((person) => [String(person.name).trim(), String(person.id)]),
  );
  for (const [publishedName] of CODE_2025_ROSTER) {
    const personId = peopleByName.get(publishedName.trim())
      ?? (publishedName === "Aparna Dhinakaran" ? peopleByName.get("Aparna Dhinkaran") : undefined);
    if (!personId) throw new Error(`CODE 2025 speaker ${publishedName} has no deduplicated person row`);
    acceptedSpeakerIds.add(personId);
  }
  for (const personId of [...acceptedSpeakerIds].sort()) membership(ctx, personId, "speaker");

  const reviewerIds: string[] = [];
  const takenEmails = new Set<string>();
  for (const reviewer of REVIEWERS) {
    const personId = seedId("per", `reviewer-${reviewer.key}`);
    reviewerIds.push(personId);
    ctx.add("people", {
      id: personId,
      org_id: ORG_ID,
      email: syntheticEmail(reviewer.name, takenEmails),
      name: reviewer.name,
      title: "Program Reviewer",
      company: reviewer.company,
      bio: "Synthetic reviewer persona for the seeded evaluation plan.",
      headshot_attachment_id: null,
      social_links: "[]",
      is_demo: 1,
      last_write_source: "marquee",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
    membership(ctx, personId, "reviewer");
  }

  ctx.add("people", {
    id: AGENT_PERSON_ID,
    org_id: ORG_ID,
    email: "triage.agent@example.com",
    name: "Triage agent",
    kind: "agent",
    title: "Agent evaluator",
    company: null,
    bio: "Seeded Agent evaluator seat for the evaluation walkthrough.",
    headshot_attachment_id: null,
    social_links: "[]",
    is_demo: 1,
    last_write_source: "marquee",
    created_at: ctx.now,
    updated_at: ctx.now,
  });
  membership(ctx, AGENT_PERSON_ID, "reviewer");

  const trackIds = Object.values(TRACK_IDS);
  for (const reviewerId of [STAFF_PERSON_ID, ...reviewerIds, AGENT_PERSON_ID]) {
    for (const trackId of trackIds) {
      ctx.add("reviewer_track_scopes", {
        id: seedId("rts", `${reviewerId}-${trackId}`),
        event_id: EVENT_ID,
        person_id: reviewerId,
        track_id: trackId,
        created_at: ctx.now,
        updated_at: ctx.now,
      });
    }
  }

  ctx.add("committees", {
    id: COMMITTEE_ID,
    event_id: EVENT_ID,
    name: "Program reviewers",
    created_at: ctx.now,
    updated_at: ctx.now,
  });
  reviewerIds.forEach((personId, index) => {
    ctx.add("committee_members", {
      id: seedId("cmm", `${COMMITTEE_ID}-${personId}`),
      committee_id: COMMITTEE_ID,
      person_id: personId,
      role: index === 0 ? "chair" : "reviewer",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  });
  ctx.add("committee_members", {
    id: seedId("cmm", `${COMMITTEE_ID}-${AGENT_PERSON_ID}`),
    committee_id: COMMITTEE_ID,
    person_id: AGENT_PERSON_ID,
    role: "reviewer",
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  ctx.add("api_tokens", {
    id: AGENT_TOKEN_ID,
    org_id: ORG_ID,
    event_id: EVENT_ID,
    name: "Evaluator seat · Triage agent",
    token_hash: "5d51377ad45aa39458876edf1016bf3f65dd8a22a3efdb922e30900f1fefb539",
    prefix: "mq_demo",
    scopes: JSON.stringify({ permissions: ["review:write"], event_ids: [EVENT_ID] }),
    created_by: STAFF_PERSON_ID,
    acts_as_person_id: AGENT_PERSON_ID,
    last_used_at: null,
    revoked_at: null,
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  ctx.add("evaluation_plans", {
    id: PLAN_ID,
    event_id: EVENT_ID,
    name: "2026 Program Review",
    instructions: "Recommend Approve, Maybe, or Deny. Numeric scoring is optional.",
    scale_min: 1,
    scale_max: 5,
    status: "open",
    created_at: ctx.now,
    updated_at: ctx.now,
  });
  ctx.add("evaluation_rounds", {
    id: ROUND_ONE_ID,
    plan_id: PLAN_ID,
    position: 0,
    name: "Initial review",
    mode: "scorecard",
    anonymized: 1,
    committee_id: COMMITTEE_ID,
    target_reviews_per_submission: 3,
    opens_at: Date.UTC(2026, 7, 10, 16),
    closes_at: Date.UTC(2026, 7, 28, 16),
    created_at: ctx.now,
    updated_at: ctx.now,
  });
  ctx.add("evaluation_rounds", {
    id: ROUND_TWO_ID,
    plan_id: PLAN_ID,
    position: 1,
    name: "Final selection",
    mode: "scorecard",
    anonymized: 0,
    committee_id: COMMITTEE_ID,
    target_reviews_per_submission: 3,
    opens_at: Date.UTC(2026, 7, 29, 16),
    closes_at: Date.UTC(2026, 8, 8, 16),
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  // Each round carries its own scorecard, and round one exercises all three
  // criterion kinds: a chair opening the demo sees what the editor can build,
  // not a bank of identical sliders.
  const roundOneCriteria = [
    { name: "Program fit", kind: "numeric", weight_pct: 40, scale_min: 1, scale_max: 5, options: null },
    { name: "Audience value", kind: "numeric", weight_pct: 35, scale_min: 1, scale_max: 5, options: null },
    { name: "Clarity", kind: "numeric", weight_pct: 25, scale_min: 1, scale_max: 5, options: null },
    { name: "Recommendation", kind: "select", weight_pct: 0, scale_min: null, scale_max: null, options: JSON.stringify(["Accept", "Maybe", "Reject"]) },
    { name: "Comments", kind: "text", weight_pct: 0, scale_min: null, scale_max: null, options: null },
  ] as const;
  const roundTwoCriteria = [
    { name: "Final score", kind: "numeric", weight_pct: 100, scale_min: 1, scale_max: 10, options: null },
    { name: "Committee notes", kind: "text", weight_pct: 0, scale_min: null, scale_max: null, options: null },
  ] as const;
  for (const [roundId, criteria] of [[ROUND_ONE_ID, roundOneCriteria], [ROUND_TWO_ID, roundTwoCriteria]] as const) {
    criteria.forEach((criterion, position) => {
      ctx.add("rubric_criteria", {
        id: seedId("rbc", `${roundId}-${criterion.name}`),
        round_id: roundId,
        name: criterion.name,
        kind: criterion.kind,
        options: criterion.options,
        scale_min: criterion.scale_min,
        scale_max: criterion.scale_max,
        weight_pct: criterion.weight_pct,
        position,
        created_at: ctx.now,
        updated_at: ctx.now,
      });
    });
  }

  const candidates = table(ctx, "submissions").filter((row) => row.status === "in_review");
  const organizerQueue = candidates.slice(0, ORGANIZER_UNREVIEWED_ASSIGNMENTS + 1);
  for (const submission of organizerQueue) {
    ctx.add("round_assignments", {
      id: seedId("ras", `${ROUND_ONE_ID}-${submission.id}-${STAFF_PERSON_ID}`),
      round_id: ROUND_ONE_ID,
      submission_id: submission.id,
      reviewer_person_id: STAFF_PERSON_ID,
      committee_id: null,
      status: submission.id === AGENT_SUBMISSION_ID ? "complete" : "assigned",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }

  const completed = candidates.slice(ORGANIZER_UNREVIEWED_ASSIGNMENTS, 100);
  const recommendations = ["approve", "maybe", "deny"] as const;
  completed.forEach((submission, index) => {
    const reviewerId = reviewerIds[index % reviewerIds.length]!;
    const scorecard = seededScorecard(index);
    ctx.add("round_assignments", {
      id: seedId("ras", `${ROUND_ONE_ID}-${submission.id}-${reviewerId}`),
      round_id: ROUND_ONE_ID,
      submission_id: submission.id,
      reviewer_person_id: reviewerId,
      committee_id: null,
      status: "complete",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
    ctx.add("evaluations", {
      id: seedId("evl", `${ROUND_ONE_ID}-${submission.id}-${reviewerId}`),
      round_id: ROUND_ONE_ID,
      submission_id: submission.id,
      reviewer_person_id: reviewerId,
      recommendation: recommendations[index % recommendations.length]!,
      score: scorecard?.score ?? null,
      criteria_scores: scorecard ? JSON.stringify(scorecard.criteria) : null,
      comment: scorecard
        ? "Seeded round-one review: criteria scored against the published scorecard."
        : "Seeded recommendation; the optional numeric scorecard was intentionally skipped.",
      abstained: 0,
      created_at: ctx.now - (index + 1) * 60_000,
      updated_at: ctx.now - (index + 1) * 60_000,
    });
  });

  /**
   * The committee's share of the round, materialized.
   *
   * These 100 abstracts used to be one blanket row per abstract pointing at
   * the committee, which meant every pool member's queue silently contained
   * them while the progress dashboard — which counts per-reviewer rows — could
   * see none of it. They are distributed here through the same scope-aware,
   * load-balanced allocator the API uses, so the demo opens with coverage that
   * every surface agrees about and reminders that have someone to chase.
   */
  const trackNamesById = new Map(table(ctx, "tracks").map((track) => [String(track.id), String(track.name)]));
  const tracksBySubmission = new Map<string, string[]>();
  for (const row of table(ctx, "submission_tracks")) {
    const list = tracksBySubmission.get(String(row.submission_id)) ?? [];
    list.push(String(row.track_id));
    tracksBySubmission.set(String(row.submission_id), list);
  }
  const scopesByReviewer = new Map<string, Set<string>>();
  for (const row of table(ctx, "reviewer_track_scopes")) {
    const scoped = scopesByReviewer.get(String(row.person_id)) ?? new Set<string>();
    scoped.add(String(row.track_id));
    scopesByReviewer.set(String(row.person_id), scoped);
  }
  const committeeShare = candidates.slice(100, 200).map((submission) => ({
    id: String(submission.id),
    trackNames: (tracksBySubmission.get(String(submission.id)) ?? []).map((trackId) => trackNamesById.get(trackId) ?? trackId),
  }));
  const eligible = new Map<string, string[]>(committeeShare.map((submission) => [
    submission.id,
    reviewerIds.filter((reviewerId) => (tracksBySubmission.get(submission.id) ?? [])
      .some((trackId) => scopesByReviewer.get(reviewerId)?.has(trackId))),
  ]));
  const distribution = allocateAssignments({
    submissions: committeeShare,
    eligible,
    existing: new Map(),
    load: new Map(reviewerIds.map((reviewerId) => [reviewerId, 0])),
    // The round asks for three reviews per abstract and the pool holds three
    // reviewers, so the seeded state is exactly what Distribute would produce.
    reviewersPerSubmission: 3,
    maxPerReviewer: null,
  });
  for (const [submissionId, reviewerId] of distribution.pairs) {
    ctx.add("round_assignments", {
      id: seedId("ras", `${ROUND_ONE_ID}-${submissionId}-${reviewerId}`),
      round_id: ROUND_ONE_ID,
      submission_id: submissionId,
      reviewer_person_id: reviewerId,
      committee_id: null,
      status: "assigned",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }

  ctx.add("evaluations", {
    id: seedId("evl", `${ROUND_ONE_ID}-${AGENT_SUBMISSION_ID}-${STAFF_PERSON_ID}`),
    round_id: ROUND_ONE_ID,
    submission_id: AGENT_SUBMISSION_ID,
    reviewer_person_id: STAFF_PERSON_ID,
    recommendation: "approve",
    score: 4.2,
    criteria_scores: JSON.stringify(criterionScores({ "Program fit": 4.2, "Audience value": 4.3, Clarity: 4.1 })),
    comment: "Human review: a clear monorepo CI case study with a credible build-caching path.",
    abstained: 0,
    created_at: ctx.now - 120_000,
    updated_at: ctx.now - 120_000,
  });

  ctx.add("round_assignments", {
    id: seedId("ras", `${ROUND_ONE_ID}-${AGENT_SUBMISSION_ID}-${AGENT_PERSON_ID}`),
    round_id: ROUND_ONE_ID,
    submission_id: AGENT_SUBMISSION_ID,
    reviewer_person_id: AGENT_PERSON_ID,
    committee_id: null,
    status: "complete",
    created_at: ctx.now,
    updated_at: ctx.now,
  });
  ctx.add("evaluations", {
    id: seedId("evl", `${ROUND_ONE_ID}-${AGENT_SUBMISSION_ID}-${AGENT_PERSON_ID}`),
    round_id: ROUND_ONE_ID,
    submission_id: AGENT_SUBMISSION_ID,
    reviewer_person_id: AGENT_PERSON_ID,
    recommendation: "maybe",
    score: 4.5,
    criteria_scores: JSON.stringify(criterionScores({ "Program fit": 4.5, "Audience value": 4.6, Clarity: 4.4 })),
    comment: "Agent review: the 40-minute CI problem is concrete and the monorepo build-caching proposal is promising; ask for measurements across clean and incremental builds.",
    abstained: 0,
    created_at: ctx.now - 60_000,
    updated_at: ctx.now - 60_000,
  });
}

export const seed: SeedModule = { name: "evaluations", order: 40, run };
