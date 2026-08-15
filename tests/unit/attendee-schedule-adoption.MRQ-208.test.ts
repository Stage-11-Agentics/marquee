// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { PUBLIC_SCHEDULE_SCRIPT } from "../../src/ui/public/agenda/schedule-script";

/**
 * The attendee's schedule module, actually executed.
 *
 * Nothing ran this script before. It is a template string shipped inline on
 * every public page, so a type error cannot reach it and a route test cannot
 * either — which is how a recovery journey shipped broken twice: verifying
 * against whatever code the browser happened to hold, and then persisting an
 * adopted code before the sessions it stands for had arrived.
 *
 * These tests drive the real module in a real DOM against a stubbed network,
 * because the boundary that matters here is the ORDER of its writes, and only
 * running it can show that.
 */

const EVENT = "aie-ny-2026";
const STORAGE = `marquee:schedule:${EVENT}`;
const X = "MQ-XXXXXXXXXXXXX";
const Y = "MQ-YYYYYYYYYYYYY";
const X_KEY = "x".repeat(32);
const Y_KEY = "y".repeat(32);

const dom = globalThis.document as unknown as Document;

/**
 * happy-dom here ships a document and a window but no storage, and the module
 * treats a missing localStorage as private-browsing — a real state, but not the
 * one under test. A tiny real implementation keeps the subject honest.
 */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  } as Storage;
}
const store = memoryStorage();

interface Reply { status?: number; body: unknown }
type Route = (url: string, init?: RequestInit) => Reply | undefined;

let routes: Route[] = [];
let calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    for (const route of routes) {
      const reply = route(url, init);
      if (reply) {
        return {
          ok: (reply.status ?? 200) < 400,
          status: reply.status ?? 200,
          json: async () => reply.body,
        } as unknown as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: "no route" } }) } as unknown as Response;
  }));
}

/** The page the script binds to: the itinerary, with the hooks it reads. */
function renderPage(search: string): void {
  const config = {
    eventSlug: EVENT,
    eventName: "AI Engineer New York 2026",
    timezone: "America/New_York",
    days: [{ date: "2026-10-13", label: "TUE OCT 13" }],
    view: "mine",
    claimEnabled: true,
    turnstileSiteKey: null,
  };
  dom.body.innerHTML = `
    <div data-public-schedule='${JSON.stringify(config)}'>
      <div class="sched-note" data-schedule-import hidden>
        <span data-schedule-import-message></span>
        <button type="button" data-schedule-action="import"></button>
      </div>
      <div class="identity-line" data-schedule-identity hidden>
        <span data-schedule-identity-copy></span>
        <button data-schedule-identity-action></button>
      </div>
      <div data-schedule-summary hidden><span data-schedule-counts></span></div>
      <div data-schedule-glance hidden></div>
      <div data-schedule-scrim></div>
      <div data-schedule-sheet="share"><p data-schedule-error hidden></p>
        <div data-schedule-claim-row><div data-schedule-claim-controls></div></div>
      </div>
      <section data-schedule-list></section>
      <section data-schedule-empty hidden></section>
    </div>`;
  const url = `http://localhost/agenda?${search}`;
  globalThis.history.replaceState(null, "", url.slice("http://localhost".length));
  // eslint-disable-next-line no-new-func -- the shipped artifact is a string; running it is the point.
  new Function(PUBLIC_SCHEDULE_SCRIPT)();
}

/**
 * Each render installs a FRESH instance of the module, and the old ones stay
 * bound to `document` — the script is a self-installing IIFE with no teardown,
 * which is correct for a page that is thrown away on navigation and awkward
 * exactly once here. So the single test that dispatches a real DOM event runs
 * first, before any other instance is listening. Everything after it asserts on
 * storage and on the requests its own render made.
 */
const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
};

beforeEach(() => {
  routes = [];
  calls = [];
  store.clear();
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("sessionStorage", memoryStorage());
  stubFetch();
});

afterEach(() => {
  // The globals stay stubbed for the whole file on purpose. Restoring the real
  // fetch lets a stale instance's deferred beacon fire against nothing and
  // print a connection error that looks like a failure and is not one.
  dom.body.innerHTML = "";
});

