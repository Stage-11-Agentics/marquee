import assert from "node:assert/strict";
import test from "node:test";

import { buildCoverage, parseEvaluationContract, scanTestSource } from "../../scripts/checks/trace-ac-core.mjs";

const contract = "| AC-1 | `auto` | proof |\n| AC-2 | `felt` | proof |\n| AC-239 | `auto` | struck |";

test("CONTRACT · the AC tracer excludes the tombstone and maps static titles", () => {
  const criteria = parseEvaluationContract(contract);
  const scan = scanTestSource("test('AC-1 · works', () => {});", "fixture.test.ts");
  const result = buildCoverage({ criteria, scans: [scan], claims: [{ ticket: "MRQ-X", owns: ["AC-1"] }], scope: "merged" });
  assert.deepEqual([...criteria.keys()], ["AC-1", "AC-2"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.uncovered, []);
});

test("CONTRACT · the AC tracer rejects dynamic, unknown, and struck test titles", () => {
  const criteria = parseEvaluationContract(contract);
  const dynamic = scanTestSource("test(name, () => {});", "dynamic.test.ts");
  const invalid = scanTestSource("test('AC-999 + AC-239 · bad', () => {});", "invalid.test.ts");
  const result = buildCoverage({ criteria, scans: [dynamic, invalid], claims: [], scope: "merged" });
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.includes("dynamic-title"));
  assert.ok(codes.includes("unknown-criterion"));
  assert.ok(codes.includes("struck-criterion"));
});

test("CONTRACT · all scope fails uncovered auto criteria but not felt criteria", () => {
  const result = buildCoverage({ criteria: parseEvaluationContract(contract), scans: [], claims: [], scope: "all" });
  assert.deepEqual(result.uncovered, ["AC-1"]);
});
