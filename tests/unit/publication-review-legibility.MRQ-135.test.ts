import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import type { AgendaPublishCandidate } from "../../src/api/agenda";
import { PublicationCandidateRow } from "../../src/ui/agenda/AgendaPage";

const styles = readFileSync(resolve(process.cwd(), "src/ui/agenda/agenda.css"), "utf8");

const candidate: AgendaPublishCandidate = {
  agenda_item_id: "item_1",
  submission_id: "sub_1",
  title: "Agents that answer to somebody",
  scheduled: true,
  can_publish: true,
  blocked_reason: null,
  starts_at: Date.UTC(2026, 9, 13, 13, 0) / 1000,
  duration_min: 45,
  room: "Monarch",
  building: "Nine Orchard",
  speakers: [{ id: "per_1", name: "Ada Ellery", company: "Stage 11", role: "speaker" }],
};

const row = (review: boolean) => renderToString(h(PublicationCandidateRow, { candidate, timezone: "America/New_York", review, selected: true }));
const unscheduledRow = renderToString(h(PublicationCandidateRow, {
  candidate: {
    ...candidate,
    agenda_item_id: null,
    starts_at: null,
    duration_min: null,
    room: null,
    building: null,
    scheduled: false,
    can_publish: false,
    blocked_reason: "needs a room and time before it can go public",
  },
  timezone: "America/New_York",
  selected: false,
}));
const submitterOnlyRow = renderToString(h(PublicationCandidateRow, {
  candidate: {
    ...candidate,
    title: "Session with a submitter but no speaker",
    speakers: [{ id: "per_submitter", name: "Submitter Only", company: "Conference Co", role: "submitter" }],
  },
  timezone: "America/New_York",
  review: true,
  selected: true,
}));
const unscheduledSubmitterOnlyRow = renderToString(h(PublicationCandidateRow, {
  candidate: {
    ...candidate,
    agenda_item_id: null,
    starts_at: null,
    duration_min: null,
    room: null,
    building: null,
    scheduled: false,
    can_publish: false,
    blocked_reason: "needs a room and time before it can go public",
    speakers: [{ id: "per_submitter", name: "Submitter Only", company: "Conference Co", role: "submitter" }],
  },
  timezone: "America/New_York",
  selected: false,
}));

/**
 * The review step drops the checkbox. The row's grid still reserved a 20px
 * first column, so the copy landed in it and ellipsised to a character or two —
 * a confirmation gate the organizer could not read.
 */
describe("MRQ-135 · the publication review row is readable", () => {
  it("CONTRACT · review rows carry the modifier that frees them from the checkbox column", () => {
    expect(row(true)).toContain("agenda-publication-candidate is-review");
  });

  it("CONTRACT · the modifier collapses the grid to one full-width column and stops the clipping", () => {
    expect(styles).toMatch(/\.agenda-publication-candidate\.is-review \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(styles).toMatch(/\.agenda-publication-candidate\.is-review[^{]*\{[^}]*white-space: normal/);
  });

  it("CONTRACT · the fields the gate exists to show are all in the review row", () => {
    const markup = row(true);
    expect(markup).toContain(candidate.title);
    expect(markup).toContain("Monarch");
    expect(markup).toContain("Nine Orchard");
    expect(markup).toContain("Ada Ellery");
    expect(markup).not.toContain("type=\"checkbox\"");
  });

  it("CONTRACT · MRQ-185 · the review row warns when its program-only participant is not on stage", () => {
    expect(submitterOnlyRow).toContain("Speaker to be announced");
    expect(submitterOnlyRow).toContain("No speaking participant attached");
    expect(submitterOnlyRow).not.toContain("Submitter Only");
  });

  it("CONTRACT · selection mode keeps its checkbox and its two-column layout", () => {
    const markup = row(false);
    expect(markup).toContain("type=\"checkbox\"");
    expect(markup).not.toContain("is-review");
    expect(styles).toMatch(/\.agenda-publication-candidate \{[^}]*grid-template-columns: 20px minmax\(0, 1fr\)/);
  });

  it("CONTRACT · an unscheduled accepted Session stays visible but its publication control is disabled with the reason", () => {
    expect(unscheduledRow).toContain("disabled");
    expect(unscheduledRow).toContain("needs a room and time before it can go public");
    expect(unscheduledRow).toContain("Agents that answer to somebody");
  });

  it("CONTRACT · an unscheduled speakerless Session keeps both its disabled reason and honest speaker state", () => {
    expect(unscheduledSubmitterOnlyRow).toContain("disabled");
    expect(unscheduledSubmitterOnlyRow).toContain("needs a room and time before it can go public");
    expect(unscheduledSubmitterOnlyRow).toContain("Speaker to be announced");
    expect(unscheduledSubmitterOnlyRow).toContain("No speaking participant attached");
    expect(unscheduledSubmitterOnlyRow).not.toContain("Submitter Only");
  });
});
