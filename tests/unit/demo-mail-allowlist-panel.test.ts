// @vitest-environment happy-dom

/**
 * The real-email panel, mounted.
 *
 * The node suite beside this one greps source text, and a review proved what
 * that is worth: deleting `class="allowlist-listing"` disconnects the only rule
 * that fixes the listing's height — rows then reflow the panel — and every
 * source-grep assertion still passed. So the claims that matter are made here
 * against the rendered DOM of the real component, driven through real state,
 * with the real stylesheet attached.
 *
 * What this does NOT do is measure pixels. happy-dom has no layout engine, and
 * the one thing in this repository that could measure — Playwright — has no
 * browser installed in CI and an e2e runner that demands a deployed URL the
 * moment `tests/e2e` gains a spec. So the reflow claim is held here by its
 * mechanism: the rows live inside an element that the stylesheet gives a fixed
 * height and a scroll, and nothing rendered after that element changes when
 * rows come and go. A pixel-measured version belongs in an e2e suite that can
 * actually launch a browser; see the PR body.
 */

import { readFileSync } from "node:fs";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../src/ui/shell/api-client", async () => {
  const actual = await vi.importActual<typeof import("../../src/ui/shell/api-client")>("../../src/ui/shell/api-client");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../src/ui/shell/api-client";
import { DemoMailAllowlist } from "../../src/ui/comms/DemoMailAllowlist";

const COMMS_CSS = readFileSync(fileURLToPath(new NodeURL("../../src/ui/comms/comms.css", import.meta.url)), "utf8");

// tsconfig.test intentionally uses Worker globals without DOM lib types. The
// happy-dom environment supplies the real DOM at runtime; keep that boundary
// explicit instead of mixing two incompatible DOM class hierarchies.
const dom = globalThis.document as any;
let mountedRoot: any = null;

afterEach(() => {
  if (mountedRoot) render(null, mountedRoot);
  mountedRoot = null;
  dom.head.querySelectorAll("style[data-allowlist-test]").forEach((style: any) => style.remove());
  dom.body.innerHTML = "";
  vi.resetAllMocks();
});

/**
 * Twice, deliberately. The panel's load resolves the fetch on one microtask and
 * clears `loading` in a `.finally()` on the next, so a single flush leaves the
 * component still rendering its loading state and every assertion below would
 * be made against a skeleton.
 */
