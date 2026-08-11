/**
 * Structured logging: one JSON line per event, correlated by request id.
 *
 * THE LOAD-BEARING RULE IS THE FIELD ALLOWLIST.
 *
 * A log line is not built by serializing whatever the caller happened to have.
 * Every event name declares the exact fields it may carry, and the builder
 * copies only those. A speaker's email address cannot be logged because the
 * shape has no slot for it — not because a redaction pass was remembered. That
 * is a structural guarantee rather than a discipline, and it is the difference
 * between an observability layer that is safe to run on a conference's speaker
 * data and one that is a slow leak.
 *
 * Consequences of the rule, all deliberate:
 *
 *   - No request bodies, no raw query strings, no cookies, no Authorization
 *     headers, no mail addresses. There is no field for any of them.
 *   - Routes are logged as TEMPLATES (`/api/v1/events/{eventId}/dashboard`),
 *     never as raw URLs, because a raw URL is an exfiltration channel for the
 *     free text callers put in query parameters.
 *   - Opaque identifiers (event ids, job ids, request ids) are fine: they carry
 *     no personal content and they are what makes a trace followable.
 *
 * Free-text fields (`message`, `stack`) are the one place a caller could smuggle
 * personal data through a declared slot, because an exception message can quote
 * anything. Those fields are additionally scrubbed for address-shaped and
 * credential-shaped runs before they are emitted. The allowlist is the
 * guarantee; the scrub is the seatbelt on top of it.
 */

import { BUILD_INFO, type BuildInfo } from "./build-info";

/** Bump when the shape of a line changes in a way a consumer must notice. */
export const LOG_SCHEMA_VERSION = 1;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
export const DEFAULT_LOG_LEVEL: LogLevel = "info";

/**
 * Hard caps. A log line that can grow without bound is a cost incident.
 * The line cap counts characters; log content is ASCII-dominated, so it tracks
 * the intended ~4KB byte budget closely enough to be the backstop it is meant
 * to be, without a TextEncoder allocation on every emitted line.
 */
export const TEXT_MAX_LENGTH = 300;
export const STACK_MAX_LENGTH = 1_200;
export const LINE_MAX_BYTES = 4_096;

type FieldType = "string" | "number" | "boolean";

/**
 * The allowlist. Adding a field here is the only way to get it into a log line,
 * which makes the review question for any new field exactly the right one:
 * "could this ever hold something a speaker told us in confidence?"
 */
export const LOG_EVENT_FIELDS = {
  /** One line per completed HTTP request. `duration_ms` is the live p50/p95 source. */
  http_request: {
    method: "string",
    route: "string",
    status: "number",
    duration_ms: "number",
    d1_queries: "number",
    d1_ms: "number",
    principal: "string",
    event_id: "string",
  },
  /** Every API failure, carrying the same request id the caller was shown. */
  api_error: {
    method: "string",
    route: "string",
    status: "number",
    code: "string",
    expected: "boolean",
    message: "string",
    error_name: "string",
    stack: "string",
  },
  /** Queue consumer outcome, one line per message. */
  queue_message: {
    queue: "string",
    message_type: "string",
    outcome: "string",
    duration_ms: "number",
    batch_size: "number",
    job_id: "string",
  },
  queue_error: {
    queue: "string",
    message_type: "string",
    job_id: "string",
    error_name: "string",
    message: "string",
    stack: "string",
  },
  /** A cron that never fires logs nothing at all; this is what makes silence visible. */
  cron_run: {
    cron: "string",
    outcome: "string",
    duration_ms: "number",
  },
  cron_error: {
    cron: "string",
    error_name: "string",
    message: "string",
    stack: "string",
  },
  /** Reported by the browser beacon. Logged, never persisted. */
  client_error: {
    kind: "string",
    message: "string",
    stack: "string",
    route: "string",
    build: "string",
    session: "string",
    occurrences: "number",
  },
  /** Web Vitals, through the same beacon. */
  web_vital: {
    metric: "string",
    value: "number",
    rating: "string",
    route: "string",
  },
  /** Deep diagnostics probe result. */
  diagnostics: {
    verdict: "string",
    duration_ms: "number",
    failing: "string",
  },
  /** Anything that failed outside a request, a queue message, or a cron. */
  worker_error: {
    source: "string",
    error_name: "string",
    message: "string",
    stack: "string",
  },
} as const satisfies Record<string, Record<string, FieldType>>;

