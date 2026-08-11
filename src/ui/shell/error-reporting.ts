/**
 * The browser's half of the instrumentation: a throttled error beacon, a small
 * ring of recent events, and the diagnostic report an organizer can paste into
 * an issue.
 *
 * WHERE THE REPORTS GO. To this deployment's own Worker, at
 * `/api/v1/telemetry/client-errors`, and nowhere else. There is no vendor
 * script, no DSN, no third-party endpoint, and nothing is persisted at the
 * other end — the Worker writes one log line and returns. An organizer running
 * Marquee for a conference is holding other people's data, and deserves to be
 * able to read exactly what leaves the browser. That is this file.
 *
 * WHY THROTTLING IS NOT OPTIONAL. The dashboard revalidates every five seconds.
 * An unthrottled beacon on a broken dashboard is roughly 720 reports an hour
 * from every open tab — a self-inflicted denial of service aimed at the same
 * origin that is already failing. Reports are therefore deduplicated by
 * signature, spaced by a floor, and capped per session, and the cap is a real
 * stop rather than a slowdown.
 */

/** The report shapes the Worker's zod schema accepts; keep the two in step. */
export type ClientErrorKind = "error" | "rejection" | "boundary";

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  route: string;
  build: string;
  session: string;
  occurrences: number;
}

export interface WebVitalReport {
  kind: "web_vital";
  metric: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  route: string;
  build: string;
  session: string;
}

export type TelemetryReport = ClientErrorReport | WebVitalReport;

export const TELEMETRY_PATH = "/api/v1/telemetry/client-errors";

/** Caps mirror the endpoint's schema; trimming here saves a rejected round trip. */
const MESSAGE_MAX = 300;
const STACK_MAX = 1_500;

/** Throttle constants. Deliberately conservative — this is a failure path. */
const MAX_REPORTS_PER_SESSION = 20;
const MIN_SEND_INTERVAL_MS = 5_000;
/** How long before the same signature is worth re-reporting with a fresh count. */
const REPEAT_COOLDOWN_MS = 120_000;

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * The route TEMPLATE of the current screen, never the raw path. A submission id
 * in a URL is opaque, but a query string is free text a person typed, and free
 * text is exactly what must not be shipped anywhere.
 */
export function routeTemplate(pathname: string): string {
  return (
    pathname
      .split("/")
      .map((segment) =>
        // Opaque record ids (`sub_01J…`, ULIDs, uuids) collapse to a placeholder.
        /^[a-z]{1,4}_[0-9A-Za-z]{8,}$/.test(segment) || /^[0-9A-Fa-f-]{16,}$/.test(segment)
          ? "{id}"
          : segment,
      )
      .join("/") || "/"
  );
}

export interface ReporterOptions {
  send: (report: TelemetryReport) => void;
  build: string;
  session: string;
  currentRoute: () => string;
  now?: () => number;
  enabled?: () => boolean;
}

export interface Reporter {
  report(kind: ClientErrorKind, error: unknown): void;
  vital(metric: WebVitalReport["metric"], value: number, rating: WebVitalReport["rating"]): void;
  /** Timestamped one-liners for the diagnostic report; nothing leaves on its own. */
  note(text: string): void;
  recentEvents(): readonly string[];
  /** Reports actually sent this session, for the cap's own tests. */
  sentCount(): number;
}

interface SignatureState {
  seen: number;
  reported: number;
  lastSentAt: number;
}

const RECENT_EVENT_LIMIT = 20;

export function errorSignature(message: string, stack: string | undefined): string {
  // The top frame is what distinguishes two failures with the same message.
  const frame = stack?.split("\n").find((line) => line.includes("@") || line.includes("at ")) ?? "";
  return `${message}::${frame.trim()}`;
}

function describeThrown(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: clamp(error.message || error.name, MESSAGE_MAX),
      ...(error.stack ? { stack: clamp(error.stack, STACK_MAX) } : {}),
    };
  }
  return { message: clamp(typeof error === "string" ? error : "a non-Error value was thrown", MESSAGE_MAX) };
}

