// @vitest-environment happy-dom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";

import { CommsScreen } from "../../src/ui/comms/CommsScreen";
import { AgendaPage } from "../../src/ui/agenda/AgendaPage";
import { OnboardingPage } from "../../src/ui/onboarding/OnboardingPage";
import { SetupChecklistCard } from "../../src/ui/setup/SetupChecklistCard";
import { Sidebar } from "../../src/ui/shell/Sidebar";
import { GETTING_STARTED_REPOSITORY_URL } from "../../src/ui/shell/getting-started";
import { useDemoEventPresent } from "../../src/ui/shell/identity";

const dom = globalThis.document as any;
let root: any;

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as unknown as Response;
}

function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && "url" in input) return String((input as { url: unknown }).url);
  return String(input);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

function mount(node: unknown): void {
  root = dom.createElement("div");
  document.body.appendChild(root);
  act(() => render(node as any, root));
}

function DemoSignalProbe(): any {
  const present = useDemoEventPresent();
  return h("span", { "data-demo-event": present === null ? "loading" : String(present) });
}

afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("MRQ-244 · a running program keeps a live compact setup row and routes its next step", async () => {
  const navigate = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = requestUrl(input);
    if (url.includes("/forms")) return okResponse({ data: [{ status: "open" }] });
    if (url.includes("/plans")) return okResponse({ data: [] });
    return okResponse({ data: { event: { name: "Truth Conf" }, formats: [{}], tracks: [{}] } });
  }));

  mount(h(SetupChecklistCard, { eventId: "evt-truth", navigate, inSetup: false }));
  await settle();

  expect(root.querySelector("[data-setup-checklist=compact]")?.textContent).toContain("4 of 5");
  expect(root.textContent).toContain("Plan evaluation is next");

  const next = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Plan evaluation →") as HTMLButtonElement | undefined;
  expect(next).toBeDefined();
  act(() => next?.click());
  expect(navigate).toHaveBeenCalledWith("/evaluation");
});

test("MRQ-244 · completed compact setup remains a reserved slot after dismissal", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = requestUrl(input);
    if (url.includes("/forms")) return okResponse({ data: [{ status: "open" }] });
    if (url.includes("/plans")) return okResponse({ data: [{ id: "plan-1" }] });
    return okResponse({ data: { event: { name: "Truth Conf" }, formats: [{}], tracks: [{}] } });
  }));

  mount(h(SetupChecklistCard, { eventId: "evt-truth", navigate: vi.fn(), inSetup: false }));
  await settle();

  expect(root.textContent).toContain("5 of 5");
  expect(root.textContent).toContain("Conference setup is complete");
  const dismiss = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Dismiss") as HTMLButtonElement | undefined;
  expect(dismiss).toBeDefined();

  act(() => dismiss?.click());
  expect(root.querySelector("[data-setup-checklist=dismissed]")).not.toBeNull();
  expect(root.querySelector("[data-setup-checklist=dismissed]")?.getAttribute("aria-hidden")).toBe("true");
});

const onboardingRow = {
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

function onboardingSnapshot(acceptedSpeakers: number, data = acceptedSpeakers ? [onboardingRow] : []) {
  return {
    data,
    page: 1,
    per_page: 50,
    total: data.length,
    total_pages: 1,
    generated_at: 0,
    risk_window_days: 14,
    metrics: { accepted_speakers: acceptedSpeakers, overdue_tasks: 0, at_risk: 0, ready_to_schedule: 0 },
    counts: { all: data.length, overdue: 0, incomplete: 0, risk: 0 },
    facets: { task_types: [], tracks: [] },
    task_templates: [],
  };
}

test("MRQ-244 · onboarding says acceptance is the prerequisite, not all-clear", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => okResponse(onboardingSnapshot(0))));

  mount(h(OnboardingPage, { eventId: "evt-truth", navigate: vi.fn() }));
  await settle();

  expect(root.textContent).toContain("No accepted speakers yet");
  expect(root.textContent).toContain("Tasks appear when the first acceptance lands");
  expect(root.textContent).toContain("Open submissions");
  expect(root.textContent).not.toContain("Every accepted speaker is clear");
});

