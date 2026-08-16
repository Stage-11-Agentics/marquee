import { expect, test } from "vitest";

import { CORE_TABLE_COUNT, CORE_TABLE_NAMES } from "../../src/db/schema";

test("CONTRACT · MRQ-257 CORE_TABLE_COUNT follows the canonical table tuple", () => {
  expect(CORE_TABLE_COUNT).toBe(CORE_TABLE_NAMES.length);
});
