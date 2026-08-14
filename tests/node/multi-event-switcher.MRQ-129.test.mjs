/**
 * The switcher's box, and the CLI's conference verbs.
 *
 * Source-and-CSS contracts, so they belong in the Worker-free project — the
 * behaviour they guard is already exercised through the Worker in
 * `tests/integration/multi-event.MRQ-129.test.ts`.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COMMAND_REGISTRY, COPY_SETS } from "../../cli/registry.mjs";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

/** The declaration block for one selector, so values can be read out of it. */
function ruleFor(css, selector) {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `no CSS rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("CONTRACT · MRQ-129 promoting the caption to a control moves nothing below it", async () => {
  const css = await source("src/styles/components.css");
  const context = ruleFor(css, ".event-context");

  // The row's height is pinned by the 32px ＋ beside it and the caption's own
  // 2px 10px box. The prototype draws a fully bordered switcher; adopting that
  // border would add two hairlines to this element and push every navigation
  // row below it down. DESIGN.md's craft rule and the operator's UI ruling both
  // make that a defect rather than a detail, so the control keeps the caption's
  // geometry exactly and spends its new weight in the popover instead.
  assert.match(context, /padding: 2px 10px/);
  assert.match(context, /border-left: 2px solid var\(--line-strong\)/);
  assert.match(context, /border: 0/);
  assert.match(context, /background: none/);
  // 6px below, not 18px: the picker wears the "Conference" group label above it
  // now (v1.15), so it reads as the head of the conference's nav rather than a
  // floating control. That is a deliberate ruled change to the gap BELOW the
  // row — the control's own box, which is what this test protects, is untouched.
  assert.match(ruleFor(css, ".event-context-row"), /margin: 0 4px 6px/);
  assert.match(ruleFor(css, ".event-add"), /flex: 0 0 32px/);

  // Hover and expansion change color, never the box.
  const hover = ruleFor(css, 'button.event-context:hover, button.event-context[aria-expanded="true"]');
  assert.match(hover, /border-left-color/);
  assert.doesNotMatch(hover, /padding|border-width|border: /);

  // The popover carries the prototype's designed width and is measured onto the
  // viewport: the sidebar is a scroll container, and a scroll container clips
  // both axes, so a 264px popover laid out inside a 224px column would lose the
  // status chips and submission gauges it exists to show.
  const popover = ruleFor(css, ".switcher-pop");
  assert.match(popover, /position: fixed/);
  assert.match(popover, /width: 264px/);
  const switcher = await source("src/ui/shell/EventSwitcher.tsx");
  assert.match(switcher, /getBoundingClientRect\(\)/);
  assert.match(switcher, /window\.addEventListener\("scroll", position, true\)/);
});

test("CONTRACT · MRQ-129 the switcher is keyboard-operable and never a second create path", async () => {
  const switcher = await source("src/ui/shell/EventSwitcher.tsx");
  assert.match(switcher, /aria-expanded=\{open\}/);
  assert.match(switcher, /role="listbox"/);
  assert.match(switcher, /event\.key === "Escape"/);
  assert.match(switcher, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(switcher, /event\.key === "Enter"/);
  // Past eight conferences a list stops being scannable; below it, a filter box
  // is one more thing between the organizer and the row they can already see.
  assert.match(switcher, /const FILTER_THRESHOLD = 8/);
  assert.match(switcher, /events\.length > FILTER_THRESHOLD/);
  assert.doesNotMatch(switcher, /apiFetch/);

  // ⌘K grows conference rows rather than the product growing a second chord.
  const quickSearch = await source("src/ui/shell/QuickSearch.tsx");
  assert.match(quickSearch, /Switch to \{event\.name\}/);
  const shell = await source("src/ui/shell/AppShell.tsx");
  assert.match(shell, /event\.key\.toLowerCase\(\) === "k"/);
  assert.doesNotMatch(shell, /event\.key\.toLowerCase\(\) === "e"/);
});

test("CONTRACT · MRQ-129 the sidebar's external links carry the conference on screen", async () => {
  const sidebar = await source("src/ui/shell/Sidebar.tsx");
  // The public agenda and the speaker portal resolve their conference from
  // `?event=<slug>` and fall back to a default. Left alone, "Conference site"
  // opens conference A while the organizer is standing in conference B.
  assert.match(sidebar, /export function eventScopedPath/);
  assert.match(sidebar, /route\.external \? eventScopedPath\(route\.path, slug\) : route\.path/);
});

test("CONTRACT · MRQ-129 the CLI can list conferences and clone one", async () => {
  const paths = COMMAND_REGISTRY.map((command) => command.path.join(" "));
  assert.ok(paths.includes("event list"), "the CLI cannot answer which conferences exist");

  const create = COMMAND_REGISTRY.find((command) => command.path.join(" ") === "event create");
  assert.ok(create.set.includes("copy_from"), "event create cannot name a source conference");
  assert.ok(create.set.includes("copy"));
  const optionNames = create.options.map((option) => option.name.split(" ")[0]);
  assert.deepEqual(optionNames, ["--set", "--from", "--copy"]);

  // The sets the CLI advertises are the sets the engine implements; a divergence
  // here is an agent told to ask for something that does not exist.
  const manifest = await source("src/lib/events/copy-manifest.ts");
  const declared = [...manifest.matchAll(/^ {2}"([a-z_]+)",$/gm)].map((match) => match[1]);
  assert.deepEqual([...COPY_SETS].sort(), [...new Set(declared)].sort());

  const skill = await source("SKILL.md");
  assert.match(skill, /## Next year's conference/);
  assert.match(skill, /event create --set name=.*--from/s);
  assert.match(skill, /marquee\.mjs event list/);
});
