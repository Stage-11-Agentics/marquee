/**
 * JSON-RPC 2.0, by hand, because that is all the Streamable HTTP transport is.
 *
 * One address (`POST /mcp`), one content type, no session, no library, no new
 * dependency. Statelessness is the point: every call carries what it needs, so
 * two calls in a row may land on two different isolates and neither knows.
 *
 * The line this module draws is the one the MCP specification draws, and it is
 * the difference between a client that recovers and a client that gives up:
 *
 *   * A **protocol** fault — an unreadable body, an unknown method, a tool that
 *     does not exist, arguments that are not an object — is a JSON-RPC `error`.
 *     The caller got the shape wrong and no amount of retrying the same bytes
 *     will help.
 *   * A **refusal** — the call for proposals is closed, this token cannot see
 *     that conference, the plan is stale — is a perfectly good JSON-RPC
 *     `result` carrying `isError: true` and one plain sentence. The caller
 *     reads a sentence and can act on it, rather than catching a fault and
 *     concluding the server is broken.
 */

export const JSONRPC_VERSION = "2.0";

/**
 * Protocol revisions this server knows how to speak. A client asking for one of
 * them is answered in its own version; a client asking for anything else is
 * answered in the newest we have and decides for itself whether to proceed —
 * which is what the specification asks a server to do, and is why an unknown
 * (newer) revision is not an error here.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** JSON-RPC's own reserved codes, plus nothing invented. */
export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: typeof JSONRPC_VERSION; id: JsonRpcId; result: unknown }
  | { jsonrpc: typeof JSONRPC_VERSION; id: JsonRpcId; error: JsonRpcErrorBody };

export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/**
 * A member is either a request to dispatch or a structural fault to answer —
 * per member, never for the whole envelope. One malformed entry in a batch of
 * ten leaves the other nine perfectly answerable, and the id the bad entry
 * carried is what lets its client correlate the failure with what it sent.
 */
export type EnvelopeMember =
  | { kind: "request"; request: JsonRpcRequest }
  | { kind: "invalid"; id: JsonRpcId; error: JsonRpcErrorBody };

export interface ParsedEnvelope {
  members: EnvelopeMember[];
  /** True when the client sent a JSON array, which must be answered with one. */
  batch: boolean;
}

/** A readable id survives a member that is otherwise unusable. */
function readableId(candidate: Record<string, unknown>): JsonRpcId {
  const id = candidate.id;
  if (typeof id === "string" || typeof id === "number") return id;
  return null;
}

function validateMember(member: unknown): EnvelopeMember {
  if (member === null || typeof member !== "object" || Array.isArray(member)) {
    return {
      kind: "invalid",
      id: null,
      error: { code: JSON_RPC_ERRORS.invalidRequest, message: "each JSON-RPC message must be an object" },
    };
  }
  const candidate = member as Record<string, unknown>;
  const id = readableId(candidate);
  const invalid = (code: number, message: string): EnvelopeMember => ({ kind: "invalid", id, error: { code, message } });
  if (candidate.jsonrpc !== JSONRPC_VERSION) {
    return invalid(JSON_RPC_ERRORS.invalidRequest, `jsonrpc must be "${JSONRPC_VERSION}"`);
  }
  if (typeof candidate.method !== "string" || candidate.method.length === 0) {
    return invalid(JSON_RPC_ERRORS.invalidRequest, "method must be a non-empty string");
  }
  const rawId = candidate.id;
  if (rawId !== undefined && rawId !== null && typeof rawId !== "string" && typeof rawId !== "number") {
    return invalid(JSON_RPC_ERRORS.invalidRequest, "id must be a string, a number, or null");
  }
  const params = candidate.params;
  if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
    return invalid(JSON_RPC_ERRORS.invalidParams, "params must be an object");
  }
  return {
    kind: "request",
    request: {
      jsonrpc: JSONRPC_VERSION,
      ...(rawId === undefined ? {} : { id: rawId as JsonRpcId }),
      method: candidate.method,
      ...(params === undefined ? {} : { params: params as Record<string, unknown> }),
    },
  };
}

/**
 * Structural validation only. Whether the method exists and whether its params
 * make sense belongs to the dispatcher; this asks only "is this JSON-RPC at
 * all?", which is the one question that has to be answered before there is an
 * id to attach a failure to. An empty batch is the sole whole-envelope fault,
 * because there is no member to attach anything to.
 */
export function parseEnvelope(payload: unknown): ParsedEnvelope | JsonRpcErrorBody {
  if (Array.isArray(payload) && payload.length === 0) {
    return { code: JSON_RPC_ERRORS.invalidRequest, message: "a JSON-RPC batch must not be empty" };
  }
  const members = (Array.isArray(payload) ? payload : [payload]).map(validateMember);
  return { members, batch: Array.isArray(payload) };
}

/** Answer in the caller's revision when we know it; otherwise in our newest. */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string"
    && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}
