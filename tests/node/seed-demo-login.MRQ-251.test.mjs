import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows } from "../../scripts/seed/index.ts";
import {
  SHIPPED_DEMO_EVENT_ID,
  SHIPPED_DEMO_SPEAKER_PERSON_ID,
} from "../../src/lib/reset-demo/demo-fixture.ts";

const rows = await buildSeedRows();
const table = (name) => rows.filter((entry) => entry.table === name).map((entry) => entry.row);

test("CONTRACT · MRQ-251 · the demo-login speaker fixture resolves against generated seed rows", () => {
  const person = table("people").find((row) => row.id === SHIPPED_DEMO_SPEAKER_PERSON_ID);
  assert.ok(
    person,
    `demo-login fixture relationship: ${SHIPPED_DEMO_SPEAKER_PERSON_ID} must resolve to a generated people row`,
  );

  const membership = table("memberships").find(
    (row) => row.event_id === SHIPPED_DEMO_EVENT_ID
      && row.person_id === SHIPPED_DEMO_SPEAKER_PERSON_ID
      && row.role === "speaker",
  );
  assert.ok(
    membership,
    `demo-login fixture relationship: ${person.name} (${SHIPPED_DEMO_SPEAKER_PERSON_ID}) must resolve to a speaker membership for ${SHIPPED_DEMO_EVENT_ID}`,
  );
});
