import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { unmatchedTaxonomyNotes } from "../../src/lib/sessionize-import";

const importStyles = readFileSync(fileURLToPath(new URL("../../src/ui/import/sessionize-import.css", import.meta.url)), "utf8");

const MATCHED = { name: "Workshop", matched: true, resolvedId: "fmt_workshop" };
const SILENT = { name: "", matched: false, resolvedId: null };

describe("CONTRACT · the importer says when it could not place a track or format", () => {
  test("CONTRACT · an unrecognized name is named, not summarized", () => {
    // The operator's next move is to create that track or fix the export, and
    // both need the actual value. A generic "some values were dropped" would
    // leave them with nowhere to go.
    const notes = unmatchedTaxonomyNotes({
      track: { name: "Platform", matched: false, resolvedId: null },
      format: MATCHED,
    });
    expect(notes).toEqual(['track "Platform" not recognized, left unset']);
  });

  test("CONTRACT · both misses are reported, each naming its own value", () => {
    const notes = unmatchedTaxonomyNotes({
      track: { name: "Platform", matched: false, resolvedId: null },
      format: { name: "Talk", matched: false, resolvedId: null },
    });
    expect(notes).toEqual([
      'track "Platform" not recognized, left unset',
      'format "Talk" not recognized, left unset',
    ]);
  });

  test("CONTRACT · an empty column is silence, not a miss", () => {
    // This is the whole reason the note is conditional. "The CSV said nothing"
    // and "the CSV said Platform and we have no such track" are different
    // events, and warning on the first makes the message noise on every blank
    // field, which trains operators to ignore it.
    expect(unmatchedTaxonomyNotes({ track: SILENT, format: SILENT })).toEqual([]);
  });

  test("CONTRACT · a matched name is never mentioned", () => {
    expect(unmatchedTaxonomyNotes({ track: { name: "Agents", matched: true, resolvedId: "trk_agents" }, format: MATCHED })).toEqual([]);
  });

  test("CONTRACT · a re-import that keeps an existing value does not claim it was unset", () => {
    // An unmatched name falls back to the value the record already carried
    // (sessionize-import.ts, `track?.id ?? current?.primary_track_id`). A row
    // categorized inside Marquee and then re-imported keeps its track, so
    // "left unset" there would be a false report of data loss.
    const notes = unmatchedTaxonomyNotes({
      track: { name: "Platform", matched: false, resolvedId: "trk_set_in_marquee" },
      format: MATCHED,
    });
    expect(notes).toEqual(['track "Platform" not recognized, existing value kept']);
  });

  test("CONTRACT · the Reason column can show a whole reason, not its first few words", () => {
    // Writing the note was only half the fix. The results table inherits a
    // shared `max-width: 180px` nowrap ellipsis from the mapping preview, which
    // clipped every reason after a few words — and because the note is appended
    // to the end of the reason, it was invisible on screen even though the API
    // carried it. Driving the real wizard in a browser is what caught this; the
    // API-level assertions above all passed while nothing was readable.
    expect(importStyles).toMatch(/\.sessionize-results-table td:last-child \{[^}]*white-space: normal;/);
    expect(importStyles).toMatch(/\.sessionize-results-table td:last-child \{[^}]*max-width: none;/);
  });
});
