/** Evaluation plans, authority, assignments, and recommendation evidence. */

import { seedId, syntheticEmail } from "../../src/lib/ids.ts";
import type { SeedContext, SeedModule, SeedRow } from "./_sql.ts";
import { EVENT_ID, ORG_ID, STAFF_PERSON_ID, TRACK_IDS } from "./event.ts";
import { CODE_2025_ROSTER } from "./pool.ts";

export const ROUND_ONE_ID = seedId("rnd", "initial-review");
export const ORGANIZER_UNREVIEWED_ASSIGNMENTS = 40;

const PLAN_ID = seedId("evp", "program-review");
const ROUND_TWO_ID = seedId("rnd", "final-selection");
const COMMITTEE_ID = seedId("com", "program-reviewers");
const REVIEWERS = [
  { key: "nora-vale", name: "Nora Vale", company: "Mosaic Relay" },
  { key: "dario-quill", name: "Dario Quill", company: "Northstar Ledger" },
  { key: "imani-sato", name: "Imani Sato", company: "Open Harbor Labs" },
] as const;

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

export function run(ctx: SeedContext): void {
  membership(ctx, STAFF_PERSON_ID, "owner");
  membership(ctx, STAFF_PERSON_ID, "program_lead");
  membership(ctx, STAFF_PERSON_ID, "reviewer");

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

  const trackIds = Object.values(TRACK_IDS);
  for (const reviewerId of [STAFF_PERSON_ID, ...reviewerIds]) {
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
    mode: "comparison",
    anonymized: 0,
    target_reviews_per_submission: 3,
    opens_at: Date.UTC(2026, 7, 29, 16),
    closes_at: Date.UTC(2026, 8, 8, 16),
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  const criteria = [
    ["Program fit", 40], ["Audience value", 35], ["Clarity", 25],
  ] as const;
  criteria.forEach(([name, weight], position) => {
    ctx.add("rubric_criteria", {
      id: seedId("rbc", name),
      round_id: ROUND_ONE_ID,
      name,
      weight_pct: weight,
      position,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  });

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

  const candidates = table(ctx, "submissions").filter((row) => row.status === "in_review");
  const organizerQueue = candidates.slice(0, ORGANIZER_UNREVIEWED_ASSIGNMENTS);
  for (const submission of organizerQueue) {
    ctx.add("round_assignments", {
      id: seedId("ras", `${ROUND_ONE_ID}-${submission.id}-${STAFF_PERSON_ID}`),
      round_id: ROUND_ONE_ID,
      submission_id: submission.id,
      reviewer_person_id: STAFF_PERSON_ID,
      committee_id: null,
      status: "assigned",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }

  const completed = candidates.slice(ORGANIZER_UNREVIEWED_ASSIGNMENTS, 100);
  const recommendations = ["approve", "maybe", "deny"] as const;
  completed.forEach((submission, index) => {
    const reviewerId = reviewerIds[index % reviewerIds.length]!;
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
      score: null,
      criteria_scores: null,
      comment: "Seeded recommendation; the optional numeric scorecard was intentionally skipped.",
      abstained: 0,
      created_at: ctx.now - (index + 1) * 60_000,
      updated_at: ctx.now - (index + 1) * 60_000,
    });
  });

  for (const submission of candidates.slice(100, 200)) {
    ctx.add("round_assignments", {
      id: seedId("ras", `${ROUND_ONE_ID}-${submission.id}-${COMMITTEE_ID}`),
      round_id: ROUND_ONE_ID,
      submission_id: submission.id,
      reviewer_person_id: null,
      committee_id: COMMITTEE_ID,
      status: "assigned",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }
}

export const seed: SeedModule = { name: "evaluations", order: 40, run };
