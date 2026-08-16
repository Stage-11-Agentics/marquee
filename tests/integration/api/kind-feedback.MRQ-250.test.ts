import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { app } from "../../../src/index";
import type { KindFeedbackProvider, KindFeedbackProviderRequest } from "../../../src/jobs/ai/kind-feedback";
import { sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-mrq250-feedback";
const TOKEN = "mq_mrq250-feedback-token";
const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const ACTOR_ID = "person-mrq250-actor";
const SPEAKER_ID = "person-mrq250-speaker";
const GENERATED_SUBMISSION = "sub-mrq250-generated";
const FAILED_SUBMISSION = "sub-mrq250-failed";
const DISABLED_SUBMISSION = "sub-mrq250-disabled";
const BULK_SUBMISSIONS = ["sub-mrq250-bulk-a", "sub-mrq250-bulk-b"] as const;
const GENERATED_PARAGRAPH = "Your perspective was thoughtful, but this program needs a different balance of topics this time.";
const GENERATED_NOTE = "The lineup already has several sessions on this same topic; keep the decision clear and kind.";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const tokenHash = await sha256Hex(TOKEN);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ('org-mrq250-feedback', 'MRQ-250 Org', 'mrq250-feedback', ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, 'org-mrq250-feedback', 'Marquee Kindness Summit', 'mrq250-feedback', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
       VALUES
        (?, 'org-mrq250-feedback', 'organizer@mrq250.test', 'Program Lead', ?, ?),
        (?, 'org-mrq250-feedback', 'speaker@mrq250.test', 'Ada Lovelace', ?, ?)`,
    ).bind(ACTOR_ID, NOW, NOW, SPEAKER_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq250-actor', 'org-mrq250-feedback', ?, ?, 'program_lead', ?, ?)`,
    ).bind(EVENT_ID, ACTOR_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens
        (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('token-mrq250-feedback', 'org-mrq250-feedback', NULL, 'MRQ-250 test token', ?, 'mq_mrq250', ?, ?, ?, ?)`,
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:read", "program:write", "comms:send"], event_ids: [EVENT_ID] }), ACTOR_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, status, origin, submitter_person_id, last_write_source, submitted_at, created_at, updated_at)
       VALUES
        (?, ?, 'abstract', 'A thoughtful session', 'submitted', 'public', ?, 'marquee', ?, ?, ?),
        (?, ?, 'abstract', 'A session that cannot be drafted', 'submitted', 'public', ?, 'marquee', ?, ?, ?),
        (?, ?, 'abstract', 'A session with drafting disabled', 'submitted', 'public', ?, 'marquee', ?, ?, ?),
        (?, ?, 'abstract', 'A bulk session one', 'submitted', 'public', ?, 'marquee', ?, ?, ?),
        (?, ?, 'abstract', 'A bulk session two', 'submitted', 'public', ?, 'marquee', ?, ?, ?)`,
    ).bind(
      GENERATED_SUBMISSION, EVENT_ID, SPEAKER_ID, NOW, NOW, NOW,
      FAILED_SUBMISSION, EVENT_ID, SPEAKER_ID, NOW, NOW, NOW,
      DISABLED_SUBMISSION, EVENT_ID, SPEAKER_ID, NOW, NOW, NOW,
      BULK_SUBMISSIONS[0], EVENT_ID, SPEAKER_ID, NOW, NOW, NOW,
      BULK_SUBMISSIONS[1], EVENT_ID, SPEAKER_ID, NOW, NOW, NOW,
    ),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at)
       VALUES
        ('participation-mrq250-generated', ?, ?, 'speaker', 0, ?, ?),
        ('participation-mrq250-failed', ?, ?, 'speaker', 0, ?, ?),
        ('participation-mrq250-disabled', ?, ?, 'speaker', 0, ?, ?),
        ('participation-mrq250-bulk-a', ?, ?, 'speaker', 0, ?, ?),
        ('participation-mrq250-bulk-b', ?, ?, 'speaker', 0, ?, ?)`,
    ).bind(
      GENERATED_SUBMISSION, SPEAKER_ID, NOW, NOW,
      FAILED_SUBMISSION, SPEAKER_ID, NOW, NOW,
      DISABLED_SUBMISSION, SPEAKER_ID, NOW, NOW,
      BULK_SUBMISSIONS[0], SPEAKER_ID, NOW, NOW,
      BULK_SUBMISSIONS[1], SPEAKER_ID, NOW, NOW,
    ),
  ]);
}

function authHeaders(extra: Record<string, string> = {}): HeadersInit {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...extra };
}

function runtimeEnv(transport: KindFeedbackProvider, overrides: Record<string, string> = {}) {
  return {
    ...env,
    AI_MODEL_TRANSPORT: transport,
    AI_RUNTIME_MODE: "enabled",
    AI_MODEL_API_KEY: "test-model-key",
    AI_MODEL_NAME: "test-kind-model",
    ...overrides,
  } as never;
}

async function draft(submissionId: string, transport: KindFeedbackProvider, overrides: Record<string, string> = {}, note = GENERATED_NOTE): Promise<Response> {
  return app.request(
    `${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/${submissionId}/decision-plan/kind-feedback`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ recommendation: "deny", internal_note: note }),
    },
    runtimeEnv(transport, overrides),
  );
}

async function draftBulk(ids: readonly string[], transport: KindFeedbackProvider, note = GENERATED_NOTE): Promise<Response> {
  return app.request(
    `${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/decision-plan/kind-feedback`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ selector: { ids }, action: "reject", internal_note: note }),
    },
    runtimeEnv(transport),
  );
}

async function applyDecision(submissionId: string, feedbackMd?: string): Promise<Response> {
  const body = { recommendation: "deny", ...(feedbackMd === undefined ? {} : { feedback_md: feedbackMd }) };
  const planResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/${submissionId}/decision-plan`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  expect(planResponse.status).toBe(200);
  const plan = await planResponse.json<{ plan_fingerprint: string; etag: string }>();
  return SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions/${submissionId}/decision`, {
    method: "POST",
    headers: authHeaders({ "if-match": plan.etag }),
    body: JSON.stringify({ ...body, plan_fingerprint: plan.plan_fingerprint }),
  });
}

describe.sequential("MRQ-250 kind rejection feedback", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · MRQ-250 · one forced tool draft becomes editable email feedback with counters-only evidence", async () => {
    let calls = 0;
    let request: KindFeedbackProviderRequest | undefined;
    const provider: KindFeedbackProvider = async (providerRequest) => {
      calls += 1;
      request = providerRequest;
      return {
        provider: "fake-provider",
        providerId: "fake-request-mrq250-generated",
        model: "test-kind-model",
        toolArguments: { paragraph: GENERATED_PARAGRAPH },
        usage: { prompt_tokens: 11, completion_tokens: 17, total_tokens: 28 },
      };
    };

    const response = await draft(GENERATED_SUBMISSION, provider);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paragraph: GENERATED_PARAGRAPH,
      notice: null,
      provenance: "Drafted from your note — edit freely",
    });
    expect(calls).toBe(1);
    expect(request?.body).toMatchObject({
      model: "test-kind-model",
      tool_choice: { type: "function", function: { name: "draft_kind_feedback" } },
    });
    const tools = request?.body.tools as Array<{ type: string; function: { name: string; parameters: { required: string[] } } }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ type: "function", function: { name: "draft_kind_feedback", parameters: { required: ["paragraph"] } } });

    const usage = await env.DB.prepare(
      `SELECT provider, model, provider_request_id, prompt_tokens, completion_tokens,
              total_tokens, status, failure_code
       FROM model_usage_events WHERE event_id = ?`,
    ).bind(EVENT_ID).all<Record<string, unknown>>();
    expect(usage.results).toEqual([{
      provider: "fake-provider",
      model: "test-kind-model",
      provider_request_id: "fake-request-mrq250-generated",
      prompt_tokens: 11,
      completion_tokens: 17,
      total_tokens: 28,
      status: "succeeded",
      failure_code: null,
    }]);

    const applied = await applyDecision(GENERATED_SUBMISSION, GENERATED_PARAGRAPH);
    expect(applied.status).toBe(200);
    const result = await applied.json<{ outbox_id: string }>();
    const outbox = await env.DB.prepare("SELECT text FROM outbox WHERE id = ?").bind(result.outbox_id).first<{ text: string }>();
    expect(outbox?.text).toContain(GENERATED_PARAGRAPH);
    expect(outbox?.text).toContain("We’re unable to include it in this program.");
    expect(outbox?.text).toContain("Open your speaker portal:");
  });

  test("CONTRACT · MRQ-250 · provider failure is non-blocking and the normal rejection template still sends", async () => {
    let calls = 0;
    const unavailableProvider: KindFeedbackProvider = async () => {
      calls += 1;
      throw new Error("simulated provider outage");
    };
    const response = await draft(FAILED_SUBMISSION, unavailableProvider);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paragraph: null,
      notice: "Drafting unavailable — the template and your own words still work",
      provenance: null,
    });
    expect(calls).toBe(1);

    const failureUsage = await env.DB.prepare(
      `SELECT provider, status, failure_code, prompt_tokens, completion_tokens, total_tokens
       FROM model_usage_events WHERE event_id = ?`,
    ).bind(EVENT_ID).all<Record<string, unknown>>();
    expect(failureUsage.results).toContainEqual({
      provider: "openai-compatible",
      status: "failed",
      failure_code: "provider_error",
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
    });

    const applied = await applyDecision(FAILED_SUBMISSION);
    expect(applied.status).toBe(200);
    const result = await applied.json<{ outbox_id: string }>();
    const outbox = await env.DB.prepare("SELECT text FROM outbox WHERE id = ?").bind(result.outbox_id).first<{ text: string }>();
    expect(outbox?.text).toContain("We’re unable to include it in this program.");
    expect(outbox?.text).toContain("Open your speaker portal:");
    expect(outbox?.text).not.toContain("simulated provider outage");
    expect(outbox?.text).not.toContain(GENERATED_NOTE);
  });

  test("CONTRACT · MRQ-250 · bulk drafting makes one provider call for one shared paragraph", async () => {
    let calls = 0;
    let request: KindFeedbackProviderRequest | undefined;
    const provider: KindFeedbackProvider = async (providerRequest) => {
      calls += 1;
      request = providerRequest;
      return {
        provider: "fake-provider",
        providerId: "fake-request-mrq250-bulk",
        model: "test-kind-model",
        toolArguments: { paragraph: GENERATED_PARAGRAPH },
        usage: { prompt_tokens: 13, completion_tokens: 19, total_tokens: 32 },
      };
    };

    const response = await draftBulk(BULK_SUBMISSIONS, provider);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paragraph: GENERATED_PARAGRAPH,
      notice: null,
      provenance: "Drafted from your note — edit freely",
    });
    expect(calls).toBe(1);
    const userMessage = (request?.body.messages as Array<{ role: string; content: string }>).find((message) => message.role === "user");
    expect(JSON.parse(userMessage?.content ?? "{}") as Record<string, unknown>).toMatchObject({ selected_count: 2, title: "2 selected submissions" });
  });

  test("CONTRACT · MRQ-250 · disabled mode never calls a supplied provider and still permits the rejection email", async () => {
    let calls = 0;
    const shouldNotRun: KindFeedbackProvider = async () => {
      calls += 1;
      throw new Error("disabled mode called the provider");
    };
    const response = await draft(DISABLED_SUBMISSION, shouldNotRun, { AI_RUNTIME_MODE: "disabled" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paragraph: null,
      notice: "Drafting unavailable — the template and your own words still work",
      provenance: null,
    });
    expect(calls).toBe(0);
    const usage = await env.DB.prepare("SELECT COUNT(*) AS count FROM model_usage_events WHERE event_id = ?").bind(EVENT_ID).first<{ count: number }>();
    expect(usage?.count).toBe(3);

    const applied = await applyDecision(DISABLED_SUBMISSION);
    expect(applied.status).toBe(200);
    const result = await applied.json<{ outbox_id: string }>();
    const outbox = await env.DB.prepare("SELECT text FROM outbox WHERE id = ?").bind(result.outbox_id).first<{ text: string }>();
    expect(outbox?.text).toContain("We’re unable to include it in this program.");
    expect(outbox?.text).toContain("Open your speaker portal:");
  });
});
