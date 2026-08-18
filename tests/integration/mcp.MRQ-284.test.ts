/**
 * The MCP endpoint against the real Worker.
 *
 * Everything here goes through `SELF.fetch("/mcp")` — the shipped composition
 * root, the shipped API app, the shipped pipeline. That is the only way to
 * prove the claim the design rests on: that a tool call is the same request the
 * REST route would have served, and cannot be more permissive than one.
 */
import { SELF } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";

import { createApiRouter } from "../../src/api/router";
import { apiManifest } from "../../src/routes/_manifest";
import { sha256Hex } from "../../src/lib/auth/random-token";
import { MCP_TOOLS } from "../../src/mcp/tools";
import { applyMigrations, env } from "./apply-migrations";

const ORIGIN = "https://marquee.example";
const NOW = Date.UTC(2026, 7, 20, 16);
const ORG = "org_mcp";
const EVENT = "evt_mcp";
const OTHER_EVENT = "evt_mcp_other";
const FORM = "form_mcp";
const OTHER_FORM = "form_mcp_other";
const ORGANIZER = "per_mcp_organizer";
const HUMAN_REVIEWER = "per_mcp_human";
const AGENT_SEAT = "per_mcp_agent";
const COMMITTEE = "committee_mcp";
const PLAN = "plan_mcp";
const ROUND = "round_mcp";
const TRACK = "track_mcp";
const SUBMISSION = "sub_mcp_one";
const SECOND_SUBMISSION = "sub_mcp_two";
const OWNER_TOKEN = "mq_owner_mcp_fixture_token";
const AGENT_TOKEN = "mq_agent_mcp_fixture_token";

