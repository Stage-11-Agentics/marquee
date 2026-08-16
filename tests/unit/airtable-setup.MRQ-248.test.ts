import { expect, test } from "vitest";

import { mirrorActionFailureError } from "../../src/routes/mirror.routes";
import { mergeSetupProgress, mirrorSetupErrorSummary } from "../../src/ui/settings/AirtablePage";
import { MarqueeApiError } from "../../src/ui/shell/api-client";

function progress(role: "submissions" | "speaker_tasks" | "people", state: "created" | "adopted" | "complete") {
  return {
    role,
    label: role,
    table_id: `tbl_${role}`,
    state,
    expected_field_count: 1,
    conformant_field_count: 1,
    fields: [{ name: "marquee_id", state: state === "created" ? "created" as const : "adopted" as const }],
    missing_fields: [],
    organizer_fields: ["Organizer notes"],
    conflicts: [],
  };
}

test("MRQ-248 · setup progress keeps earlier per-column creation receipts across continuations", () => {
  const merged = mergeSetupProgress(
    [progress("submissions", "created")],
    [progress("submissions", "adopted"), progress("speaker_tasks", "complete")],
  );
  expect(merged.map((row) => row.role)).toEqual(["submissions", "speaker_tasks"]);
  expect(merged[0]).toMatchObject({
    state: "created",
    fields: [{ name: "marquee_id", state: "created" }],
    organizer_fields: ["Organizer notes"],
  });
  expect(merged[1]).toMatchObject({ state: "complete" });
});

test("MRQ-248 · schema mutation 403 and 429 envelopes keep only safe setup copy and retry progress", () => {
  const progressRows = [progress("submissions", "created")];
  const forbidden = mirrorActionFailureError({
    ok: false,
    field: "tables",
    code: "provider_forbidden",
    message: "Airtable denied schema.bases:write while adopting submissions.",
    details: { progress: progressRows },
  });
  expect(forbidden).toMatchObject({
    code: "forbidden",
    message: "Airtable denied schema.bases:write while adopting submissions.",
    details: { mirror_setup: true, progress: progressRows },
  });

  const limited = mirrorActionFailureError({
    ok: false,
    field: "tables",
    code: "rate_limited",
    retryable: true,
    message: "Airtable is rate-limiting schema setup for submissions; wait a moment and retry this table.",
    details: { continuation: "submissions", progress: progressRows },
  });
  expect(limited).toMatchObject({
    code: "rate_limited",
    headers: { "Retry-After": "1" },
    details: { mirror_setup: true, retryable: true, continuation: "submissions", progress: progressRows },
  });

  const clientError = new MarqueeApiError({
    code: limited.code,
    message: limited.message,
    status: limited.status,
    field: limited.field,
    details: limited.details,
    route: "/api/v1/mirror/mapping",
    requestId: "req_mrq248",
    serverAuthored: true,
  });
  const summary = mirrorSetupErrorSummary(clientError);
  expect(summary).toContain("Airtable is rate-limiting schema setup for submissions");
  expect(summary).not.toContain("provider-private");
});
