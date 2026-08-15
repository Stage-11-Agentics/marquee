import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import { OnboardingPage, reconcileOnboardingSelection } from "../../src/ui/onboarding/OnboardingPage";

test("CONTRACT · MRQ-215 · a poll removes disappeared visible rows but keeps intentional off-page selection", () => {
  const selected = new Set(["visible-removed", "visible-kept", "off-page"]);
  const previousVisible = new Set(["visible-removed", "visible-kept"]);
  const nextRows = [{ id: "visible-kept" }, { id: "new-visible" }];

  expect([...reconcileOnboardingSelection(selected, previousVisible, nextRows)]).toEqual(["visible-kept", "off-page"]);
});

test("CONTRACT · MRQ-215 · selection recovery stays discoverable before and after a selection", () => {
  const rendered = renderToString(h(OnboardingPage, { eventId: "evt_mrq215" }));

  expect(rendered).toContain("Clear selection");
  expect(rendered).toContain("onboarding-selection-clear");
});
