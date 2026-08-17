import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows } from "../../scripts/seed/index.ts";
import { FORM_IDS } from "../../scripts/seed/event.ts";

const rows = await buildSeedRows();
const forms = new Map(
  rows
    .filter((entry) => entry.table === "forms")
    .map((entry) => [entry.row.id, entry.row]),
);

test("AC-395 · MRQ-245 · the demo CFP and Hotel/Travel forms inherit without an event setting row", () => {
  for (const id of [FORM_IDS.cfp, FORM_IDS.hotelTravel]) {
    assert.equal(forms.get(id)?.submitter_limit_inherit, 1, `form ${id} must inherit the event default`);
  }
  assert.equal(rows.some((entry) => entry.table === "event_settings" && entry.row.key === "submission_default_limit"), false);
});
