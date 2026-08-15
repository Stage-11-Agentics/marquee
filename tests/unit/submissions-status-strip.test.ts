import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The submissions list reserves space so nothing jumps under the operator's
 * cursor — but it once reserved a row per message: export, saved view, bulk
 * decision, refresh, plus the selection bar. Five slots, four of them blank
 * almost always, stacked into two dead bands between the filters and the first
 * record.
 *
 * The rule that replaced them: one strip, one reserved height, every message
 * about this list in it. These assertions are the guard rail — a sixth reserved
 * band is easy to add by reflex when the next status message needs a home.
 */

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const page = source("../../src/ui/submissions/SubmissionsPage.tsx");
const styles = source("../../src/ui/submissions/submissions.css");

const RETIRED_SLOTS = ["export-message", "notify-message", "saved-view-message", "bulk-message", "submissions-refresh-message", "selection-bar"];

test("CONTRACT · the submissions list reserves exactly one status strip", () => {
  expect(page).toContain('class={`table-status-bar');
  expect(page.match(/table-status-bar/g)).toHaveLength(1);
  for (const slot of RETIRED_SLOTS) {
    expect(page, `${slot} is a separately reserved band; it belongs in the shared strip`).not.toContain(slot);
    expect(styles, `${slot} has no element left to style`).not.toContain(slot);
  }
});

test("CONTRACT · every status this list can raise reaches the shared strip", () => {
  // Each of these is a message the operator must not miss. Removing one from
  // the strip removes its only surface, silently.
  for (const state of ["exportError", "viewsError", "bulkError", "notifyError", "refreshError"]) {
    expect(page.match(new RegExp(`const statusError = [^;]*\\b${state}\\b`))).not.toBeNull();
  }
  for (const state of ["exportNotice", "viewMessage", "bulkMessage", "notifyMessage"]) {
    expect(page.match(new RegExp(`const statusNotice = [^;]*\\b${state}\\b`))).not.toBeNull();
  }
  expect(page).toContain("Refreshing submissions…");
});

test("CONTRACT · the strip's reserved height clears its tallest state", () => {
  // A `small` button is 26px; 12px of padding and the 1px rule bring the
  // selected state to 39px. Reserve less and checking a row grows the strip and
  // pushes the row out from under the pointer that checked it.
  expect(styles).toMatch(/\.table-status-bar \{[^}]*min-height: 40px/);
});
