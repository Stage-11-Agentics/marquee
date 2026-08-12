import { describe, expect, test } from "vitest";

import { acceptedAnyParams, acceptedStageUndercount, isAcceptedStageDeadEnd } from "../../src/ui/submissions/list-request";

describe("MRQ-106 · Ready to place tells you what it is not", () => {
  test("CONTRACT · MRQ-106 · the gap is the trigger, not the zero", () => {
    // The seed this ships against answers `?status=accepted` with ONE record
    // out of 62 accepted talks. A list of one reads as an answer in a way an
    // empty list does not, so it needs the other count more, not less.
    expect(acceptedStageUndercount("accepted", 1, 62)).toBe(true);
    expect(acceptedStageUndercount("accepted", 0, 62)).toBe(true);
    // Nothing to say when the stage holds every accepted talk.
    expect(acceptedStageUndercount("accepted", 62, 62)).toBe(false);
    // Never on another filter, and never before both numbers are known.
    expect(acceptedStageUndercount("accepted_any", 0, 62)).toBe(false);
    expect(acceptedStageUndercount("waved", 0, 62)).toBe(false);
    expect(acceptedStageUndercount("accepted", null, 62)).toBe(false);
    expect(acceptedStageUndercount("accepted", 1, null)).toBe(false);
  });
});

describe("MRQ-106 · the Ready-to-place dead end offers a way out", () => {
  test("CONTRACT · MRQ-106 · the dead end is the stage filter finding nothing, and nothing else", () => {
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

  test("CONTRACT · MRQ-106 · the escape swaps the stage for the stored fact and keeps every other filter", () => {
    const swapped = acceptedAnyParams(new URLSearchParams("status=accepted&track=agents&q=rag&sort=score&page=3"));
    expect(swapped.get("status")).toBe("accepted_any");
    expect(swapped.get("track")).toBe("agents");
    expect(swapped.get("q")).toBe("rag");
    expect(swapped.get("sort")).toBe("score");
    // Page 3 of the old result set means nothing in the new one, and landing on
    // an empty page would be a second dead end at the end of the escape.
    expect(swapped.get("page")).toBeNull();
  });

  test("CONTRACT · MRQ-106 · the escape does not mutate the query it was given", () => {
    const original = new URLSearchParams("status=accepted&page=2");
    acceptedAnyParams(original);
    expect(original.get("status")).toBe("accepted");
    expect(original.get("page")).toBe("2");
  });
});
