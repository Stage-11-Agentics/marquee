// @vitest-environment happy-dom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { useEffect } from "preact/hooks";

import { lockBodyScroll, useDialogLifecycle } from "../../src/ui/shell/OverlayHosts";

/**
 * Two dialogs can be open at once, and the body scroll lock is one shared
 * property.
 *
 * At <=760px the sidebar is a dialog on every admin route, and "/" opens
 * QuickSearch on top of it. When each dialog saved and restored
 * document.body.style.overflow for itself, the second one saved the "hidden"
 * the first had already written; whichever cleanup ran last then won. Dismiss
 * the drawer first and QuickSearch's cleanup wrote "hidden" back over an empty
 * page — permanently unscrollable, with nothing on screen to explain it. Three
 * of six open/close orderings leaked that way.
 *
 * The lock is refcounted now, so these tests are about ORDER: every ordering of
 * two overlapping dialogs must leave the page exactly as it found it, and the
 * lock must still hold while any dialog is open.
 */

function Dialog({ open }: { open: boolean }) {
  useDialogLifecycle(open, () => {});
  return h("div", null, null);
}

function StandaloneDialog({ open }: { open: boolean }) {
  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);
  return h("div", null, null);
}

const overflow = () => document.body.style.overflow;

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const standaloneOverlaySources = [
  ["PersonDrawer", "../../src/ui/people/PersonDrawer.tsx"],
  ["ReviewerPage", "../../src/ui/review/ReviewerPage.tsx"],
  ["SpeakersPage", "../../src/ui/speakers/SpeakersPage.tsx"],
  ["OnboardingPage", "../../src/ui/onboarding/OnboardingPage.tsx"],
] as const;

test("CONTRACT · MRQ-215 · every standalone dialog uses the shared body lock", () => {
  for (const [name, path] of standaloneOverlaySources) {
    // Ignore prose so this guard cannot be satisfied by a comment describing
    // the old save/restore pattern.
    const production = source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(production, `${name} must acquire the shared lock`).toContain("lockBodyScroll");
    expect(production, `${name} must not restore a private body lock`).not.toContain("document.body.style.overflow");
  }
});

test("CONTRACT · MRQ-215 · a standalone dialog keeps the shared lock while another is open", () => {
  const standalone = mountHost();
  const shell = mountHost();

  act(() => render(h(StandaloneDialog, { open: true }), standalone));
  act(() => render(h(Dialog, { open: true }), shell));
  act(() => render(h(StandaloneDialog, { open: false }), standalone));
  expect(overflow()).toBe("hidden");

  act(() => render(h(Dialog, { open: false }), shell));
  expect(overflow()).toBe("");
});

function mountHost() {
  const host = document.createElement("div");
  // appendChild, not append: the Worker types in scope give `append` an
  // unrelated overload set and the test would not typecheck.
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.style.overflow = "";
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

test("CONTRACT · MRQ-215 · a single dialog locks the page and gives it back", () => {
  const host = mountHost();
  act(() => render(h(Dialog, { open: true }), host));
  expect(overflow()).toBe("hidden");
  act(() => render(h(Dialog, { open: false }), host));
  expect(overflow()).toBe("");
});

test("CONTRACT · MRQ-215 · overlapping dialogs restore the page in EVERY closing order", () => {
  for (const closeFirst of ["outer", "inner"] as const) {
    const outer = mountHost();
    const inner = mountHost();

    act(() => render(h(Dialog, { open: true }), outer));
    act(() => render(h(Dialog, { open: true }), inner));
    expect(overflow()).toBe("hidden");

    // Closing one of two leaves the lock held — the other dialog is still up.
    const first = closeFirst === "outer" ? outer : inner;
    const second = closeFirst === "outer" ? inner : outer;
    act(() => render(h(Dialog, { open: false }), first));
    expect(overflow(), `lock released early when closing ${closeFirst} first`).toBe("hidden");

    act(() => render(h(Dialog, { open: false }), second));
    expect(overflow(), `page left unscrollable when closing ${closeFirst} first`).toBe("");

    outer.remove();
    inner.remove();
  }
});

test("CONTRACT · MRQ-215 · unmounting both dialogs at once still restores the page", () => {
  // Escape closes the drawer and QuickSearch together; both cleanups run in the
  // same commit, so the last one to run must not be the one that decides.
  const outer = mountHost();
  const inner = mountHost();
  act(() => render(h(Dialog, { open: true }), outer));
  act(() => render(h(Dialog, { open: true }), inner));
  act(() => {
    render(h(Dialog, { open: false }), inner);
    render(h(Dialog, { open: false }), outer);
  });
  expect(overflow()).toBe("");
});

test("CONTRACT · MRQ-215 · a page that was already locked keeps its own value", () => {
  // Only the FIRST lock records the page's overflow, so a surface that scrolls
  // its own way is handed back what it had, not a blanket reset.
  document.body.style.overflow = "clip";
  const host = mountHost();
  act(() => render(h(Dialog, { open: true }), host));
  expect(overflow()).toBe("hidden");
  act(() => render(h(Dialog, { open: false }), host));
  expect(overflow()).toBe("clip");
});
