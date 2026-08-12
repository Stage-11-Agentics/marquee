import { describe, expect, test } from "vitest";

import { acceptedAnyParams, isAcceptedStageDeadEnd } from "../../src/ui/submissions/list-request";

describe("MRQ-106 · the Ready-to-place dead end offers a way out", () => {
  test("the dead end is the stage filter finding nothing, and nothing else", () => {
    expect(isAcceptedStageDeadEnd("accepted", 0)).toBe(true);
    // A stage that found records is not a dead end.
    expect(isAcceptedStageDeadEnd("accepted", 12)).toBe(false);
    // Neither is any other empty filter — those already say "Clear filters",
    // and there is no second reading of them to offer.
    expect(isAcceptedStageDeadEnd("waved", 0)).toBe(false);
    expect(isAcceptedStageDeadEnd("accepted_any", 0)).toBe(false);
    expect(isAcceptedStageDeadEnd("", 0)).toBe(false);
    // Before the list resolves there is no state to judge.
    expect(isAcceptedStageDeadEnd("accepted", null)).toBe(false);
  });

  test("the escape swaps the stage for the stored fact and keeps every other filter", () => {
    const swapped = acceptedAnyParams(new URLSearchParams("status=accepted&track=agents&q=rag&sort=score&page=3"));
    expect(swapped.get("status")).toBe("accepted_any");
    expect(swapped.get("track")).toBe("agents");
    expect(swapped.get("q")).toBe("rag");
    expect(swapped.get("sort")).toBe("score");
    // Page 3 of the old result set means nothing in the new one, and landing on
    // an empty page would be a second dead end at the end of the escape.
    expect(swapped.get("page")).toBeNull();
  });

  test("the escape does not mutate the query it was given", () => {
    const original = new URLSearchParams("status=accepted&page=2");
    acceptedAnyParams(original);
    expect(original.get("status")).toBe("accepted");
    expect(original.get("page")).toBe("2");
  });
});
