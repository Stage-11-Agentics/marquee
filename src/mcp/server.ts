/**
 * The MCP server: a façade over the API, and deliberately nothing else.
 *
 * Every `tools/call` becomes one HTTP request against the SAME assembled API
 * app the Worker mounts at `/api/*`. Not the handler function — the app. So the
 * whole shipped pipeline runs, in order, exactly as it does for a browser or a
 * curl: credential resolution, rate-limit bucket, authorization, request
 * validation, the handler, ETag/CAS, idempotency, audit rows, demo-safe mail,
 * and the one error envelope. There is no code path here that could permit
 * something REST does not, because there is no code path here at all — only an
 * argument object turned into a URL, a body, and two headers.
 *
 * That is what makes the rule enforceable rather than aspirational. A tool
 * holds no SQL, no scope check, and no policy of its own; it names an
 * `operationId`, and the registry says what that operation costs.
 */
import type { ApiRouteEntry } from "../api/route";
import type { Principal } from "../api/runtime";
import { REQUEST_ID_HEADER } from "../api/errors";
import {
  JSON_RPC_ERRORS,
  jsonRpcError,
  jsonRpcResult,
  negotiateProtocolVersion,
  parseEnvelope,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";
import { indexRoutesByOperationId, toolIsVisible } from "./tier";
import { MCP_TOOLS, MCP_TOOLS_BY_NAME, type McpTool } from "./tools";

export const MCP_PATH = "/mcp";

const SERVER_INFO = { name: "marquee", title: "Marquee", version: "1" } as const;

/**
 * A batch is answered inside one Worker invocation, and each member is a real
 * D1-backed sub-request, so an unbounded array is a way to spend this
 * deployment's CPU budget in a single POST. The cap is generous for any real
 * client and small enough that no batch can be a denial of service.
 */
const MAX_BATCH_MEMBERS = 32;

/**
 * Said once, on the way in. A model that has never seen a conference platform
 * reads this before it reads a single tool, so it says where to start and where
 * the one genuinely dangerous edge is.
 */
const INSTRUCTIONS = [
  "Marquee runs a conference's program: the call for proposals, the review of what arrives, the decisions, the speaker chase, the schedule, and the published agenda.",
  "With no Authorization header you get the public tier — the published program, one session, one speaker, the questions a call for proposals asks, and the act of sending a proposal. That is exactly what a signed-out person can reach.",
  "With `Authorization: Bearer mq_…` the tool set widens to whatever that token already allows over the REST API: no more, and never on a conference the token is not scoped to. Call `whoami` first to see which seat you are in, then `list_events` for the conference ids every other tool takes.",
  "Two habits matter. Count before you send: run `comms_audience` before `send_reminder`. And preview before you decide: `decision_plan` returns a fingerprint that `apply_decisions` requires — show that plan to a human and get their answer before applying it. Acceptance and rejection letters are not an agent's to send unasked.",
  "`tools/list` shows what this connection may reach. A few of the signed tools additionally check which seat you hold when you call them — an organizer's tool called from a reviewer seat is refused, and says so plainly. Trying one and reading the sentence is a perfectly good way to find out.",
  "A refusal here is a sentence, not a fault. Read it: a closed call for proposals, a stale plan, a missing grant are all answers, and retrying the same call will produce the same one.",
].join("\n\n");

export interface McpContext {
  /** The route table of the assembled API app — the source of every tier. */
  entries: readonly ApiRouteEntry[];
  /** Dispatch one sub-request into that same app. */
  callApi(request: Request): Promise<Response>;
  /** Resolved from the bearer token alone; cookies are never read here. */
  principal: Principal;
  /** Origin of the incoming request, so sub-requests stay on this host. */
  origin: string;
  /** The bearer header to forward verbatim, when there was one. */
  authorization?: string;
  /** Headers the rate limiter keys on, forwarded so the buckets are the same. */
  forwardedHeaders?: Record<string, string>;
  /** This request's correlation id, shared by every sub-request it makes. */
  requestId: string;
}

interface ToolContent {
  type: "text";
  text: string;
}

interface ToolResult {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** A refusal the caller can act on: a result, never a protocol fault. */
function refusal(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function ok(payload: unknown): ToolResult {
  const text = JSON.stringify(payload, null, 2);
  const structured = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? { structuredContent: payload as Record<string, unknown> }
    : {};
  return { content: [{ type: "text", text }], ...structured };
}

/**
 * The API's own refusal, said in the API's own words, with the reference code a
 * support conversation can grep for. Reworded refusals are how two surfaces
 * start disagreeing about the same rule.
 */
function refusalFromEnvelope(status: number, body: unknown, requestId: string): ToolResult {
  const envelope = body as { error?: { code?: string; message?: string; field?: string } } | null;
  const message = envelope?.error?.message ?? `the request was refused with HTTP ${status}`;
  const code = envelope?.error?.code ?? "error";
  const field = envelope?.error?.field ? ` (field ${envelope.error.field})` : "";
  return refusal(`${message}${field} [${code} · request ${requestId}]`);
}

/**
 * `/api/v1/events/{eventId}/…` -> the concrete path.
 *
 * A path parameter is checked before it is substituted, because
 * `encodeURIComponent` does not encode `.` and the WHATWG URL parser then
 * removes dot segments: a `round_id` of `..` would turn
 * `/events/E/rounds/../submissions/S` into `/events/E/submissions/S` — a
 * DIFFERENT registered operation than the one whose policy the tier check just
 * evaluated. Every route still enforces itself, so this was never an escalation;
 * it was worse in one specific way, which is that the binding this design rests
 * on — a tool's tier is the tier of the route that serves it — stopped being
 * true. An id in this product is a ULID-shaped string, never a path.
 */
function fillPath(
  template: string,
  pathParams: Record<string, string> | undefined,
  args: Record<string, unknown>,
): { path: string } | { missing: string } | { invalid: string } {
  let path = template;
  for (const [parameter, argument] of Object.entries(pathParams ?? {})) {
    const value = args[argument];
    if (value === undefined || value === null || value === "") return { missing: argument };
    const text = String(value);
    if (text.includes("/") || text.includes("\\") || /^\.{1,2}$/.test(text)) {
      return { invalid: argument };
    }
    path = path.replace(`{${parameter}}`, encodeURIComponent(text));
  }
  return { path };
}

function buildQuery(tool: McpTool, args: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const name of tool.query ?? []) {
    const value = args[name];
    if (value === undefined || value === null || value === "") continue;
    search.set(name, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}

/**
 * The argument object as the API's own request body. `selector` is assembled
 * rather than copied because the decision endpoints take one selector shape —
 * ids or a filter — and letting a caller invent a third would be exactly the
 * business logic a façade must not hold.
 */
function buildBody(tool: McpTool, args: Record<string, unknown>): unknown | undefined {
  if (!tool.body) return undefined;
  const body: Record<string, unknown> = { ...(tool.body.fixed ?? {}) };
  for (const field of tool.body.fields ?? []) {
    if (args[field] !== undefined) body[field] = args[field];
  }
  for (const [argument, field] of Object.entries(tool.body.rename ?? {})) {
    if (args[argument] !== undefined) body[field] = args[argument];
  }
  if (tool.body.selector === true) {
    if (Array.isArray(args.ids)) body.selector = { ids: args.ids };
    else if (args.filter !== undefined) body.selector = { filter: args.filter };
  }
  if (tool.body.selectorFields) {
    const selector: Record<string, unknown> = {};
    for (const field of tool.body.selectorFields) {
      if (args[field] !== undefined) selector[field] = args[field];
    }
    body.selector = selector;
  }
  return body;
}

/** Reject an argument the tool never declared, rather than dropping it silently. */
function unknownArguments(tool: McpTool, args: Record<string, unknown>): string[] {
  const declared = new Set(Object.keys(tool.inputSchema.properties));
  return Object.keys(args).filter((name) => !declared.has(name));
}

function missingRequired(tool: McpTool, args: Record<string, unknown>): string[] {
  return (tool.inputSchema.required ?? []).filter(
    (name) => args[name] === undefined || args[name] === null,
  );
}

/**
 * One sentence for "you spelled it wrong" and for "you may not have this",
 * because telling those two apart is exactly what a caller must not be able to
 * do. The hint that follows names the general remedy, never the tool.
 */
function notOnThisConnection(name: string, context: McpContext): ToolResult {
  return refusal(
    `there is no tool called '${name}' on this connection. Call tools/list to see what this one reaches; ${context.principal.kind === "anonymous"
      ? "the set widens when you present a bearer token, which you mint from the Agents page of this deployment."
      : "the set is what this token's grants, seat, and conference restriction allow — call whoami to see them."}`,
  );
}

async function callTool(
  context: McpContext,
  routes: ReadonlyMap<string, ApiRouteEntry>,
  name: unknown,
  rawArguments: unknown,
): Promise<ToolResult> {
  if (typeof name !== "string") return refusal("tools/call needs a tool name.");
  const tool = MCP_TOOLS_BY_NAME.get(name);
  const route = tool ? routes.get(tool.operationId) : undefined;
  if (!tool || !route) return notOnThisConnection(name, context);
  if (rawArguments !== undefined && (rawArguments === null || typeof rawArguments !== "object" || Array.isArray(rawArguments))) {
    return refusal(`${name} takes an arguments object.`);
  }
  const args = (rawArguments ?? {}) as Record<string, unknown>;

  // Concealment first, and in the SAME words as a misspelling. Validating the
  // arguments before checking reachability would answer an unreachable tool with
  // its own argument list, which hands out the schema `tools/list` withheld and
  // makes the pair of replies a clean existence oracle for the whole catalogue.
  if (!toolIsVisible(tool, route, context.principal)) return notOnThisConnection(name, context);

  const unknown = unknownArguments(tool, args);
  if (unknown.length > 0) {
    return refusal(
      `${name} does not take ${unknown.join(", ")}. Its arguments are: ${Object.keys(tool.inputSchema.properties).join(", ") || "none"}.`,
    );
  }
  const missing = missingRequired(tool, args);
  if (missing.length > 0) return refusal(`${name} needs ${missing.join(", ")}.`);

  const filled = fillPath(route.path, tool.pathParams, args);
  if ("missing" in filled) return refusal(`${name} needs ${filled.missing}.`);
  if ("invalid" in filled) {
    return refusal(`${name} cannot take a path separator or a dot segment in ${filled.invalid}; it wants an id.`);
  }

  const body = buildBody(tool, args);
  const headers = new Headers(context.forwardedHeaders);
  if (context.authorization !== undefined) headers.set("authorization", context.authorization);
  headers.set(REQUEST_ID_HEADER, context.requestId);
  for (const [header, argument] of Object.entries(tool.headers ?? {})) {
    const value = args[argument];
    if (value !== undefined && value !== null && value !== "") headers.set(header, String(value));
  }
  if (body !== undefined) headers.set("content-type", "application/json");

  const method = route.method.toUpperCase();
  const response = await context.callApi(new Request(
    `${context.origin}${filled.path}${buildQuery(tool, args)}`,
    {
      method,
      headers,
      ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }),
    },
  ));

  const requestId = response.headers.get(REQUEST_ID_HEADER) ?? context.requestId;
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text.length === 0 ? null : JSON.parse(text);
  } catch {
    // A non-JSON body from a JSON route is a fault worth showing as one.
    return refusal(`${name} received an unreadable response from the API [request ${requestId}]`);
  }
  if (!response.ok) return refusalFromEnvelope(response.status, payload, requestId);

  // A write's ETag is the caller's next `if_match`, so it must survive the trip
  // out of HTTP — otherwise the two-phase decision contract cannot be driven
  // from here at all.
  const etag = response.headers.get("etag");
  if (
    etag !== null
    && payload !== null
    && typeof payload === "object"
    && !Array.isArray(payload)
    // Never shadow a body the route already wrote: a plan returns its own
    // `etag`, and silently replacing it with a header would hand the caller a
    // different value than the one the API meant it to carry.
    && !("etag" in (payload as Record<string, unknown>))
  ) {
    return ok({ ...(payload as Record<string, unknown>), etag });
  }
  return ok(payload);
}

function toolDescriptor(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.write !== true,
      destructiveHint: false,
      openWorldHint: false,
    },
  };
}

