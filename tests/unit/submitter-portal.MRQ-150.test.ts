/**
 * MRQ-150 · The submitter's empty state, as it actually renders.
 *
 * The API test proves the route stops 404ing. This one holds the screen to the
 * standard PHILOSOPHY sets for empty states: it says what is true, and it names
 * the next action. A page that renders an honest 200 and then tells the reader
 * nothing is the same dead end with a different status code.
 */
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import { SubmitterPortal, type SubmitterSnapshot, type SubmitterSubmission } from "../../src/ui/portal/PortalPage";

function submission(overrides: Partial<SubmitterSubmission> = {}): SubmitterSubmission {
  return {
    id: "sub-mrq-150",
    title: "Shipping agents that answer the phone",
    status: "submitted",
    format: "Stage Talk",
    submitted_at: Date.UTC(2026, 7, 12, 15, 0, 0),
    updated_at: Date.UTC(2026, 7, 12, 15, 0, 0),
    wave_name: "Wave 1",
    wave_decision_on: "2026-09-21",
    role: "submitter",
    form_slug: "cfp",
    ...overrides,
  };
}

function snapshot(overrides: Partial<SubmitterSnapshot> = {}): SubmitterSnapshot {
  return {
    seat: "submitter",
    event: { id: "evt", name: "AI Engineer New York 2026", slug: "aie-ny-2026", timezone: "America/New_York", status: "live" },
    person: { id: "per", name: "Avery Okonkwo", email: "avery.okonkwo@example.com" },
    submissions: [submission()],
    ...overrides,
  };
}

function render(state: SubmitterSnapshot, viewingAsSpeaker = false): string {
  return renderToString(h(SubmitterPortal, { snapshot: state, onSignOut: () => undefined, viewingAsSpeaker }));
}

