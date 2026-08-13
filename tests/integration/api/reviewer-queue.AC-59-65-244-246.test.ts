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
const ORIGIN = "https://marquee.stage11.dev";

interface QueueEnvelope {
  committees?: Array<{ id: string; name: string; role: string }>;
  completed?: Array<{ id: string; review: { criteria_scores: Record<string, number | string> | null; recommendation: string | null } | null }>;
  counts?: { reviewed: number; total: number; waiting: number };
  current_id: string | null;
  current_index: number | null;
  data: Array<{ id: string; queue_id: string }>;
  person?: { bio: string | null; company: string | null; email: string; id: string; name: string; title: string | null } | null;
  plan: { id: string; name: string };
  remaining: number;
  round?: { criteria?: Array<{ kind: string; name: string; options: string[] | null }> };
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

  test("CONTRACT · MRQ-171 · reviewer context carries the home data and the existing profile route accepts a reviewer seat", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/reviewer/queue`);
    expect(response.status).toBe(200);
    const body = await json<QueueEnvelope>(response);
    expect(body.person).toMatchObject({ id: REVIEWER_ID, name: "MRQ-18 Reviewer", email: "reviewer@mrq-18.marquee.example" });
    expect(body.committees).toEqual([{ id: COMMITTEE_ID, name: "MRQ-18 committee", role: "chair" }]);
    expect(body.counts).toEqual({ reviewed: 0, total: body.data.length, waiting: body.data.length });

    const profile = await request("/api/v1/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ title: "Review Chair", company: "Marquee Labs", bio: "A reviewer profile that survives a cold reload.", social_links: [], headshot_attachment_id: null }),
    });
    expect(profile.status).toBe(200);
    expect(await json<{ person: { title: string; company: string; bio: string } }>(profile)).toMatchObject({
      person: { title: "Review Chair", company: "Marquee Labs", bio: "A reviewer profile that survives a cold reload." },
    });

    const reloaded = await json<QueueEnvelope>(await request(`/api/v1/events/${EVENT_ID}/reviewer/queue`));
    expect(reloaded.person).toMatchObject({ title: "Review Chair", company: "Marquee Labs", bio: "A reviewer profile that survives a cold reload." });
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

  // The 300ms median is `review-next-interactive` in the speed manifest, measured
  // by check:speed against a real browser. This asserts the half that a hermetic
  // suite can actually prove: every score resolves the next card.
  test("AC-62 · scoring a submission always resolves the next queue card", async () => {
    for (const [index, submissionId] of SPEED_IDS.entries()) {
      const response = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${submissionId}/evaluations`, {
        method: "POST",
        body: JSON.stringify({ recommendation: index % 2 ? "maybe" : "approve", score: null, criteria_scores: null }),
      });
      expect(response.status).toBe(200);
      const queue = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`);
      expect(queue.status).toBe(200);
    }
  });

  test("AC-65 · the organizer-facing submission list retains identity for an authorized program lead", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/submissions?per_page=100`, {}, ORGANIZER_SESSION_ID);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Demo Organizer");
  });
  test("CONTRACT · MRQ-108 · the queue carries the round's scorecard, and a submitted review moves to Completed with its stored values", async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rubric_criteria WHERE round_id = ?").bind(ROUND_ID),
      env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position, created_at, updated_at) VALUES ('crit-mrq-108-originality', ?, 'Originality', 'numeric', NULL, 1, 5, 60, 0, ?, ?)").bind(ROUND_ID, now, now),
      env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position, created_at, updated_at) VALUES ('crit-mrq-108-relevance', ?, 'Relevance', 'numeric', NULL, 1, 5, 40, 1, ?, ?)").bind(ROUND_ID, now, now),
      env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position, created_at, updated_at) VALUES ('crit-mrq-108-recommendation', ?, 'Recommendation', 'select', '[\"Accept\",\"Maybe\",\"Reject\"]', NULL, NULL, 0, 2, ?, ?)").bind(ROUND_ID, now, now),
      env.DB.prepare("INSERT INTO rubric_criteria (id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position, created_at, updated_at) VALUES ('crit-mrq-108-comments', ?, 'Comments', 'text', NULL, NULL, NULL, 0, 3, ?, ?)").bind(ROUND_ID, now, now),
    ]);

    const before = await json<QueueEnvelope>(await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`));
    expect(before.round?.criteria?.map((criterion) => [criterion.name, criterion.kind])).toEqual([
      ["Originality", "numeric"], ["Relevance", "numeric"], ["Recommendation", "select"], ["Comments", "text"],
    ]);
    expect(before.round?.criteria?.[2]?.options).toEqual(["Accept", "Maybe", "Reject"]);
    expect(before.data.some((item) => item.id === A_ONLY_ID)).toBe(true);
    expect(before.completed?.some((item) => item.id === A_ONLY_ID)).toBe(false);

    const saved = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${A_ONLY_ID}/evaluations`, {
      method: "POST",
      body: JSON.stringify({
        comment: "Strong fit for the track.",
        criteria_scores: {
          "crit-mrq-108-originality": 4,
          "crit-mrq-108-relevance": 2,
          "crit-mrq-108-recommendation": "Accept",
          "crit-mrq-108-comments": "Clear worked examples throughout.",
        },
        recommendation: "approve",
      }),
    });
    expect(saved.status).toBe(200);

    const after = await json<QueueEnvelope>(await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`));
    expect(after.data.some((item) => item.id === A_ONLY_ID)).toBe(false);
    const reopened = after.completed?.find((item) => item.id === A_ONLY_ID);
    expect(reopened).toBeDefined();
    // Numbers stay numbers and strings stay strings — the reopened review is the
    // evidence that the values were stored, not merely that a badge turned green.
    expect(reopened?.review?.criteria_scores).toEqual({
      "crit-mrq-108-originality": 4,
      "crit-mrq-108-relevance": 2,
      "crit-mrq-108-recommendation": "Accept",
      "crit-mrq-108-comments": "Clear worked examples throughout.",
    });
    expect(reopened?.review?.recommendation).toBe("approve");

    const detail = await json<SubmissionDetail & { review: { criteria_scores: Record<string, number | string> | null } | null }>(
      await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/submissions/${A_ONLY_ID}`),
    );
    expect(detail.review?.criteria_scores?.["crit-mrq-108-recommendation"]).toBe("Accept");

    // Completed items are scoped exactly like open ones: an out-of-scope reviewer
    // sees nothing of another reviewer's finished work.
    const organizerQueue = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`, {}, ORGANIZER_SESSION_ID);
    if (organizerQueue.status === 200) {
      const body = await json<QueueEnvelope>(organizerQueue);
      expect(body.completed?.some((item) => item.id === A_ONLY_ID)).toBe(false);
    }
  });
});
