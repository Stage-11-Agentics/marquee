import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { FROZEN_NOW } from "../seed/event.ts";
import { budgetsForScope, classifySpeedMeasurements, SPEED_BUDGETS } from "./speed-budgets.mjs";
import {
  ApiClient,
  DEMO_EVENT_ID,
  fetchAllSubmissions,
  withLocalRuntime,
} from "./seed.ts";

const SAMPLE_COUNTS = Object.freeze({
  warm: 10,
  cold: 5,
  review: 20,
  search: 10,
  agendaSwitch: 20,
  transitions: 10,
});

const EVENT = encodeURIComponent(DEMO_EVENT_ID);

interface SampleSet {
  values: number[];
  method: string;
  notes?: string[];
  completed?: boolean;
  longTaskMs?: number;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!;
}

function summarize(values: readonly number[]): { n: number; p50: number | null; p95: number | null; max: number | null } {
  return {
    n: values.length,
    p50: percentile(values, 0.5) === null ? null : rounded(percentile(values, 0.5)! ),
    p95: percentile(values, 0.95) === null ? null : rounded(percentile(values, 0.95)! ),
    max: values.length ? rounded(Math.max(...values)) : null,
  };
}

async function sample(count: number, operation: () => Promise<number>): Promise<number[]> {
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) values.push(await operation());
  return values;
}

async function waitFor(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 15_000 });
}

async function loadPage(page: Page, baseUrl: string, path: string, selector: string): Promise<number> {
  const startedAt = performance.now();
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitFor(page, selector);
  return performance.now() - startedAt;
}

async function quickSearchPaintSamples(page: Page, baseUrl: string): Promise<number[]> {
  await loadPage(page, baseUrl, "/dashboard", ".dashboard-page");
  const searchTerms = [
    "agent",
    "Casy",
    "RAG",
    "zzzz-no-match",
    "Leadership",
    "Marriott",
    "Aïcha",
    "session",
    "Dhinkran",
    "retrieval systms",
  ];
  const searchValues: number[] = [];
  for (const term of searchTerms) {
    const before = page.url();
    await page.keyboard.press("/");
    const input = page.locator("[data-search-input]");
    await input.waitFor({ state: "visible", timeout: 5_000 });
    await input.pressSequentially(term.slice(0, -1), { delay: 0 });
    const startedAt = performance.now();
    await input.pressSequentially(term.slice(-1), { delay: 0 });
    await page.waitForFunction(
      (expected) => {
        const host = document.querySelector("[data-search-painted-query]");
        return host?.getAttribute("data-search-painted-query") === expected
          && host?.getAttribute("data-search-state") === "ready";
      },
      term,
      { timeout: 15_000 },
    );
    searchValues.push(performance.now() - startedAt);
    if (page.url() !== before) throw new Error(`global search navigated while typing ${term}`);
    await page.keyboard.press("Escape");
    await input.waitFor({ state: "hidden", timeout: 5_000 });
  }
  if (searchValues.length < SAMPLE_COUNTS.search) throw new Error("global search speed sample set is below ten queries");
  return searchValues;
}

async function coldPublicPages(
  browser: Browser,
  baseUrl: string,
  path: string,
  selector: string,
  count: number,
): Promise<number[]> {
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      values.push(await loadPage(page, baseUrl, path, selector));
    } finally {
      await context.close();
    }
  }
  return values;
}

async function adminContext(browser: Browser, runtimeBaseUrl: string, cookie: string | null): Promise<BrowserContext> {
  const context = await browser.newContext();
  if (cookie) {
    const value = cookie.replace(/^mq_session=/, "");
    await context.addCookies([{ name: "mq_session", value, url: `${runtimeBaseUrl}/` }]);
  }
  return context;
}