/**
 * The reporter, with its clock and transport injected so the throttle and the
 * dedupe are testable as the arithmetic they are rather than as a side effect.
 */
export function createReporter(options: ReporterOptions): Reporter {
  const now = options.now ?? Date.now;
  const enabled = options.enabled ?? (() => true);
  const signatures = new Map<string, SignatureState>();
  const recent: string[] = [];
  let sent = 0;
  let lastSendAt = 0;

  const pushRecent = (text: string) => {
    recent.push(text);
    if (recent.length > RECENT_EVENT_LIMIT) recent.shift();
  };

  return {
    report(kind, error) {
      const { message, stack } = describeThrown(error);
      const at = now();
      pushRecent(`${new Date(at).toISOString()} ${kind}: ${message}`);
      if (!enabled()) return;

      const signature = errorSignature(message, stack);
      const state = signatures.get(signature) ?? { seen: 0, reported: 0, lastSentAt: 0 };
      state.seen += 1;
      signatures.set(signature, state);

      // The cap is a stop, not a slowdown: past it this tab is silent for the
      // rest of the session no matter how hard the screen is failing.
      if (sent >= MAX_REPORTS_PER_SESSION) return;
      // Same failure, already reported, still inside its cooldown.
      if (state.reported > 0 && at - state.lastSentAt < REPEAT_COOLDOWN_MS) return;
      // Global floor between any two sends, so a burst of distinct failures
      // cannot become a burst of requests.
      if (sent > 0 && at - lastSendAt < MIN_SEND_INTERVAL_MS) return;

      const occurrences = state.seen - state.reported;
      state.reported = state.seen;
      state.lastSentAt = at;
      sent += 1;
      lastSendAt = at;
      options.send({
        kind,
        message,
        ...(stack ? { stack } : {}),
        route: options.currentRoute(),
        build: options.build,
        session: options.session,
        occurrences,
      });
    },
    vital(metric, value, rating) {
      if (!enabled()) return;
      options.send({
        kind: "web_vital",
        metric,
        value,
        rating,
        route: options.currentRoute(),
        build: options.build,
        session: options.session,
      });
    },
    note(text) {
      pushRecent(`${new Date(now()).toISOString()} ${clamp(text, 160)}`);
    },
    recentEvents() {
      return recent;
    },
    sentCount() {
      return sent;
    },
  };
}

/** `sendBeacon` survives the page unloading; `fetch(keepalive)` is the fallback. */
function browserSend(report: TelemetryReport): void {
  const body = JSON.stringify(report);
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon(TELEMETRY_PATH, blob)) return;
  }
  void fetch(TELEMETRY_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // A failing beacon must never become a second failure on screen.
  });
}

declare global {
  interface Window {
    /** Set to `false` by an embedder to silence the beacon in this page. */
    __MARQUEE_TELEMETRY__?: boolean;
    /** Build stamp handed to the client bundle at build time. */
    __MARQUEE_BUILD__?: string;
  }
}

declare const __MARQUEE_BUILD_SHA__: string | undefined;

export function clientBuildSha(): string {
  if (typeof __MARQUEE_BUILD_SHA__ === "string" && __MARQUEE_BUILD_SHA__.length > 0) {
    return __MARQUEE_BUILD_SHA__;
  }
  return "unknown";
}

function newSessionId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "").slice(0, 16)
    : `s${Math.floor(Math.random() * 1e12).toString(36)}`;
}

const VITAL_THRESHOLDS: Record<WebVitalReport["metric"], [number, number]> = {
  LCP: [2_500, 4_000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1_800, 3_000],
  TTFB: [800, 1_800],
};

