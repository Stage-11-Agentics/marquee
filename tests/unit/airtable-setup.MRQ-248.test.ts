// @vitest-environment happy-dom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";

import { mirrorActionFailureError, mirrorTableSummaries } from "../../src/routes/mirror.routes";
import { AirtablePage, mergeSetupProgress, mirrorSetupErrorSummary } from "../../src/ui/settings/AirtablePage";
import { MarqueeApiError } from "../../src/ui/shell/api-client";

const dom = globalThis.document;
let root: HTMLElement | null = null;

function mount(node: ReturnType<typeof h>): void {
  root = dom.createElement("div");
  document.body.appendChild(root);
  act(() => render(node, root!));
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function progress(role: "submissions" | "speaker_tasks" | "people", state: "created" | "adopted" | "complete") {
  return {
    role,
    label: role,
    table_id: `tbl_${role}`,
    state,
    expected_field_count: 1,
    conformant_field_count: 1,
    fields: [{ name: "marquee_id", state: state === "created" ? "created" as const : "adopted" as const }],
    missing_fields: [],
    organizer_fields: ["Organizer notes"],
    conflicts: [],
  };
}

test("MRQ-248 · setup progress keeps earlier per-column creation receipts across continuations", () => {
  const merged = mergeSetupProgress(
    [progress("submissions", "created")],
    [progress("submissions", "adopted"), progress("speaker_tasks", "complete")],
  );
  expect(merged.map((row) => row.role)).toEqual(["submissions", "speaker_tasks"]);
  expect(merged[0]).toMatchObject({
    state: "created",
    fields: [{ name: "marquee_id", state: "created" }],
    organizer_fields: ["Organizer notes"],
  });
  expect(merged[1]).toMatchObject({ state: "complete" });
});

test("MRQ-248 · schema mutation 403 and 429 envelopes keep only safe setup copy and retry progress", () => {
  const progressRows = [progress("submissions", "created")];
  const forbidden = mirrorActionFailureError({
    ok: false,
    field: "tables",
    code: "provider_forbidden",
    message: "Airtable denied schema.bases:write while adopting submissions.",
    details: { progress: progressRows },
  });
  expect(forbidden).toMatchObject({
    code: "forbidden",
    message: "Airtable denied schema.bases:write while adopting submissions.",
    details: { mirror_setup: true, progress: progressRows },
  });

  const limited = mirrorActionFailureError({
    ok: false,
    field: "tables",
    code: "rate_limited",
    retryable: true,
    message: "Airtable is rate-limiting schema setup for submissions; wait a moment and retry this table.",
    details: { continuation: "submissions", progress: progressRows },
  });
  expect(limited).toMatchObject({
    code: "rate_limited",
    headers: { "Retry-After": "1" },
    details: { mirror_setup: true, retryable: true, continuation: "submissions", progress: progressRows },
  });

  const clientError = new MarqueeApiError({
    code: limited.code,
    message: limited.message,
    status: limited.status,
    field: limited.field,
    details: limited.details,
    route: "/api/v1/mirror/mapping",
    requestId: "req_mrq248",
    serverAuthored: true,
  });
  const summary = mirrorSetupErrorSummary(clientError);
  expect(summary).toContain("Airtable is rate-limiting schema setup for submissions");
  expect(summary).not.toContain("provider-private");
});

test("MRQ-248 · rendered setup keeps three rows from empty-base offer through the completed report", async () => {
  const roles = ["submissions", "speaker_tasks", "people"] as const;
  const counts = { submissions: 27, speaker_tasks: 19, people: 17 } as const;
  const tables = roles.map((role) => ({ id: `tbl_${role}`, name: role, fields: [] }));
  const readiness = (ready: boolean) => ({
    needs_provisioning: !ready,
    provisionable: true,
    max_conformant_roles: ready ? 3 : 0,
    roles: roles.map((role) => ({
      role,
      label: role,
      expected_field_count: counts[role],
      candidate_table_ids: ready ? [`tbl_${role}`] : [],
      selected_table_id: ready ? `tbl_${role}` : null,
      state: ready ? "ready" : "missing",
      conflict: null,
    })),
  });
  const setupProgress = (state: "created" | "complete", fieldState: "created" | "adopted") => roles.map((role) => ({
    role,
    label: role,
    table_id: `tbl_${role}`,
    state,
    expected_field_count: counts[role],
    conformant_field_count: counts[role],
    fields: [{ name: "marquee_id", state: fieldState }],
    missing_fields: [],
    organizer_fields: role === "submissions" ? ["Organizer notes"] : [],
    conflicts: [],
  }));
  const disconnectedStatus = {
    base_id: null,
    base_url: null,
    configured: false,
    last_error: null,
    last_sync_at: null,
    last_verified_at: null,
    mapped: false,
    rejected_edits: 0,
    recent_rejections: [],
    queued: 0,
    set_at: null,
    stuck: 0,
    tables: [],
    token_fingerprint: null,
    traffic_assisted: false,
    webhook_expires_at: null,
  };
  const requestBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url === "/api/v1/mirror/status") return okResponse({ data: disconnectedStatus });
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requestBodies.push(body);
    if (url === "/api/v1/mirror/connect" && body.intent === "verify") {
      return okResponse({ data: { base_id: "app_mrq248", tables: [], needs_provisioning: true, readiness: readiness(false) } });
    }
    if (url === "/api/v1/mirror/connect" && body.intent === "provision") {
      return okResponse({ data: {
        base_id: "app_mrq248",
        tables,
        needs_provisioning: false,
        readiness: readiness(true),
        progress: setupProgress("created", "created"),
        table_actions: roles.map((role) => ({ role, table_id: `tbl_${role}`, outcome: "created" })),
      } });
    }
    if (url === "/api/v1/mirror/mapping") {
      return okResponse({ data: {
        base_id: "app_mrq248",
        mapped: true,
        tables,
        needs_provisioning: false,
        readiness: readiness(true),
        progress: setupProgress("complete", "adopted"),
        continuation: null,
        complete: true,
      } });
    }
    throw new Error(`unexpected request ${url}`);
  }));

  mount(h(AirtablePage, { navigate: vi.fn() }));
  await settle();

  const token = root!.querySelector('input[type="password"]') as HTMLInputElement;
  const baseId = root!.querySelector('input[placeholder="app…"]') as HTMLInputElement;
  act(() => {
    token.value = "pat_hermetic";
    token.dispatchEvent(new Event("input", { bubbles: true }));
    baseId.value = "app_mrq248";
    baseId.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    root!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();

  expect(root!.querySelectorAll(".airtable-setup-progress-row")).toHaveLength(3);
  const provision = [...root!.querySelectorAll("button")].find((button) => button.textContent === "Create the three tables for me") as HTMLButtonElement | undefined;
  expect(provision).toBeDefined();

  act(() => provision!.click());
  await settle();
  expect(root!.querySelectorAll(".airtable-setup-progress-row")).toHaveLength(3);
  const turnOn = [...root!.querySelectorAll("button")].find((button) => button.textContent === "Turn on mirror") as HTMLButtonElement | undefined;
  expect(turnOn?.disabled).toBe(false);

  act(() => turnOn!.click());
  await settle();
  expect(root!.textContent).toContain("Mirror setup report");
  const finalRows = [...root!.querySelectorAll(".airtable-setup-progress-row")];
  expect(finalRows).toHaveLength(3);
  expect(finalRows.map((row) => row.querySelector("strong")?.textContent)).toEqual(["Submissions", "Speaker tasks", "People"]);
  expect(root!.querySelector(".airtable-setup-progress-row small")?.textContent).toBe("added marquee_id · kept 1 organizer column");
  expect(requestBodies.map((body) => body.intent)).toEqual(["verify", "provision", "adopt"]);
});

test("MRQ-248 · route table summaries preserve unknown schema as null, distinct from known empty fields", () => {
  expect(mirrorTableSummaries([{ id: "tbl_unknown", name: "Submissions" }])).toEqual([
    { id: "tbl_unknown", name: "Submissions", fields: null },
  ]);
  expect(mirrorTableSummaries([{ id: "tbl_empty", name: "Submissions", fields: [] }])).toEqual([
    { id: "tbl_empty", name: "Submissions", fields: [] },
  ]);
});
