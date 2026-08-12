import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "src/ui/files/FilesPage.tsx"), "utf8");
const dialog = fs.readFileSync(path.join(root, "src/ui/files/BulkExportDialog.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "src/routes/files-export.routes.ts"), "utf8");

test("MRQ-117 · Files selection mounts a discoverable export dialog", () => {
  assert.match(page, /Download files \(\{selected\.size\}\)/);
  assert.match(page, /selectedRows/);
  assert.match(page, /<BulkExportDialog eventId=\{eventId\} rows=\{selectedRows\}/);
  assert.match(dialog, /Export deliverables/);
  assert.match(dialog, /By session|Session/);
  assert.match(dialog, /By speaker|Speaker/);
  assert.match(dialog, /Preparing your download/);
  assert.match(dialog, /Ready to download/);
  assert.match(dialog, /manifest\.txt/);
  assert.match(dialog, /Remove/);
});

test("MRQ-117 · export route remains latest-pointer and manifest honest", () => {
  assert.match(route, /listVersionsForOwners\(/);
  assert.match(route, /version\.is_latest/);
  assert.match(route, /manifest\.txt/);
  assert.match(route, /application\/zip/);
  assert.match(route, /task\.event_id = \?/);
});
