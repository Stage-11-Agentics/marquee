import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("CONTRACT · CNT-12 the record API exposes an audited reversible publication route", async () => {
  const route = await source("src/routes/submission-record.routes.ts");

  assert.match(route, /path: "\/api\/v1\/events\/\{eventId\}\/submissions\/\{submissionId\}\/unpublish"/);
  assert.match(route, /operationId: "unpublishSubmission"/);
  assert.match(route, /Sets agenda_items\.is_published = 0 and submissions\.is_published = 0/);
  assert.match(route, /auditStatementFromSelect/);
  assert.match(route, /action = published \? "published" : "unpublished"/);
  assert.match(route, /updated_at = \?/);
  assert.match(route, /this Session changed while/);
  assert.match(route, /publishSubmission, unpublishSubmission/);
});

test("CONTRACT · CNT-12 the record slot owns the publication control and reserves its geometry", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const css = await source("src/ui/submissions/record.css");

  assert.match(page, /const UNPUBLISH_ROUTE/);
  assert.match(page, /record\.actions\.can_unpublish/);
  assert.match(page, /Publish this session/);
  assert.match(page, /Remove from public site/);
  assert.match(page, /This Session's title, time, room, speakers, and description become public immediately\./);
  assert.match(page, /This Session disappears from the public agenda and embeds immediately\./);
  assert.match(page, /Live on the public site/);
  assert.match(page, /Not yet public/);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.doesNotMatch(page, /<Card><CardHeader title="Public site"/);
  assert.match(css, /\.record-publication-chip[^}]*min-width: 164px/);
  assert.match(css, /\.record-publication-trigger[^}]*min-width: 200px/);
  assert.match(css, /\.record-publication-action[^}]*min-height: 32px/);
});
