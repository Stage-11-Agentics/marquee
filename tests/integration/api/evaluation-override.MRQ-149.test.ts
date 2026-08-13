import { SELF } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

/**
 * The chair's override of a recorded score.
 *
 * The product's claim is that an Agent seat records a first-pass judgment and a
 * chair can override any of them. These tests hold the two halves of that
 * sentence honest: the override governs and survives a reload, and the
 * reviewer's own judgment is still on the record beside it — an override
 * supersedes, it does not erase.
 */
const ORIGIN = "https://marquee.example";
const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZATION_ID = DEMO_ORGANIZATION_ID;
const CHAIR_ID = DEMO_ORGANIZER_PERSON_ID;
const CHAIR_SESSION = "sess-mrq149-chair";
const REVIEWER_ID = "per-mrq149-reviewer";
const REVIEWER_SESSION = "sess-mrq149-reviewer";
const AGENT_ID = "per-mrq149-agent";
const TRACK_ID = "track-mrq149";
const PLAN_ID = "plan-mrq149";
const ROUND_ID = "round-mrq149";
const SUBMISSION_ID = "submission-mrq149-ci";
const AGENT_EVALUATION_ID = "evaluation-mrq149-agent";
const HUMAN_EVALUATION_ID = "evaluation-mrq149-human";
const NOW = Date.UTC(2026, 7, 20, 16);
// Fixture rows stay pinned to NOW; a session's expiry cannot, because the Worker
// checks it against the real clock. Anchored to NOW, these sessions would expire
// on 2026-08-21 and fail every run after that date.
const SESSION_EXPIRES_AT = Date.now() + 86_400_000;

interface EvaluationView {
  id: string;
  reviewer_name: string;
  reviewer_kind: string;
  score: number | null;
  comment: string;
  override_score: number | null;
  override_comment: string | null;
  override_person_name: string | null;
  override_at: number | null;
  scale_min: number | null;
  scale_max: number | null;
}

interface RecordView {
  actions: { can_override_scores: boolean };
  evaluations: EvaluationView[];
}

async function request(path: string, init: RequestInit = {}, session = CHAIR_SESSION): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${session}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function overridePath(evaluationId: string, submissionId = SUBMISSION_ID): string {
  return `/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${submissionId}/evaluations/${evaluationId}/override`;
}

