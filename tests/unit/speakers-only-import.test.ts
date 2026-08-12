import { describe, expect, test } from "vitest";

import { defaultMapping, parseCsv, previewCsv } from "../../src/lib/sessionize-import";

/**
 * The import wizard offers a speakers-only import in as many words: the
 * Sessions CSV is labelled optional and "Leave blank for a speakers-only
 * import". Leaving it blank sent the empty string through the CSV parser,
 * which returned one nameless column — so the mapping step saw an export that
 * had headers and could not recognise any of them, counted every required
 * session field as missing, and disabled "Map, import, and review" for good.
 */
const SPEAKERS_CSV = [
  "name,email,title,company,bio",
  "Priya Raman,priya@example.com,Principal Engineer,Latticework,Leads build tooling.",
  "Marcus Okafor,marcus@example.com,Staff Advocate,Cloudreach,Writes about agents.",
].join("\n");

describe("an absent CSV has no header row", () => {
  test.each([
    ["empty string", ""],
    ["a single newline", "\n"],
    ["whitespace only", "  \n  "],
  ])("%s parses to no headers and no rows", (_label, text) => {
    const table = parseCsv(text);
    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([]);
  });

  test("a real export still parses normally", () => {
    const table = parseCsv(SPEAKERS_CSV);
    expect(table.headers).toEqual(["name", "email", "title", "company", "bio"]);
    expect(table.rows).toHaveLength(2);
  });
});

test("a speakers-only import leaves the sessions half empty rather than unrecognised", () => {
  const sessions = previewCsv("sessions", "", defaultMapping("sessions", []));
  // The wizard's gate reads `Boolean(sessionPreview.headers.length)` to decide
  // whether the sessions half applies at all. One phantom header made it apply.
  expect(sessions.headers).toEqual([]);
  expect(sessions.rows).toEqual([]);

  const speakers = previewCsv("speakers", SPEAKERS_CSV, defaultMapping("speakers", parseCsv(SPEAKERS_CSV).headers));
  expect(speakers.missing).not.toContain("name");
  expect(speakers.missing).not.toContain("email");

  // The gate, as the page computes it.
  const hasSessions = Boolean(sessions.headers.length);
  const blocked = (hasSessions && ["external_ref", "title", "speaker_emails"].some((field) => sessions.missing.includes(field)))
    || ["name", "email"].some((field) => speakers.missing.includes(field));
  expect(blocked, "the speakers-only import must be runnable").toBe(false);
});
