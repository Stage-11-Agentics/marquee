import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../src/routes/agenda.routes.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../../src/routes/agenda.queries.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../src/ui/agenda/AgendaPage.tsx", import.meta.url), "utf8");
const trackBoard = readFileSync(new URL("../../src/ui/agenda/track-board.tsx", import.meta.url), "utf8");

test("CONTRACT · AIA-07 batch publication is an accepted, scheduled, dual-table command", () => {
  assert.match(route, /path: "\/api\/v1\/events\/\{eventId\}\/agenda\/publish"/);
  assert.match(route, /submission\.status = 'accepted'/);
  assert.match(route, /UPDATE agenda_items AS item/);
  assert.match(route, /UPDATE submissions AS submission/);
  assert.match(route, /auditStatementFromSelect/);
  assert.match(route, /const auditStatements = submissionIds\.map/);
  assert.match(route, /MAX_BATCH_PUBLISH_IDS/);
  assert.match(route, /submission\.id IN \(SELECT CAST\(value AS TEXT\) FROM json_each\(\?\)\)/);
  assert.match(route, /candidate_submission\.id IN \(SELECT CAST\(value AS TEXT\) FROM json_each\(\?\)\)/);
  assert.match(route, /the selected Sessions changed while publishing/);
  assert.match(queries, /blocked_reason/);
  assert.match(queries, /public_agenda_url/);
});

test("CONTRACT · AIA-07 + CFP-15 publication preview and agenda drop targets expose truthful refs", () => {
  assert.match(page, /live <span aria-hidden="true">·<\/span> .*not yet public/);
  assert.match(page, /Select all/);
  assert.match(page, /Publish in batches of up to/);
  assert.match(page, /Review publication/);
  assert.match(page, /Publish \$\{selectedCandidates\.length\} to public agenda/);
  assert.match(page, /needs a room and time before it can go public/);
  assert.match(page, /disabled=\{disabled \|\| !candidate\.can_publish/);
  assert.match(page, /role="group"\n    aria-label=\{ariaLabel\}\n    data-agenda-drop-target="true"/);
  assert.match(page, /Place Session on/);
  assert.match(page, /aria-label="Unscheduled sessions to place"/);
  assert.match(trackBoard, /role="group"\n    aria-label=\{ariaLabel\}\n    data-agenda-drop-target="true"/);
  assert.match(trackBoard, /Place Session in/);
});

test("CONTRACT · agenda builder puts the placement workspace before the publication checklist", () => {
  const toolbar = page.indexOf('<div class="agenda-toolbar card">');
  const layout = page.indexOf('<div class="agenda-layout">');
  const publication = page.indexOf("<PublicationPanel");
  assert.ok(toolbar >= 0 && layout >= 0 && publication >= 0, "agenda builder landmarks are present");
  assert.ok(toolbar < layout, "toolbar must precede the placement workspace");
  assert.ok(layout < publication, "publication checklist must follow the placement workspace");
});
