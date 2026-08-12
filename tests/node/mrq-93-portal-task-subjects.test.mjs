import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portal = await readFile(new URL("../../src/ui/portal/PortalPage.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../../src/ui/portal/portal.css", import.meta.url), "utf8");
const routes = await readFile(new URL("../../src/routes/portal.routes.ts", import.meta.url), "utf8");

test("CONTRACT · MRQ-93 keeps generic acknowledgement separate from the two subject-bearing templates", () => {
  assert.match(portal, /const FINALIZE_TALK_TEMPLATE_ID = "tpl_finalize-talk-description"/);
  assert.match(portal, /const FINALIZE_BIO_TEMPLATE_ID = "tpl_finalize-bio-and-photos"/);
  assert.match(portal, /task\.kind !== "acknowledge" \|\| task\.submission_id === null/);
  assert.match(portal, /I have read and acknowledge this task\./);
  assert.match(portal, /I have reviewed this talk title and abstract\./);
  assert.match(portal, /I have reviewed my speaker bio and headshot\./);
});

test("CONTRACT · MRQ-93 reuses the existing talk and profile write paths", () => {
  assert.equal((portal.match(/\/api\/v1\/me\/submissions\/\$\{submission\.id\}\/talk/g) ?? []).length, 1);
  assert.equal((portal.match(/requestJson\("\/api\/v1\/me\/profile"/g) ?? []).length, 1);
  assert.match(portal, /<TalkEditor submission=\{submission\} onSaved=\{onSaved\} \/>/);
  assert.match(portal, /<ProfileForm person=\{person\} onSaved=\{onSaved\} \/>/);
  assert.match(portal, /Talk editing is closed because the conference call for proposals is closed\./);
});

test("CONTRACT · MRQ-93 reserves the specialized task subject space and returns template identity", () => {
  assert.match(styles, /\.portal-subject-task[^\n]*min-height: 360px/);
  assert.match(styles, /\.portal-talk-task[^\n]*min-height: 310px/);
  assert.match(styles, /\.portal-profile-task[^\n]*min-height: 470px/);
  assert.match(styles, /\.portal-talk-editor-compact[^\n]*min-height: 212px/);
  assert.match(routes, /template_id: task\.template_id/);
});
