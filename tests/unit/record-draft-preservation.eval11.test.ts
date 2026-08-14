import { describe, expect, test } from "vitest";

import { adoptServerValue } from "../../src/ui/submissions/SubmissionRecordPage";

/**
 * The eval caught one route by which unsaved work disappeared — a failed save
 * taking the page, and Retry reloading the server's values over the top. The
 * independent review of that fix found seven more: `reload()` runs after every
 * successful write on the record page, and each one reseeded the content
 * editor. An organizer part-way through an abstract lost it to assigning a
 * reviewer, publishing, deciding, resending, or overriding a score — silently,
 * with no failure to notice.
 *
 * These are behavioural tests of the rule itself rather than assertions about
 * the source, because the review's objection to the first round was precisely
 * that source inspection cannot show what the field ends up holding.
 */
describe("a record reload does not overwrite what the operator typed", () => {
  test("CONTRACT · record editor — an untouched field takes the fresher server value", () => {
    expect(adoptServerValue("Taming 40-Minute CI", "Taming 40-Minute CI", "Taming 40-Minute CI (renamed elsewhere)"))
      .toBe("Taming 40-Minute CI (renamed elsewhere)");
  });

  test("CONTRACT · record editor — an edited field keeps the edit when an unrelated action reloads", () => {
    // The organizer is mid-abstract; assigning a reviewer succeeds and reloads.
    expect(adoptServerValue("UPDATED: Taming 40-Minute CI", "Taming 40-Minute CI", "Taming 40-Minute CI"))
      .toBe("UPDATED: Taming 40-Minute CI");
  });

  test("CONTRACT · record editor — an edit survives even when the server value also moved", () => {
    // Someone else renamed the record while this operator was typing. Their
    // work is not discarded to resolve that; it stays and they decide.
    expect(adoptServerValue("my in-progress abstract", "old server text", "someone else's new text"))
      .toBe("my in-progress abstract");
  });

  test("CONTRACT · record editor — text typed while a save was in flight is not replaced by the saved value", () => {
    // Save sent "first sentence."; the operator kept typing; the reload carries
    // what was saved, which is now stale relative to the field.
    expect(adoptServerValue("first sentence. second sentence.", "", "first sentence."))
      .toBe("first sentence. second sentence.");
  });

  test("CONTRACT · record editor — the first load seeds an empty editor", () => {
    expect(adoptServerValue("", "", "Taming 40-Minute CI")).toBe("Taming 40-Minute CI");
    expect(adoptServerValue("", "", "")).toBe("");
  });

  test("CONTRACT · record editor — clearing a field is an edit, not an empty field to refill", () => {
    // Deliberately emptying the abstract must not be undone by the next reload.
    expect(adoptServerValue("", "an abstract that was there", "an abstract that was there")).toBe("");
  });
});
