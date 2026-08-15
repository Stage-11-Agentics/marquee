/**
 * The organization surface as a reachability contract.
 *
 * Moving a page's home is the change most likely to leave a dead end behind:
 * the sidebar keeps pointing somewhere, or the old URL stops resolving, and
 * neither shows up in a test that only renders the new page. So this asserts
 * the map rather than the markup.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import { activeNavId, matchRoute, routesFor, routeTable, SIDEBAR_GROUPS } from "../../src/ui/shell/route-table";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

test("AC-301 · the organization surface is four reachable tabs under one sidebar row", () => {
  // Every tab path resolves to a real route. A tab that navigates to a 404 is
  // a dead end inside the surface, which the walkthrough rule forbids anywhere.
  const tabs = ["/org", "/org/organizers", "/org/server", "/org/tokens"];
  for (const path of tabs) {
    const route = matchRoute(path);
    expect(route, `${path} must resolve`).toBeDefined();
    // …and all four light the same row, because they are one surface.
    expect(activeNavId(route?.id)).toBe("org-settings");
  }

  // Exactly one sidebar row, closing the Organization group the way the
  // conference group ends in its own Settings row (ruling O1).
  const organization = routesFor("organization");
  const settingsRows = organization.filter((route) => route.label === "Settings");
  expect(settingsRows).toHaveLength(1);
  expect(settingsRows[0]).toMatchObject({ id: "org-settings", path: "/org", icon: "⚙" });
  expect(organization.at(-1)?.id).toBe("org-settings");

  // The conference stack still ends in its own Settings row — the symmetry is
  // the thing being taught, so losing either half is a defect. It sits in the
  // trailing `settings` group, which is the last group the sidebar draws.
  expect(routeTable.find((route) => route.id === "settings")).toMatchObject({
    path: "/settings",
    label: "Settings",
    group: "settings",
  });
  expect(SIDEBAR_GROUPS.at(0)).toBe("organization");
  expect(SIDEBAR_GROUPS.at(-1)).toBe("settings");
});

test("AC-301 · the old API-tokens URL still resolves after the move", () => {
  // A URL that has worked does not stop working because its home moved: agents
  // and bookmarks both hold this path.
  const legacy = matchRoute("/settings/api");
  expect(legacy?.id).toBe("api-tokens");
  expect(activeNavId(legacy?.id)).toBe("org-settings");

  // And it renders the same surface rather than a second implementation.
  const shell = read("src/ui/shell/AppShell.tsx");
  expect(shell).toContain('"api-tokens": "tokens"');
  expect(shell).not.toContain("<ApiTokensPage");
});

test("AC-301 · Conference settings gives up the organizers card and keeps what is genuinely event-scoped", () => {
  const settings = read("src/ui/settings/EventSettings.tsx");
  // The Organizers card was only in Conference settings because that is where
  // an organizer already looked. Its home now exists (ruling O2).
  expect(settings).not.toContain("OrganizersCard");
  // Nor does it still offer API tokens: that is the move (ruling O2).
  expect(settings).not.toContain("/settings/api");
  expect(settings).not.toMatch(/API tokens/i);
  // What is genuinely `event_id`-scoped stays where it was. Venues and speaker
  // tasks belong to one conference and did not move with the org-level rows.
  expect(settings).toContain("/settings/venues");
  expect(settings).toContain('navigate("/tasks")');
});

test("AC-301 · the tab strip reserves its width, so selecting a tab moves nothing", () => {
  const css = read("src/ui/org/org-settings.css");
  // A tab that grows when selected shoves its neighbours under the pointer.
  // The width is reserved up front and the active state is paint only.
  expect(css).toMatch(/\.org-tabs button \{[^}]*min-width:/s);
  // Select → Selected must not resize the control it is written on.
  expect(css).toMatch(/\.org-theme-card \.button \{[^}]*min-width:/s);

  // Every colour is a token. This stylesheet is outside check:design's reach
  // (it enforces components.css only), so the discipline is asserted here.
  const declarations = css.match(/(?:color|background|border-color|box-shadow)\s*:[^;]+;/g) ?? [];
  const literals = declarations.filter((line) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line));
  expect(literals).toEqual([]);
});
