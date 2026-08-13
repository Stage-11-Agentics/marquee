/**
 * The reversal inventory's counts open onto the rows they count.
 *
 * "2 active" is not a decision an organizer can make. Reversing an acceptance
 * cancels a real person's portal tasks, kills queued mail, and can send a
 * calendar cancellation — so the screen has to be able to say WHICH tasks,
 * which mail, and whose invite, on the same card, before the button is pressed.
 */
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import { ReversalRow } from "../../src/ui/submissions/AcceptanceReversalPanel";

const tasks = [
  { id: "task-1", label: "Upload your headshot", detail: "open" },
  { id: "task-2", label: "Confirm your travel dates", detail: "done" },
];

function row(open: boolean, rows = tasks): string {
  return renderToString(h(ReversalRow, {
    id: "portal-tasks",
    title: "Portal tasks",
    count: `${rows.length} row(s)`,
    state: "1 active",
    rows,
    empty: "No portal tasks were created for this talk.",
    open,
    onToggle: () => undefined,
  }));
}

describe("CONTRACT · the reversal inventory can be opened onto its own rows", () => {
  test("CONTRACT · the count is a control, not a label", () => {
    const html = row(false);
    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="reversal-detail-portal-tasks"');
  });

  test("CONTRACT · closed, the row still reports the count and the state test hook", () => {
    const html = row(false);
    expect(html).toContain('data-row-state="portal-tasks"');
    expect(html).toContain("1 active");
    expect(html).toContain("2 row(s)");
  });

  test("CONTRACT · open, every counted row is named", () => {
    const html = row(true);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Upload your headshot");
    expect(html).toContain("Confirm your travel dates");
    expect(html).not.toContain('id="reversal-detail-portal-tasks" hidden');
    // And closed, the same rows are held out of the accessibility tree rather
    // than merely painted over.
    expect(row(false)).toContain('id="reversal-detail-portal-tasks" hidden');
  });

  test("CONTRACT · nothing to show says so rather than opening onto an empty box", () => {
    expect(row(true, [])).toContain("No portal tasks were created for this talk.");
  });
});
