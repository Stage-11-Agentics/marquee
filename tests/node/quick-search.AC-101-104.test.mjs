import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("../../src/ui/shell/AppShell.tsx", import.meta.url), "utf8");
const topbar = readFileSync(new URL("../../src/ui/shell/Topbar.tsx", import.meta.url), "utf8");
const routeTable = readFileSync(new URL("../../src/ui/shell/route-table.ts", import.meta.url), "utf8");
const quickSearch = readFileSync(new URL("../../src/ui/shell/QuickSearch.tsx", import.meta.url), "utf8");
const matcher = readFileSync(new URL("../../src/lib/quick-search.ts", import.meta.url), "utf8");
const searchRoute = readFileSync(new URL("../../src/routes/search.routes.ts", import.meta.url), "utf8");
const speed = readFileSync(new URL("../../scripts/checks/speed.ts", import.meta.url), "utf8");
const deliveryHealthShell = readFileSync(new URL("../../src/ui/health/DeliveryHealthShell.tsx", import.meta.url), "utf8");
const appEntry = readFileSync(new URL("../../src/ui/app.tsx", import.meta.url), "utf8");

const routeRows = [...routeTable.matchAll(/^\s*\{ id: "([^"]+)", path: "([^"]+)"[^\n]*\},?$/gm)].map((match) => ({
  id: match[1],
  path: match[2],
  source: match[0],
}));

/**
 * The honest ways a route can sit outside the admin shell, read from the code
 * that decides it rather than from a list somebody keeps up to date:
 *
 *   1. `app.tsx` routes it without AppShell — either its public-page predicate
 *      or one of its own render branches.
 *   2. `AppShell` returns it before drawing the admin chrome.
 *
 * `external: true` is the route table's way of saying "not an admin shell page",
 * and it is also the easiest thing in this repo to reach for when a screen will
 * not cooperate. Pinning the *set* catches the addition; checking the *reason*
 * catches the dodge, which is the failure actually worth stopping.
 */
const appEntryExact = [...appEntry.matchAll(/pathname\s*===\s*"([^"]+)"/g)].map((match) => match[1]);
const appEntryPrefixes = [...appEntry.matchAll(/pathname\.startsWith\("([^"]+)"\)/g)].map((match) => match[1]);
const shellEarlyReturns = [...appShell.matchAll(/location\.pathname === "([^"]+)"\) return </g)].map((match) => match[1]);

function outsideTheShellBecause(pathname) {
  if (appEntryExact.includes(pathname) || appEntryPrefixes.some((prefix) => pathname.startsWith(prefix))) return "app.tsx routes it without AppShell";
  if (shellEarlyReturns.includes(pathname)) return "AppShell returns it before the admin chrome";
  return null;
}

test("AC-101 · every AppShell admin route is covered by one shared QuickSearch mount", () => {
  assert.ok(routeRows.length >= 20, "route-table contract should enumerate the installed routes");
  const external = routeRows.filter((row) => row.source.includes("external: true"));
  assert.deepEqual(external.map((row) => row.id).sort(), ["co-speaker", "delivery-health", "embeds", "event-site", "portal", "system-health"]);
  // Every one of them earns it. A route marked external that the shell would
  // happily have rendered is a screen quietly removed from the shared search,
  // and this is the assertion that refuses it.
  for (const row of external) {
    const pathname = row.path.split("?")[0];
    const reason = outsideTheShellBecause(pathname);
    assert.ok(reason, `route "${row.id}" (${row.path}) is marked external: true, but AppShell renders it — it belongs inside the shared shell, not outside it`);
  }
  const separate = routeRows.filter((row) => row.source.includes("external: true") || ["reviewer", "reviewer-queue"].includes(row.id));
  assert.deepEqual(separate.map((row) => row.id).sort(), ["co-speaker", "delivery-health", "embeds", "event-site", "portal", "reviewer", "reviewer-queue", "system-health"]);
  // Delivery health carries the shared chrome itself, so the guarantee holds
  // there the same way: one shared search mount over the same route table.
  assert.equal((deliveryHealthShell.match(/<QuickSearch\b/g) ?? []).length, 1);
  assert.match(deliveryHealthShell, /<Sidebar\b/);
  assert.match(deliveryHealthShell, /<Topbar\b/);
  const admin = routeRows.filter((row) => !row.source.includes("external: true") && !["api-docs", "reviewer", "reviewer-queue"].includes(row.id));
  assert.equal(admin.length, routeRows.length - external.length - 3);
  assert.match(routeTable, /\["reviewer", "reviewer-queue", "api-docs"\]/);
  assert.match(routeTable, /export const adminRouteTable[^=]*= routeTable\.filter\(isAdminRoute\)/);
  assert.equal((appShell.match(/<QuickSearch\b/g) ?? []).length, 1);
  assert.match(appShell, /openSearch=\{openSearch\}/);
  assert.match(topbar, /data-global-search-trigger/);
  assert.match(appShell, /event\.key === "\/"/);
  assert.match(appShell, /event\.metaKey \|\| event\.ctrlKey/);
  assert.doesNotMatch(appShell, /Search becomes available when the conference data API lands/);
});

test("AC-102 · the authenticated result contract carries all four visible type labels in one list", () => {
  assert.match(searchRoute, /path: "\/api\/v1\/events\/\{eventId\}\/search"/);
  assert.match(searchRoute, /z\.enum\(SEARCH_RESULT_TYPES\)/);
  for (const label of ["Abstract", "Session", "Speaker", "Form"]) assert.match(searchRoute, new RegExp(`"${label}"`));
  assert.match(searchRoute, /data: rankSearchCandidates\(candidates, q, SEARCH_RESULT_LIMIT\)/);
  assert.match(quickSearch, /role="listbox"/);
  assert.match(quickSearch, /data-search-result/);
  assert.match(quickSearch, /result\.type/);
});

test("AC-103 · the speed gate measures ten real keystroke-to-painted queries at the 200ms budget", () => {
  assert.match(speed, /const searchTerms = \[/);
  assert.match(speed, /Casy/);
  assert.match(speed, /Dhinkran/);
  assert.match(speed, /retrieval systms/);
  assert.match(speed, /pressSequentially/);
  assert.match(speed, /data-search-painted-query/);
  assert.match(speed, /global-search-painted/);
  assert.match(speed, /final keystroke/);
  assert.match(speed, /searchValues\.length/);
});

test("AC-104 · fuzzy name/title matching normalizes diacritics and preserves canonical record hrefs", () => {
  assert.match(matcher, /normalize\("NFD"\)/);
  assert.match(matcher, /function subsequenceScore/);
  assert.match(searchRoute, /href: `\/submissions\/\$\{encodeURIComponent\(row\.id\)\}`/);
  assert.match(searchRoute, /`\/roster\?person=\$\{encodeURIComponent\(row\.id\)\}`/);
  assert.match(searchRoute, /`\/onboarding\?person=\$\{encodeURIComponent\(row\.id\)\}`/);
  assert.match(searchRoute, /href: `\/forms\?form=\$\{encodeURIComponent\(row\.id\)\}`/);
  assert.match(searchRoute, /requireSubmissionRead\(context, eventId\)/);
  assert.match(searchRoute, /form_admins scoped_admin/);
});
