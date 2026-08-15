// @vitest-environment happy-dom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";

import { Sidebar } from "../../src/ui/shell/Sidebar";

const dom = globalThis.document as any;
let root: any;
let innerWidthDescriptor: PropertyDescriptor | undefined;

afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  root = null;
  vi.unstubAllGlobals();
  if (innerWidthDescriptor) {
    Object.defineProperty(window, "innerWidth", innerWidthDescriptor);
    innerWidthDescriptor = undefined;
  }
  document.body.innerHTML = "";
});

test("CONTRACT · MRQ-215 · an open drawer follows CSS viewport truth", () => {
  const onClose = vi.fn();
  const media = {
    matches: true,
    media: "(max-width: 760px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => media));

  // The classic scrollbar makes the JS innerWidth wider than the CSS
  // viewport. The hamburger is still the correct control at this boundary.
  innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 770 });
  root = dom.createElement("div");
  document.body.appendChild(root);

  act(() => render(h(Sidebar, {
    eventName: "Conference",
    navigate: vi.fn(),
    resetting: false,
    onReset: vi.fn(),
    drawerOpen: true,
    onClose,
  }), root));

  expect(onClose).not.toHaveBeenCalled();
});
