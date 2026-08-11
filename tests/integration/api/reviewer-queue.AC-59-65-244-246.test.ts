import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { DEMO_EVENT_ID, DEMO_ORGANIZATION_ID, DEMO_ORGANIZER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const REVIEWER_ID = "per-mrq-18-reviewer";
const SESSION_ID = "sess-mrq-18-reviewer";
const ORGANIZER_SESSION_ID = "sess-mrq-18-organizer";
const TRACK_A = "track-mrq-18-a";
const TRACK_B = "track-mrq-18-b";
const TRACK_C = "track-mrq-18-c";
const FORM_ID = "form-mrq-18-review";
const FIELD_ID = "field-mrq-18-audience";
const FORMAT_ID = "format-mrq-18-workshop";
const PLAN_ID = "plan-mrq-18-review";
const ROUND_ID = "round-mrq-18-initial";
const COMMITTEE_ID = "committee-mrq-18";
const MAIN_ID = "submission-mrq-18-main";
const A_ONLY_ID = "submission-mrq-18-a-only";
const OUT_OF_SCOPE_ID = "submission-mrq-18-out-of-scope";
const RECOMMENDATION_IDS = [
  "submission-mrq-18-approve",
  "submission-mrq-18-maybe",
  "submission-mrq-18-deny",
] as const;
const SPEED_IDS = Array.from({ length: 20 }, (_, index) => `submission-mrq-18-speed-${index}`);
const ORIGIN = "https://marquee.example";

interface QueueEnvelope {
  current_id: string | null;
  current_index: number | null;
  data: Array<{ id: string; queue_id: string }>;
  plan: { id: string; name: string };
  remaining: number;
  scopes: Array<{ name: string }>;
  total: number;
}

interface SubmissionDetail {
  abstract: string | null;
  blind_mode: boolean;
  fields: unknown[];
  files: unknown[];
  format: string | null;
  id: string;
  identity: unknown;
  review: { actor_id: string; recommendation: string | null; updated_at: number } | null;
}

async function request(path: string, init: RequestInit = {}, sessionId = SESSION_ID): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${sessionId}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function submissionStatement(id: string, title: string, abstract: string, formId = FORM_ID, formatId: string | null = null) {
  return env.DB.prepare(`
    INSERT INTO submissions (
      id, event_id, form_id, format_id, kind, bypass_evaluation, title, abstract, status, origin,
      submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'abstract', 0, ?, ?, 'in_review', 'public', ?, ?, ?, ?, ?, ?)
  `).bind(id, EVENT_ID, formId, formatId, title, abstract, ORGANIZER_ID, NOW, NOW, title.toLowerCase(), NOW, NOW);
}

function trackStatement(id: string, submissionId: string, trackId: string, primary: number) {
  return env.DB.prepare(
    "INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, submissionId, trackId, primary, NOW, NOW);
}

function assignmentStatement(id: string, submissionId: string) {
  return env.DB.prepare(
    "INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'assigned', ?, ?)",
  ).bind(id, ROUND_ID, submissionId, REVIEWER_ID, NOW, NOW);
}

const NOW = Date.now();

async function seedReviewerFixture(): Promise<void> {
  await applyMigrations();
  for (const row of demoFixtureRows(NOW)) await env.DB.prepare(row.statement).bind(...row.bindings).run();

  const submissions = [
    submissionStatement(MAIN_ID, "A complete blind review submission", "A complete abstract whose evaluator-visible fields and files must be available.", FORM_ID, FORMAT_ID),
    submissionStatement(A_ONLY_ID, "A single-track submission", "This card is authorized through the primary track."),
    submissionStatement(OUT_OF_SCOPE_ID, "Hidden security submission", "This metadata must never be returned to a reviewer outside the track scope."),
    ...RECOMMENDATION_IDS.map((id, index) => submissionStatement(id, `Recommendation ${index + 1}`, "A recommendation-only review fixture.")),
    ...SPEED_IDS.map((id, index) => submissionStatement(id, `Speed submission ${index + 1}`, "A small deterministic speed-budget review fixture.")),
  ];
  const trackRows = [
    trackStatement("submission-track-mrq-18-main-a", MAIN_ID, TRACK_A, 1),
    trackStatement("submission-track-mrq-18-main-b", MAIN_ID, TRACK_B, 0),
    trackStatement("submission-track-mrq-18-a-only", A_ONLY_ID, TRACK_A, 1),
    trackStatement("submission-track-mrq-18-out", OUT_OF_SCOPE_ID, TRACK_C, 1),
    ...RECOMMENDATION_IDS.map((id, index) => trackStatement(`submission-track-mrq-18-rec-${index}`, id, TRACK_A, 1)),
    ...SPEED_IDS.map((id, index) => trackStatement(`submission-track-mrq-18-speed-${index}`, id, TRACK_A, 1)),
  ];
  const assignments = [
    assignmentStatement("assignment-mrq-18-main", MAIN_ID),
    assignmentStatement("assignment-mrq-18-a-only", A_ONLY_ID),
    assignmentStatement("assignment-mrq-18-out", OUT_OF_SCOPE_ID),
    ...RECOMMENDATION_IDS.map((id, index) => assignmentStatement(`assignment-mrq-18-rec-${index}`, id)),
    ...SPEED_IDS.map((id, index) => assignmentStatement(`assignment-mrq-18-speed-${index}`, id)),
  ];

  await env.DB.batch([
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', ?, ?)").bind(REVIEWER_ID, DEMO_ORGANIZATION_ID, "reviewer@mrq-18.marquee.example", "MRQ-18 Reviewer", NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'reviewer', ?, ?)").bind("membership-mrq-18-reviewer", DEMO_ORGANIZATION_ID, EVENT_ID, REVIEWER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'reviewer', ?, 'mrq-18', NULL, ?, ?)").bind(SESSION_ID, REVIEWER_ID, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'mrq-18-organizer', NULL, ?, ?)").bind(ORGANIZER_SESSION_ID, ORGANIZER_ID, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Agents', '#db4c3f', 0, ?, ?)").bind(TRACK_A, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Evals', '#0d9488', 1, ?, ?)").bind(TRACK_B, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Security', '#be185d', 2, ?, ?)").bind(TRACK_C, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, 'Workshop', 60, 30, 120, 0, ?, ?)").bind(FORMAT_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at) VALUES (?, ?, 'Reviewer form', 'reviewer-form', 'abstract', 'open', ?, ?)").bind(FORM_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at) VALUES (?, ?, 'audience_outcome', 'Audience outcome', 'long_text', 1, 0, '{}', ?, ?)").bind(FIELD_ID, FORM_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at) VALUES (?, ?, 'MRQ-18 review', 'Read the whole submission, then recommend.', 1, 5, 'open', ?, ?)").bind(PLAN_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES (?, ?, 0, 'Initial review', 'scorecard', 1, 1, ?, ?)").bind(ROUND_ID, PLAN_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES ('criterion-mrq-18', ?, 'Fit', 100, 0, ?, ?)").bind(ROUND_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, 'MRQ-18 committee', ?, ?)").bind(COMMITTEE_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at) VALUES ('committee-member-mrq-18', ?, ?, 'chair', ?, ?)").bind(COMMITTEE_ID, REVIEWER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at) VALUES ('scope-mrq-18-a', ?, ?, ?, ?, ?)").bind(EVENT_ID, REVIEWER_ID, TRACK_A, NOW, NOW),
    ...submissions,
    ...trackRows,
    env.DB.prepare("INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at) VALUES ('answer-mrq-18', ?, ?, 'Build reliable systems', NULL, ?, ?)").bind(MAIN_ID, FIELD_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('participation-mrq-18-main', ?, ?, 'submitter', 0, ?, ?)").bind(MAIN_ID, ORGANIZER_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at) VALUES ('file-mrq-18', ?, 'submission_file', ?, 'submission/mrq-18.pdf', 'reviewer-guide.pdf', 'application/pdf', 4096, 'ready', 'etag-mrq-18', ?, ?)").bind(EVENT_ID, MAIN_ID, NOW, NOW),
    ...assignments,
  ]);
}

describe.sequential("MRQ-18 reviewer queue", () => {
  beforeAll(seedReviewerFixture, 10_000);

  test("AC-59, AC-60 · first load is populated and queue position survives a detail revisit", async () => {
    const first = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`);
    expect(first.status).toBe(200);
    const firstBody = await json<QueueEnvelope>(first);
    expect(firstBody.data.length).toBeGreaterThanOrEqual(23);
    expect(firstBody.current_id).toBe(firstBody.data[0]?.id);
    expect(firstBody.current_index).toBe(0);
    expect(firstBody.remaining).toBe(firstBody.total);
    expect(firstBody.scopes.map((scope) => scope.name)).toEqual(["Agents"]);

    const contextResponse = await request(`/api/v1/events/${EVENT_ID}/reviewer/queue`);
    expect(contextResponse.status).toBe(200);
    const contextBody = await json<QueueEnvelope>(contextResponse);
    expect(contextBody.plan.name).toBe("MRQ-18 review");
    expect(contextBody.current_id).toBe(firstBody.current_id);
    expect(contextBody.data.length).toBe(firstBody.data.length);

    const revisited = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`);
    const revisitedBody = await json<QueueEnvelope>(revisited);
    expect(revisitedBody.current_id).toBe(firstBody.current_id);
    expect(revisitedBody.current_index).toBe(firstBody.current_index);
    expect(revisitedBody.data[0]?.queue_id).toBe(firstBody.data[0]?.queue_id);
  });

  test("AC-244 · full detail contains evaluator fields and downloadable file metadata while blind identity stays in the query layer", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${MAIN_ID}`);
    expect(response.status).toBe(200);
    const body = await json<SubmissionDetail>(response);
    expect(body).toMatchObject({ id: MAIN_ID, blind_mode: true, format: "Workshop", title: "A complete blind review submission" });
    expect(body.abstract).toContain("evaluator-visible fields");
    expect(body.fields).toEqual(expect.arrayContaining([expect.objectContaining({ key: "audience_outcome", label: "Audience outcome", value_text: "Build reliable systems" })]));
    expect(body.files).toEqual([expect.objectContaining({ filename: "reviewer-guide.pdf", content_type: "application/pdf", size_bytes: 4096, status: "ready" })]);
    expect(body.identity).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Demo Organizer");
    expect(JSON.stringify(body)).not.toContain("organizer@demo.marquee.example");
  });

  test("AC-63 · a reviewer cannot change the conference anonymity setting", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/plans/${PLAN_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ rounds: [{ name: "Initial review", position: 0, mode: "scorecard", anonymized: false, target_reviews_per_submission: 1 }] }),
    });
    expect(response.status).toBe(403);
  });

  test("AC-64, AC-246 · every reviewer surface uses blind output and an out-of-scope ID returns 403 with no metadata", async () => {
    const paths = [
      `/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${OUT_OF_SCOPE_ID}`,
      `/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${OUT_OF_SCOPE_ID}/files`,
      `/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${OUT_OF_SCOPE_ID}/evaluations`,
    ];
    for (const path of paths) {
      const response = await request(path, path.endsWith("evaluations") ? { method: "POST", body: JSON.stringify({ recommendation: "maybe" }) } : undefined);
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(body).not.toContain(OUT_OF_SCOPE_ID);
      expect(body).not.toContain("Hidden security submission");
      expect(body).not.toContain("Demo Organizer");
    }

    const exportResponse = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/export?format=csv`);
    expect(exportResponse.status).toBe(200);
    const csv = await exportResponse.text();
    expect(csv).toContain("submission_id,title,abstract,format,tracks");
    expect(csv).not.toContain("Hidden security submission");
    expect(csv).not.toContain("Demo Organizer");
    expect(csv).not.toContain("organizer@demo.marquee.example");
  });

  test("AC-245 · Approve, Maybe, and Deny save nullable scorecards, restore actor/time, and leave lifecycle unchanged", async () => {
    const choices = ["approve", "maybe", "deny"] as const;
    const expectedStatuses = ["accepted", "waitlisted", "rejected"] as const;
    for (const [index, choice] of choices.entries()) {
      const submissionId = RECOMMENDATION_IDS[index]!;
      const response = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${submissionId}/evaluations`, {
        method: "POST",
        body: JSON.stringify({ recommendation: choice, comment: `Saved ${choice}` }),
      });
      expect(response.status).toBe(200);
      const saved = await json<{ criteria_scores: null; decision_proposal: { resulting_status: string }; score: null }>(response);
      expect(saved.score).toBeNull();
      expect(saved.criteria_scores).toBeNull();
      expect(saved.decision_proposal.resulting_status).toBe(expectedStatuses[index]);

      const row = await env.DB.prepare("SELECT recommendation, score, criteria_scores, reviewer_person_id, updated_at FROM evaluations WHERE round_id = ? AND submission_id = ?").bind(ROUND_ID, submissionId).first<{ criteria_scores: string | null; recommendation: string; reviewer_person_id: string; score: number | null; updated_at: number }>();
      expect(row).toMatchObject({ recommendation: choice, criteria_scores: null, reviewer_person_id: REVIEWER_ID, score: null });
      expect(row?.updated_at).toBeGreaterThan(0);
      const lifecycle = await env.DB.prepare("SELECT status FROM submissions WHERE id = ?").bind(submissionId).first<{ status: string }>();
      expect(lifecycle?.status).toBe("in_review");

      const detailResponse = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${submissionId}`);
      const detail = await json<SubmissionDetail>(detailResponse);
      expect(detail.review?.recommendation).toBe(choice);
      expect(detail.review?.actor_id).toBe(REVIEWER_ID);
      expect(detail.review?.updated_at).toBe(row?.updated_at);
    }
  });

  test("AC-62 · score submission to next queue card stays within the signed 300ms median budget", async () => {
    const durations: number[] = [];
    for (const [index, submissionId] of SPEED_IDS.entries()) {
      const started = performance.now();
      const response = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${submissionId}/evaluations`, {
        method: "POST",
        body: JSON.stringify({ recommendation: index % 2 ? "maybe" : "approve", score: null, criteria_scores: null }),
      });
      expect(response.status).toBe(200);
      const queue = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`);
      expect(queue.status).toBe(200);
      durations.push(performance.now() - started);
    }
    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] ?? Number.POSITIVE_INFINITY;
    expect(median).toBeLessThan(300);
  });

  test("AC-65 · the organizer-facing submission list retains identity for an authorized program lead", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/submissions?per_page=100`, {}, ORGANIZER_SESSION_ID);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Demo Organizer");
  });
});
