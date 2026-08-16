import type { D1Database } from "@cloudflare/workers-types";

import { newUlid } from "../../api/ids";

export const KIND_FEEDBACK_UNAVAILABLE = "Drafting unavailable — the template and your own words still work";
export const KIND_FEEDBACK_PROVENANCE = "Drafted from your note — edit freely";
export const KIND_FEEDBACK_TIMEOUT_MS = 8_000;

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const PROVIDER = "openai-compatible";

export interface KindFeedbackContext {
  decision: "reject";
  eventName: string;
  internalNote: string;
  selectedCount?: number;
  title: string;
  track: string | null;
}

export interface KindFeedbackProviderRequest {
  apiKey: string;
  body: Record<string, unknown>;
  endpoint: string;
  model: string;
}

export interface KindFeedbackUsage {
  completion_tokens?: unknown;
  prompt_tokens?: unknown;
  total_tokens?: unknown;
}

export interface KindFeedbackProviderResponse {
  model?: unknown;
  provider?: unknown;
  providerId?: unknown;
  toolArguments?: unknown;
  usage?: KindFeedbackUsage | null;
}

export type KindFeedbackProvider = (
  request: KindFeedbackProviderRequest,
  signal: AbortSignal,
) => Promise<KindFeedbackProviderResponse>;

export interface KindFeedbackEnvironment {
  AI_MODEL_API_KEY?: string;
  AI_MODEL_ENDPOINT?: string;
  AI_MODEL_NAME?: string;
  AI_MODEL_TRANSPORT?: KindFeedbackProvider;
  AI_RUNTIME_MODE?: string;
  DB: D1Database;
}

export interface KindFeedbackDraftResult {
  failureCode?: string;
  ok: boolean;
  paragraph?: string;
  providerCalled: boolean;
}

const KIND_FEEDBACK_TOOL = {
  type: "function",
  function: {
    name: "draft_kind_feedback",
    description: "Return one concise, kind, speaker-facing feedback paragraph.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        paragraph: { type: "string", minLength: 1 },
      },
      required: ["paragraph"],
      additionalProperties: false,
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "Write one concise speaker-facing feedback paragraph for a rejection.",
  "Translate the substance of the organizer's private note kindly; do not quote it verbatim.",
  "Use only reasons present in the note. Never invent a reason, soften the decision into ambiguity, or state schedule details.",
  "Do not write a greeting, subject, sign-off, title, portal link, or any other email fact.",
].join(" ");

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function counter(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function configured(environment: KindFeedbackEnvironment): boolean {
  return environment.AI_RUNTIME_MODE?.trim().toLowerCase() === "enabled"
    && Boolean(environment.AI_MODEL_API_KEY?.trim());
}

export function kindFeedbackConfigured(environment: Pick<KindFeedbackEnvironment, "AI_MODEL_API_KEY" | "AI_RUNTIME_MODE">): boolean {
  return configured(environment as KindFeedbackEnvironment);
}

function requestBody(context: KindFeedbackContext, model: string): Record<string, unknown> {
  const selectedCount = context.selectedCount ?? 1;
  return {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          organizer_note: context.internalNote,
          decision: context.decision,
          event: context.eventName,
          title: context.title,
          track: context.track,
          selected_count: selectedCount,
        }),
      },
    ],
    tools: [KIND_FEEDBACK_TOOL],
    tool_choice: { type: "function", function: { name: "draft_kind_feedback" } },
  };
}

async function openAiCompatibleProvider(
  request: KindFeedbackProviderRequest,
  signal: AbortSignal,
): Promise<KindFeedbackProviderResponse> {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${request.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request.body),
    signal,
  });
  if (!response.ok) throw new Error(`model provider returned ${response.status}`);
  const payload = record(await response.json());
  if (!payload) throw new Error("model provider returned non-object JSON");

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = record(choices[0]);
  const message = record(firstChoice?.message);
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCall = record(toolCalls[0]);
  const functionCall = record(toolCall?.function);
  const rawArguments = functionCall?.arguments;
  let toolArguments: unknown = rawArguments;
  if (typeof rawArguments === "string") toolArguments = JSON.parse(rawArguments) as unknown;

  return {
    model: payload.model,
    provider: PROVIDER,
    providerId: payload.id,
    toolArguments,
    usage: record(payload.usage) as KindFeedbackUsage | null,
  };
}