async function dispatch(
  context: McpContext,
  routes: ReadonlyMap<string, ApiRouteEntry>,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const notification = request.id === undefined;
  switch (request.method) {
    case "initialize": {
      if (notification) return null;
      return jsonRpcResult(id, {
        protocolVersion: negotiateProtocolVersion(request.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return notification ? null : jsonRpcResult(id, {});
    case "tools/list": {
      if (notification) return null;
      const visible = MCP_TOOLS.filter((tool) => {
        const route = routes.get(tool.operationId);
        return route !== undefined && toolIsVisible(tool, route, context.principal);
      });
      return jsonRpcResult(id, { tools: visible.map(toolDescriptor) });
    }
    case "tools/call": {
      if (notification) return null;
      const result = await callTool(
        context,
        routes,
        request.params?.name,
        request.params?.arguments,
      );
      return jsonRpcResult(id, result);
    }
    // Declared in no capability, answered anyway: a client that probes for them
    // reads "this server has none" instead of "this server is broken".
    case "resources/list":
      return notification ? null : jsonRpcResult(id, { resources: [] });
    case "resources/templates/list":
      return notification ? null : jsonRpcResult(id, { resourceTemplates: [] });
    case "prompts/list":
      return notification ? null : jsonRpcResult(id, { prompts: [] });
    default:
      // Every `notifications/*` the client sends lands here, and a notification
      // is answered with silence by definition — including one we do not know.
      if (notification) return null;
      return jsonRpcError(id, JSON_RPC_ERRORS.methodNotFound, `unknown method '${request.method}'`);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** The whole endpoint: one POST body in, one JSON-RPC body (or 202) out. */
export async function handleMcpRequest(
  request: Request,
  context: McpContext,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      jsonRpcError(null, JSON_RPC_ERRORS.parse, "the request body is not valid JSON"),
      400,
    );
  }
  const envelope = parseEnvelope(payload);
  if ("code" in envelope) {
    return jsonResponse(jsonRpcError(null, envelope.code, envelope.message), 400);
  }

  if (envelope.members.length > MAX_BATCH_MEMBERS) {
    return jsonResponse(
      jsonRpcError(
        null,
        JSON_RPC_ERRORS.invalidRequest,
        `a batch may carry at most ${MAX_BATCH_MEMBERS} messages; this one carried ${envelope.members.length}`,
      ),
      400,
    );
  }

  const routes = indexRoutesByOperationId(context.entries);
  const responses: JsonRpcResponse[] = [];
  for (const member of envelope.members) {
    if (member.kind === "invalid") {
      responses.push(jsonRpcError(member.id, member.error.code, member.error.message));
      continue;
    }
    // One member's fault is that member's. Without this, a header value the
    // runtime rejects throws out of the loop, the composition root answers with
    // a plain-text 500 rather than JSON-RPC, and every other member of the batch
    // is discarded along with it.
    let answer: JsonRpcResponse | null;
    try {
      answer = await dispatch(context, routes, member.request);
    } catch (error) {
      if (member.request.id === undefined) continue;
      answer = jsonRpcError(
        member.request.id ?? null,
        JSON_RPC_ERRORS.internal,
        "the server could not complete this call",
        { request_id: context.requestId, reason: error instanceof Error ? error.name : "unknown" },
      );
    }
    if (answer !== null) responses.push(answer);
  }
  // Notifications only: the specification asks for 202 and no body.
  // (Batching itself is a courtesy to clients on revisions that had it; the
  // 2025-06-18 revision this server prefers removed it.)
  if (responses.length === 0) return new Response(null, { status: 202 });
  if (envelope.batch) return jsonResponse(responses);
  // A lone malformed message is a bad HTTP request as well as a JSON-RPC error;
  // saying so in the status is what lets a proxy or a client's error handling
  // see it without parsing the body.
  const malformed = envelope.members[0]?.kind === "invalid";
  return jsonResponse(responses[0], malformed ? 400 : 200);
}

