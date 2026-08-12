import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import { SpeakerFilesPanel } from "../../src/ui/speakers/SpeakerFilesPanel";

/**
 * MRQ-138 · the region has to have something in it.
 *
 * The defect this guards is small and specific: the speaker record shipped a
 * self-closing `<section aria-label="Speaker files" />`. A screen reader
 * announced a region called "Speaker files" that contained nothing at all, and
 * a sighted organizer saw a gap. Whatever the panel is fetching, it says so.
 */

test("REGRESSION · MRQ-138 — the Speaker files region is never an empty labelled void", () => {
  const html = renderToString(h(SpeakerFilesPanel, { eventId: "evt_1", personId: "per_1" }));
  expect(html).toContain('aria-label="Speaker files"');
  // The old placeholder rendered exactly this and nothing more.
  expect(html).not.toContain('<section class="speaker-section speaker-files" aria-label="Speaker files"></section>');
  expect(html).toContain("Files");
  expect(html).toMatch(/Reading this speaker's files/);
});