test("CONTRACT · MRQ-208 a star placed while an adoption is pending is never pushed over the adopted code", async () => {
  store.setItem(STORAGE, JSON.stringify({
    v: 1, sessionIds: ["ses-own"], code: Y, writeKey: Y_KEY, feedToken: null, adoptPending: true,
  }));
  routes.push((url, init) => (url.includes(`/schedules/${Y}`) && (init?.method ?? "GET") === "GET"
    ? { status: 503, body: {} }
    : undefined));

  renderPage(`event=${EVENT}&view=mine`);
  await flush();
  vi.useFakeTimers();
  dom.body.insertAdjacentHTML("beforeend", '<button data-schedule-star="ses-new"></button>');
  (dom.querySelector("[data-schedule-star]") as HTMLElement).click();
  vi.advanceTimersByTime(2000);
  vi.useRealTimers();
  await flush();

  // The local star is kept; the PUT that would have replaced Y's own sessions
  // with this device's set is not sent until the merge has actually happened.
  expect(JSON.parse(store.getItem(STORAGE) ?? "{}").sessionIds).toContain("ses-new");
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
});

test("CONTRACT · MRQ-208 a recovery link verifies against the MAIL's schedule, not whatever this device already holds", async () => {
  // This device already owns X. The mail is for Y.
  store.setItem(STORAGE, JSON.stringify({ v: 1, sessionIds: ["ses-own"], code: X, writeKey: X_KEY, feedToken: null }));

  routes.push((url, init) => {
    if (url.endsWith(`/schedules/${Y}/claim/verify`) && init?.method === "POST") {
      return { body: { claim: { status: "verified", maskedEmail: "a…v@example.com" }, speakingSessionIds: [], writeKey: Y_KEY, feedToken: "feed-y" } };
    }
    if (url.includes(`/schedules/${Y}`) && (init?.method ?? "GET") === "GET") {
      return { body: { code: Y, sessions: [{ id: "ses-theirs" }], claim: { status: "verified", maskedEmail: "a…v@example.com" }, speakingSessionIds: [], feedToken: "feed-y" } };
    }
    return undefined;
  });

  renderPage(`event=${EVENT}&sched=${Y}&claim=TOKEN`);
  await flush();

  // The verify must have gone to Y. Gated on `!state.code`, it went to X and
  // answered 404 — a dead end on the one journey the claim exists for.
  const verify = calls.find((call) => call.url.includes("/claim/verify"));
  expect(verify?.url).toContain(`/schedules/${Y}/claim/verify`);
  expect(verify?.url).not.toContain(X);

  const state = JSON.parse(store.getItem(STORAGE) ?? "{}");
  expect(state.code).toBe(Y);
  expect(state.writeKey).toBe(Y_KEY);
  expect(state.feedToken).toBe("feed-y");
  // Union, never replace.
  expect([...state.sessionIds].sort()).toEqual(["ses-own", "ses-theirs"]);
  expect(state.adoptPending).toBe(false);
  expect(dom.querySelector("[data-schedule-import-message]")?.textContent).toContain(Y);
});

test("CONTRACT · MRQ-208 an adoption whose owner read fails keeps its picks and finishes on the next load", async () => {
  store.setItem(STORAGE, JSON.stringify({ v: 1, sessionIds: ["ses-own"], code: X, writeKey: X_KEY, feedToken: null }));

  // Verification succeeds; the read that carries Y's sessions does not.
  routes.push((url, init) => {
    if (url.endsWith(`/schedules/${Y}/claim/verify`) && init?.method === "POST") {
      return { body: { claim: { status: "verified", maskedEmail: "a…v@example.com" }, speakingSessionIds: [], writeKey: Y_KEY, feedToken: "feed-y" } };
    }
    if (url.includes(`/schedules/${Y}`) && (init?.method ?? "GET") === "GET") return { status: 503, body: {} };
    return undefined;
  });

  renderPage(`event=${EVENT}&sched=${Y}&claim=TOKEN`);
  await flush();

  const mid = JSON.parse(store.getItem(STORAGE) ?? "{}");
  expect(mid.code).toBe(Y);
  // The intent survives the tab. Held only in memory, it died here — and the
  // next star pushed this device's old set over the schedule just recovered.
  expect(mid.adoptPending).toBe(true);
  expect(calls.some((call) => call.method === "PUT")).toBe(false);

  // Second load, network back: the adoption finishes itself.
  calls = [];
  routes = [(url, init) => (url.includes(`/schedules/${Y}`) && (init?.method ?? "GET") === "GET"
    ? { body: { code: Y, sessions: [{ id: "ses-theirs" }], claim: { status: "verified", maskedEmail: "a…v@example.com" }, speakingSessionIds: [], feedToken: "feed-y" } }
    : undefined)];
  renderPage(`event=${EVENT}&view=mine`);
  await flush();

  const done = JSON.parse(store.getItem(STORAGE) ?? "{}");
  expect([...done.sessionIds].sort()).toEqual(["ses-own", "ses-theirs"]);
  expect(done.adoptPending).toBe(false);
});
