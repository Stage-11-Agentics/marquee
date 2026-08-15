import assert from "node:assert/strict";
import test from "node:test";

import { seedId } from "../../src/lib/ids.ts";
import { SPONSOR_WRITEBACK_TEMPLATE_IDS } from "../../src/lib/sponsors/deliverable-templates.ts";

/**
 * The write-back template ids are literals because the constant has to be
 * importable from both the Node seed generator and the Vite-built Worker, and a
 * shared file that imports a helper cannot be. This is the assertion that keeps
 * the literals honest: they must be exactly what `seedId` would produce, so a
 * seeded template and the server's dispatch can never name different rows.
 */
test("CONTRACT · sponsor write-back template ids are the seed ids they claim to be", () => {
  assert.deepEqual(SPONSOR_WRITEBACK_TEMPLATE_IDS, {
    companyDetails: seedId("tpl", "sponsor-company-details"),
    nameYourSpeaker: seedId("tpl", "sponsor-name-your-speaker"),
    sessionContent: seedId("tpl", "sponsor-session-content"),
  });
  // Distinct, and none of them collide with a speaker template.
  const ids = Object.values(SPONSOR_WRITEBACK_TEMPLATE_IDS);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^tpl_sponsor-/);
});
