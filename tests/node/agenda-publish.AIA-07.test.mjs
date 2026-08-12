import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../src/routes/agenda.routes.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../../src/routes/agenda.queries.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../src/ui/agenda/AgendaPage.tsx", import.meta.url), "utf8");
const trackBoard = readFileSync(new URL("../../src/ui/agenda/track-board.tsx", import.meta.url), "utf8");

test("AIA-07 · batch publication is an accepted, scheduled, dual-table command", () => {
  assert.match(route, /path: "\/api\/v1\/events\/\{eventId\}\/agenda\/publish"/);
  assert.match(route, /submission\.status = 'accepted'/);
  assert.match(route, /UPDATE agenda_items AS item/);
  assert.match(route, /UPDATE submissions AS submission/);
  assert.match(route, /INSERT INTO audit_log/);
  assert.match(route, /the selected Sessions changed while publishing/);
  assert.match(queries, /item\.is_published = 0/);
  assert.match(queries, /submission\.status = 'accepted'/);
  assert.match(queries, /public_agenda_url/);
});

test("AIA-07 + CFP-15 · publication preview and agenda drop targets expose truthful refs", () => {
  assert.match(page, /live <span aria-hidden="true">·<\/span> .*not yet public/);
  assert.match(page, /Review publication/);
  assert.match(page, /Publish \$\{selectedCandidates\.length\} to public agenda/);
  assert.match(page, /role="group"\n    aria-label=\{ariaLabel\}\n    data-agenda-drop-target="true"/);
  assert.match(page, /Place Session on/);
  assert.match(page, /role="region" aria-label="Unscheduled sessions to place"/);
  assert.match(trackBoard, /role="group"\n    aria-label=\{ariaLabel\}\n    data-agenda-drop-target="true"/);
  assert.match(trackBoard, /Place Session in/);
});
