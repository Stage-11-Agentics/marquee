// @vitest-environment happy-dom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../src/ui/shell/api-client", async () => {
  const actual = await vi.importActual<typeof import("../../src/ui/shell/api-client")>("../../src/ui/shell/api-client");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../src/ui/shell/api-client";
import { FormsPage } from "../../src/ui/forms/FormsPage";

const dom = globalThis.document as any;
let mountedRoot: any = null;

afterEach(() => {
  if (mountedRoot) render(null, mountedRoot);
  mountedRoot = null;
  dom.body.innerHTML = "";
  vi.resetAllMocks();
});

async function settle(): Promise<void> {
  for (let flush = 0; flush < 8; flush += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

const form = {
  id: "form-1",
  event_id: "event-1",
  name: "Call for speakers",
  slug: "call-for-speakers",
  kind: "abstract" as const,
  status: "draft" as const,
  opens_at: null,
  closes_at: null,
  welcome_md: "",
  per_submitter_limit: 3,
  submitter_limit_inherit: false,
  effective_submitter_limit: 3,
  min_speakers: 1,
  max_speakers: 4,
  max_sponsors: 0,
  response_count: 0,
  visibility: "private" as const,
  public_url: null,
  created_at: 1,
  updated_at: 1,
  reminder_offset_hours: null,
  thankyou_template_key: null,
  admin_notify_person_ids: [],
  turnstile_required: true,
  fields: [],
  admins: [],
  preview_fields: [],
};

const rule = {
  id: "rule-vendor-content",
  event_id: "event-1",
  name: "Vendor content review",
  when_json: { all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] },
  then_json: { track_id: null, add_tag_ids: [], level_id: null, plan_id: null, committee_id: null, round_id: null },
  position: 0,
  enabled: true,
  dangling_references: [],
  dangling_reason: null,
  summary: "Vendor content equals Yes",
  updated_at: 1,
};

function installApi(): Set<string> {
  const calls = new Set<string>();
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    calls.add(path);
    if (path === "/api/v1/instance/status") return { data: { rows: [{ key: "mail", configured: true }] } } as never;
    if (path.startsWith("/api/v1/events/event-1/forms?page=")) return { data: [form] } as never;
    if (path === "/api/v1/events/event-1/forms/form-1") return form as never;
    if (path.startsWith("/api/v1/events/event-1/field-library")) return { data: [] } as never;
    if (path === "/api/v1/events/event-1/routing-rules") return { data: [rule] } as never;
    if (path === "/api/v1/events/event-1/tracks") throw new Error("route returned 404");
    if (path === "/api/v1/events/event-1/tags" || path === "/api/v1/events/event-1/levels") return { data: [] } as never;
    if (path.startsWith("/api/v1/events/event-1/plans?")) return { data: [] } as never;
    if (path === "/api/v1/events/event-1/forms/form-1/routing-preview") return {
      data: { form_id: "form-1", sample_size: 0, last_arrival_at: null, max_sample_size: 100, rules: [] },
    } as never;
    throw new Error(`unexpected FormsPage request: ${path}`);
  });
  return calls;
}

test("CONTRACT · MRQ-265 · a failed secondary lookup leaves the returned rules visible", async () => {
  const calls = installApi();
  const root = dom.createElement("div");
  dom.body.append(root);
  mountedRoot = root;
  render(h(FormsPage, { eventId: "event-1" }), root);
  await settle();

  const routingStep = [...root.querySelectorAll("button")].find((button: any) => button.textContent?.endsWith("Rules & routing")) as any;
  expect(routingStep).toBeDefined();
  await act(async () => {
    routingStep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();

  expect(calls).toContain("/api/v1/events/event-1/routing-rules");
  expect(calls).toContain("/api/v1/events/event-1/tracks");
  expect(calls).not.toContain("/api/v1/events/event-1/settings");
  expect(root.querySelectorAll(".forms-rule-row")).toHaveLength(1);
  expect(root.textContent).toContain("Vendor content review");
  expect(root.textContent).toContain("Track destinations unavailable");
  expect(root.textContent).not.toContain("No routing rules yet");
});
