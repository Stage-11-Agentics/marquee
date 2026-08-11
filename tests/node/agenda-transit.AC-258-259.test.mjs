import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agendaPage = readFileSync(new URL("../../src/ui/agenda/AgendaPage.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../../src/ui/dashboard/DashboardPage.tsx", import.meta.url), "utf8");
const agendaStyles = readFileSync(new URL("../../src/ui/agenda/agenda.css", import.meta.url), "utf8");

test("AC-258 + AC-259 · one agenda conflict snapshot reaches the drawer, tiles, and dashboard metric", () => {
  assert.match(agendaPage, /const conflicts = conflictMarkers\(snapshot\.conflicts\)/);
  assert.match(agendaPage, /<ConflictPanel conflicts=\{snapshot\.conflicts\} sessions=\{snapshot\.sessions\}/);
  assert.match(agendaPage, /conflict\.kind === "transit" \? "Transit" : "Conflict"/);
  assert.match(agendaPage, /⚠ \{conflicts\.get\(session\.id\) \?\? "Conflict"\}/);
  assert.match(dashboardPage, /snapshot\.metrics\.map/);
  assert.match(dashboardPage, /metric\.id === "conflicts" \? "active conflicts"/);
  assert.match(agendaStyles, /\.agenda-conflict-panel/);
});

test("AC-259 · the binding conflict vocabulary is Transit, never Travel", () => {
  assert.match(agendaPage, /label="Agenda conflicts"/);
  assert.doesNotMatch(`${agendaPage}\n${dashboardPage}`, /Travel/);
});