describe("MRQ-150 the submitter's empty state", () => {
  test("CONTRACT · MRQ-150 · it states what is true, in the submitter's own terms", () => {
    const html = render(snapshot());
    expect(html).toContain("Your abstract is in");
    expect(html).toContain("Shipping agents that answer the phone");
    expect(html).toContain("AI Engineer New York 2026");
    // Never the promise the confirmation page used to make.
    expect(html).not.toContain("Speaker portal");
  });

  test("CONTRACT · MRQ-150 · it names when a decision arrives and where it will be sent", () => {
    const html = render(snapshot());
    expect(html).toContain("September 21, 2026");
    expect(html).toContain("Wave 1");
    expect(html).toContain("avery.okonkwo@example.com");
  });

  test("CONTRACT · MRQ-150 · every next action is a real link, so the screen is not a cul-de-sac", () => {
    const html = render(snapshot());
    expect(html).toContain('href="/signin?next=/portal"');
    expect(html).toContain('href="/f/cfp"');
    expect(html).toContain('href="/agenda"');
    expect(html).toContain('href="/"');
  });

  test("CONTRACT · MRQ-150 · a closed call is not offered as a way back", () => {
    // The server sends form_slug only while the form is open, so a closed call
    // must simply not appear rather than link somewhere that refuses the reader.
    const html = render(snapshot({ submissions: [submission({ form_slug: null })] }));
    expect(html).not.toContain("Open the call for speakers");
    expect(html).toContain('href="/signin?next=/portal"');
  });

  test("CONTRACT · MRQ-150 · with no decision date it says so rather than inventing one", () => {
    const html = render(snapshot({ submissions: [submission({ wave_name: null, wave_decision_on: null })] }));
    expect(html).toContain("has not set a decision date");
    expect(html).not.toContain("Invalid Date");
    expect(html).not.toContain("null");
  });

  test("CONTRACT · MRQ-150 · it renders each status honestly rather than always claiming success", () => {
    expect(render(snapshot({ submissions: [submission({ status: "in_review" })] }))).toContain("under review");
    expect(render(snapshot({ submissions: [submission({ status: "withdrawn" })] }))).toContain("You withdrew this abstract");
    expect(render(snapshot({ submissions: [submission({ status: "rejected" })] }))).toContain("was not selected");
  });

  test("CONTRACT · MRQ-150 · a draft names the submitter's next action and makes no review promise", () => {
    const html = render(snapshot({
      submissions: [submission({ status: "draft", submitted_at: null, wave_name: null, wave_decision_on: null })],
    }));
    expect(html).toContain("Your draft is saved, not yet submitted");
    expect(html).toContain("Finish and submit your abstract");
    expect(html).toContain("Continue your conference abstract");
    expect(html).toContain("reopens it");
    expect(html).not.toContain("Nothing is waiting on you");
    expect(html.toLowerCase()).not.toContain("under review");
    expect(html.toLowerCase()).not.toContain("decision");
    expect(html).not.toContain('href="/f/cfp"');
  });

  test("CONTRACT · MRQ-150 · decided statuses do not show a forward-looking decision flow", () => {
    for (const status of ["accepted", "rejected", "withdrawn"] as const) {
      const html = render(snapshot({ submissions: [submission({ status })] }));
      expect(html).not.toContain("What happens next");
      expect(html).not.toContain("portal-next-steps");
      expect(html.toLowerCase()).not.toContain("next decision");
      expect(html.toLowerCase()).not.toContain("go out by");
      expect(html.toLowerCase()).not.toContain("has not set a decision date");
    }
  });

  test("CONTRACT · MRQ-150 · the submitter chip uses Maybe for a waitlisted abstract", () => {
    const html = render(snapshot({ submissions: [submission({ status: "waitlisted" })] }));
    expect(html).toContain("Your abstract is Maybe");
    expect(html).toContain(">Maybe<");
  });

  test("CONTRACT · MRQ-150 · a lead status never borrows another abstract's wave date", () => {
    const html = render(snapshot({
      submissions: [
        submission({ id: "lead-rejected", title: "Lead abstract", status: "rejected", wave_name: null, wave_decision_on: null }),
        submission({ id: "other-submitted", title: "Other abstract", status: "submitted", wave_name: "Wave 2", wave_decision_on: "2026-10-01" }),
      ],
    }));
    expect(html).toContain("Your abstract was not selected");
    expect(html).toContain("Lead abstract");
    expect(html).toContain("Other abstract");
    const otherStart = html.indexOf('data-submission-id="other-submitted"');
    const leadStart = html.indexOf('data-submission-id="lead-rejected"');
    const otherRow = html.slice(otherStart, html.indexOf("</article>", otherStart));
    const leadRow = html.slice(leadStart, html.indexOf("</article>", leadStart));
    expect(otherRow).toContain("Wave 2");
    expect(otherRow).toContain("October 1, 2026");
    expect(leadRow).not.toContain("Wave 2");
    expect(leadRow).not.toContain("October 1, 2026");
  });

  test("CONTRACT · MRQ-150 · a draft lead does not hide another abstract's decision date", () => {
    const html = render(snapshot({
      submissions: [
        submission({ id: "lead-draft", status: "draft", submitted_at: null, wave_name: null, wave_decision_on: null }),
        submission({ id: "other-submitted", status: "submitted", wave_name: "Wave 2", wave_decision_on: "2026-10-01" }),
      ],
    }));
    const otherStart = html.indexOf('data-submission-id="other-submitted"');
    const otherRow = html.slice(otherStart, html.indexOf("</article>", otherStart));
    expect(html).toContain("Your draft is saved, not yet submitted");
    expect(html).toContain("Finish and submit your abstract");
    expect(otherRow).toContain("Wave 2");
    expect(otherRow).toContain("October 1, 2026");
    expect(html).not.toContain("Decisions for Wave 2 go out by October 1, 2026");
  });

  test("CONTRACT · MRQ-153 · a rejected submitter preview keeps its viewing-as label", () => {
    const html = render(snapshot({ submissions: [submission({ status: "rejected" })] }), true);
    expect(html).toContain("Viewing as speaker · organizer preview");
    expect(html).toContain("Your abstract was not selected");
  });
});
