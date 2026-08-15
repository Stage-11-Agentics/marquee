import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const page = fs.readFileSync(path.join(root, "src/ui/settings/TaskTemplatesPage.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "src/ui/shell/AppShell.tsx"), "utf8");
// The portal is two files since MRQ-214 extracted the task machinery the sponsor
// portal shares. Read both, so the assertion follows the code.
const portal = [
  fs.readFileSync(path.join(root, "src/ui/portal/PortalPage.tsx"), "utf8"),
  fs.readFileSync(path.join(root, "src/ui/portal/task-machinery.tsx"), "utf8"),
].join("\n");
const styles = fs.readFileSync(path.join(root, "src/ui/settings/settings.css"), "utf8");

test("CONTRACT · MRQ-96 · the existing task-template route is a real organizer editor", () => {
  assert.match(appShell, /TaskTemplatesPage/);
  assert.match(appShell, /route\?\.id === "task-templates"/);
  assert.match(page, /\/api\/v1\/events\/\$\{encodeURIComponent\(eventId\)\}\/task-templates/);
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /file_config: template\.file_config/);
});

test("CONTRACT · MRQ-96 · the editor offers named presets, arbitrary extensions, and MB limits", () => {
  assert.match(page, /Slides \(PDF, PPTX, Keynote\)/);
  assert.match(page, /label: "Documents"/);
  assert.match(page, /label: "Images"/);
  assert.match(page, /label: "Video"/);
  assert.match(page, /Custom extensions/);
  assert.match(page, /MAX_FILE_SIZE_MB = 100/);
  assert.match(page, /maxBytes: megabytes \* BYTES_PER_MB/);
});

test("CONTRACT · MRQ-96 · the speaker portal still renders the edited accepted line and limit", () => {
  assert.match(portal, /Accepted: \$\{accept\}/);
  assert.match(portal, /Limit: \$\{formatBytes\(task\.payload\.max_bytes\)\}/);
  assert.match(portal, /validateClientUpload\(file, \{ accept: task\.payload\.accept, maxBytes: task\.payload\.max_bytes \}\)/);
});

test("CONTRACT · MRQ-96 · preset controls reserve their layout instead of reflowing when selected", () => {
  assert.match(styles, /\.task-template-preset-grid[^\n]*grid-auto-rows: minmax\(56px, auto\)/);
  assert.match(styles, /\.task-template-preset[^\n]*min-height: 56px/);
});
