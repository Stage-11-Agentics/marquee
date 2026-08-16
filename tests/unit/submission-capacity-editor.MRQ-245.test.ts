// @vitest-environment happy-dom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test } from "vitest";

import { SubmissionCapacityEditor, type SubmissionCapacityPatch } from "../../src/ui/forms/SubmissionCapacityEditor";

function mount(): HTMLDivElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

test("CONTRACT · MRQ-245 · the builder shows effective inheritance, finite override, and clear behavior", () => {
  const root = mount();
  const patches: SubmissionCapacityPatch[] = [];
  act(() => render(h(SubmissionCapacityEditor, {
    inherit: true,
    rawLimit: 3,
    effectiveLimit: 7,
    onChange: (patch) => patches.push(patch),
  }), root));
  expect(root.textContent).toContain("Uses conference default");
  expect(root.textContent).toContain("7 abstracts per person");
  const setOverride = [...root.querySelectorAll("button")].find((button) => button.textContent === "Set form override");
  expect(setOverride).toBeDefined();
  act(() => {
    setOverride?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(patches).toContainEqual({ submitter_limit_inherit: false, per_submitter_limit: 7 });

  patches.length = 0;
  act(() => render(h(SubmissionCapacityEditor, {
    inherit: false,
    rawLimit: 5,
    effectiveLimit: 5,
    onChange: (patch) => patches.push(patch),
  }), root));
  const input = root.querySelector("input[type=number]") as HTMLInputElement;
  expect(input.min).toBe("1");
  expect(input.max).toBe("100");
  input.value = "9";
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(patches).toContainEqual({ per_submitter_limit: 9, submitter_limit_inherit: false });
  const clear = [...root.querySelectorAll("button")].find((button) => button.textContent === "Use conference default");
  act(() => {
    clear?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(patches).toContainEqual({ submitter_limit_inherit: true });
});

test("CONTRACT · MRQ-245 · a stored legacy zero is displayed as legacy state without a zero input affordance", () => {
  const root = mount();
  act(() => render(h(SubmissionCapacityEditor, {
    inherit: false,
    rawLimit: 0,
    effectiveLimit: 0,
    onChange: () => undefined,
  }), root));
  expect(root.textContent).toContain("Legacy unlimited value");
  const input = root.querySelector("input[type=number]") as HTMLInputElement;
  expect(input.min).toBe("1");
  expect(input.placeholder).toBe("1–100");
  expect(input.value).toBe("");
});
