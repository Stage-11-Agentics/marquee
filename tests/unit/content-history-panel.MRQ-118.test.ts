import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import { ContentHistory, type HistoryEntryView } from "../../src/ui/history/ContentHistory";

/**
 * The organizer's History panel (MRQ-118) — CNT-11's scoring surface.
 *
 * The panel used to print `actor_kind`, so every row read the literal string
 * "user" where a person's name belongs. That is the exact failure CNT-11
 * grades ("entries attributed to Jordan Alvarez"), and it was invisible to
 * every existing test because nothing rendered this card.
 */

const historyStyles = readFileSync(fileURLToPath(new URL("../../src/ui/history/history.css", import.meta.url)), "utf8");
const recordStyles = readFileSync(fileURLToPath(new URL("../../src/ui/submissions/record.css", import.meta.url)), "utf8");

const label = (action: string): string => action.replace(/[._]/g, " ");
const moment = (value: number | null): string => (value === null ? "—" : "12 Aug");

function entry(overrides: Partial<HistoryEntryView> = {}): HistoryEntryView {
  return {
    id: "aud_1",
    action: "content_updated",
    actor_name: "Priya Raman",
    created_at: 1_786_000_000_000,
    before: { title: "Taming 40-Minute CI", abstract: "Original." },
    restorable: true,
    ...overrides,
  };
}

test("CONTRACT · CNT-11 · a history row renders the editor's name, never the actor kind", () => {
  const html = renderToString(h(ContentHistory, { entries: [entry()], label, moment, onRestore: () => {} }));
  expect(html).toContain("Priya Raman");
  // The bug this replaced: `<span>{entry.actor_kind}</span>` printed "user".
  expect(html).not.toMatch(/>user</);
});

test("CONTRACT · an actor-less history row says so rather than borrowing someone's name", () => {
  const html = renderToString(h(ContentHistory, { entries: [entry({ actor_name: null })], label, moment, onRestore: () => {} }));
  expect(html).toContain("Conference team");
});

test("CONTRACT · CNT-11 · a restorable row offers the control and names the version it restores to", () => {
  const html = renderToString(h(ContentHistory, { entries: [entry()], label, moment, onRestore: () => {} }));
  expect(html).toContain("Restore this version");
  // An audit row records a CHANGE, so "restore" is ambiguous without saying
  // which version is on the other end of the button. The preview is what makes
  // CNT-S3 step 9 ("restore the version prior to the second edit") followable
  // without guessing.
  expect(html).toContain("Restores:");
  expect(html).toContain("Taming 40-Minute CI");
});

test("CONTRACT · a non-content history row appears in the timeline but offers no restore", () => {
  const html = renderToString(h(ContentHistory, {
    entries: [entry({ action: "scheduled", restorable: false, before: null })],
    label, moment, onRestore: () => {},
  }));
  expect(html).toContain("scheduled");
  expect(html).not.toContain("Restore this version");
});

test("CONTRACT · without an onRestore handler the history panel is read-only", () => {
  const html = renderToString(h(ContentHistory, { entries: [entry()], label, moment }));
  expect(html).not.toContain("Restore this version");
});

test("CONTRACT · an empty history says so instead of rendering a bare panel", () => {
  const html = renderToString(h(ContentHistory, { entries: [], label, moment }));
  expect(html).toContain("No history recorded.");
});

test("CONTRACT · history rows cannot jump when a restore control swaps for its confirm", () => {
  // House rule: elements never jump. The action column exists on every row
  // whether or not that row is restorable, and it reserves height so
  // "Restore this version" → "Confirm / Cancel" cannot resize the row and
  // shove every entry below it.
  expect(historyStyles).toMatch(/\.history-row \{[^}]*grid-template-columns: 1fr 190px;/);
  expect(historyStyles).toMatch(/\.history-action \{[^}]*min-height: 26px;/);
});

test("CONTRACT · the content save button cannot resize as its label changes", () => {
  // The button reads "Save changes", then "Confirm public update", then
  // "Saving…". A width that tracked the label would move the cue beside it on
  // every state change.
  expect(recordStyles).toMatch(/\.record-content-save \{ min-width: \d+px; \}/);
  expect(recordStyles).toMatch(/\.record-content-cue \{[^}]*min-height: \d+px;/);
});
