/**
 * The browser's side of the error envelope.
 *
 * The API has always returned `{ error: { code, message }, request_id }` and an
 * `X-Request-Id` header. Screens used to throw away both and keep the HTTP
 * status, which is how a "Dashboard refresh failed" banner could be
 * undiagnosable: the operator saw `500`, the log line existed, and nothing
 * connected them. Everything a screen needs to close that gap lives here.
 *
 * Three jobs:
 *
 *   1. Parse the envelope into a `MarqueeApiError` that keeps the correlation
 *      id, so every error surface can print a reference the operator can quote
 *      and an engineer can grep.
 *   2. Say what happened in the organizer's language. `429` is not a sentence;
 *      "going faster than the system allows" is. The taxonomy below is the one
 *      place those sentences live.
 *   3. Tell a dropped connection apart from a broken server. They are the same
 *      screen in most software and they call for opposite reactions.
 */

import { reporter } from "./error-reporting";

/**
 * The stable envelope codes, mirroring `ERROR_STATUS_CODES` in `src/api/errors.ts`.
 * They are restated rather than imported because the client bundle must not
 * pull the Worker's schema module in; `tests/unit/client-error-handling.test.ts`
 * asserts the two lists never drift.
 */
export const API_ERROR_CODES = [
  "malformed_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "unprocessable",
  "rate_limited",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Failures that never reach the server, so they have no envelope of their own. */
export type ClientFailureCode = "offline" | "unreachable" | "unreadable";

export type MarqueeErrorCode = ApiErrorCode | ClientFailureCode;

export interface ErrorTreatment {
  /** One plain sentence. No status codes, no jargon, no blame. */
  sentence: string;
  /** What happens next, or what the operator can do. */
  recovery: string;
  /** Retrying on a timer is worth it — the condition is expected to pass. */
  retryable: boolean;
}

/**
 * Every code an operator can actually be shown, mapped to a sentence and a
 * recovery. Adding a code to the envelope without adding it here is a test
 * failure, not a silent fallback to a number on screen.
 */
export const ERROR_TREATMENTS: Readonly<Record<MarqueeErrorCode, ErrorTreatment>> = {
  malformed_request: {
    sentence: "The system sent a request this conference could not accept.",
    recovery: "Reload the page. If it repeats, copy the diagnostic report and file it.",
    retryable: false,
  },
  unauthenticated: {
    // The wall raised over the screen carries the sign-in action and says the
    // same sentence. A panel behind it repeating the instruction is two answers
    // to one question, and only one of them has a button.
    sentence: "Your session has expired.",
    recovery: "Nothing you were working on has been lost.",
    retryable: false,
  },
  forbidden: {
    sentence: "Your account does not have access to this.",
    recovery: "Ask a program lead to grant access.",
    retryable: false,
  },
  not_found: {
    sentence: "That is not here any more.",
    recovery: "It may have been moved or removed. Go back and try again.",
    retryable: false,
  },
  conflict: {
    sentence: "Someone else changed this while you were working on it.",
    recovery: "Reload to see their version before saving yours.",
    retryable: false,
  },
  unprocessable: {
    sentence: "That change would leave the program in a state it cannot be in.",
    recovery: "Adjust the values and try again.",
    retryable: false,
  },
  rate_limited: {
    sentence: "Going faster than the system allows.",
    recovery: "Retrying shortly — nothing is lost.",
    retryable: true,
  },
  internal_error: {
    sentence: "The conference server hit an unexpected problem.",
    recovery: "Retrying shortly. If it keeps failing, copy the diagnostic report.",
    retryable: true,
  },
  offline: {
    sentence: "Your connection dropped.",
    recovery: "The conference is fine — this device is offline. Reconnecting automatically.",
    retryable: true,
  },
  unreachable: {
    sentence: "The conference server could not be reached.",
    recovery: "Retrying shortly. Your work is not lost.",
    retryable: true,
  },
  unreadable: {
    sentence: "The conference server sent something unreadable.",
    recovery: "Retrying shortly. If it repeats, copy the diagnostic report.",
    retryable: true,
  },
};

/**
 * A short reference an operator can read aloud or paste into an issue. It is a
 * PREFIX of the full correlation id rather than a hash of it, so `grep 8f2a4c`
 * over the logs finds the line — a code that cannot be grepped is decoration.
 */
export function referenceCode(requestId: string | undefined): string {
  if (!requestId) return "none";
  return requestId.replaceAll("-", "").slice(0, 6).toLowerCase();
}

/**
 * The refusals whose server sentence is worth more than the generic one.
 *
 * A 422 or a 409 is the API declining a specific change for a stated reason,
 * and those reasons are written for the organizer: "Sam Whitfield reviews
 * Evals and Infra; this abstract carries RAG/Retrieval." Replacing that with
 * "That change would leave the program in a state it cannot be in" throws away
 * the only part of the answer that says what to do next. The generic sentence
 * stays for the refusals that arrive with no message, or with a technical one.
 */
const AUTHORED_CODES: ReadonlySet<MarqueeErrorCode> = new Set(["unprocessable", "conflict"]);

/** A server sentence, rendered as a sentence: capitalized, terminated once. */
function presentServerMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return trimmed;
  const capitalized = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export class MarqueeApiError extends Error {
  readonly code: MarqueeErrorCode;
  readonly status: number;
  /** The server's correlation id; absent when the request never arrived. */
  readonly requestId?: string;
  readonly field?: string;
  readonly details?: unknown;
  /** The route template, for the diagnostic report. */
  readonly route: string;
  /** True when the envelope carried a message a person wrote for this case. */
  readonly serverAuthored: boolean;

  constructor(options: {
    code: MarqueeErrorCode;
    message: string;
    status: number;
    requestId?: string;
    field?: string;
    details?: unknown;
    route: string;
    serverAuthored?: boolean;
  }) {
    super(options.message);
    this.name = "MarqueeApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.field = options.field;
    this.details = options.details;
    this.route = options.route;
    this.serverAuthored = options.serverAuthored ?? false;
  }

  get treatment(): ErrorTreatment {
    return ERROR_TREATMENTS[this.code];
  }

  get reference(): string {
    return referenceCode(this.requestId);
  }

  /** The server's own diagnosis where there is one; the taxonomy otherwise. */
  get sentence(): string {
    return this.serverAuthored && AUTHORED_CODES.has(this.code) && this.message.trim().length > 0
      ? presentServerMessage(this.message)
      : this.treatment.sentence;
  }

  /** What a banner shows: the plain sentence, then the reference to quote. */
  get display(): string {
    return `${this.sentence} ${this.treatment.recovery}`;
  }
}

/** Anything thrown at a screen, described. Non-API throws get honest wording. */
export function describeError(error: unknown): {
  sentence: string;
  recovery: string;
  reference: string;
  retryable: boolean;
} {
  if (error instanceof MarqueeApiError) {
    return {
      sentence: error.sentence,
      recovery: error.treatment.recovery,
      reference: error.reference,
      retryable: error.treatment.retryable,
    };
  }
  return {
    sentence: "Something in this screen stopped working.",
    recovery: "Reload the page. If it repeats, copy the diagnostic report and file it.",
    reference: "none",
    retryable: false,
  };
}

/**
 * One line for a screen that keeps its error state as a string rather than as a
 * banner component. Always ends in the reference, because a message an operator
 * cannot quote back is a message that costs somebody an afternoon.
 */
export function errorSummary(error: unknown): string {
  const described = describeError(error);
  return `${described.sentence} ${described.recovery} · ref ${described.reference}`;
}

interface FieldDetail {
  field?: unknown;
  fieldKey?: unknown;
  message?: unknown;
}

function detailIssues(details: unknown): FieldDetail[] {
  if (Array.isArray(details)) return details.filter((item): item is FieldDetail => Boolean(item) && typeof item === "object");
  if (!details || typeof details !== "object") return [];
  const issues = (details as { issues?: unknown }).issues;
  return Array.isArray(issues)
    ? issues.filter((item): item is FieldDetail => Boolean(item) && typeof item === "object")
    : [];
}

/** Return the API's own 422 detail for one or more controls on a screen. */
export function fieldError(error: unknown, fields: readonly string[]): string | undefined {
  if (!(error instanceof MarqueeApiError) || !["unprocessable", "malformed_request"].includes(error.code)) return undefined;
  if (error.field && fields.includes(error.field)) return error.message;
  const issue = detailIssues(error.details).find((candidate) => {
    const field = typeof candidate.field === "string" ? candidate.field : candidate.fieldKey;
    return typeof field === "string" && fields.includes(field);
  });
  return typeof issue?.message === "string" && issue.message.length > 0 ? issue.message : undefined;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

interface EnvelopeShape {
  error?: { code?: unknown; message?: unknown; field?: unknown; details?: unknown };
  request_id?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function codeFromEnvelope(value: unknown, status: number): ApiErrorCode {
  if (typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value)) {
    return value as ApiErrorCode;
  }
  // A response that is not one of ours (a proxy's 502 page, say) still has to
  // land on a sentence, and "the server hit a problem" is the honest one.
  return status === 429 ? "rate_limited" : status === 404 ? "not_found" : "internal_error";
}

export interface ApiFetchOptions extends RequestInit {
  /** Route template for logging and the diagnostic report; defaults to the path. */
  route?: string;
  /** Successful downloads can be plain text while errors remain the JSON envelope. */
  responseType?: "json" | "text";
}

/**
 * Record a failure in the local ring the diagnostic report reads from. This is
 * what turns "Recent client events" from an empty block into the trail that
 * explains how the screen got here — the second request failing after a token
 * expired reads very differently from one failure out of nowhere.
 *
 * Local only. Nothing here is sent; the beacon is a separate, throttled path.
 */
function noted(error: MarqueeApiError): MarqueeApiError {
  reporter().note(`${error.code} ${error.status} ${error.route}${error.requestId ? ` ref ${error.reference}` : ""}`);
  return error;
}

/**
 * `fetch`, with the envelope actually read.
 *
 * Every failure path produces a `MarqueeApiError` carrying a code, a human
 * sentence and — whenever the request reached the server — the correlation id.
 * Callers never see a bare status again.
 */
const forbiddenListeners = new Set<() => void>();

/**
 * Fires whenever a route refuses this seat its data. The shell listens so it
 * can stop drawing organizer chrome around a wall the seat cannot pass; the
 * refusal itself is still thrown to the caller that asked for the data.
 */
export function onForbidden(listener: () => void): () => void {
  forbiddenListeners.add(listener);
  return () => { forbiddenListeners.delete(listener); };
}

/**
 * Every request in flight belongs to the conference that was on screen when it
 * was sent. Switching conferences ends that generation.
 *
 * Remounting the page tree makes a late response *invisible*, not *cancelled* —
 * the request still lands, still costs the origin a round trip, and on a slow
 * connection still holds a connection open for a screen nobody is looking at.
 * So the switch says so out loud, and every caller's own AbortController still
 * composes on top of this one.
 */
// Created on first use, never at module scope: this module is reachable from
// the Worker bundle, and workerd refuses constructor work in global scope —
// the whole deployment fails to start rather than one request failing.
let requestGeneration: AbortController | null = null;

function currentGeneration(): AbortController {
  requestGeneration ??= new AbortController();
  return requestGeneration;
}

export function abortInFlightRequests(): void {
  requestGeneration?.abort(new DOMException("the conference on screen changed", "AbortError"));
  requestGeneration = null;
}

function scopedSignal(callerSignal: AbortSignal | null | undefined): AbortSignal {
  const generation = currentGeneration().signal;
  if (!callerSignal) return generation;
  // `AbortSignal.any` is the composition primitive; a runtime without it keeps
  // the caller's own signal rather than losing it.
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([callerSignal, generation])
    : callerSignal;
}

const unauthenticatedListeners = new Set<() => void>();

/**
 * Fires when a route says this browser has no session left. The shell listens
 * so it can raise one wall over the work already on screen rather than letting
 * every panel fail on its own — the refusal is still thrown to the caller that
 * asked, exactly as `onForbidden` leaves it.
 */
export function onUnauthenticated(listener: () => void): () => void {
  unauthenticatedListeners.add(listener);
  return () => { unauthenticatedListeners.delete(listener); };
}

export async function apiFetch<Result>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<Result> {
  const { route = path, responseType = "json", ...init } = options;
  let response: Response;
  try {
    response = await fetch(path, { ...init, signal: scopedSignal(init.signal) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // A dropped connection and a broken server are different problems with
    // different reactions, and must never render as the same screen.
    throw noted(new MarqueeApiError({
      code: isOffline() ? "offline" : "unreachable",
      message: error instanceof Error ? error.message : "the request could not be sent",
      status: 0,
      route,
    }));
  }

  const requestId = asString(response.headers.get("X-Request-Id") ?? undefined);
  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as EnvelopeShape | null;
    const code = codeFromEnvelope(envelope?.error?.code, response.status);
    if (code === "forbidden") for (const listener of forbiddenListeners) listener();
    if (code === "unauthenticated") for (const listener of unauthenticatedListeners) listener();
    const authoredMessage = asString(envelope?.error?.message);
    throw noted(new MarqueeApiError({
      code,
      serverAuthored: authoredMessage !== undefined,
      message: authoredMessage ?? `the request failed with status ${response.status}`,
      status: response.status,
      requestId: asString(envelope?.request_id) ?? requestId,
      field: asString(envelope?.error?.field),
      details: envelope?.error?.details,
      route,
    }));
  }

  // Some successful mutation routes deliberately return 204 with no JSON
  // body. Treat that as a successful API call rather than turning a completed
  // action into an "unreadable" error for the caller.
  if (response.status === 204 || response.status === 205) return undefined as Result;

  try {
    return (await (responseType === "text" ? response.text() : response.json())) as Result;
  } catch {
    throw noted(new MarqueeApiError({
      code: "unreadable",
      message: "the response body was not valid JSON",
      status: response.status,
      requestId,
      route,
    }));
  }
}

/**
 * Exponential backoff with full jitter.
 *
 * The dashboard used to re-poll every five seconds forever, failure or not. On
 * a sustained outage that is every open tab in the building hammering an origin
 * that is already wounded — the classic way a small incident becomes a large
 * one. Full jitter (a uniform draw from `[0, capped]`) is what stops every tab
 * from retrying in lockstep after the same failure.
 */
export function backoffDelayMs(
  consecutiveFailures: number,
  baseMs: number,
  options: { maxMs?: number; random?: () => number } = {},
): number {
  if (consecutiveFailures <= 0) return baseMs;
  const maxMs = options.maxMs ?? 60_000;
  const random = options.random ?? Math.random;
  const capped = Math.min(maxMs, baseMs * 2 ** consecutiveFailures);
  // Never retry faster than the healthy interval, never slower than the cap.
  return Math.round(baseMs + random() * Math.max(0, capped - baseMs));
}
