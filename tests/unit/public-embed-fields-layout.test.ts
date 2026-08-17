import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../../src/ui/embeds/EmbedPage.tsx", import.meta.url)), "utf8");

/**
 * MRQ-277 D10. The FIELDS checkboxes rendered their labels as vertical columns
 * of single letters — "S/E/S/S/I/O/N/T/I/T/L/E" — which made choosing a field
 * guesswork. Two rules did it together, and both are asserted here because
 * either one alone brings it back:
 *
 * - `.embed-field input` stretches the panel's text inputs to full width, and a
 *   checkbox caught by that rule takes the whole grid track, leaving its label
 *   about one character of room.
 * - `overflow-wrap: anywhere` lets a box shrink below its longest word, so that
 *   one character of room is a legal layout rather than an overflow.
 *
 * The grid is also asserted responsive: two fixed tracks in a narrow panel is
 * what put the label under that pressure in the first place.
 */
test("CONTRACT · an embed field checkbox keeps its own width and its label stays on one line", () => {
  expect(source).toMatch(/\.embed-field-option-grid \{[^}]*grid-template-columns: repeat\(auto-fit,/);
  expect(source).toMatch(/\.embed-field \.embed-field-option \{[^}]*align-items: flex-start;/);
  expect(source).toMatch(/\.embed-field \.embed-field-option > span \{[^}]*overflow-wrap: break-word;/);
  expect(source).not.toMatch(/\.embed-field-option > span \{[^}]*overflow-wrap: anywhere;/);
  expect(source).toMatch(/\.embed-field \.embed-field-option input\[type=checkbox\] \{[^}]*width: auto;/);
});

/**
 * These labels are the organizer's own vocabulary — "Session title", not a
 * micro-label — and `.embed-field label` would otherwise paint them uppercase
 * mono, because a class-plus-element selector outranks the bare class.
 */
test("CONTRACT · embed field option labels are prose, not micro-labels", () => {
  expect(source).toMatch(/\.embed-field \.embed-field-option \{[^}]*text-transform: none;/);
});
