/**
 * Populate the answer and file surfaces that the reviewer walkthrough reads.
 *
 * The source seed deliberately keeps people and submissions deterministic; this
 * module supplies the ordinary form content that makes those records useful in
 * the product. Conditional answers are projected here with the same rule as
 * the public form: vendor_product exists only when vendor_content is Yes.
 */

import { seedId } from "../../src/lib/ids.ts";
import type { SeedContext, SeedModule, SeedRow } from "./_sql.ts";
import { EVENT_ID, FORM_IDS } from "./event.ts";

function table(ctx: SeedContext, name: string): SeedRow["row"][] {
  return ctx.rows.filter((entry) => entry.table === name).map((entry) => entry.row);
}

export function run(ctx: SeedContext): void {
  const submissions = table(ctx, "submissions").filter((row) => row.form_id === FORM_IDS.cfp);
  const fields = new Map(
    table(ctx, "form_fields")
      .filter((row) => row.form_id === FORM_IDS.cfp)
      .map((row) => [String(row.key), row]),
  );
  const formats = new Map(table(ctx, "formats").map((row) => [String(row.id), String(row.name)]));
  const tracks = new Map(table(ctx, "tracks").map((row) => [String(row.id), String(row.name)]));

  const answer = (
    submissionId: string,
    key: string,
    value: string | null,
    valueJson: string | null = null,
  ): void => {
    const field = fields.get(key);
    if (!field) throw new Error(`CFP field ${key} is missing from the seed`);
    ctx.add("submission_answers", {
      id: seedId("ans", `${submissionId}-${key}`),
      submission_id: submissionId,
      field_id: field.id,
      value_text: value,
      value_json: valueJson,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  };

  submissions.forEach((submission, index) => {
    const submissionId = String(submission.id);
    const format = formats.get(String(submission.format_id)) ?? "Stage Talk";
    const track = tracks.get(String(submission.primary_track_id)) ?? "AI in Financial Services";
    const vendorContent = index % 11 === 0 ? "Yes" : "No";

    answer(
      submissionId,
      "audience_outcome",
      "Attendees leave with a concrete operating move they can apply to their next production review.",
    );
    answer(submissionId, "format", format);
    answer(submissionId, "tracks", null, JSON.stringify([track]));
    answer(submissionId, "vendor_content", vendorContent);
    if (vendorContent === "Yes") answer(submissionId, "vendor_product", "Northstar Observability");
  });

  // The first forty in-review submissions are the organizer's unreviewed
  // queue. Attaching there makes the first real reviewer detail card useful,
  // while the remaining rows continue to exercise the no-file state.
  const queueCandidates = submissions.filter((submission) => submission.status === "in_review").slice(0, 40);
  for (const submission of queueCandidates) {
    const submissionId = String(submission.id);
    ctx.add("attachments", {
      id: seedId("att", `submission-file-${submissionId}`),
      event_id: EVENT_ID,
      owner_type: "submission_file",
      owner_id: submissionId,
      r2_key: `submission-files/${submissionId}/supporting-material.pdf`,
      filename: "supporting-material.pdf",
      content_type: "application/pdf",
      size_bytes: 4_096,
      status: "ready",
      sha256: null,
      r2_etag: `seed-etag-${submissionId}`,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }
}

export const seed: SeedModule = { name: "submission-content", order: 45, run };
