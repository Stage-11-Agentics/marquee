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
  for (let flush = 0; flush < 6; flush += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

interface FormFixture {
  id: string;
  event_id: string;
  name: string;
  slug: string;
  kind: "abstract";
  status: "draft";
  opens_at: null;
  closes_at: null;
  welcome_md: string;
  per_submitter_limit: number;
  submitter_limit_inherit: boolean;
  effective_submitter_limit: number;
  min_speakers: number;
  max_speakers: number;
  max_sponsors: number;
  response_count: number;
  visibility: "private";
  public_url: null;
  created_at: number;
  updated_at: number;
  reminder_offset_hours: null;
  thankyou_template_key: null;
  admin_notify_person_ids: string[];
  turnstile_required: boolean;
  fields: [];
  admins: [];
  preview_fields: [];
}

function formFixture(overrides: Partial<FormFixture> = {}): FormFixture {
  return {
    id: "form-legacy",
    event_id: "event-1",
    name: "Call for speakers",
    slug: "call-for-speakers",
    kind: "abstract",
    status: "draft",
    opens_at: null,
    closes_at: null,
    welcome_md: "",
    per_submitter_limit: 0,
    submitter_limit_inherit: false,
    effective_submitter_limit: 0,
    min_speakers: 1,
    max_speakers: 4,
    max_sponsors: 0,
    response_count: 0,
    visibility: "private",
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
    ...overrides,
  };
}

function installApi(form: FormFixture): { patchBodies: Record<string, unknown>[]; acceptedBodies: Record<string, unknown>[] } {
  let current = { ...form };
  const patchBodies: Record<string, unknown>[] = [];
  const acceptedBodies: Record<string, unknown>[] = [];
  vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
    const method = String(options.method ?? "GET").toUpperCase();
    if (path === "/api/v1/instance/status") return { data: { rows: [{ key: "mail", configured: true }] } } as never;
    if (method === "PATCH") {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      patchBodies.push(body);
      const limit = body.per_submitter_limit;
      // This is the route boundary the component calls. It mirrors the
      // production patch schema's bounded writer so raw legacy zero is a real
      // rejected request, not merely an assertion about an object in memory.
      if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100)) {
        throw new Error("patchFormSchema rejected per_submitter_limit");
      }
      if (body.submitter_limit_inherit !== undefined && typeof body.submitter_limit_inherit !== "boolean") {
        throw new Error("patchFormSchema rejected submitter_limit_inherit");
      }
      current = {
        ...current,
        ...body,
        per_submitter_limit: typeof body.per_submitter_limit === "number" ? body.per_submitter_limit : current.per_submitter_limit,
        submitter_limit_inherit: typeof body.submitter_limit_inherit === "boolean" ? body.submitter_limit_inherit : current.submitter_limit_inherit,
        effective_submitter_limit: body.submitter_limit_inherit === true ? 3 : typeof body.per_submitter_limit === "number" ? body.per_submitter_limit : current.effective_submitter_limit,
      } as FormFixture;
      acceptedBodies.push(body);
      return current as never;
    }
    if (path.includes("/forms?page=")) return { data: [current], page: 1, per_page: 100, total: 1, total_pages: 1 } as never;
    if (path.endsWith(`/forms/${current.id}`)) return current as never;
    throw new Error(`unexpected FormsPage request: ${method} ${path}`);
  });
  return { patchBodies, acceptedBodies };
}

function mountPage(): any {
  const root = dom.createElement("div");
  dom.body.append(root);
  mountedRoot = root;
  render(h(FormsPage, { eventId: "event-1" }), root);
  return root;
}

function buttonWithText(root: any, text: string): any {
  return [...root.querySelectorAll("button")].find((button: any) => button.textContent === text);
}

test("CONTRACT · MRQ-245 · legacy raw zero can transition to conference default through the real save request", async () => {
  // Explicit legacy state: a pre-floor row, not a freshly created form.
  const network = installApi(formFixture({ per_submitter_limit: 0, submitter_limit_inherit: false, effective_submitter_limit: 0 }));
  const root = mountPage();
  await settle();

  const useDefault = buttonWithText(root, "Use conference default");
  expect(useDefault).toBeDefined();
  await act(async () => {
    useDefault.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(root.querySelector(".submission-capacity-editor")?.textContent).toContain("Uses conference default");

  const save = buttonWithText(root, "Save form");
  expect(save).toBeDefined();
  await act(async () => {
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();

  expect(network.acceptedBodies).toHaveLength(1);
  expect(network.acceptedBodies[0]).toMatchObject({ submitter_limit_inherit: true });
  expect(network.acceptedBodies[0].per_submitter_limit).toEqual(expect.any(Number));
  expect(network.acceptedBodies[0].per_submitter_limit as number).toBeGreaterThanOrEqual(1);
  expect(network.acceptedBodies[0].per_submitter_limit as number).toBeLessThanOrEqual(100);
  expect(root.querySelector('[role="status"]')?.textContent ?? "").not.toContain("needs attention");
});

test("CONTRACT · MRQ-245 · explicit finite override remains a bounded whole-object PATCH", async () => {
  const network = installApi(formFixture({ id: "form-explicit", per_submitter_limit: 5, submitter_limit_inherit: false, effective_submitter_limit: 5 }));
  const root = mountPage();
  await settle();

  const input = root.querySelector(".submission-capacity-editor input[type=number]") as any;
  expect(input.value).toBe("5");
  input.value = "9";
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const save = buttonWithText(root, "Save form");
  await act(async () => {
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();

  expect(network.acceptedBodies).toContainEqual(expect.objectContaining({ per_submitter_limit: 9, submitter_limit_inherit: false }));
});