/** Always re-read from the API rather than trusting the write's own response. */
async function readRecord(session = CHAIR_SESSION): Promise<RecordView> {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}`, {}, session);
  expect(response.status).toBe(200);
  return response.json() as Promise<RecordView>;
}

async function evaluationOf(kind: "agent" | "human"): Promise<EvaluationView> {
  const record = await readRecord();
  const evaluation = record.evaluations.find((row) => row.reviewer_kind === kind);
  expect(evaluation).toBeDefined();
  return evaluation!;
}

async function listScore(): Promise<{ score: number | null; review_count: number }> {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions?per_page=50`);
  const body = await response.json() as { data: Array<{ id: string; score: number | null; review_count: number }> };
  const item = body.data.find((row) => row.id === SUBMISSION_ID);
  expect(item).toBeDefined();
  return { score: item!.score, review_count: item!.review_count };
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  for (const row of demoFixtureRows(NOW)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, 'mrq149-chair', NULL, ?, ?)`,
    ).bind(CHAIR_SESSION, CHAIR_ID, SESSION_EXPIRES_AT, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, kind, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, 'Nora Vale', 'human', 0, 'marquee', ?, ?),
              (?, ?, ?, 'Triage agent', 'agent', 0, 'marquee', ?, ?)`,
    ).bind(
      REVIEWER_ID, ORGANIZATION_ID, "nora.vale@example.com", NOW, NOW,
      AGENT_ID, ORGANIZATION_ID, "triage.agent@example.com", NOW, NOW,
    ),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'reviewer', ?, 'mrq149-reviewer', NULL, ?, ?)`,
    ).bind(REVIEWER_SESSION, REVIEWER_ID, SESSION_EXPIRES_AT, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq149-reviewer', ?, ?, ?, 'reviewer', ?, ?),
              ('membership-mrq149-agent', ?, ?, ?, 'reviewer', ?, ?)`,
    ).bind(ORGANIZATION_ID, EVENT_ID, REVIEWER_ID, NOW, NOW, ORGANIZATION_ID, EVENT_ID, AGENT_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Agents', '#0b6a72', 0, ?, ?)",
    ).bind(TRACK_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at)
       VALUES (?, ?, 'Program review', 'Score every abstract.', 1, 5, 'open', ?, ?)`,
    ).bind(PLAN_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at)
       VALUES (?, ?, 0, 'Initial review', 'scorecard', 0, 3, ?, ?)`,
    ).bind(ROUND_ID, PLAN_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
       VALUES (?, ?, 'abstract', 0, 'Taming 40-Minute CI', 'A monorepo CI case study.', 'in_review', 'public', ?, ?, ?, 'taming 40-minute ci', ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, CHAIR_ID, NOW, NOW, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('submission-track-mrq149', ?, ?, 1, ?, ?)",
    ).bind(SUBMISSION_ID, TRACK_ID, NOW, NOW),
    // Track scope and a round assignment, so the reviewer can reach their own
    // evaluation through the real write route. Without these the revision test
    // could only reach the row with raw SQL — which would never execute the
    // upsert it exists to pin.
    env.DB.prepare(
      "INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at) VALUES ('scope-mrq149-reviewer', ?, ?, ?, ?, ?)",
    ).bind(EVENT_ID, REVIEWER_ID, TRACK_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES ('assignment-mrq149-reviewer', ?, ?, ?, NULL, 'complete', ?, ?)",
    ).bind(ROUND_ID, SUBMISSION_ID, REVIEWER_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'maybe', 4.5, NULL, ?, 0, ?, ?),
              (?, ?, ?, ?, 'approve', 4.2, NULL, ?, 0, ?, ?)`,
    ).bind(
      AGENT_EVALUATION_ID, ROUND_ID, SUBMISSION_ID, AGENT_ID,
      "Agent review: the 40-minute CI problem is concrete; ask for clean and incremental measurements.", NOW, NOW,
      HUMAN_EVALUATION_ID, ROUND_ID, SUBMISSION_ID, REVIEWER_ID,
      "Human review: a credible build-caching path.", NOW, NOW,
    ),
  ]);
}

beforeEach(seedFixture);

test("CONTRACT · MRQ-149 · a chair's override of an Agent first-pass score persists across a reload and stays distinguishable", async () => {
  const before = await evaluationOf("agent");
  expect(before).toMatchObject({ score: 4.5, override_score: null, reviewer_name: "Triage agent" });

  const response = await request(overridePath(AGENT_EVALUATION_ID), {
    method: "PUT",
    body: JSON.stringify({ score: 2.5, comment: "The measurements the agent asked for are already in the abstract." }),
  });
  expect(response.status).toBe(200);

  // Re-read from the API, which is what a reload does.
  const after = await evaluationOf("agent");
  expect(after.override_score).toBe(2.5);
  expect(after.override_person_name).toBe("Demo Organizer");
  expect(after.override_comment).toBe("The measurements the agent asked for are already in the abstract.");
  expect(after.override_at).toBeGreaterThan(0);
  // The agent's own judgment survives the override, attributed as the agent's.
  expect(after.score).toBe(4.5);
  expect(after.reviewer_kind).toBe("agent");
  expect(after.comment).toContain("Agent review");

  const stored = await env.DB.prepare(
    "SELECT override_score, override_person_id, score FROM evaluations WHERE id = ?",
  ).bind(AGENT_EVALUATION_ID).first<{ override_score: number; override_person_id: string; score: number }>();
  expect(stored).toEqual({ override_score: 2.5, override_person_id: CHAIR_ID, score: 4.5 });

  const audit = await env.DB.prepare(
    "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC",
  ).bind(AGENT_EVALUATION_ID).first<{ action: string }>();
  expect(audit?.action).toBe("evaluation_score_overridden");
});

test("CONTRACT · MRQ-149 · an override of a human score governs the committee aggregate, and clearing it restores the reviewer's own", async () => {
  // The agent's 4.5 is outside the human aggregate, so the headline is the
  // human reviewer's 4.2 alone.
  expect(await listScore()).toEqual({ score: 4.2, review_count: 1 });

  const overridden = await request(overridePath(HUMAN_EVALUATION_ID), { method: "PUT", body: JSON.stringify({ score: 3 }) });
  expect(overridden.status).toBe(200);
  expect(await listScore()).toEqual({ score: 3, review_count: 1 });

  const cleared = await request(overridePath(HUMAN_EVALUATION_ID), { method: "DELETE" });
  expect(cleared.status).toBe(200);
  expect(await listScore()).toEqual({ score: 4.2, review_count: 1 });
  const restored = await evaluationOf("human");
  expect(restored).toMatchObject({ score: 4.2, override_score: null, override_person_name: null });
});

test("CONTRACT · MRQ-149 · overriding an Agent score never lifts it into the human aggregate, and the list agrees with the record", async () => {
  const response = await request(overridePath(AGENT_EVALUATION_ID), { method: "PUT", body: JSON.stringify({ score: 5 }) });
  expect(response.status).toBe(200);
  // R1 holds: an agent's row stays out of the committee average whether or not
  // a chair has corrected the number on it.
  expect(await listScore()).toEqual({ score: 4.2, review_count: 1 });

  // The results list must not still be showing 4.5 while the record shows 5.
  const list = await request(`/api/v1/events/${EVENT_ID}/submissions?per_page=50`);
  const body = await list.json() as { data: Array<{ id: string; agent_reviews: Array<{ name: string; score: number | null; override_score: number | null }> }> };
  const item = body.data.find((row) => row.id === SUBMISSION_ID);
  expect(item?.agent_reviews).toEqual([expect.objectContaining({ name: "Triage agent", score: 4.5, override_score: 5 })]);
});

test("CONTRACT · MRQ-149 · only program staff may override, and the control is offered to exactly the same people", async () => {
  const asReviewer = await request(overridePath(AGENT_EVALUATION_ID), { method: "PUT", body: JSON.stringify({ score: 1 }) }, REVIEWER_SESSION);
  expect(asReviewer.status).toBe(403);
  const untouched = await env.DB.prepare("SELECT override_score FROM evaluations WHERE id = ?").bind(AGENT_EVALUATION_ID).first<{ override_score: number | null }>();
  expect(untouched?.override_score).toBeNull();

  expect((await readRecord()).actions.can_override_scores).toBe(true);
});

test("CONTRACT · MRQ-149 · an override is refused when it does not identify one evaluation of this round and submission", async () => {
  const unknown = await request(overridePath("evaluation-mrq149-nonexistent"), { method: "PUT", body: JSON.stringify({ score: 3 }) });
  expect(unknown.status).toBe(404);

  // A real evaluation id, addressed through a submission it does not belong to.
  const crossed = await request(overridePath(AGENT_EVALUATION_ID, "submission-mrq149-other"), { method: "PUT", body: JSON.stringify({ score: 3 }) });
  expect(crossed.status).toBe(404);

  const offScale = await request(overridePath(AGENT_EVALUATION_ID), { method: "PUT", body: JSON.stringify({ score: 9 }) });
  expect(offScale.status).toBe(422);
});

test("CONTRACT · MRQ-149 · the published schema documents the override the API actually returns", async () => {
  // `sequence/submission/DIFFERENTIATORS.md` stakes the claim that an
  // undocumented endpoint is not a state this codebase can express. A field on
  // the wire that the schema omits is the same defect one level down, and
  // `check:api` compares routes rather than payload shapes, so only a test
  // holds it.
  //
  // Verify against `/api/openapi.json`, never `/api/docs`. The latter renders a
  // table of operations — method, path, summary — and links the spec through
  // `<link rel="alternate">`; it carries no schema properties, so grepping it
  // for a field name returns nothing whether or not the field is documented.
  // That false negative reads exactly like a regression.
  const response = await SELF.fetch(`${ORIGIN}/api/openapi.json`);
  expect(response.status).toBe(200);
  const document = await response.json() as {
    components: {
      schemas: {
        SubmissionListItem: {
          properties: { agent_reviews: { items: { properties: Record<string, unknown>; required: string[] } } };
        };
      };
    };
  };
  // The agent review is inlined into `SubmissionListItem`, not a named
  // component, so assert on where it actually lives rather than sweeping the
  // component table — a sweep would pass on any schema that happened to match.
  const agentReview = document.components.schemas.SubmissionListItem.properties.agent_reviews.items;
  expect(Object.keys(agentReview.properties)).toContain("override_score");
  expect(agentReview.required).toContain("override_score");
});

test("CONTRACT · MRQ-149 · an off-scale override is refused without destroying the record", async () => {
  // The record page renders `kind: "error"` as a full-page "Record unavailable".
  // The override is the only control on that page submitting a number an
  // operator typed, so its refusal has to stay an ordinary answer: the server
  // says 422 with the offending field named, and the record itself still loads.
  const refused = await request(overridePath(AGENT_EVALUATION_ID), { method: "PUT", body: JSON.stringify({ score: 9 }) });
  expect(refused.status).toBe(422);
  const body = await refused.json() as { error: { message: string; field?: string } };
  expect(body.error.field).toBe("score");
  expect(body.error.message).toContain("1");
  expect(body.error.message).toContain("5");

  const record = await readRecord();
  expect(record.evaluations).toHaveLength(2);
  expect((await evaluationOf("agent")).override_score).toBeNull();
});

test("CONTRACT · MRQ-149 · the record carries the plan's scale so the control can bound its own input", async () => {
  const record = await readRecord();
  for (const evaluation of record.evaluations) {
    expect(evaluation.scale_min).toBe(1);
    expect(evaluation.scale_max).toBe(5);
  }
});

test("CONTRACT · MRQ-149 · an override supersedes the weighted criteria mean and reports as unweighted", async () => {
  // The one branch the rest of the suite cannot reach: every other fixture row
  // has `criteria_scores = NULL`, so nothing exercises an override landing on a
  // row that *did* go through the weighted computation. The register's asterisk
  // and the export's "Score basis" column both key off `score_is_weighted`, and
  // a chair's scalar did not go through that arithmetic — so claiming it did
  // would be exactly the overclaim this feature was careful to avoid.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rubric_criteria (id, round_id, name, kind, weight_pct, scale_min, scale_max, position, created_at, updated_at) VALUES ('criterion-mrq149-fit', ?, 'Program fit', 'numeric', 100, 1, 5, 0, ?, ?)",
    ).bind(ROUND_ID, NOW, NOW),
    env.DB.prepare("UPDATE evaluations SET criteria_scores = ? WHERE id = ?")
      .bind(JSON.stringify({ "Program fit": 4 }), HUMAN_EVALUATION_ID),
    env.DB.prepare("DELETE FROM evaluations WHERE id = ?").bind(AGENT_EVALUATION_ID),
  ]);
  const weighted = await request(`/api/v1/events/${EVENT_ID}/submissions?per_page=50`);
  const before = (await weighted.json() as { data: Array<{ id: string; score: number | null; score_is_weighted: boolean }> })
    .data.find((row) => row.id === SUBMISSION_ID);
  expect(before).toMatchObject({ score: 4, score_is_weighted: true });

  const overridden = await request(overridePath(HUMAN_EVALUATION_ID), { method: "PUT", body: JSON.stringify({ score: 2 }) });
  expect(overridden.status).toBe(200);
  const after = await request(`/api/v1/events/${EVENT_ID}/submissions?per_page=50`);
  const item = (await after.json() as { data: Array<{ id: string; score: number | null; score_is_weighted: boolean }> })
    .data.find((row) => row.id === SUBMISSION_ID);
  expect(item).toMatchObject({ score: 2, score_is_weighted: false });
});

test("CONTRACT · MRQ-149 · a chair's override survives the reviewer revising their own score", async () => {
  // Deliberate, not incidental: the evaluation upsert leaves `override_*`
  // alone, so a reviewer cannot lift a chair's correction by re-submitting.
  //
  // This drives the REAL write route rather than updating the row with SQL. A
  // raw UPDATE never executes the `DO UPDATE SET` whose column list is the
  // entire behaviour under test, so it would pass identically if the override
  // were cleared there — a check that cannot fail.
  const overridden = await request(overridePath(HUMAN_EVALUATION_ID), {
    method: "PUT",
    body: JSON.stringify({ score: 2.5, comment: "Chair's correction." }),
  });
  expect(overridden.status).toBe(200);

  const resubmitted = await request(
    `/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${SUBMISSION_ID}/evaluations`,
    { method: "POST", body: JSON.stringify({ comment: "Reviewer revised after a second read.", recommendation: "approve", score: 3, abstained: 0 }) },
    REVIEWER_SESSION,
  );
  expect(resubmitted.status).toBe(200);

  const evaluation = await evaluationOf("human");
  expect(evaluation.override_score).toBe(2.5);
  expect(evaluation.override_comment).toBe("Chair's correction.");
  // The reviewer's revision is on the record too — superseded, not discarded.
  expect(evaluation.score).toBe(3);
  expect(evaluation.comment).toBe("Reviewer revised after a second read.");
  // The chair's number still governs the aggregate, not the reviewer's new one.
  expect((await listScore()).score).toBe(2.5);

  // Clearing restores the reviewer's *current* value, not the one the chair saw.
  const cleared = await request(overridePath(HUMAN_EVALUATION_ID), { method: "DELETE" });
  expect(cleared.status).toBe(200);
  expect((await evaluationOf("human")).override_score).toBeNull();
  expect((await evaluationOf("human")).score).toBe(3);
  expect((await listScore()).score).toBe(3);
});

test("CONTRACT · MRQ-149 · the plan summary headlines the governing score, not the superseded one", async () => {
  // Two organizer screens must not disagree about the same number. Before this
  // was fixed, /evaluation's summary kept headlining a reviewer's original
  // score after the register, the results table, the export and the record had
  // all moved to the chair's.
  const before = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
  expect(before.status).toBe(200);
  expect((await before.json() as { summary: { highest_score: number | null } }).summary.highest_score).toBe(4.2);

  const overridden = await request(overridePath(HUMAN_EVALUATION_ID), { method: "PUT", body: JSON.stringify({ score: 2 }) });
  expect(overridden.status).toBe(200);

  const after = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`);
  expect((await after.json() as { summary: { highest_score: number | null } }).summary.highest_score).toBe(2);
});