interface RpcResponse {
  jsonrpc: string;
  id: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function post(body: unknown, token?: string): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  return SELF.fetch(`${ORIGIN}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function rpc(method: string, params?: unknown, token?: string): Promise<RpcResponse> {
  const response = await post({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }, token);
  return response.json<RpcResponse>();
}

async function listToolNames(token?: string): Promise<string[]> {
  const answer = await rpc("tools/list", {}, token);
  return ((answer.result?.tools ?? []) as Array<{ name: string }>).map((tool) => tool.name).sort();
}

async function call(name: string, args: Record<string, unknown>, token?: string): Promise<ToolResult> {
  const answer = await rpc("tools/call", { name, arguments: args }, token);
  expect(answer.error, `${name} raised a protocol fault: ${JSON.stringify(answer.error)}`).toBeUndefined();
  return answer.result as unknown as ToolResult;
}

function payloadOf(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

async function seed(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'MCP Org', 'mcp-org', ?, ?)").bind(ORG, NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'MCP Conference', 'mcp-conference', '2026-10-12', '2026-10-14', 'America/New_York', 'live', 1, ?, ?),
             (?, ?, 'Other Conference', 'other-conference', '2026-11-12', '2026-11-14', 'America/New_York', 'live', 0, ?, ?)`)
      .bind(EVENT, ORG, NOW, NOW, OTHER_EVENT, ORG, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES ('format_mcp', ?, 'Talk', 20, 15, 30, 0, ?, ?)").bind(EVENT, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Agents', '#0b6a72', 0, ?, ?)").bind(TRACK, EVENT, NOW, NOW),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, kind, created_at, updated_at)
      VALUES (?, ?, 'organizer@mcp.example', 'Organizer', 'human', ?, ?),
             (?, ?, 'reviewer@mcp.example', 'Human Reviewer', 'human', ?, ?),
             (?, ?, 'first-read-agent@mcp.example', 'First-read agent', 'agent', ?, ?)`)
      .bind(ORGANIZER, ORG, NOW, NOW, HUMAN_REVIEWER, ORG, NOW, NOW, AGENT_SEAT, ORG, NOW, NOW),
    env.DB.prepare(`INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
      VALUES ('mem_mcp_owner', ?, NULL, ?, 'owner', ?, ?),
             ('mem_mcp_human', ?, ?, ?, 'reviewer', ?, ?),
             ('mem_mcp_agent', ?, ?, ?, 'reviewer', ?, ?)`)
      .bind(ORG, ORGANIZER, NOW, NOW, ORG, EVENT, HUMAN_REVIEWER, NOW, NOW, ORG, EVENT, AGENT_SEAT, NOW, NOW),
    env.DB.prepare(`INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, 'Program reviewers', ?, ?)`).bind(COMMITTEE, EVENT, NOW, NOW),
    env.DB.prepare(`INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at)
      VALUES ('cm_mcp_human', ?, ?, 'reviewer', ?, ?), ('cm_mcp_agent', ?, ?, 'reviewer', ?, ?)`)
      .bind(COMMITTEE, HUMAN_REVIEWER, NOW, NOW, COMMITTEE, AGENT_SEAT, NOW, NOW),
    env.DB.prepare(`INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at)
      VALUES ('scope_mcp_human', ?, ?, ?, ?, ?), ('scope_mcp_agent', ?, ?, ?, ?, ?)`)
      .bind(EVENT, HUMAN_REVIEWER, TRACK, NOW, NOW, EVENT, AGENT_SEAT, TRACK, NOW, NOW),
    env.DB.prepare(`INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at)
      VALUES (?, ?, 'First screen', 'Read it, then say why.', 1, 5, 'open', ?, ?)`).bind(PLAN, EVENT, NOW, NOW),
    // clock-check: allow — the round window is stored and echoed here, never compared to a clock
    env.DB.prepare(`INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, committee_id, target_reviews_per_submission, opens_at, closes_at, created_at, updated_at)
      VALUES (?, ?, 0, 'Initial screen', 'scorecard', 0, ?, 3, ?, ?, ?, ?)`)
      .bind(ROUND, PLAN, COMMITTEE, NOW - 86_400_000, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare(`INSERT INTO rubric_criteria (id, round_id, name, kind, weight_pct, scale_min, scale_max, position, created_at, updated_at)
      VALUES ('crit_mcp_fit', ?, 'Program fit', 'numeric', 100, 1, 5, 0, ?, ?)`).bind(ROUND, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', 0, 'A talk about queues', 'It is about queues.', 'in_review', 'public', ?, ?, ?, 'queues', ?, ?),
             (?, ?, 'abstract', 0, 'A talk about caches', 'It is about caches.', 'in_review', 'public', ?, ?, ?, 'caches', ?, ?)`)
      .bind(SUBMISSION, EVENT, ORGANIZER, NOW, NOW, NOW, NOW, SECOND_SUBMISSION, EVENT, ORGANIZER, NOW, NOW, NOW, NOW),
    env.DB.prepare(`INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
      VALUES ('st_mcp_one', ?, ?, 1, ?, ?), ('st_mcp_two', ?, ?, 1, ?, ?)`)
      .bind(SUBMISSION, TRACK, NOW, NOW, SECOND_SUBMISSION, TRACK, NOW, NOW),
    env.DB.prepare(`INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at)
      VALUES ('ra_mcp_agent_one', ?, ?, ?, NULL, 'assigned', ?, ?),
             ('ra_mcp_agent_two', ?, ?, ?, NULL, 'assigned', ?, ?),
             ('ra_mcp_human_one', ?, ?, ?, NULL, 'assigned', ?, ?)`)
      .bind(ROUND, SUBMISSION, AGENT_SEAT, NOW, NOW, ROUND, SECOND_SUBMISSION, AGENT_SEAT, NOW, NOW, ROUND, SUBMISSION, HUMAN_REVIEWER, NOW, NOW),
    // The human's own read, so the aggregate has a value the agent must not move.
    env.DB.prepare(`INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, score, criteria_scores, recommendation, comment, abstained, created_at, updated_at)
      VALUES ('eval_mcp_human', ?, ?, ?, 3, ?, 'maybe', 'A human read it.', 0, ?, ?)`)
      .bind(ROUND, SUBMISSION, HUMAN_REVIEWER, JSON.stringify({ "Program fit": 3 }), NOW, NOW),
    env.DB.prepare(`INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md, per_submitter_limit, min_speakers, max_speakers, max_sponsors, admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Call for speakers', 'mcp-cfp', 'abstract', 'open', 0, ?, 'Tell us what you are building.', 3, 1, 4, 0, '[]', 0, ?, ?),
             (?, ?, 'Guarded call', 'guarded-cfp', 'abstract', 'open', 0, ?, 'Tell us what you are building.', 3, 1, 4, 0, '[]', 1, ?, ?)`)
      .bind(FORM, EVENT, Date.UTC(2099, 0, 1), NOW, NOW, OTHER_FORM, OTHER_EVENT, Date.UTC(2099, 0, 1), NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES ('ff_mcp_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 0, '{"maxLength":120}', NULL, ?, ?),
             ('ff_mcp_name', ?, 'speaker_name', 'Speaker name', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
             ('ff_mcp_email', ?, 'speaker_email', 'Speaker email', NULL, 'email', 1, 2, '{}', NULL, ?, ?),
             ('ff_other_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 0, '{"maxLength":120}', NULL, ?, ?),
             ('ff_other_name', ?, 'speaker_name', 'Speaker name', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
             ('ff_other_email', ?, 'speaker_email', 'Speaker email', NULL, 'email', 1, 2, '{}', NULL, ?, ?)`)
      .bind(FORM, NOW, NOW, FORM, NOW, NOW, FORM, NOW, NOW, OTHER_FORM, NOW, NOW, OTHER_FORM, NOW, NOW, OTHER_FORM, NOW, NOW),
    env.DB.prepare(`INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
      VALUES ('tok_mcp_owner', ?, NULL, 'Owner token', ?, 'mq_owne', ?, ?, ?, ?)`)
      .bind(ORG, await sha256Hex(OWNER_TOKEN), JSON.stringify({ permissions: ["program:read", "program:write", "review:write", "speaker:write", "agenda:write", "comms:send"], event_ids: [] }), ORGANIZER, NOW, NOW),
    env.DB.prepare(`INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, acts_as_person_id, created_at, updated_at)
      VALUES ('tok_mcp_agent', ?, ?, 'Agent seat', ?, 'mq_agen', ?, ?, ?, ?, ?)`)
      .bind(ORG, EVENT, await sha256Hex(AGENT_TOKEN), JSON.stringify({ permissions: ["review:write"], event_ids: [EVENT] }), ORGANIZER, AGENT_SEAT, NOW, NOW),
  ]);
}

beforeEach(seed);
test("CONTRACT · MRQ-284 · every tool names an operation the live route registry actually serves", async () => {
  const { entries } = await createApiRouter(apiManifest);
  const registered = new Set(entries.map((entry) => entry.operationId));
  for (const tool of MCP_TOOLS) {
    expect(registered.has(tool.operationId), `${tool.name} -> ${tool.operationId}`).toBe(true);
  }
});
test("CONTRACT · MRQ-284 acceptance 1 · the transport: initialize, ping, notifications, bounded batches, and POST only", async () => {
  const answer = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1" },
  });
  expect(answer.result).toMatchObject({
    protocolVersion: "2025-06-18",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "marquee" },
  });
  expect(String(answer.result?.instructions)).toContain("Authorization: Bearer");
  expect((await rpc("ping")).result).toEqual({});

  const notification = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  expect(notification.status).toBe(202);
  expect(await notification.text()).toBe("");

  const batch = await post([
    { jsonrpc: "2.0", id: "a", method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: "b", method: "tools/list" },
  ]);
  const answers = await batch.json<RpcResponse[]>();
  expect(answers.map((answer) => answer.id)).toEqual(["a", "b"]);

  const oversized = await post(
    Array.from({ length: 40 }, (_unused, index) => ({ jsonrpc: "2.0", id: index, method: "ping" })),
  );
  expect(oversized.status).toBe(400);
  expect((await oversized.json<RpcResponse>()).error?.message).toContain("at most");

  const mixed = await post([
    { jsonrpc: "2.0", id: "good", method: "ping" },
    { jsonrpc: "2.0", id: "bad", method: "tools/call", params: "oops" },
  ]);
  const mixedAnswers = await mixed.json<RpcResponse[]>();
  expect(mixedAnswers.map((answer) => answer.id)).toEqual(["good", "bad"]);
  expect(mixedAnswers[0].error).toBeUndefined();
  expect(mixedAnswers[1].error?.code).toBe(-32602);

  const streamed = await SELF.fetch(`${ORIGIN}/mcp`);
  expect(streamed.status).toBe(405);
  expect(streamed.headers.get("allow")).toBe("POST");

  const unreadable = await SELF.fetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  expect(unreadable.status).toBe(400);
  expect((await unreadable.json<RpcResponse>()).error?.code).toBe(-32700);
});
test("CONTRACT · MRQ-284 acceptance 2 · the two tiers, and what a credential does and does not add", async () => {
  const agentTools = await listToolNames(AGENT_TOKEN);
  // A reviewer seat: the review tools arrive, the organizer's do not.
  expect(agentTools).toContain("review_queue");
  expect(agentTools).toContain("record_evaluation");
  expect(agentTools).toContain("abstain");
  // Every grant-gated organizer tool is absent: this seat holds review:write
  // and nothing else, on one conference.
  expect(agentTools).not.toContain("apply_decisions");
  expect(agentTools).not.toContain("publish_sessions");
  expect(agentTools).not.toContain("place_session");
  expect(agentTools).not.toContain("pipeline_summary");
  expect(agentTools).not.toContain("speakers");
  // The public tier never narrows.
  expect(agentTools).toContain("agenda");

  const ownerTools = await listToolNames(OWNER_TOKEN);
  expect(ownerTools).toContain("apply_decisions");
  expect(ownerTools).toContain("send_reminder");
  expect(ownerTools).toContain("publish_sessions");
  expect(ownerTools.length).toBeGreaterThan(agentTools.length);

  expect(await listToolNames()).toEqual(
    ["agenda", "cfp_form", "session", "speaker", "star_session", "submit_proposal"],
  );

  const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "mq_not_a_real_token");
  expect(response.status).toBe(401);
  expect((await response.json<RpcResponse>()).error?.message).toContain("not valid");
});
test("CONTRACT · MRQ-284 acceptance 2 · a token restricted to one conference is refused on another in the API's own words", async () => {
  // The tool IS on this connection — the seat holds it on its own conference.
  // The refusal therefore comes from the pipeline, on the conference asked for.
  const allowed = await call("review_queue", { event_id: EVENT }, AGENT_TOKEN);
  expect(allowed.isError, allowed.content[0]?.text).toBeUndefined();

  const refused = await call("review_queue", { event_id: OTHER_EVENT }, AGENT_TOKEN);
  expect(refused.isError).toBe(true);
  const sentence = refused.content[0].text;
  expect(sentence).toMatch(/forbidden|not_found/);
  expect(sentence).toMatch(/request /);

  // And the same call over REST refuses the same way, which is the whole claim.
  const rest = await SELF.fetch(`${ORIGIN}/api/v1/events/${OTHER_EVENT}/reviewer/queue`, {
    headers: { authorization: `Bearer ${AGENT_TOKEN}` },
  });
  expect(rest.ok).toBe(false);
  const body = await rest.json<{ error: { code: string; message: string } }>();
  expect(sentence).toContain(body.error.message);
});
test("CONTRACT · MRQ-284 acceptance 1 · a public read runs through the same handler as the public page", async () => {
  const result = await call("cfp_form", { slug: "mcp-cfp" });
  expect(result.isError).toBeUndefined();
  const payload = payloadOf(result);
  expect(payload.state).toBe("open");
  expect((payload.fields as Array<{ key: string }>).map((field) => field.key))
    .toEqual(["title", "speaker_name", "speaker_email"]);
  expect(result.structuredContent).toBeDefined();
});
test("CONTRACT · MRQ-284 acceptance 3 · a proposal sent over MCP is the same row the web form writes", async () => {
  const viaTool = await call("submit_proposal", {
    slug: "mcp-cfp",
    email: "agent.submitter@mcp.example",
    answers: { title: "Sent by an agent", speaker_name: "Agent Submitter", speaker_email: "agent.submitter@mcp.example" },
  });
  expect(viaTool.isError, viaTool.content[0]?.text).toBeUndefined();

  const viaForm = await SELF.fetch(`${ORIGIN}/api/v1/public/forms/mcp-cfp/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "form.submitter@mcp.example",
      answers: { title: "Sent by a person", speaker_name: "Form Submitter", speaker_email: "form.submitter@mcp.example" },
    }),
  });
  expect(viaForm.status).toBe(201);

  const rows = await env.DB.prepare(
    "SELECT title, origin, status, form_id FROM submissions WHERE title IN ('Sent by an agent', 'Sent by a person') ORDER BY title",
  ).all<{ title: string; origin: string; status: string; form_id: string }>();
  expect(rows.results).toHaveLength(2);
  const [agentRow, personRow] = rows.results;
  // Indistinguishable: same origin, same status, same form. Nothing marks one
  // as having arrived through a machine, because nothing should.
  expect({ origin: agentRow.origin, status: agentRow.status, form_id: agentRow.form_id })
    .toEqual({ origin: personRow.origin, status: personRow.status, form_id: personRow.form_id });

  const mail = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM outbox WHERE to_email IN ('agent.submitter@mcp.example', 'form.submitter@mcp.example')",
  ).first<{ n: number }>();
  expect(mail?.n).toBe(2);
});
test("CONTRACT · MRQ-284 acceptance 3 · the CAPTCHA the public form demands is demanded of an agent too, in the same words", async () => {
  const body = {
    email: "guarded@mcp.example",
    answers: { title: "Guarded", speaker_name: "Guarded Speaker", speaker_email: "guarded@mcp.example" },
  };
  const viaForm = await SELF.fetch(`${ORIGIN}/api/v1/public/forms/guarded-cfp/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(viaForm.status).toBe(403);
  const formRefusal = (await viaForm.json<{ error: { message: string } }>()).error.message;

  const viaTool = await call("submit_proposal", { slug: "guarded-cfp", ...body });
  expect(viaTool.isError).toBe(true);
  expect(viaTool.content[0].text).toContain(formRefusal);
});
test("CONTRACT · MRQ-284 acceptance 4 · an agent seat's evaluation lands as an agent review, beside the human number and never inside it", async () => {
  const written = await call("record_evaluation", {
    event_id: EVENT,
    round_id: ROUND,
    submission_id: SUBMISSION,
    criteria_scores: { "Program fit": 5 },
    score: 5,
    recommendation: "approve",
    comment: "The abstract names the failure mode it fixes, which is the part a chair cannot get elsewhere.",
  }, AGENT_TOKEN);
  expect(written.isError, written.content[0]?.text).toBeUndefined();

  const stored = await env.DB.prepare(
    "SELECT reviewer_person_id, score, abstained FROM evaluations WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?",
  ).bind(ROUND, SUBMISSION, AGENT_SEAT).first<{ reviewer_person_id: string; score: number; abstained: number }>();
  expect(stored).toEqual({ reviewer_person_id: AGENT_SEAT, score: 5, abstained: 0 });

  const list = await call("list_submissions", { event_id: EVENT, sort: "agent_score" }, OWNER_TOKEN);
  const items = payloadOf(list).data as Array<{
    id: string;
    score: number | null;
    review_count: number;
    agent_reviews: Array<{ name: string; score: number | null }>;
  }>;
  const target = items.find((item) => item.id === SUBMISSION);
  // Visible as an agent review…
  expect(target?.agent_reviews).toEqual([
    expect.objectContaining({ name: "First-read agent", score: 5 }),
  ]);
  // …and the human aggregate is still only the human's 3, from one review.
  expect(target?.score).toBe(3);
  expect(target?.review_count).toBe(1);
  // The agent read orders the list: what it scored comes before what it did not.
  expect(items[0].id).toBe(SUBMISSION);

  // A chair can override it, and the override is what the row then shows.
  const evaluationId = (await env.DB.prepare(
    "SELECT id FROM evaluations WHERE reviewer_person_id = ? AND submission_id = ?",
  ).bind(AGENT_SEAT, SUBMISSION).first<{ id: string }>())!.id;
  const override = await SELF.fetch(
    `${ORIGIN}/api/v1/events/${EVENT}/rounds/${ROUND}/submissions/${SUBMISSION}/evaluations/${evaluationId}/override`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ score: 2, reason: "The chair disagreed with the agent." }),
    },
  );
  expect(override.status).toBe(200);
  const afterOverride = payloadOf(await call("list_submissions", { event_id: EVENT, sort: "agent_score" }, OWNER_TOKEN)).data as Array<{
    id: string;
    agent_reviews: Array<{ override_score: number | null }>;
  }>;
  expect(afterOverride.find((item) => item.id === SUBMISSION)?.agent_reviews[0].override_score).toBe(2);
  // The sort takes the override too, so the column orders by the number the row
  // displays rather than by the score the chair overruled.
  const scored = await call("record_evaluation", {
    event_id: EVENT,
    round_id: ROUND,
    submission_id: SECOND_SUBMISSION,
    score: 4,
    recommendation: "approve",
    comment: "A second read, deliberately between the agent's 5 and the chair's 2.",
  }, AGENT_TOKEN);
  expect(scored.isError, scored.content[0]?.text).toBeUndefined();
  const ordered = payloadOf(await call("list_submissions", { event_id: EVENT, sort: "agent_score" }, OWNER_TOKEN)).data as Array<{ id: string }>;
  expect(ordered[0].id).toBe(SECOND_SUBMISSION);
});
test("CONTRACT · MRQ-284 acceptance 4 · abstaining over MCP is recorded as an abstention rather than a low score", async () => {
  const result = await call("abstain", {
    event_id: EVENT,
    round_id: ROUND,
    submission_id: SECOND_SUBMISSION,
    comment: "A conflict of interest: the speaker's employer sponsors this track.",
  }, AGENT_TOKEN);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  const stored = await env.DB.prepare(
    "SELECT abstained, score FROM evaluations WHERE reviewer_person_id = ? AND submission_id = ?",
  ).bind(AGENT_SEAT, SECOND_SUBMISSION).first<{ abstained: number; score: number | null }>();
  expect(stored?.abstained).toBe(1);
  expect(stored?.score).toBeNull();
});
test("CONTRACT · MRQ-284 acceptance 5 · apply_decisions needs the plan's own fingerprint and ETag, and refuses a stale plan", async () => {
  const plan = await call("decision_plan", {
    event_id: EVENT,
    action: "accept",
    ids: [SUBMISSION],
  }, OWNER_TOKEN);
  expect(plan.isError, plan.content[0]?.text).toBeUndefined();
  const planPayload = payloadOf(plan);
  const fingerprint = String(planPayload.plan_fingerprint);
  const etag = String(planPayload.etag);
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(etag.length).toBeGreaterThan(0);

  const stale = await call("apply_decisions", {
    event_id: EVENT,
    action: "accept",
    ids: [SUBMISSION],
    plan_fingerprint: "0".repeat(64),
    if_match: etag,
  }, OWNER_TOKEN);
  expect(stale.isError).toBe(true);

  const applied = await call("apply_decisions", {
    event_id: EVENT,
    action: "accept",
    ids: [SUBMISSION],
    plan_fingerprint: fingerprint,
    if_match: etag,
  }, OWNER_TOKEN);
  expect(applied.isError, applied.content[0]?.text).toBeUndefined();
  const decided = await env.DB.prepare("SELECT status FROM submissions WHERE id = ?").bind(SUBMISSION).first<{ status: string }>();
  expect(decided?.status).toBe("accepted");

  // The same plan cannot be applied twice: the pile moved underneath it.
  const replayed = await call("apply_decisions", {
    event_id: EVENT,
    action: "accept",
    ids: [SUBMISSION],
    plan_fingerprint: fingerprint,
    if_match: etag,
  }, OWNER_TOKEN);
  expect(replayed.isError).toBe(true);
});
test("CONTRACT · MRQ-284 · every refusal shape: concealed, actionable, and never a moved target", async () => {
  const hidden = await call("apply_decisions", {
    event_id: EVENT,
    action: "accept",
    ids: [SUBMISSION],
    plan_fingerprint: "0".repeat(64),
    if_match: "x",
  }, AGENT_TOKEN);
  expect(hidden.isError).toBe(true);
  // Word for word what a misspelling gets. A caller must not be able to tell
  // "that tool does not exist" from "that tool exists and is not yours" — and
  // the refusal must arrive BEFORE argument validation, or the reply hands out
  // the argument list of a tool `tools/list` deliberately withheld.
  const misspelled = await call("apply_decisionz", { zzz: 1 }, AGENT_TOKEN);
  // Identical but for the name the caller itself supplied.
  expect(hidden.content[0].text.replace("apply_decisions", "«name»"))
    .toBe(misspelled.content[0].text.replace("apply_decisionz", "«name»"));
  expect(hidden.content[0].text).not.toContain("plan_fingerprint");

  const anonymous = await call("apply_decisions", { zzz: 1 });
  expect(anonymous.content[0].text).not.toContain("plan_fingerprint");
  expect(anonymous.content[0].text).not.toContain("does not take");

  const unknownName = await call("list_submisions", {});
  expect(unknownName.isError).toBe(true);
  expect(unknownName.content[0].text).toContain("tools/list");

  const missing = await call("session", {});
  expect(missing.isError).toBe(true);
  expect(missing.content[0].text).toContain("slug");

  const unknownArgument = await call("agenda", { day: "2026-10-12", colour: "blue" });
  expect(unknownArgument.isError).toBe(true);
  expect(unknownArgument.content[0].text).toContain("colour");

  // An unknown METHOD, by contrast, is a real protocol fault.
  const badMethod = await rpc("tools/execute", {});
  expect(badMethod.error?.code).toBe(-32601);

  // `encodeURIComponent` leaves `.` alone and the URL parser removes dot
  // segments, so `..` here would have been served by getSubmissionRecord — the
  // organizer's UNBLINDED record — while the tier check had been evaluated
  // against the blinded reviewer route it names.
  const refused = await call("review_submission", {
    event_id: EVENT,
    round_id: "..",
    submission_id: SUBMISSION,
  }, OWNER_TOKEN);
  expect(refused.isError).toBe(true);
  expect(refused.content[0].text).toContain("path separator");
  expect(refused.content[0].text).not.toContain("A talk about queues");

  const slashed = await call("submission", { event_id: EVENT, submission_id: `${SUBMISSION}/timeline` }, OWNER_TOKEN);
  expect(slashed.isError).toBe(true);
});
test("CONTRACT · MRQ-284 · every tool this connection lists can be called without an argument-mapping fault", async () => {
  // The gap this closes is the one that shipped two dead tools: a façade does no
  // schema validation of its own, so a body-field typo — or a tool whose handler
  // no credential this endpoint accepts could ever satisfy — is invisible until
  // somebody calls it. A domain refusal here is fine and expected; an argument
  // fault, a 500, or a tool that is listed and then unknown is not.
  const plausible: Record<string, Record<string, unknown>> = {
    agenda: {},
    session: { slug: "not-a-real-session" },
    speaker: { slug: "not-a-real-speaker" },
    cfp_form: { slug: "mcp-cfp" },
    submit_proposal: {
      slug: "mcp-cfp",
      email: "smoke@mcp.example",
      answers: { title: "Smoke", speaker_name: "Smoke Speaker", speaker_email: "smoke@mcp.example" },
    },
    star_session: { session_id: "not-a-real-session", device_hash: "0123456789abcdef", starred: true },
    whoami: {},
    list_events: {},
    event: { event_id: EVENT },
    pipeline_summary: { event_id: EVENT },
    list_submissions: { event_id: EVENT, per_page: 1 },
    submission: { event_id: EVENT, submission_id: SUBMISSION },
    review_queue: { event_id: EVENT },
    review_submission: { event_id: EVENT, round_id: ROUND, submission_id: SUBMISSION },
    record_evaluation: { event_id: EVENT, round_id: ROUND, submission_id: SUBMISSION, score: 3, recommendation: "maybe", comment: "Smoke." },
    abstain: { event_id: EVENT, round_id: ROUND, submission_id: SUBMISSION, comment: "Smoke." },
    speakers: { event_id: EVENT },
    decision_plan: { event_id: EVENT, action: "accept", ids: [SECOND_SUBMISSION] },
    apply_decisions: {
      event_id: EVENT,
      action: "accept",
      ids: [SECOND_SUBMISSION],
      plan_fingerprint: "0".repeat(64),
      if_match: '"not-the-current-etag"',
    },
    comms_audience: { event_id: EVENT },
    send_reminder: { event_id: EVENT, subject: "Smoke", body: "Smoke.", person_ids: [HUMAN_REVIEWER] },
    place_session: { event_id: EVENT, submission_id: SUBMISSION, room_id: "room_absent", starts_at: NOW },
    publish_sessions: { event_id: EVENT, submission_ids: [SUBMISSION] },
  };
  const listed = await listToolNames(OWNER_TOKEN);
  // Every listed tool is covered here, and nothing is covered that is not listed.
  expect(Object.keys(plausible).sort()).toEqual(listed);

  for (const name of listed) {
    const result = await call(name, plausible[name], OWNER_TOKEN);
    const text = result.content[0]?.text ?? "";
    expect(text, `${name}: ${text}`).not.toContain("does not take");
    expect(text, `${name}: ${text}`).not.toMatch(/^\w+ needs /);
    expect(text, `${name}: ${text}`).not.toContain("an unexpected error occurred");
    expect(text, `${name}: ${text}`).not.toContain("there is no tool called");
  }
});