export type LogEvent = keyof typeof LOG_EVENT_FIELDS;
export const LOG_EVENTS = Object.keys(LOG_EVENT_FIELDS) as readonly LogEvent[];

export type LogFields<Event extends LogEvent> = {
  [Key in keyof (typeof LOG_EVENT_FIELDS)[Event]]?: (typeof LOG_EVENT_FIELDS)[Event][Key] extends "string"
    ? string
    : (typeof LOG_EVENT_FIELDS)[Event][Key] extends "number"
      ? number
      : boolean;
};

/**
 * Every quantifier here is BOUNDED, deliberately. The unbounded form
 * (`[A-Z0-9._%+-]+@`) backtracks across the whole run at every position it
 * fails, which is quadratic — and the input to this scrub is an exception
 * message, which an attacker can influence. A logging path that can be made to
 * burn CPU is a denial of service wearing a safety vest. Real local parts fit
 * in 64 characters (RFC 5321) and real domains in 255.
 */
const EMAIL_PATTERN = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,24}/gi;
const CREDENTIAL_PATTERN = /\b(?:Bearer|Basic)\s{1,4}[A-Z0-9._~+/=-]{8,512}/gi;

/**
 * The seatbelt under the allowlist: an exception message can quote anything the
 * caller sent, so address- and credential-shaped runs never survive into a line.
 */
export function redactFreeText(value: string): string {
  return value
    .replaceAll(EMAIL_PATTERN, "[redacted-email]")
    .replaceAll(CREDENTIAL_PATTERN, "[redacted-credential]");
}

function clampText(value: string, max: number): string {
  // Trim to a window wider than the output BEFORE scrubbing, so the scrub's
  // cost is bounded by the cap rather than by whatever length a caller managed
  // to produce. The window is deliberately wider than `max`: an address
  // straddling the visible cut is still inside it, so it is redacted first and
  // truncated second, and never emerges as a readable fragment.
  const windowed = value.length > max * 2 ? value.slice(0, max * 2) : value;
  const scrubbed = redactFreeText(windowed);
  return scrubbed.length <= max ? scrubbed : `${scrubbed.slice(0, max)}…`;
}

/**
 * Absolute build paths in a stack frame. They name the machine that built the
 * bundle — under a local dev server that is somebody's home directory — and
 * they carry no diagnostic value the file name does not already carry.
 */
const BUILD_PATH_PATTERN = /\b(?:file:\/\/)?\/(?:[\w.@%+-]{1,64}\/){1,24}(?=[\w.@%+-]{1,64}:\d)/g;

/** A stack is useful for its top frames and ruinous for its full length. */
export function truncateStack(stack: string | undefined): string | undefined {
  if (typeof stack !== "string" || stack.length === 0) return undefined;
  const frames = stack.split("\n").slice(0, 12).join("\n").replaceAll(BUILD_PATH_PATTERN, "");
  return clampText(frames, STACK_MAX_LENGTH);
}

function coerce(type: FieldType, value: unknown, field: string): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (type === "number") return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (typeof value !== "string") return undefined;
  // Every declared string is scrubbed, not only `message`/`stack`: the ones
  // that cannot contain an address pay nothing, and the rule needs no upkeep
  // when a new string field is declared.
  return clampText(value, field === "stack" ? STACK_MAX_LENGTH : TEXT_MAX_LENGTH);
}

