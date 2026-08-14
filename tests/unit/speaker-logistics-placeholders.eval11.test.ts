import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("../../src/ui/speakers/SpeakerRecord.tsx", import.meta.url), "utf8");

function logisticsPlaceholders(): string[] {
  const block = /const LOGISTICS_FIELDS[^=]*=\s*\[([\s\S]*?)\];/.exec(source);
  if (!block) throw new Error("LOGISTICS_FIELDS not found — this test is about that list");
  return [...block[1].matchAll(/placeholder:\s*"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * sbek round 11, speaker-management: the Logistics & notes placeholders were
 * written as realistic sample values, so a record where nothing had been
 * captured read as though arrival, travel and accessibility were already on
 * file. Accessibility is the one that makes this worth a test rather than a
 * tidy-up — an organizer who wrongly believes a speaker's access requirement is
 * recorded does not go and ask for it.
 */
describe("speaker logistics placeholders", () => {
  test("CONTRACT · speaker record — every logistics field prompts rather than showing a specimen", () => {
    const placeholders = logisticsPlaceholders();

    expect(placeholders.length).toBeGreaterThanOrEqual(6);
    for (const placeholder of placeholders) {
      expect(placeholder.trim()).not.toBe("");
    }
  });

  test("CONTRACT · speaker record — no placeholder reads as a captured date", () => {
    const monthAndDay = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/i;

    for (const placeholder of logisticsPlaceholders()) {
      expect(placeholder, `"${placeholder}" reads as a recorded date`).not.toMatch(monthAndDay);
    }
  });

  test("CONTRACT · speaker record — the shipped specimen values do not come back", () => {
    // Verbatim from the judgement. Each one looked like data an organizer had entered.
    for (const specimen of ["May 11, evening", "May 15, midday", "Aisle seat; no red-eyes", "Step-free stage access", "Vegetarian"]) {
      expect(logisticsPlaceholders(), `"${specimen}" is a value, not a prompt`).not.toContain(specimen);
    }
  });
});
