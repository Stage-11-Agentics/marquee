// @vitest-environment happy-dom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { renderToString } from "preact-render-to-string";
import { afterEach, expect, test, vi } from "vitest";

import { OnboardingPage, reconcileOnboardingSelection, reconcileOnboardingSelectionForView, shouldApplyOnboardingSnapshot } from "../../src/ui/onboarding/OnboardingPage";

const dom = globalThis.document as any;
let root: any;

const row = {
  id: "row-a",
  person: { id: "person-a", name: "Ada Lovelace", email: "ada@example.test", title: null, company: null, bio: null, headshot_attachment_id: null },
  wave: null,
  tracks: [],
  sessions: [],
  submission_ids: [],
  tasks: [],
  cells: {},
  last_contact: null,
  owed_count: 0,
  done_count: 0,
  overdue_task_count: 0,
  risk_task_count: 0,
  severity: 0,
};

const snapshot = {
  data: [row],
  page: 1,
  per_page: 50,
  total: 1,
  total_pages: 1,
  generated_at: 0,
  risk_window_days: 14,
  metrics: { accepted_speakers: 1, overdue_tasks: 0, at_risk: 0, ready_to_schedule: 0 },
  counts: { all: 1, overdue: 0, incomplete: 0, risk: 0 },
  facets: { task_types: [], tracks: [] },
  task_templates: [],
};

const secondRow = {
  ...row,
  id: "row-b",
  person: { ...row.person, id: "person-b", name: "Grace Hopper", email: "grace@example.test" },
};

function snapshotFor(data: Array<typeof row>, page = 1, totalPages = 1): typeof snapshot {
  return { ...snapshot, data, page, total: totalPages === 1 ? data.length : 51, total_pages: totalPages };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as unknown as Response;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("CONTRACT · MRQ-215 · a poll removes disappeared visible rows but keeps intentional off-page selection", () => {
  const selected = new Set(["visible-removed", "visible-kept", "off-page"]);
  const previousVisible = new Set(["visible-removed", "visible-kept"]);
  const nextRows = [{ id: "visible-kept" }, { id: "new-visible" }];

  expect([...reconcileOnboardingSelection(selected, previousVisible, nextRows)]).toEqual(["visible-kept", "off-page"]);
});

test("CONTRACT · MRQ-215 · a revisited page reconciles against its last visible snapshot", () => {
  const selected = new Set(["removed-on-page-1", "kept-on-page-1", "page-2"]);
  const visibleRowsByView = new Map([
    ["page-1", new Set(["removed-on-page-1", "kept-on-page-1"])],
    ["page-2", new Set(["page-2"])],
  ]);

  expect([...reconcileOnboardingSelectionForView(selected, visibleRowsByView, "page-1", [{ id: "kept-on-page-1" }])]).toEqual(["kept-on-page-1", "page-2"]);
  expect([...reconcileOnboardingSelectionForView(selected, visibleRowsByView, "new-page", [{ id: "new-row" }])]).toEqual(["removed-on-page-1", "kept-on-page-1", "page-2"]);
});

test("CONTRACT · MRQ-215 · an obsolete poll cannot apply after a newer request wins", () => {
  const first = new AbortController();
  const second = new AbortController();
  first.abort();

  expect(shouldApplyOnboardingSnapshot(false, second, first)).toBe(false);
  expect(shouldApplyOnboardingSnapshot(false, second, second)).toBe(true);
  expect(shouldApplyOnboardingSnapshot(true, second, second)).toBe(false);
});

test("CONTRACT · MRQ-215 · a slower poll cannot overwrite a newer board snapshot", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const pending: Array<(response: Response) => void> = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))));
  root = dom.createElement("div");
  document.body.appendChild(root);

  act(() => render(h(OnboardingPage, { eventId: "evt_mrq215" }), root));
  expect(pending).toHaveLength(1);
  act(() => pending[0]!(okResponse(snapshot)));
  await settle();
  expect(root.textContent).toContain("Ada Lovelace");

  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(pending).toHaveLength(3);
  act(() => pending[2]!(okResponse(snapshotFor([secondRow]))));
  await settle();
  expect(root.textContent).toContain("Grace Hopper");

  act(() => pending[1]!(okResponse(snapshot)));
  await settle();
  expect(root.textContent).toContain("Grace Hopper");
  expect(root.textContent).not.toContain("Ada Lovelace");
});

test("CONTRACT · MRQ-215 · revisiting a page prunes a row removed while it was away", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const pending: Array<(response: Response) => void> = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))));
  root = dom.createElement("div");
  document.body.appendChild(root);

  act(() => render(h(OnboardingPage, { eventId: "evt_mrq215" }), root));
  act(() => pending[0]!(okResponse(snapshotFor([row], 1, 2))));
  await settle();
  const rowCheckbox = root.querySelector('input[aria-label^="Select "]');
  act(() => rowCheckbox.dispatchEvent(new Event("change", { bubbles: true })));
  const next = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Next") as HTMLButtonElement;
  act(() => next.click());
  expect(pending).toHaveLength(2);
  act(() => pending[1]!(okResponse(snapshotFor([secondRow], 2, 2))));
  await settle();

  const previous = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Previous") as HTMLButtonElement;
  act(() => previous.click());
  expect(pending).toHaveLength(3);
  act(() => pending[2]!(okResponse(snapshotFor([], 1, 1))));
  await settle();

  const clear = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Clear selection") as HTMLButtonElement;
  const reminder = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Send reminder (1)") as HTMLButtonElement | undefined;
  expect(clear.disabled).toBe(true);
  expect(reminder).toBeUndefined();
});

test("CONTRACT · MRQ-215 · the clear control removes a mounted selection", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => snapshot })));
  root = dom.createElement("div");
  document.body.appendChild(root);

  act(() => render(h(OnboardingPage, { eventId: "evt_mrq215" }), root));
  await settle();

  const rowCheckbox = root.querySelector('input[aria-label^="Select "]');
  expect(rowCheckbox).not.toBeNull();
  act(() => rowCheckbox.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();

  const clear = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Clear selection") as HTMLButtonElement | undefined;
  const reminder = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Send reminder (1)") as HTMLButtonElement | undefined;
  expect(clear?.disabled).toBe(false);
  expect(reminder?.disabled).toBe(false);

  act(() => clear?.click());
  expect(clear?.disabled).toBe(true);
  expect(reminder?.disabled).toBe(true);
});

test("CONTRACT · MRQ-215 · selection recovery stays discoverable before data arrives", () => {
  const rendered = renderToString(h(OnboardingPage, { eventId: "evt_mrq215" }));

  expect(rendered).toContain("Clear selection");
  expect(rendered).toContain("onboarding-selection-clear");
});
