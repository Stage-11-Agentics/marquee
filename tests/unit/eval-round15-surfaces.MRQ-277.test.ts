import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), "utf8");
}

/**
 * MRQ-277 D8. The agenda builder's Room details panel is `position: fixed` over
 * the top-right of the screen, which is where the publication controls live.
 * With no Escape and no click-outside, its only exit was a 22px × in its corner
 * — Escape did nothing, scrolling did nothing (it is fixed, by design), and
 * every click aimed at the panel underneath landed on the floating layer
 * instead, so opening Room details made publish unreachable.
 *
 * Both floating panels share the hook, because they share the position and
 * therefore share the trap.
 */
test("CONTRACT · MRQ-277 · the agenda's floating panels close on Escape and on a click outside", () => {
  const agenda = source("ui/agenda/AgendaPage.tsx");
  expect(agenda).toMatch(/function useDismissablePanel/);
  expect(agenda).toMatch(/addEventListener\("keydown"/);
  expect(agenda).toMatch(/event\.key === "Escape"/);
  // mousedown, not click: the gesture that dismisses must still reach the
  // control the operator was aiming at.
  expect(agenda).toMatch(/addEventListener\("mousedown"/);
  expect(agenda).toMatch(/!node\.contains\(event\.target\)/);
  // Both panels, not just the one the eval happened to open.
  expect(agenda).toMatch(/function RoomPanel[\s\S]{0,400}useDismissablePanel\(onClose\)/);
  expect(agenda).toMatch(/export function ConflictPanel[\s\S]{0,900}useDismissablePanel\(onClose\)/);
});

/**
 * MRQ-277 D11. Saving a list navigated straight to the Lists tab while `lists`
 * still held the answer from before the write, so a list that existed rendered
 * as "No lists yet · Lists · 0" — and an organizer's reasonable next move is to
 * save it again. Every sibling write on this screen reloads; this one did not.
 */
test("CONTRACT · MRQ-277 · saving a list refreshes the tab that is about to show it", () => {
  const people = source("ui/people/PeoplePage.tsx");
  const onSaved = people.match(/onSaved=\{\(list\) => \{[\s\S]*?\}\}/)?.[0] ?? "";
  expect(onSaved).not.toBe("");
  // The row the server just returned, so the tab is never briefly wrong…
  expect(onSaved).toMatch(/setLists\(/);
  // …and a reload behind it, so the optimistic row is reconciled with truth.
  expect(onSaved).toMatch(/setReloadToken\(/);
});
