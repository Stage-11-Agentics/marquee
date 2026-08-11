import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const uiPath = new URL("../../src/ui/submissions/AcceptanceReversalPanel.tsx", import.meta.url);
const routePath = new URL("../../src/routes/submission-reversal.routes.ts", import.meta.url);
const ui = await readFile(uiPath, "utf8");
const route = await readFile(routePath, "utf8");

test("AC-123 · reversal dialog names every dependent row set with cancel and retain choices", () => {
  assert.match(ui, /Portal tasks/);
  assert.match(ui, /Cancel open tasks/);
  assert.match(ui, /Keep tasks active/);
  assert.match(ui, /Scheduled emails/);
  assert.match(ui, /Cancel queued emails/);
  assert.match(ui, /Retain queued emails/);
  assert.match(ui, /Calendar invites/);
  assert.match(ui, /Send cancellation/);
  assert.match(ui, /Retain invite/);
  assert.match(ui, /data-row-state/);
  assert.match(ui, /reversal-branch-summary/);
  assert.match(ui, /data-task-branch/);
  assert.match(ui, /unfinished portal work will be cancelled and no longer chased/);
  assert.match(ui, /unfinished portal work will remain open and continue to be chased/);
  assert.notEqual(
    ui.match(/unfinished portal work will be cancelled and no longer chased/)?.[0],
    ui.match(/unfinished portal work will remain open and continue to be chased/)?.[0],
  );
  assert.match(ui, /POST/);
  assert.match(route, /scheduled_emails/);
  assert.match(route, /calendar_invites/);
  assert.match(route, /choiceSchema/);
});
