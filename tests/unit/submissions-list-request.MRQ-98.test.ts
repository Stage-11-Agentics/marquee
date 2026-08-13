import { describe, expect, it } from "vitest";

import {
  buildSubmissionsQuery,
  canonicalSubmissionsQueryKey,
  isCurrentSubmissionsRequest,
  submissionsRequestKey,
} from "../../src/ui/submissions/list-request";

describe("MRQ-98 submissions request continuity", () => {
  it("CONTRACT · MRQ-98 always sends the 50-row page size while retaining the full query", () => {
    const query = buildSubmissionsQuery(new URLSearchParams("q=accessibility&page=3&sort=title&per_page=10"));

    expect(query.get("q")).toBe("accessibility");
    expect(query.get("page")).toBe("3");
    expect(query.get("sort")).toBe("title");
    expect(query.get("per_page")).toBe("50");
  });

  it("CONTRACT · MRQ-98 uses one key for equivalent parameter orderings and different keys for pages", () => {
    const first = new URLSearchParams("sort=title&q=accessibility&page=2");
    const equivalent = new URLSearchParams("page=2&q=accessibility&sort=title");
    const otherPage = new URLSearchParams("sort=title&q=accessibility&page=3");

    expect(canonicalSubmissionsQueryKey(first)).toBe(canonicalSubmissionsQueryKey(equivalent));
    expect(canonicalSubmissionsQueryKey(first)).not.toBe(canonicalSubmissionsQueryKey(otherPage));
    expect(submissionsRequestKey("evt-a", first)).not.toBe(submissionsRequestKey("evt-b", first));
  });

  it("CONTRACT · MRQ-98 rejects stale or aborted responses", () => {
    const controller = new AbortController();

    expect(isCurrentSubmissionsRequest(2, 2, controller.signal)).toBe(true);
    expect(isCurrentSubmissionsRequest(1, 2, controller.signal)).toBe(false);
    controller.abort();
    expect(isCurrentSubmissionsRequest(2, 2, controller.signal)).toBe(false);
  });
});
