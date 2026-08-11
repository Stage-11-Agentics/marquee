/**
 * The bulk selector union, the S-3 ID-set transport, and the one CAS
 * primitive. S-3's verdict is a behavioural contract, so these assert call
 * counts and the single serialization — not just the returned rows.
 */
import { expect, test, vi } from "vitest";

// `?raw` rather than `fs`: the fast suite runs inside the Workers runtime,
// which has no filesystem, and the bundled source is the real shipped source.
import bulkSource from "../../../src/api/bulk.ts?raw";

import {
  BULK_ID_LIMIT,
  buildBulkResult,
  normalizeBulkSelector,
  runBulkByIds,
} from "../../../src/api/bulk";
import {
  assertCasUpdated,
  compareAndSwapResource,
  parseStrongEtag,
  requireIfMatch,
  strongEtag,
} from "../../../src/api/concurrency";
import { ApiError } from "../../../src/api/errors";
import { isUlid } from "../../../src/api/ids";

const ULID_A = "01J8ZQ7X2M4N6P8R0T2V4Y6A8C";
const ULID_B = "01J8ZQ7X2M4N6P8R0T2V4Y6A8D";

function fakeStatement(changes: number) {
  return {
    run: vi.fn(async () => ({ success: true, results: [], meta: { changes } })),
  } as unknown as D1PreparedStatement & { run: ReturnType<typeof vi.fn> };
}

test("CONTRACT · a bulk selector carries exactly one arm — never both, never neither", () => {
  expect(normalizeBulkSelector({ ids: [ULID_A] }, isUlid)).toEqual({ kind: "ids", ids: [ULID_A] });
  expect(normalizeBulkSelector({ filter: { status: "accepted" } }, isUlid).kind).toBe("filter");
  expect(() => normalizeBulkSelector({}, isUlid)).toThrowError(/exactly one of 'ids' or 'filter'/);
  expect(() => normalizeBulkSelector({ ids: [ULID_A], filter: {} }, isUlid)).toThrowError(ApiError);
  expect(() => normalizeBulkSelector({ ids: ["not-a-ulid"] }, isUlid)).toThrowError(/malformed id/);
  expect(() => normalizeBulkSelector({ ids: [] }, isUlid)).toThrowError(/must not be empty/);
  expect(() =>
    normalizeBulkSelector({ ids: Array.from({ length: BULK_ID_LIMIT + 1 }, () => ULID_A) }, isUlid),
  ).toThrowError(/capped at 1000/);
});

test("CONTRACT · the durable bulk result cannot claim more outcomes than it selected", () => {
  const result = buildBulkResult({
    operation_id: ULID_A,
    selected: 3,
    succeeded: 2,
    failed: 1,
    state: "completed_with_failures",
    outbox_enqueued: 2,
  });
  expect(result.selected).toBe(3);
  expect(() =>
    buildBulkResult({ ...result, succeeded: 3, failed: 3 }),
  ).toThrowError(/bulk result invariant/);
});