export function rateVital(metric: WebVitalReport["metric"], value: number): WebVitalReport["rating"] {
  const [good, poor] = VITAL_THRESHOLDS[metric];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

let installed: Reporter | undefined;

/**
 * The live reporter. Every surface talks to this one instance so the throttle
 * is a per-tab budget rather than a per-component one.
 */
export function reporter(): Reporter {
  installed ??= createReporter({
    send: browserSend,
    build: clientBuildSha(),
    session: newSessionId(),
    currentRoute: () =>
      typeof window === "undefined" ? "unknown" : routeTemplate(window.location.pathname),
    enabled: () => typeof window === "undefined" || window.__MARQUEE_TELEMETRY__ !== false,
  });
  return installed;
}

/** Wire the window-level handlers and the Web Vitals observers. Idempotent. */
export function installErrorReporting(): void {
  if (typeof window === "undefined" || window.__MARQUEE_TELEMETRY_INSTALLED__) return;
  window.__MARQUEE_TELEMETRY_INSTALLED__ = true;
  const live = reporter();

  window.addEventListener("error", (event) => {
    live.report("error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    live.report("rejection", event.reason);
  });
  window.addEventListener("online", () => live.note("connection restored"));
  window.addEventListener("offline", () => live.note("connection dropped"));

  observeVitals(live);
}

declare global {
  interface Window {
    __MARQUEE_TELEMETRY_INSTALLED__?: boolean;
  }
}

/**
 * LCP, INP and TTFB without a library. Reported once, when the page is hidden —
 * both metrics are only final at that point, and reporting them earlier would
 * mean reporting them wrong.
 */
function observeVitals(live: Reporter): void {
  if (typeof PerformanceObserver !== "function") return;
  let largestContentfulPaint = 0;
  let slowestInteraction = 0;

  const observe = (type: string, handle: (entry: PerformanceEntry) => void) => {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) handle(entry);
      });
      observer.observe({ type, buffered: true } as PerformanceObserverInit);
    } catch {
      // An unsupported entry type is not a reason to break the page.
    }
  };

  observe("largest-contentful-paint", (entry) => {
    largestContentfulPaint = Math.max(largestContentfulPaint, entry.startTime);
  });
  observe("event", (entry) => {
    slowestInteraction = Math.max(slowestInteraction, entry.duration);
  });

  let reported = false;
  const flush = () => {
    if (reported || document.visibilityState !== "hidden") return;
    reported = true;
    if (largestContentfulPaint > 0) {
      live.vital("LCP", Math.round(largestContentfulPaint), rateVital("LCP", largestContentfulPaint));
    }
    if (slowestInteraction > 0) {
      live.vital("INP", Math.round(slowestInteraction), rateVital("INP", slowestInteraction));
    }
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation && navigation.responseStart > 0) {
      live.vital("TTFB", Math.round(navigation.responseStart), rateVital("TTFB", navigation.responseStart));
    }
  };
  document.addEventListener("visibilitychange", flush);
}

export interface DiagnosticContext {
  /** The reference code shown on screen, or "none". */
  reference: string;
  /** The full correlation id, when one was returned. */
  requestId?: string;
  route: string;
  /** The sanitized error sentence the operator was shown. */
  summary: string;
}

/**
 * The support handshake: everything an engineer needs, in one paste, with
 * nothing an organizer would be uncomfortable posting in public. No cookies, no
 * tokens, no request bodies — the reference code is what ties this to the
 * server-side line that has the rest.
 */
export function buildDiagnosticReport(
  context: DiagnosticContext,
  live: Reporter = reporter(),
  at: Date = new Date(),
): string {
  const lines = [
    "### Marquee diagnostic report",
    "",
    `- Reference: \`${context.reference}\``,
    ...(context.requestId ? [`- Request id: \`${context.requestId}\``] : []),
    `- Route: \`${context.route}\``,
    `- Build: \`${clientBuildSha()}\``,
    `- When: ${at.toISOString()}`,
    `- Browser: ${typeof navigator === "undefined" ? "unknown" : navigator.userAgent}`,
    "",
    "**What the screen said**",
    "",
    `> ${context.summary}`,
    "",
    "**Recent client events**",
    "",
    "```",
    ...(live.recentEvents().length > 0 ? live.recentEvents() : ["(none recorded)"]),
    "```",
  ];
  return lines.join("\n");
}

/** Copy the report, reporting honestly if the clipboard refuses. */
export async function copyDiagnosticReport(context: DiagnosticContext): Promise<boolean> {
  const text = buildDiagnosticReport(context);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
