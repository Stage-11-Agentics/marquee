import { describe, expect, test } from "vitest";

import { portalStatusProjection } from "../../src/lib/portal-status";

describe("MRQ-240 portal status vocabulary", () => {
  test("CONTRACT · speaker statuses project to the submitter's words and a display tone", () => {
    const cases = [
      ["draft", { label: "Draft", tone: "warning" }],
      ["submitted", { label: "Submitted · awaiting review", tone: "" }],
      ["in_review", { label: "Under review", tone: "" }],
      ["accepted", { label: "Accepted", tone: "success" }],
      ["waitlisted", { label: "Maybe", tone: "warning" }],
      ["rejected", { label: "Rejected", tone: "alarm" }],
      ["withdrawn", { label: "Withdrawn", tone: "warning" }],
    ] as const;
    for (const [status, expected] of cases) {
      expect(portalStatusProjection("speaker", status)).toEqual(expected);
    }
  });

  test("CONTRACT · sponsor statuses do not expose sales-pipeline codes", () => {
    expect(portalStatusProjection("sponsor", "courting")).toEqual({ label: "In discussion", tone: "" });
    expect(portalStatusProjection("sponsor", "committed")).toEqual({ label: "Confirmed", tone: "success" });
    expect(portalStatusProjection("sponsor", "fulfilled")).toEqual({ label: "Complete", tone: "success" });
    for (const status of ["courting", "committed", "fulfilled"]) {
      expect(portalStatusProjection("sponsor", status).label.toLowerCase()).not.toContain(status);
    }
  });
});