test("CONTRACT · runBulkByIds serializes once, prepares once, and runs once at 150 and 1000 ids", async () => {
  for (const size of [150, 1_000]) {
    const ids = Array.from({ length: size }, (_, index) => `01J8ZQ7X2M4N6P8R0T2V4Y${String(index).padStart(4, "0")}`);
    const statement = fakeStatement(size);
    const prepare = vi.fn((_idsJson: string) => statement);
    const result = await runBulkByIds(ids, prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(statement.run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(prepare.mock.calls[0][0])).toHaveLength(size);
    expect(result?.meta.changes).toBe(size);
  }
});

test("CONTRACT · runBulkByIds dedupes in first-seen order and no-ops on an empty set", async () => {
  const statement = fakeStatement(2);
  const prepare = vi.fn((_idsJson: string) => statement);
  await runBulkByIds([ULID_B, ULID_A, ULID_B, ULID_A], prepare);
  expect(JSON.parse(prepare.mock.calls[0][0])).toEqual([ULID_B, ULID_A]);

  const unusedPrepare = vi.fn((_idsJson: string) => fakeStatement(0));
  expect(await runBulkByIds([], unusedPrepare)).toBeNull();
  expect(unusedPrepare).not.toHaveBeenCalled();
});

test("CONTRACT · the bulk helper never builds one placeholder per id", () => {
  const executable = bulkSource.replaceAll(/\/\*\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
  // `IN (?, ?, ...)` expansion and chunk splitting are the patterns S-3 ruled out.
  expect(executable).not.toMatch(/\?\s*,\s*\?/);
  expect(executable).not.toMatch(/\.map\([^)]*=>\s*["'`]\?/);
  expect(executable).not.toMatch(/slice\(\s*\w*\s*,\s*\w*\s*\+/);
  expect(bulkSource).toContain("json_each(?)");
});

test("CONTRACT · strong ETags encode identity plus the monotonic updated_at", () => {
  expect(strongEtag(ULID_A, 1_700_000_000_000)).toBe(`"${ULID_A}:1700000000000"`);
  expect(parseStrongEtag(`"${ULID_A}:42"`)).toEqual({ id: ULID_A, updatedAt: 42 });
  expect(parseStrongEtag(`W/"${ULID_A}:42"`)).toBeNull();

  const request = (headers: Record<string, string>) => new Request("https://x/y", { headers });
  expect(requireIfMatch(request({ "if-match": `"${ULID_A}:42"` }), ULID_A).updatedAt).toBe(42);
  expect(() => requireIfMatch(request({}), ULID_A)).toThrowError(/If-Match header/);
  expect(() => requireIfMatch(request({ "if-match": `W/"${ULID_A}:42"` }), ULID_A)).toThrowError(/strong ETag/);
  expect(() => requireIfMatch(request({ "if-match": `"${ULID_B}:42"` }), ULID_A)).toThrowError(/current strong ETag/);
});

test("CONTRACT · two writes in the same millisecond still produce distinct ETags", async () => {
  const frozenNow = 1_700_000_000_000;
  const first = await compareAndSwapResource({
    expected: { id: ULID_A, updatedAt: frozenNow },
    now: frozenNow,
    prepareWrite: () => fakeStatement(1),
    readCurrent: async () => null,
    versionOf: () => ({ id: ULID_A, updatedAt: frozenNow }),
  });
  const second = await compareAndSwapResource({
    expected: { id: ULID_A, updatedAt: frozenNow + 1 },
    now: frozenNow,
    prepareWrite: () => fakeStatement(1),
    readCurrent: async () => null,
    versionOf: () => ({ id: ULID_A, updatedAt: frozenNow }),
  });
  expect(first.kind).toBe("updated");
  expect(second.kind).toBe("updated");
  expect(first.kind === "updated" && second.kind === "updated" && first.etag).not.toBe(
    second.kind === "updated" ? second.etag : "",
  );
});

test("CONTRACT · a stale version mutates nothing and answers 409 with the current ETag", async () => {
  const statement = fakeStatement(0);
  const outcome = await compareAndSwapResource({
    expected: { id: ULID_A, updatedAt: 100 },
    now: 500,
    prepareWrite: () => statement,
    readCurrent: async () => ({ id: ULID_A, updatedAt: 300, title: "current" }),
    versionOf: (current) => ({ id: current.id, updatedAt: current.updatedAt }),
  });
  expect(outcome.kind).toBe("stale");
  expect(statement.run).toHaveBeenCalledTimes(1);
  try {
    assertCasUpdated(outcome, (current) => ({ id: current.id, updated_at: current.updatedAt }));
    expect.unreachable("a stale outcome must throw");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).headers?.ETag).toBe(`"${ULID_A}:300"`);
  }
});

test("CONTRACT · an absent resource is concealed as 404, never distinguished from forbidden", async () => {
  const outcome = await compareAndSwapResource({
    expected: { id: ULID_A, updatedAt: 100 },
    now: 500,
    prepareWrite: () => fakeStatement(0),
    readCurrent: async () => null,
    versionOf: () => ({ id: ULID_A, updatedAt: 0 }),
  });
  expect(outcome.kind).toBe("missing");
  expect(() => assertCasUpdated(outcome)).toThrowError(ApiError);
  try {
    assertCasUpdated(outcome);
  } catch (error) {
    expect((error as ApiError).status).toBe(404);
  }
});