async function settle(): Promise<void> {
  for (let flush = 0; flush < 2; flush += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

function addresses(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `listed-${index}@example.org`);
}

/** Mounts the real panel with the list the API would have returned. */
async function mountWith(emails: string[]): Promise<any> {
  vi.mocked(apiFetch).mockResolvedValue({ data: { demo_mode: true, limit: 10, emails } } as never);
  const root = dom.createElement("div");
  const style = dom.createElement("style");
  style.dataset.allowlistTest = "true";
  style.textContent = COMMS_CSS;
  dom.head.append(style);
  dom.body.append(root);
  mountedRoot = root;
  render(h(DemoMailAllowlist, { eventId: "evt_panel" }), root);
  await settle();
  return root;
}

/** The declaration block for one selector, as the shipped stylesheet writes it. */
function ruleFor(selector: string): string {
  const match = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(COMMS_CSS);
  expect(match, `no CSS rule for ${selector}`).not.toBeNull();
  return match![1];
}

test("CONTRACT · the rows are rendered inside the element the stylesheet gives a fixed height", async () => {
  // The mutation this exists to catch: drop the class from the component and
  // the rows are no longer inside anything that bounds their height.
  const listingRule = ruleFor(".allowlist-listing");
  expect(listingRule).toMatch(/height:\s*\d+px/);
  expect(listingRule).toMatch(/overflow-y:\s*auto/);
  expect(listingRule).not.toMatch(/min-height/);

  for (const count of [0, 1, 5]) {
    const root = await mountWith(addresses(count));
    const listing = root.querySelector(".allowlist-listing");
    expect(listing, `no fixed-height listing rendered with ${count} rows`).not.toBeNull();
    expect(root.querySelectorAll(".allowlist-row").length).toBe(count);
    // Every row is INSIDE it — a row rendered as a sibling would grow the panel
    // even with the class present.
    for (const row of root.querySelectorAll(".allowlist-row")) {
      expect(listing.contains(row)).toBe(true);
    }
    render(null, root);
    mountedRoot = null;
  }
});

test("CONTRACT · adding and removing rows changes nothing rendered beside the listing", async () => {
  const shapes = new Map<number, string>();
  for (const count of [0, 1, 5]) {
    const root = await mountWith(addresses(count));
    const listing = root.querySelector(".allowlist-listing");
    // Everything after the listing — the label, the input, the button, the
    // reserved note — must be identical whatever the list holds.
    const after: string[] = [];
    let node = listing.nextElementSibling;
    while (node) {
      after.push(node.outerHTML);
      node = node.nextElementSibling;
    }
    // ...and the listing's own box is a constant in the markup too: same
    // element, same classes, only its children differ.
    shapes.set(count, `${listing.className}\u0000${after.join("")}`);
    render(null, root);
    mountedRoot = null;
  }
  expect(shapes.get(1)).toBe(shapes.get(0));
  expect(shapes.get(5)).toBe(shapes.get(0));
});

test("CONTRACT · the empty state fills the same box rather than collapsing it", async () => {
  const root = await mountWith([]);
  const listing = root.querySelector(".allowlist-listing");
  const empty = listing.querySelector(".allowlist-empty");
  expect(empty).not.toBeNull();
  expect(empty.textContent).toMatch(/No address receives real email/);
  expect(ruleFor(".allowlist-empty")).toMatch(/height:\s*100%/);
});

test("CONTRACT · a typed address is validated in the browser, and an invalid one is never sent", async () => {
  const root = await mountWith([]);
  const input = root.querySelector("#comms-allowlist-input");
  const form = root.querySelector("form.allowlist-add");
  vi.mocked(apiFetch).mockClear();

  input.value = "not-an-address";
  await act(async () => {
    input.dispatchEvent(new (globalThis as any).Event("input", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new (globalThis as any).Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();

  // The refusal is stated where the address was typed...
  const note = root.querySelector(".allowlist-note");
  expect(note.textContent).toBe("not-an-address is not a complete email address.");
  expect(note.className).toContain("tone-error");
  // ...and nothing was written. A rejected address must not reach the server,
  // let alone the stored list.
  expect(apiFetch).not.toHaveBeenCalled();
  expect(root.querySelectorAll(".allowlist-row").length).toBe(0);
});

test("CONTRACT · a rejection quotes back a bounded amount of what was pasted", async () => {
  const root = await mountWith([]);
  const input = root.querySelector("#comms-allowlist-input");
  const form = root.querySelector("form.allowlist-add");

  input.value = "x".repeat(254);
  await act(async () => {
    input.dispatchEvent(new (globalThis as any).Event("input", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new (globalThis as any).Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();

  const note = root.querySelector(".allowlist-note");
  expect(note.textContent).toBe(`${"x".repeat(47)}… is not a complete email address.`);
  // The reserved box scrolls rather than hiding, so a long message is reachable
  // instead of silently eaten.
  const noteRule = ruleFor(".allowlist-note");
  expect(noteRule).toMatch(/overflow-y:\s*auto/);
  expect(noteRule).not.toMatch(/overflow:\s*hidden/);
  // And the keyboard cannot outrun the schema in the first place.
  expect(input.getAttribute("maxlength")).toBe("254");
});

test("CONTRACT · the panel names the one message demo mode never holds", async () => {
  const root = await mountWith([]);
  const copy = root.textContent as string;
  // Claiming universal suppression would contradict a green test: a public
  // submitter's confirmation is written `always_live` and bypasses this list.
  expect(copy).toMatch(/when somebody submits your public form, their\s+confirmation goes to the address they typed/);
  expect(copy).not.toMatch(/every message[^.]*is held/i);
});
