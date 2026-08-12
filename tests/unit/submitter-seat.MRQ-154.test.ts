/** MRQ-154 · CFP-05's screen-level status contract. */
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import { SubmitterPortal, type SubmitterSnapshot, type SubmitterSubmission } from "../../src/ui/portal/PortalPage";

function submission(overrides: Partial<SubmitterSubmission> = {}): SubmitterSubmission {
  return {
    id: "sub_mrq154",
    title: "A proposal with a clear answer",
    status: "submitted",
    format: "Stage Talk",
    submitted_at: Date.UTC(2026, 7, 12, 15, 0, 0),
    updated_at: Date.UTC(2026, 7, 12, 15, 0, 0),
    wave_name: "Wave 1",
    wave_decision_on: "2026-09-21",
    role: "submitter",
    form_slug: "mrq-154-cfp",
    ...overrides,
  };
}

function snapshot(overrides: Partial<SubmitterSnapshot> = {}): SubmitterSnapshot {
  return {
    seat: "submitter",
    event: { id: "evt_mrq154", name: "CFP-05 Conference", slug: "cfp-05-conference", timezone: "America/New_York", status: "live" },
    person: { id: "per_mrq154", name: "Avery Submitter", email: "avery@example.com" },
    submissions: [submission()],
    ...overrides,
  };
}

function render(state: SubmitterSnapshot): string {
  return renderToString(h(SubmitterPortal, { snapshot: state, onSignOut: () => undefined }));
}

describe("CONTRACT · MRQ-154 · submitter status semantics", () => {
  test("CONTRACT · MRQ-154 · a submitted proposal is explicitly awaiting review", () => {
    const html = render(snapshot());
    expect(html).toContain("A proposal with a clear answer");
    expect(html).toContain("Submitted · awaiting review");
  });

  test("CONTRACT · MRQ-154 · accepted and rejected treatment remains the established speaker vocabulary", () => {
    expect(render(snapshot({ submissions: [submission({ status: "accepted" })] }))).toContain("Your abstract was accepted");
    expect(render(snapshot({ submissions: [submission({ status: "rejected" })] }))).toContain("Your abstract was not selected");
  });
});