export interface LogLineBase {
  request_id?: string;
  build?: BuildInfo;
  /** Injectable clock, so a test asserts on a line rather than on a timestamp. */
  now?: () => number;
}

/**
 * Build the JSON line for one event. Exported so tests can assert on the exact
 * emitted text without capturing console output.
 *
 * Anything the caller passes that the event did not declare is dropped on the
 * floor, silently and by design: a caller who did not read this file cannot
 * widen what gets recorded.
 */
export function buildLogLine<Event extends LogEvent>(
  event: Event,
  level: LogLevel,
  fields: LogFields<Event> & Record<string, unknown>,
  base: LogLineBase = {},
): string {
  const declared = LOG_EVENT_FIELDS[event] as Record<string, FieldType>;
  const build = base.build ?? BUILD_INFO;
  const line: Record<string, unknown> = {
    ts: new Date((base.now ?? Date.now)()).toISOString(),
    level,
    event,
    schema_version: LOG_SCHEMA_VERSION,
    build_sha: build.sha,
  };
  if (base.request_id !== undefined) line.request_id = clampText(base.request_id, 120);

  // The allowlist walk: iterate the DECLARED fields, never the caller's keys.
  for (const [field, type] of Object.entries(declared)) {
    const coerced = coerce(type, (fields as Record<string, unknown>)[field], field);
    if (coerced !== undefined) line[field] = coerced;
  }

  const serialized = JSON.stringify(line);
  if (serialized.length <= LINE_MAX_BYTES) return serialized;
  // Over budget even after per-field caps: drop the stack, then hard-truncate.
  delete line.stack;
  const withoutStack = JSON.stringify({ ...line, truncated: true });
  return withoutStack.length <= LINE_MAX_BYTES
    ? withoutStack
    : `${withoutStack.slice(0, LINE_MAX_BYTES - 1)}`;
}

export type LogSink = (level: LogLevel, line: string) => void;

/** Levels map onto the console methods so `wrangler tail --status` still works. */
const consoleSink: LogSink = (level, line) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export function parseLogLevel(value: unknown): LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value)
    ? (value as LogLevel)
    : DEFAULT_LOG_LEVEL;
}

export interface Logger {
  readonly level: LogLevel;
  readonly requestId: string | undefined;
  emit<Event extends LogEvent>(
    event: Event,
    level: LogLevel,
    fields: LogFields<Event> & Record<string, unknown>,
  ): void;
  /** A child logger bound to a correlation id; everything else is inherited. */
  withRequestId(requestId: string | undefined): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  requestId?: string;
  build?: BuildInfo;
  now?: () => number;
  sink?: LogSink;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? DEFAULT_LOG_LEVEL;
  const sink = options.sink ?? consoleSink;
  const threshold = LEVEL_RANK[level];
  return {
    level,
    requestId: options.requestId,
    emit(event, eventLevel, fields) {
      if (LEVEL_RANK[eventLevel] < threshold) return;
      sink(
        eventLevel,
        buildLogLine(event, eventLevel, fields, {
          request_id: options.requestId,
          build: options.build,
          now: options.now,
        }),
      );
    },
    withRequestId(requestId) {
      return createLogger({ ...options, requestId });
    },
  };
}

/** Read the level from whatever env the caller has; anything unknown is `info`. */
export function loggerForEnv(
  env: { LOG_LEVEL?: string } | undefined,
  options: Omit<LoggerOptions, "level"> = {},
): Logger {
  return createLogger({ ...options, level: parseLogLevel(env?.LOG_LEVEL) });
}

/** The safe subset of an unknown thrown value, for the declared error fields. */
export function errorFields(error: unknown): {
  error_name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    const stack = truncateStack(error.stack);
    return {
      error_name: error.name,
      message: error.message,
      ...(stack === undefined ? {} : { stack }),
    };
  }
  return { error_name: "NonError", message: typeof error === "string" ? error : "a non-Error value was thrown" };
}
