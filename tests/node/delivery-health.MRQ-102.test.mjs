import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync(new URL("../../src/ui/shell/Sidebar.tsx", import.meta.url), "utf8");
const routeTable = readFileSync(new URL("../../src/ui/shell/route-table.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../src/ui/health/DeliveryHealthPage.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../src/ui/health/DeliveryHealthShell.tsx", import.meta.url), "utf8");

test("AC-1 · system health is rendered in the sidebar, from the route table", () => {
  // It moved from a nav row to the sidebar footer, beside API & CLI, where the
  // system's own entrances belong (v1.15). Still a real external route, still
  // rendered by the sidebar, and still read out of the route table rather than
  // written twice — so a path change moves the link instead of orphaning it.
  assert.match(routeTable, /id: "system-health"[^\n]*group: "utility"[^\n]*external: true/);
  assert.match(sidebar, /matchRoute\("\/delivery-health", "\?view=system"\)/);
  assert.match(sidebar, /href=\{SYSTEM_HEALTH_PATH\}/);
  assert.match(sidebar, /System health/);
});

test("AC-4 · the owed headline is an exact-set browser link", () => {
  assert.match(page, /class="health-summary-link"/);
  assert.match(page, /href=\{owedHref\}/);
  assert.match(page, /navigate\(owedHref\)/);
});

test("AC-7 · both health modes retain dedicated fixed-shape loading branches", () => {
  assert.match(shell, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(page, /mode === "system-health"/);
  assert.match(page, /CapabilitySkeleton/);
  assert.match(page, /FollowupsSkeleton/);
  assert.match(page, /OWED_LEDGER_LIMIT/);
});
