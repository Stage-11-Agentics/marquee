/**
 * MRQ-279 · The submitter's home, as it actually renders.
 *
 * The integration test proves the door and the data. This one holds the screen
 * to the thing the user story asks for: a person holding several proposals sees
 * *several*, each named and each with where it stands. A page that answers a
 * three-proposal submitter with a headline about one of them is the failure this
 * ticket exists to end, and it is the failure that renders as a success.
 */
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import { MyProposalsPage } from "../../src/routes/my-proposals.route";
import { SubmitterPortal, type SubmitterSnapshot, type SubmitterSubmission } from "../../src/ui/portal/PortalPage";

const DECIDED_AT = Date.UTC(2026, 7, 14, 12, 0, 0);

function submission(overrides: Partial<SubmitterSubmission> = {}): SubmitterSubmission {
  return {
    id: "sub-mrq-279",
    title: "Taming 40-Minute CI",
    status: "submitted",
    reference_code: "SUB-1",
    decision: null,
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

function snapshot(submissions: SubmitterSubmission[]): SubmitterSnapshot {
  return {
    seat: "submitter",
    event: { id: "evt", name: "AI Engineer New York 2026", slug: "aie-ny-2026", timezone: "America/New_York", status: "live" },
    available_events: [{ id: "evt", name: "AI Engineer New York 2026" }],
    person: { id: "per", name: "Avery Okonkwo", email: "avery.okonkwo@example.com" },
    submissions,
  };
}

function render(state: SubmitterSnapshot): string {
  return renderToString(h(SubmitterPortal, { snapshot: state, onSignOut: () => undefined }));
}

function renderMyProposals(turnstileSiteKey: string): string {
  return renderToString(h(MyProposalsPage, {
    state: {
      event: { name: "AI Engineer New York 2026", slug: "aie-ny-2026" },
      requestedEventSlug: "aie-ny-2026",
      turnstileSiteKey,
    },
  }));
}

function rowFor(html: string, id: string): string {
  const start = html.indexOf(`data-submission-id="${id}"`);
  expect(start, `a row for ${id} must render`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
}

describe("MRQ-279 the submitter's home", () => {
  test("CONTRACT · MRQ-279 · three proposals are counted and tallied, not reduced to one", () => {
    const html = render(snapshot([
      submission({ id: "a", reference_code: "SUB-1", title: "First", status: "accepted", decision: { status: "accepted", decided_at: DECIDED_AT, feedback_md: null } }),
      submission({ id: "b", reference_code: "SUB-2", title: "Second", status: "submitted" }),
      submission({ id: "c", reference_code: "SUB-3", title: "Third", status: "rejected", decision: { status: "rejected", decided_at: DECIDED_AT, feedback_md: null } }),
    ]));
    expect(html).toContain("Your 3 proposals to AI Engineer New York 2026");
    // Fixed order, so a landing decision moves a number rather than reshuffling
    // the sentence under somebody who is reading it.
    expect(html).toContain("1 accepted · 1 under review · 1 not selected");
    expect(html).toContain("First");
    expect(html).toContain("Second");
    expect(html).toContain("Third");
  });

  test("CONTRACT · MRQ-279 · one proposal keeps the singular headline it always had", () => {
    const html = render(snapshot([submission({ status: "accepted", decision: { status: "accepted", decided_at: DECIDED_AT, feedback_md: null } })]));
    expect(html).toContain("Your abstract was accepted");
    expect(html).not.toContain("Your 1 proposals");
  });

  test("CONTRACT · MRQ-279 · every row names itself with its reference code", () => {
    const html = render(snapshot([
      submission({ id: "a", reference_code: "SUB-1042", title: "First" }),
      // A record minted before reference codes existed says so rather than
      // rendering an empty slot the reader has to interpret.
      submission({ id: "b", reference_code: null, title: "Second" }),
    ]));
    expect(rowFor(html, "a")).toContain("SUB-1042");
    expect(rowFor(html, "b")).toContain("No reference yet");
  });

  test("CONTRACT · MRQ-279 · a decision is shown in the words the decision mail used", () => {
    const html = render(snapshot([
      submission({
        id: "a",
        reference_code: "SUB-1",
        status: "accepted",
        decision: { status: "accepted", decided_at: DECIDED_AT, feedback_md: "The committee wants this on the Infra track." },
      }),
      submission({ id: "b", reference_code: "SUB-2", status: "submitted" }),
    ]));
    const decided = rowFor(html, "a");
    expect(decided).toContain("The program team accepted this abstract for the conference.");
    expect(decided).toContain("The committee wants this on the Infra track.");
    expect(decided).toContain("Decided");
    // An undecided proposal carries its expected decision date instead, and no
    // decision block at all: the page never implies an answer that has not come.
    const waiting = rowFor(html, "b");
    expect(waiting).not.toContain("portal-submitted-decision");
    expect(waiting).toContain("Next decision");
  });

  test("CONTRACT · MRQ-279 · a decision with no organizer note still says what happened", () => {
    const html = render(snapshot([
      submission({ id: "a", status: "rejected", decision: { status: "rejected", decided_at: DECIDED_AT, feedback_md: null } }),
    ]));
    expect(rowFor(html, "a")).toContain("The program team did not select this abstract for the conference.");
  });

  test("CONTRACT · MRQ-279 · the set's own progress line never contradicts the list", () => {
    // "Not selected" beside a list containing an acceptance is the singular
    // hero's lie moved one line down.
    const html = render(snapshot([
      submission({ id: "a", reference_code: "SUB-1", status: "accepted", decision: { status: "accepted", decided_at: DECIDED_AT, feedback_md: null } }),
      submission({ id: "b", reference_code: "SUB-2", status: "rejected", decision: { status: "rejected", decided_at: DECIDED_AT, feedback_md: null } }),
    ]));
    expect(html).toContain("Every decision is in");
    expect(html).not.toContain(">Not selected<");
    expect(html).toContain("Every proposal you sent has an answer");
  });

  test("CONTRACT · MRQ-279 · a decided row reserves no editor space it can never use", () => {
    const html = render(snapshot([
      submission({ id: "open", status: "submitted", edit: { enabled: true, reason: null } }),
      submission({ id: "closed", status: "rejected", decision: { status: "rejected", decided_at: DECIDED_AT, feedback_md: null }, edit: { enabled: false, reason: "Editing is closed because the conference has already made a decision." } }),
    ]));
    expect(rowFor(html, "open")).toContain('data-submission-editable="true"');
    expect(rowFor(html, "closed")).toContain('data-submission-editable="false"');
    // `visibility: hidden` still occupies its full height, so a reservation on a
    // row that can never open the editor is a screen of emptiness, not safety.
    expect(rowFor(html, "open")).toContain("portal-submitter-editor");
    expect(rowFor(html, "closed")).not.toContain("portal-submitter-editor");
  });

  test("CONTRACT · MRQ-279 · the way back is the submitter's own door and needs no password", () => {
    const html = render(snapshot([submission()]));
    expect(html).toContain('href="/my-proposals?event=aie-ny-2026"');
    expect(html).toContain("There is no password");
    // The organizer's page is not an answer to somebody who never had an account.
    expect(html).not.toContain("/signin");
  });

  test("CONTRACT · MRQ-279 · the proposal door is script-only, never a raw JSON landing page", () => {
    const html = renderMyProposals("");
    expect(html).not.toContain('method="post"');
    expect(html).not.toContain('action="/api/v1/public/proposals/link"');
  });

  test("CONTRACT · MRQ-279 · a blocked Turnstile script leaves a visible instruction", () => {
    const html = renderMyProposals("turnstile-site-key");
    expect(html).toContain('data-proposals-turnstile="true"');
    expect(html).toContain("Complete the security check before sending.");
  });
});