async function reviewAdvanceSamples(page: Page, baseUrl: string): Promise<number[]> {
  // The home is the reviewer seat; this gate measures the working surface.
  await loadPage(page, baseUrl, "/reviewer/queue", "[data-reviewer-surface]");
  const values: number[] = [];
  for (let index = 0; index < SAMPLE_COUNTS.review; index += 1) {
    const currentId = await page.locator("[data-queue-id]").getAttribute("data-queue-id");
    if (!currentId) throw new Error(`review queue lost its current card at advance ${index + 1}`);
    await page.locator(".decision-button").first().click();
    await page.locator(".reviewer-save").waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForFunction(() => !document.querySelector(".reviewer-save")?.hasAttribute("disabled"), undefined, { timeout: 5_000 });
    const startedAt = performance.now();
    await page.locator(".reviewer-save").click();
    await page.waitForFunction(
      (previousId) => document.querySelector("[data-queue-id]")?.getAttribute("data-queue-id") !== previousId,
      currentId,
      { timeout: 15_000 },
    );
    values.push(performance.now() - startedAt);
  }
  return values;
}

async function bulkAcceptSample(
  page: Page,
  baseUrl: string,
  ids: string[],
): Promise<{ durationMs: number; completed: boolean; longestMainThreadTaskMs: number }> {
  await loadPage(page, baseUrl, "/submissions", ".submissions-page");
  return page.evaluate(async ({ eventId, selectedIds }) => {
    const planResponse = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/decision-plan`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ selector: { ids: selectedIds }, action: "accept" }),
    });
    const plan = await planResponse.json() as { plan_fingerprint?: string; etag?: string };
    if (!planResponse.ok || !plan.plan_fingerprint || !plan.etag) {
      throw new Error(`bulk accept decision plan failed with ${planResponse.status}`);
    }
    let longestMainThreadTaskMs = 0;
    const observer = typeof PerformanceObserver === "undefined" ? null : new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longestMainThreadTaskMs = Math.max(longestMainThreadTaskMs, entry.duration);
    });
    try {
      observer?.observe({ type: "longtask", buffered: true });
    } catch {
      // Chromium supports Long Tasks; keep the report explicit if a future
      // engine does not expose this observer rather than inventing a value.
    }
    const startedAt = performance.now();
    const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/submissions/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "if-match": plan.etag },
      body: JSON.stringify({ selector: { ids: selectedIds }, action: "accept", plan_fingerprint: plan.plan_fingerprint }),
    });
    const body = await response.json() as { state?: string; selected?: number; succeeded?: number; failed?: number };
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
    observer?.disconnect();
    return {
      durationMs: performance.now() - startedAt,
      completed: response.ok && body.state === "completed" && body.selected === selectedIds.length && body.succeeded === selectedIds.length && body.failed === 0,
      longestMainThreadTaskMs,
    };
  }, { eventId: DEMO_EVENT_ID, selectedIds: ids });
}

async function embedPropagationSample(client: ApiClient, agendaSession: Record<string, any>): Promise<number> {
  const embedPath = "/api/v1/public/embeds/aie-ny-2026-agenda";
  const publicClient = new ApiClient(client.baseUrl);
  const before = await publicClient.json<Record<string, any>>(embedPath);
  const beforeSnapshot = JSON.stringify(before.body);
  await client.json(`/api/v1/events/${EVENT}/agenda/items/${encodeURIComponent(String(agendaSession.id))}`, {
    method: "PATCH",
    headers: { "If-Match": String(agendaSession.etag) },
    body: JSON.stringify({ starts_at: Number(agendaSession.starts_at) + 60_000 }),
  });
  const startedAt = performance.now();
  const deadline = startedAt + 60_000;
  while (performance.now() < deadline) {
    const response = await publicClient.json<Record<string, any>>(embedPath);
    if (JSON.stringify(response.body) !== beforeSnapshot) return performance.now() - startedAt;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("public embed did not reflect the agenda mutation within 60 seconds");
}

function recordSample(
  samples: Record<string, SampleSet>,
  measurements: Record<string, number | boolean>,
  id: string,
  values: number[],
  method: string,
  metric: string,
  notes?: string[],
): void {
  const summary = summarize(values);
  samples[id] = { ...summary, values: values.map(rounded), method, notes };
  if (metric === "median") measurements[id] = summary.p50!;
  else if (metric === "max") measurements[id] = summary.max!;
  else measurements[id] = summary.p95!;
}

export interface SpeedReport {
  command: "check:speed";
  scope: SpeedScope;
  status: "pass" | "fail";
  gate: boolean;
  environment: {
    kind: "local-wrangler-dev";
    runtime: "wrangler dev/miniflare";
    deployed: false;
    seed: "scripts/seed/index.ts";
  };
  measurements: Record<string, number | boolean>;
  samples: Record<string, SampleSet & { n?: number; p50?: number | null; p95?: number | null; max?: number | null }>;
  methods: Record<string, string>;
  harness: { check_speed: { observedMs: number; budgetMs: number; verdict: "pass" | "fail" } };
  follow_up: string;
  entries: unknown[];
  acceptanceFailures: unknown[];
  objectiveWarnings: unknown[];
  missing: unknown[];
  shouldFail: boolean;
}

export type SpeedScope = "all" | "acceptance";

export async function runSpeedCheck({ gate = false, scope = "all" }: { gate?: boolean; scope?: SpeedScope } = {}): Promise<SpeedReport> {
  budgetsForScope(scope);
  const acceptanceOnly = scope === "acceptance";
  const commandStartedAt = performance.now();
  return withLocalRuntime(async (runtime) => {
    const client = new ApiClient(runtime.baseUrl);
    await client.login("organizer");
    const allSubmissions = await fetchAllSubmissions(client);
    const inReviewIds = allSubmissions.filter((row) => row.status === "in_review").slice(0, 150).map((row) => row.id);
    if (inReviewIds.length < 150) throw new Error(`speed harness needs 150 in-review submissions, found ${inReviewIds.length}`);
    const agenda = await client.json<{ sessions: Array<Record<string, any>> }>(`/api/v1/events/${EVENT}/agenda`);
    const agendaSession = agenda.body.sessions.find((session) => session.kind === "session");
    if (!agendaSession) throw new Error("speed harness needs one scheduled agenda session for the embed mutation");

    const measurements: Record<string, number | boolean> = {};
    const samples: Record<string, SampleSet & { n?: number; p50?: number | null; p95?: number | null; max?: number | null }> = {};
    const methods: Record<string, string> = {};
    const browser = await chromium.launch({ headless: true });
    try {
      const admin = await adminContext(browser, runtime.baseUrl, client.sessionCookie);
      const adminPage = await admin.newPage();
      if (!acceptanceOnly) {
        const dashboardValues = await sample(SAMPLE_COUNTS.warm, () => loadPage(adminPage, runtime.baseUrl, "/dashboard", ".dashboard-page"));
        recordSample(samples, measurements, "dashboard-render", dashboardValues, "Playwright authenticated /dashboard render", "p95");
        methods["dashboard-render"] = "Playwright authenticated /dashboard render to .dashboard-page";

        const submissionsValues = await sample(SAMPLE_COUNTS.warm, () => loadPage(adminPage, runtime.baseUrl, "/submissions", ".submissions-page"));
        recordSample(samples, measurements, "submissions-first-interactive", submissionsValues, "Playwright authenticated /submissions render", "p95");
        methods["submissions-first-interactive"] = "Playwright authenticated /submissions render to .submissions-page";

        const filterValues = await sample(SAMPLE_COUNTS.warm, () => {
          const query = ["status=in_review&sort=title", "kind=abstract&sort=score", "status=accepted&sort=updated", "format=fmt_workshop&sort=newest"][Math.floor(Math.random() * 4)]!;
          return loadPage(adminPage, runtime.baseUrl, `/submissions?${query}`, ".submissions-page");
        });
        recordSample(samples, measurements, "submissions-filter-sort", filterValues, "Playwright authenticated submissions filter/sort reload", "p95");
        methods["submissions-filter-sort"] = "Playwright authenticated submissions filter/sort reload to .submissions-page";
      }

      const reviewValues = await reviewAdvanceSamples(await admin.newPage(), runtime.baseUrl);
      recordSample(samples, measurements, "review-next-interactive", reviewValues, "Playwright click recommendation + Save recommendation & next", "median");
      methods["review-next-interactive"] = "20 consecutive real reviewer UI advances; duration starts at save click and ends on next card";

      if (!acceptanceOnly) {
        const adminRoutes = ["/dashboard", "/submissions", "/forms", "/evaluation", "/agenda-builder", "/settings", "/board"];
        const transitionValues: number[] = [];
        for (let index = 0; index < SAMPLE_COUNTS.transitions; index += 1) {
          transitionValues.push(await loadPage(adminPage, runtime.baseUrl, adminRoutes[index % adminRoutes.length]!, ".page"));
        }
        recordSample(samples, measurements, "admin-route-transition", transitionValues, "Playwright authenticated admin route navigation", "p95");
        methods["admin-route-transition"] = "10 authenticated admin route navigations through the installed shell; the external speaker portal is measured separately";

        const speakerClient = new ApiClient(runtime.baseUrl);
        await speakerClient.login("speaker");
        const speaker = await adminContext(browser, runtime.baseUrl, speakerClient.sessionCookie);
        const speakerPage = await speaker.newPage();
        const portalValues = await sample(SAMPLE_COUNTS.warm, () => loadPage(speakerPage, runtime.baseUrl, "/portal", ".portal-shell"));
        recordSample(samples, measurements, "speaker-portal-load", portalValues, "Playwright authenticated speaker /portal shell load", "p95");
        methods["speaker-portal-load"] = "Playwright /portal shell with the seeded speaker persona; this is an objective proxy for deployed-device speaker-portal performance";
        await speaker.close();
      }

      const bulk = await bulkAcceptSample(await admin.newPage(), runtime.baseUrl, inReviewIds);
      measurements["bulk-accept-completion"] = bulk.completed;
      samples["bulk-accept-completion"] = { ...summarize([bulk.durationMs]), values: [rounded(bulk.durationMs)], method: "Playwright page.evaluate fetch to bulk decision API", completed: bulk.completed };
      methods["bulk-accept-completion"] = "150 explicit IDs through the real bulk decision API; completed means 150 succeeded, 0 failed, durable completed state";
      if (!acceptanceOnly) {
        measurements["bulk-accept-long-task"] = rounded(bulk.longestMainThreadTaskMs);
        samples["bulk-accept-long-task"] = { ...summarize([bulk.longestMainThreadTaskMs]), values: [rounded(bulk.longestMainThreadTaskMs)], method: "Chromium PerformanceObserver longtask during the same bulk operation", longTaskMs: rounded(bulk.longestMainThreadTaskMs) };
        methods["bulk-accept-long-task"] = "Chromium Long Tasks API; zero means no long task was observed in the local browser";
      }

      const searchValues = await quickSearchPaintSamples(adminPage, runtime.baseUrl);
      recordSample(samples, measurements, "global-search-painted", searchValues, "Playwright keystroke-to-painted global search", "p95", ["Ten real browser queries include genuine seeded misspellings (Casy, Dhinkran, retrieval systms), a no-match, and a diacritic probe."]);
      methods["global-search-painted"] = "For each of 10 queries, the timer starts immediately before the final keystroke and ends only when that final query is painted in data-search-painted-query with a ready result state; no input debounce is used.";

      await admin.close();

      const cfpValues = await coldPublicPages(browser, runtime.baseUrl, "/f/cfp", ".public-form", SAMPLE_COUNTS.cold);
      recordSample(samples, measurements, "cfp-cold-interactive", cfpValues, "Playwright cold public /f/cfp render", "p95", ["Five fresh browser contexts with Chromium cache disabled; the exact seeded public CFP route is measured."]);
      methods["cfp-cold-interactive"] = "Playwright cold /f/cfp render to .public-form with a fresh context and disabled HTTP cache";

      const agendaValues = await coldPublicPages(browser, runtime.baseUrl, "/agenda?event=aie-ny-2026", "main", SAMPLE_COUNTS.cold);
      recordSample(samples, measurements, "agenda-cold-interactive", agendaValues, "Playwright cold public /agenda render", "p95");
      methods["agenda-cold-interactive"] = "Playwright cold /agenda render to main";

      if (!acceptanceOnly) {
        const agendaSwitchValues: number[] = [];
        const publicAgendaQueries = [
          "day=2026-10-12", "day=2026-10-13", "track=trk_agents", "track=trk_evals", "q=agent",
          "q=workshop", "day=2026-10-12&track=trk_agents", "day=2026-10-13&track=trk_infra",
        ];
        for (let index = 0; index < SAMPLE_COUNTS.agendaSwitch; index += 1) {
          const query = publicAgendaQueries[index % publicAgendaQueries.length]!;
          const result = await client.json<unknown>(`/api/v1/public/agenda?event=aie-ny-2026&${query}`);
          agendaSwitchValues.push(result.elapsedMs);
        }
        recordSample(samples, measurements, "agenda-view-switch", agendaSwitchValues, "Public agenda API filtered snapshot", "p95", ["The installed public agenda exposes server-rendered filters; this records the source snapshot switch, not a deployed device paint."]);
        methods["agenda-view-switch"] = "20 real public agenda day/track/search filter snapshots";

        const chaseValues: number[] = [];
        for (let index = 0; index < SAMPLE_COUNTS.warm; index += 1) {
          const result = await client.json<unknown>(`/api/v1/events/${EVENT}/submissions?status=onboarding&per_page=100&sort=updated`);
          chaseValues.push(result.elapsedMs);
        }
        recordSample(samples, measurements, "chase-board-load", chaseValues, "Authenticated onboarding/task-backed submissions API", "p95", ["The current tree has no board data module; this is the real task-backed source query and is not presented as a board render."]);
        methods["chase-board-load"] = "10 real onboarding list reads backing the chase workload; board UI is a named product follow-up";
      }

      const embedMs = await embedPropagationSample(client, agendaSession);
      measurements["embed-source-reflection"] = rounded(embedMs);
      samples["embed-source-reflection"] = { values: [rounded(embedMs)], method: "Agenda API mutation then clean unauthenticated public embed polls", n: 1, p50: rounded(embedMs), p95: rounded(embedMs), max: rounded(embedMs) };
      methods["embed-source-reflection"] = "Patch a seeded agenda item via API, then poll /api/v1/public/embeds/aie-ny-2026-agenda from the clean public path";

      const classified = classifySpeedMeasurements(measurements, { gate, scope });
      const checkSpeedElapsedMs = Math.round(performance.now() - commandStartedAt);
      const checkSpeedBudgetMs = 4 * 60_000;
      const harnessFail = checkSpeedElapsedMs > checkSpeedBudgetMs;
      return {
        command: "check:speed" as const,
        scope,
        status: classified.shouldFail || harnessFail ? "fail" as const : "pass" as const,
        gate,
        environment: runtime.environment,
        measurements,
        samples,
        methods,
        harness: {
          check_speed: {
            observedMs: checkSpeedElapsedMs,
            budgetMs: checkSpeedBudgetMs,
            verdict: harnessFail ? "fail" as const : "pass" as const,
          },
        },
        follow_up: "Local measurements are not deployed evidence. MRQ-57 must run the same budgets against the real Cloudflare deployment, including /f/:formSlug cold interactive, browser search paint, board/portal surfaces, and production Long Tasks.",
        ...classified,
      } as SpeedReport;
    } finally {
      await browser.close();
    }
  });
}

export { SPEED_BUDGETS };
