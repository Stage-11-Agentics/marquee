import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows } from "../../scripts/seed/index.ts";

const rows = await buildSeedRows();
const fields = rows
  .filter((entry) => entry.table === "form_fields" && entry.row.form_id === "frm_cfp")
  .sort((left, right) => Number(left.row.position) - Number(right.row.position))
  .map((entry) => entry.row);

test("AC-234 · the seeded CFP exposes the complete participant, file, track, and conditional baseline", () => {
  assert.deepEqual(fields.map((field) => field.key), [
    "title", "abstract", "audience_outcome", "format", "tracks",
    "speaker_name", "speaker_email", "speaker_role", "speaker_company",
    "biography", "headshot", "co_speaker_name", "co_speaker_email",
    "supporting_file", "vendor_content", "vendor_product",
  ]);

  const tracks = fields.find((field) => field.key === "tracks");
  assert.deepEqual(JSON.parse(tracks.config), {
    options: ["AI in Financial Services", "Agents", "Evals", "Infra", "Open Models", "RAG/Retrieval", "Security", "Leadership"],
    minItems: 1,
  });
  assert.equal(fields.find((field) => field.key === "headshot").required, 1);
  assert.equal(fields.find((field) => field.key === "co_speaker_name").required, 0);
  assert.equal(fields.find((field) => field.key === "supporting_file").required, 0);
  assert.deepEqual(JSON.parse(fields.find((field) => field.key === "vendor_product").condition), {
    all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }],
  });
});
