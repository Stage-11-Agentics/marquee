import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const filesPage = await readFile(new URL("../../src/ui/files/FilesPage.tsx", import.meta.url), "utf8");
const filesComments = await readFile(new URL("../../src/ui/files/FileComments.tsx", import.meta.url), "utf8");
const portalComments = await readFile(new URL("../../src/ui/portal/FileComments.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../../src/ui/files/files.css", import.meta.url), "utf8");

test("CONTRACT · MRQ-116 · organizer comments are mounted on the speaker-task row beside version history", () => {
  assert.match(filesPage, /import \{ FileComments \} from "\.\/FileComments"/);
  assert.match(filesPage, /<FileComments eventId=\{eventId\} taskId=\{row\.id\} attachmentId=\{row\.latest\?\.attachment_id \?\? null\} \/>/);
  assert.match(filesPage, /list=\{hasFile \? \{ owner_type: "task_upload", owner_id: row\.id/);
  assert.match(filesPage, /emptyCopy="No upload yet — this deliverable slot is open for context\."/);
  assert.match(filesPage, /hasFile \? "Versions" : "Details"/);
});

test("CONTRACT · MRQ-116 · both surfaces expose a truthful slot thread with version-tagged replies", () => {
  assert.match(filesComments, /\/api\/v1\/events\/\$\{encodeURIComponent\(eventId\)\}\/files\/\$\{encodeURIComponent\(taskId\)\}\/comments/);
  assert.match(filesComments, /threaded on this deliverable slot/);
  assert.match(filesComments, /comment\.author_name/);
  assert.match(filesComments, /comment\.author_role/);
  assert.match(filesComments, /comment\.attachment_version/);
  assert.match(portalComments, /\/api\/v1\/me\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/comments/);
  assert.match(styles, /\.files-comments[^\n]*min-height: 190px/);
});
