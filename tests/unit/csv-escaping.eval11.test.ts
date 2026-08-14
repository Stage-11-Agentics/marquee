import { describe, expect, test } from "vitest";

import { csvCell, csvRow } from "../../src/lib/csv";
import { SUBMISSION_EXPORT_HEADER, submissionsCsv, type ExportableSubmission } from "../../src/ui/submissions/export-csv";

/**
 * The product had three CSV escapers, written a day apart by three tickets:
 * the reviewer queue (MRQ-18), the chair results (MRQ-109), and the submissions
 * list (MRQ-9). Two flattened line breaks to spaces. The third — the one that
 * carries conference titles and speaker names — did not.
 *
 * A field with a line break in it is legal CSV and a complete RFC 4180 reader
 * puts it back together. That is not the failure. The failure is that the
 * record stops being a line, and an organizer's tools are line-shaped: a
 * `grep`, a `wc -l`, a script that reads a row at a time, a column count. The
 * damage shows up in a spreadsheet a week later, not at download time. Titles
 * and speaker names come in through the Sessionize import and the API, which
 * carry other people's typing.
 */

/** A title as a Sessionize import can deliver it. */
const MULTILINE_TITLE = "Agents in production:\nwhat broke, and why";
const CRLF_NAME = "Ada\r\nLovelace";

function submission(overrides: Partial<ExportableSubmission> = {}): ExportableSubmission {
  return {
    kind: "session",
    id: "sub_1",
    title: "A perfectly ordinary talk",
    speakers: [{ name: "Priya Raman" }],
    status: "accepted",
    tracks: [{ name: "Agents" }],
    score: 4.25,
    submitted_at: 1_760_000_000_000,
    updated_at: 1_760_000_100_000,
    origin: "form",
    ...overrides,
  };
}

/** Physical lines, the way every line-oriented tool counts them. */
function physicalLines(file: string): string[] {
  return file.replace(/\n$/, "").split("\n");
}

describe("csv escaping", () => {
  test("CONTRACT · a cell is quoted, its quotes doubled, and its line breaks flattened", () => {
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell('she said "no"')).toBe('"she said ""no"""');
    expect(csvCell("a\nb")).toBe('"a b"');
    expect(csvCell("a\r\nb")).toBe('"a b"');
    expect(csvCell("a\rb")).toBe('"a b"');
    // A CRLF must not become two spaces — that is a different string than the
    // one the other exports produce, which is the whole point of sharing this.
    expect(csvCell("a\r\nb")).toBe(csvCell("a\nb"));
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(0)).toBe('"0"');
    // A comma inside a quoted field is a comma, not a column boundary.
    expect(csvRow(["a,b", "c"])).toBe('"a,b","c"');
  });

  test("CONTRACT · a title with a line break still occupies exactly one line", () => {
    const file = submissionsCsv([
      submission({ id: "sub_1", title: MULTILINE_TITLE }),
      submission({ id: "sub_2", speakers: [{ name: CRLF_NAME }] }),
      submission({ id: "sub_3" }),
    ]);

    // One header plus one line per record. Before the fix this was six.
    expect(physicalLines(file)).toHaveLength(4);
    expect(file.endsWith("\n")).toBe(true);

    // And the columns after the damaged one are still in their columns: an
    // organizer reading the file finds the origin under Origin, not under
    // Title, which is what a shifted row actually looks like in a spreadsheet.
    for (const line of physicalLines(file).slice(1)) {
      expect(line.split('","'), "cells per record").toHaveLength(SUBMISSION_EXPORT_HEADER.length);
      expect(line.endsWith('"form"')).toBe(true);
    }

    // Flattening is lossy on purpose, and the words survive it.
    expect(file).toContain("Agents in production: what broke, and why");
    expect(file).toContain("Ada Lovelace");
  });

  test("CONTRACT · the header is the columns the list promises, in order", () => {
    const [header] = physicalLines(submissionsCsv([]));
    expect(header).toBe(SUBMISSION_EXPORT_HEADER.map((name) => `"${name}"`).join(","));
    // An empty export is a header and nothing else, not an empty file — the
    // organizer needs to see which columns they asked for.
    expect(physicalLines(submissionsCsv([]))).toHaveLength(1);
  });

  test("CONTRACT · the export says what the row says", () => {
    // The status chip on the row and the status cell in the file read the same
    // word, because they are now one function rather than two.
    const file = submissionsCsv([submission({ status: "waitlisted", kind: "abstract" })]);
    expect(file).toContain('"Maybe"');
    expect(file).toContain('"Abstract"');
    expect(submissionsCsv([submission({ score: null, submitted_at: null })])).toContain('"",');
  });
});