test("MRQ-244 · an accepted speaker with no open tasks gets the genuine all-clear", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => okResponse(onboardingSnapshot(1))));

  mount(h(OnboardingPage, { eventId: "evt-truth", navigate: vi.fn() }));
  await settle();

  expect(root.textContent).toContain("Nothing outstanding");
  expect(root.textContent).toContain("Every accepted speaker is clear");
  expect(root.textContent).not.toContain("No accepted speakers yet");
  expect(root.querySelector(".onboarding-matrix")).toBeNull();
});

test("MRQ-244 · communications names the acceptance prerequisite before offering a recipient action", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = requestUrl(input);
    if (url.includes("/templates")) return okResponse({ data: [] });
    if (url.includes("/outbox")) return okResponse({ data: [] });
    if (url.includes("/comms/audience")) return okResponse({ data: [], page: 1, per_page: 100, total: 0, total_pages: 0 });
    return okResponse({});
  }));

  mount(h(CommsScreen, { eventId: "evt-truth" }));
  await settle();

  expect(root.textContent).toContain("No accepted speakers to contact yet");
  expect(root.textContent).toContain("Accept a submission first");
  expect(root.querySelector('a[href="/submissions"]')?.textContent).toBe("Open submissions");
});

test("MRQ-244 · communications does not call an audience failure an empty prerequisite", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = requestUrl(input);
    if (url.includes("/comms/audience")) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) } as unknown as Response;
    if (url.includes("/templates")) return okResponse({ data: [] });
    if (url.includes("/outbox")) return okResponse({ data: [] });
    return okResponse({});
  }));

  mount(h(CommsScreen, { eventId: "evt-truth" }));
  await settle();

  expect(root.querySelector(".comms-prerequisite")).toBeNull();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain("unexpected problem");
});

test("MRQ-244 · agenda empty state opens the unfiltered submissions surface", async () => {
  const snapshot = {
    event: { id: "evt-truth", name: "Truth Conf", starts_on: "2026-09-01", ends_on: "2026-09-02", timezone: "UTC" },
    schedule_window: { outside_window_session_count: 0 },
    publication: { live: 0, not_yet_public: 0, candidates: [], public_agenda_url: "/agenda" },
    schedulable_statuses: ["accepted"],
    rooms: [],
    formats: [],
    tracks: [],
    sessions: [],
    unscheduled: [],
    conflicts: [],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = requestUrl(input);
    if (url.includes("/agenda/demand")) return okResponse({ data: { sessions: [], stats: { imported: 0, synced: 0, via_agents: 0, claimed: 0, advance_picks: 0 }, public_counts: { enabled: false, threshold: 3 } } });
    if (url.endsWith("/agenda")) return okResponse(snapshot);
    return okResponse({});
  }));
  mount(h(AgendaPage, { eventId: "evt-truth" }));
  await settle();

  expect(root.textContent).toContain("Accept a submission first");
  const open = [...root.querySelectorAll("button")].find((button: any) => button.textContent === "Open submissions") as HTMLButtonElement | undefined;
  expect(open).toBeDefined();
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
  act(() => open?.click());
  expect(assign).toHaveBeenCalledWith("/submissions");
  assign.mockRestore();
});

test("MRQ-244 · the shared demo signal hides reset on a non-demo account and keeps the footer reachable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => okResponse({ kind: "session", demo_event_id: null })));
  mount(h(DemoSignalProbe, null));
  await settle();
  expect(root.querySelector("[data-demo-event]")?.getAttribute("data-demo-event")).toBe("false");

  act(() => render(h(Sidebar, {
    eventName: "Truth Conf",
    navigate: vi.fn(),
    resetting: false,
    onReset: vi.fn(),
    showResetDemo: false,
  }), root));
  expect(root.querySelector(".reset-demo-button")).toBeNull();
  expect(root.querySelector(`a[href="${GETTING_STARTED_REPOSITORY_URL}"]`)).not.toBeNull();

  act(() => render(h(Sidebar, {
    eventName: "Truth Conf",
    navigate: vi.fn(),
    resetting: false,
    onReset: vi.fn(),
    showResetDemo: true,
  }), root));
  expect(root.querySelector(".reset-demo-button")).not.toBeNull();
});
