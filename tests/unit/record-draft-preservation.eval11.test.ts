import { describe, expect, test } from "vitest";

import { adoptServerValue } from "../../src/ui/submissions/SubmissionRecordPage";

/**
 * The eval caught one route by which unsaved work disappeared — a failed save
 * taking the page, and Retry reloading the server's values over the top. Review
 * found seven more: `reload()` runs after every successful write on the record
 * page, and each one reseeded the content editor. An organizer part-way through
 * an abstract lost it to assigning a reviewer, publishing, deciding, resending,
 * or overriding a score — silently, with no failure to notice.
 *
 * The first fix compared the field's text against the last server value. Review
 * then found the case that breaks: type, save, and put the original back while
 * the save is in flight, and the text matches the old baseline again — so an
 * equality test calls the field untouched and overwrites a deliberate undo.
 * The signal is INTENT: has the operator touched this field since a save of it
 * last landed.
 */
describe("a record reload does not overwrite what the operator typed", () => {
  test("CONTRACT · record editor — an untouched field takes the fresher server value", () => {
    expect(adoptServerValue(false, "Taming 40-Minute CI", "Taming 40-Minute CI (renamed elsewhere)"))
      .toBe("Taming 40-Minute CI (renamed elsewhere)");
  });

  test("CONTRACT · record editor — an edited field keeps the edit when an unrelated action reloads", () => {
    // Mid-abstract; assigning a reviewer succeeds and reloads.
    expect(adoptServerValue(true, "UPDATED: Taming 40-Minute CI", "Taming 40-Minute CI"))
      .toBe("UPDATED: Taming 40-Minute CI");
  });

  test("CONTRACT · record editor — an edit survives even when the server value also moved", () => {
    // Someone else renamed the record while this operator was typing. Their
    // work is not discarded to resolve that; it stays and they decide.
    expect(adoptServerValue(true, "my in-progress abstract", "someone else's new text"))
      .toBe("my in-progress abstract");
  });

  test("CONTRACT · record editor — a deliberate undo is not overwritten by the value being saved", () => {
    // The case an equality test cannot see: the operator typed "new", saved,
    // then restored "old" while the save was in flight. The field's text now
    // matches the pre-save baseline, but they touched it, so it is theirs.
    expect(adoptServerValue(true, "old", "new")).toBe("old");
  });

  test("CONTRACT · record editor — text typed while a save was in flight is not replaced by the saved value", () => {
    expect(adoptServerValue(true, "first sentence. second sentence.", "first sentence."))
      .toBe("first sentence. second sentence.");
  });

  test("CONTRACT · record editor — the first load seeds an empty editor", () => {
    expect(adoptServerValue(false, "", "Taming 40-Minute CI")).toBe("Taming 40-Minute CI");
    expect(adoptServerValue(false, "", "")).toBe("");
  });

  test("CONTRACT · record editor — clearing a field is an edit, not an empty field to refill", () => {
    // Deliberately emptying the abstract must not be undone by the next reload.
    expect(adoptServerValue(true, "", "an abstract that was there")).toBe("");
  });

  test("CONTRACT · record editor — a landed save of these fields makes the server's copy the operator's own", () => {
    // saveContent clears the flag before reloading, so the values it just wrote
    // are adopted rather than treated as someone else's change.
    expect(adoptServerValue(false, "what I typed", "what I typed")).toBe("what I typed");
  });
});
