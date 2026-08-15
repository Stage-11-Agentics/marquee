import { expect, test } from "vitest";

import { parsePagination } from "../../src/api/pagination";
import { buildSpeakerRosterQueries, buildSpeakerStatusCountsQuery, ROSTER_STATUS_SQL } from "../../src/routes/speakers.queries";

/**
 * The roster badge is derived, never stored, so its precedence is the whole
 * contract. The server-side page, filter, detail, and facet counts must all
 * consume one SQL projection rather than each reimplementing it.
 */

test("CONTRACT · MRQ-111 · SPK-04 · the page, filter, and facets share one status projection", () => {
  const page = buildSpeakerRosterQueries(
    "evt_mrq111",
    { status: "confirmed" },
    parsePagination({ page: 1, per_page: 50 }),
  );
  const facets = buildSpeakerStatusCountsQuery("evt_mrq111");

  expect(page.dataSql).toContain(`${ROSTER_STATUS_SQL} AS roster_status`);
  expect(page.dataSql).toContain(`${ROSTER_STATUS_SQL} = ?`);
  expect(facets.sql).toContain(`${ROSTER_STATUS_SQL} AS roster_status`);
  expect(facets.sql).toContain("SELECT roster_status AS status, COUNT(*) AS count");
});
