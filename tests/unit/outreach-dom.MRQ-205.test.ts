// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { h, render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../src/ui/people/people-api", async () => {
  const actual = await vi.importActual<typeof import("../../src/ui/people/people-api")>("../../src/ui/people/people-api");
  return {
    ...actual,
    fetchPeople: vi.fn(),
    fetchSummary: vi.fn(),
    fetchLists: vi.fn(),
  };
});

import { type PeoplePage as PeoplePayload, type Person, fetchLists, fetchPeople, fetchSummary } from "../../src/ui/people/people-api";
import { PeoplePage } from "../../src/ui/people/PeoplePage";
import { OutreachCard } from "../../src/ui/people/SourcingPipelinePage";

const PEOPLE_CSS = readFileSync(fileURLToPath(new NodeURL("../../src/ui/people/people.css", import.meta.url)), "utf8");

// tsconfig.test intentionally uses Worker globals without DOM lib types. The
// happy-dom environment supplies the real DOM at runtime; keep that boundary
// explicit instead of mixing two incompatible DOM class hierarchies.
const dom = globalThis.document as any;
let mountedRoot: any = null;

afterEach(() => {
  if (mountedRoot) render(null, mountedRoot);
  mountedRoot = null;
  dom.head.querySelectorAll("style[data-outreach-test]").forEach((style: any) => style.remove());
  dom.body.innerHTML = "";
  vi.resetAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function mount(element: VNode<any>): any {
  const root = dom.createElement("div");
  const style = dom.createElement("style");
  style.dataset.outreachTest = "true";
  style.textContent = PEOPLE_CSS;
  dom.head.append(style);
  dom.body.append(root);
  mountedRoot = root;
  render(element, root);
  return root;
}

function person(id: string, name: string, doNotContact: boolean): Person {
  return {
    id,
    name,
    email: `${id}@example.test`,
    title: "Staff engineer",
    company: "Signal Cooperative",
    bio: null,
    headshot_attachment_id: null,
    tags: [],
    stage: null,
    do_not_contact: doNotContact,
    outreach_target_event_id: null,
    outreach_target_event_name: null,
    outreach_next_touch_on: null,
    conference_count: 0,
    last_contact_at: null,
    created_at: 1,
    updated_at: 1,
  };
}

function peoplePage(data: Person[], page: number): PeoplePayload {
  return {
    data,
    page,
    per_page: 1,
    total: 2,
    total_pages: 2,
    facets: { company: [], title: [], tag: [] },
  };
}

test("CONTRACT · MRQ-205 · the mounted long-name card contains and drives its stage selector", async () => {
  const name = "Margarethe von Habsburg-Lothringen, Erzherzogin zu Österreich";
  const moved: string[] = [];
  const opened: string[] = [];
  let root!: any;
  await act(async () => {
    root = mount(h(OutreachCard, {
      card: {
        person_id: "per_long",
        name,
        company: "Longform Signal Cooperative",
        stage: "contacted",
        score: 92,
        rationale: null,
        moved_at: 1,
        target_event_id: "evt_devflow",
        target_event_name: "DevFlow Conf 2027 with an exceptionally long conference name",
        next_touch_on: "2026-08-11",
      },
      displayName: name,
      stages: [
        { id: "researching", name: "Researching", kind: "open" },
        { id: "contacted", name: "Contacted", kind: "open" },
      ],
      busy: false,
      onMove: (stage) => moved.push(stage),
      onOpen: () => opened.push("opened"),
    }));
  });
  await settle();

  const card = root.querySelector('[data-outreach-card="true"]') as any;
  const link = root.querySelector(".people-rowlink") as any;
  const selector = root.querySelector(".people-moveto") as any;
  expect(card).not.toBeNull();
  expect(link?.title).toBe(name);
  expect(card?.textContent).toContain("→ DevFlow Conf 2027 with an exceptionally long conference name");
  expect(card?.dataset.overflow).toBe("false");
  expect(card?.contains(selector)).toBe(true);

  const cardStyle = getComputedStyle(card) as any;
  const selectorStyle = getComputedStyle(selector) as any;
  expect(cardStyle.overflow).toBe("hidden");
  expect(cardStyle.minWidth).toBe("0");
  expect(selectorStyle.minWidth).toBe("0");
  expect(selectorStyle.maxWidth).toBe("100%");
  expect(selectorStyle.overflow).toBe("hidden");
  expect(selectorStyle.textOverflow).toBe("ellipsis");

  selector!.value = "researching";
  await act(async () => {
    selector!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  expect(moved).toEqual(["researching"]);

  link!.click();
  expect(opened).toEqual(["opened"]);
});

test("CONTRACT · MRQ-205 · mounted People selection survives a page change into compose", async () => {
  const excludedName = "Margarethe von Habsburg-Lothringen";
  const pageOne = peoplePage([person("per_margarethe", excludedName, true)], 1);
  const pageTwo = peoplePage([person("per_grace", "Grace Isford", false)], 2);
  vi.mocked(fetchPeople).mockImplementation(async (_filters, page) => page === 1 ? pageOne : pageTwo);
  vi.mocked(fetchSummary).mockResolvedValue({ people: 2, conferences: 2, returning_speakers: 0, in_pipeline: 0, top_companies: [] });
  vi.mocked(fetchLists).mockResolvedValue({ data: [] });

  let root!: any;
  await act(async () => {
    root = mount(h(PeoplePage, { navigate: () => undefined }));
  });
  await settle();

  const excludedCheckbox = root.querySelector(`input[aria-label="Select ${excludedName}"]`) as any;
  expect(excludedCheckbox).not.toBeNull();
  await act(async () => {
    excludedCheckbox!.click();
    await Promise.resolve();
  });
  expect(root.textContent).toContain("1 selected");

  const next = [...root.querySelectorAll("button")].find((button: any) => button.textContent?.trim() === "Next") as any;
  expect(next).not.toBeUndefined();
  await act(async () => {
    next!.click();
    await Promise.resolve();
  });
  await settle();

  expect(root.textContent).toContain("Grace Isford");
  expect(root.querySelector(`input[aria-label="Select ${excludedName}"]`)).toBeNull();
  const graceCheckbox = root.querySelector('input[aria-label="Select Grace Isford"]') as any;
  expect(graceCheckbox).not.toBeNull();
  await act(async () => {
    graceCheckbox!.click();
    await Promise.resolve();
  });
  const communicate = [...root.querySelectorAll("button")].find((button: any) => button.textContent?.trim() === "Communicate") as any;
  expect(communicate).not.toBeUndefined();
  await act(async () => {
    communicate!.click();
    await Promise.resolve();
  });

  const dialog = root.querySelector('[role="dialog"]') as any;
  expect(dialog?.textContent).toContain("1 recipient ready");
  expect(dialog?.textContent).toContain(`1 excluded — marked do-not-contact: ${excludedName}`);
});