function evidence(response: KindFeedbackProviderResponse, configuredModel: string): {
  completionTokens: number | null;
  failureCode?: string;
  model: string;
  paragraph: string | null;
  promptTokens: number | null;
  provider: string;
  providerRequestId: string | null;
  totalTokens: number | null;
} {
  const providerRequestId = text(response.providerId);
  const provider = text(response.provider) ?? PROVIDER;
  const model = text(response.model) ?? configuredModel;
  const usage = response.usage ?? null;
  const promptTokens = counter(usage?.prompt_tokens);
  const completionTokens = counter(usage?.completion_tokens);
  const totalTokens = counter(usage?.total_tokens);
  const argumentsRecord = record(response.toolArguments);
  const paragraph = text(argumentsRecord?.paragraph);

  if (!providerRequestId) return { providerRequestId: null, provider, model, promptTokens, completionTokens, totalTokens, paragraph, failureCode: "missing_provider_evidence" };
  if (promptTokens === null || completionTokens === null || totalTokens === null) return { providerRequestId, provider, model, promptTokens, completionTokens, totalTokens, paragraph, failureCode: "missing_usage_evidence" };
  if (!paragraph) return { providerRequestId, provider, model, promptTokens, completionTokens, totalTokens, paragraph, failureCode: "malformed_tool_output" };
  return { providerRequestId, provider, model, promptTokens, completionTokens, totalTokens, paragraph };
}

async function writeUsageEvent(input: {
  actorPersonId: string;
  db: D1Database;
  eventId: string;
  failureCode?: string;
  model: string;
  now: number;
  provider: string;
  providerRequestId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  status: "failed" | "succeeded";
}): Promise<void> {
  await input.db.prepare(
    `INSERT INTO model_usage_events
       (id, event_id, actor_person_id, operation, provider, model, provider_request_id,
        prompt_tokens, completion_tokens, total_tokens, status, failure_code, created_at)
     VALUES (?, ?, ?, 'kind_feedback', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newUlid(input.now),
    input.eventId,
    input.actorPersonId,
    input.provider,
    input.model,
    input.providerRequestId,
    input.promptTokens,
    input.completionTokens,
    input.totalTokens,
    input.status,
    input.failureCode ?? null,
    input.now,
  ).run();
}

function unavailable(providerCalled: boolean, failureCode?: string): KindFeedbackDraftResult {
  return { ok: false, providerCalled, ...(failureCode ? { failureCode } : {}) };
}

/**
 * The only model-drafting chokepoint. Configuration, timeout, forced tool
 * shape, evidence validation, and counters-only logging all live here so a
 * record and a bulk action cannot grow separate provider paths.
 */
export async function draftKindFeedback(input: {
  actorPersonId: string;
  context: KindFeedbackContext;
  environment: KindFeedbackEnvironment;
  eventId: string;
  now?: number;
  provider?: KindFeedbackProvider;
}): Promise<KindFeedbackDraftResult> {
  if (!configured(input.environment)) return unavailable(false, "disabled");
  const note = input.context.internalNote.replace(/\r\n?/g, "\n").trim();
  if (!note) return unavailable(false, "missing_internal_note");

  const now = input.now ?? Date.now();
  const model = input.environment.AI_MODEL_NAME?.trim() || DEFAULT_MODEL;
  const endpoint = input.environment.AI_MODEL_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const provider = input.provider ?? input.environment.AI_MODEL_TRANSPORT ?? openAiCompatibleProvider;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KIND_FEEDBACK_TIMEOUT_MS);
  let providerResponse: KindFeedbackProviderResponse | null = null;
  try {
    providerResponse = await provider({
      apiKey: input.environment.AI_MODEL_API_KEY!.trim(),
      body: requestBody({ ...input.context, internalNote: note }, model),
      endpoint,
      model,
    }, controller.signal);
    const result = evidence(providerResponse, model);
    const failureCode = result.failureCode;
    await writeUsageEvent({
      actorPersonId: input.actorPersonId,
      db: input.environment.DB,
      eventId: input.eventId,
      failureCode,
      model: result.model,
      now,
      provider: result.provider,
      providerRequestId: result.providerRequestId,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      status: failureCode ? "failed" : "succeeded",
    });
    if (failureCode || !result.paragraph) return unavailable(true, failureCode ?? "malformed_tool_output");
    return { ok: true, paragraph: result.paragraph, providerCalled: true };
  } catch (error: unknown) {
    const failureCode = controller.signal.aborted ? "timeout" : "provider_error";
    try {
      await writeUsageEvent({
        actorPersonId: input.actorPersonId,
        db: input.environment.DB,
        eventId: input.eventId,
        failureCode,
        model,
        now,
        provider: text(providerResponse?.provider) ?? PROVIDER,
        providerRequestId: text(providerResponse?.providerId),
        promptTokens: counter(providerResponse?.usage?.prompt_tokens),
        completionTokens: counter(providerResponse?.usage?.completion_tokens),
        totalTokens: counter(providerResponse?.usage?.total_tokens),
        status: "failed",
      });
    } catch {
      // A provider failure is already fail-closed; a logging failure must not
      // turn the organizer's decision dialog into a hard error either.
    }
    return unavailable(true, failureCode);
  } finally {
    clearTimeout(timeout);
  }
}
