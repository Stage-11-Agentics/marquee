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
  starts_at: Date.UTC(2026, 9, 13, 13, 0) / 1000,
  duration_min: 45,
  room: "Monarch",
  building: "Nine Orchard",
  speakers: [{ id: "per_1", name: "Ada Ellery", company: "Stage 11" }],
};

const row = (review: boolean) => renderToString(h(PublicationCandidateRow, { candidate, timezone: "America/New_York", review, selected: true }));

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

  it("CONTRACT · selection mode keeps its checkbox and its two-column layout", () => {
    const markup = row(false);
    expect(markup).toContain("type=\"checkbox\"");
    expect(markup).not.toContain("is-review");
    expect(styles).toMatch(/\.agenda-publication-candidate \{[^}]*grid-template-columns: 20px minmax\(0, 1fr\)/);
  });
});
