/**
 * The allowlist is the load-bearing rule of the whole observability layer, so
 * it gets the load-bearing test: a payload stuffed with everything a speaker
 * ever told this conference in confidence goes into the builder, and none of it
 * comes out. Not because a redaction pass caught it — because the shape has no
 * slot for it.
 */
import { describe, expect, test } from "vitest";

import {
  buildLogLine,
  createLogger,
  errorFields,
  LINE_MAX_BYTES,
  LOG_EVENT_FIELDS,
  LOG_LEVELS,
  LOG_SCHEMA_VERSION,
  parseLogLevel,
  redactFreeText,
  STACK_MAX_LENGTH,
  truncateStack,
  type LogLevel,
} from "../../src/lib/observability/log";

const BUILD = { sha: "abc123def456", built_at: "2026-08-11T00:00:00.000Z" };
const base = { build: BUILD, now: () => Date.UTC(2026, 7, 11, 12) };

describe("the field allowlist", () => {
  test("CONTRACT · a payload full of speaker PII cannot be emitted", () => {
    const line = buildLogLine(
      "http_request",
      "info",
      {
        method: "POST",
        route: "/api/v1/events/{eventId}/submissions",
        status: 201,
        duration_ms: 12,
        // Everything below is undeclared. There is no slot for any of it.
        email: "ada@lovelace.example",
        speaker_email: "ada@lovelace.example",
        body: { bio: "Ada Lovelace, ada@lovelace.example, +1 555 0100" },
        cookie: "mq_session=sess_secret",
        authorization: "Bearer sk-live-not-a-real-key",
        query: "?q=ada@lovelace.example",
        url: "https://marquee.example/api/v1/events/evt_1/submissions?q=ada@lovelace.example",
      },
      base,
    );

    expect(line).not.toContain("@");
    expect(line).not.toContain("lovelace");
    expect(line).not.toContain("Bearer");
    expect(line).not.toContain("mq_session");
    expect(line).not.toContain("bio");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ["build_sha", "duration_ms", "event", "level", "method", "route", "schema_version", "status", "ts"].sort(),
    );
  });

  test("CONTRACT · an address smuggled through a declared free-text field is scrubbed", () => {
    const line = buildLogLine(
      "api_error",
      "error",
      {
        code: "internal_error",
        message: "could not deliver to ada@lovelace.example using Bearer sk-live-abcdefgh",
        status: 500,
      },
      base,
    );
    expect(line).not.toContain("ada@lovelace.example");
    expect(line).toContain("[redacted-email]");
    expect(line).toContain("[redacted-credential]");
  });

  test("CONTRACT · every declared field is a scalar, so no object can ride in on one", () => {
    for (const fields of Object.values(LOG_EVENT_FIELDS)) {
      for (const type of Object.values(fields as Record<string, string>)) {
        expect(["string", "number", "boolean"]).toContain(type);
      }
    }
  });

  test("CONTRACT · a wrongly-typed value for a declared field is dropped, not coerced", () => {
    // The types stop this at compile time; the cast proves the runtime does too,
    // because JavaScript callers and JSON payloads do not typecheck.
    const wronglyTyped = { status: "500 oops", duration_ms: Number.NaN } as unknown as Record<string, never>;
    const parsed = JSON.parse(buildLogLine("http_request", "info", wronglyTyped, base)) as Record<string, unknown>;
    expect(parsed.status).toBeUndefined();
    expect(parsed.duration_ms).toBeUndefined();
  });
});

describe("line shape", () => {
  test("CONTRACT · every line is self-describing: timestamp, level, event, version, build", () => {
    const parsed = JSON.parse(buildLogLine("cron_run", "info", { cron: "0 * * * *" }, base)) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      ts: "2026-08-11T12:00:00.000Z",
      level: "info",
      event: "cron_run",
      schema_version: LOG_SCHEMA_VERSION,
      build_sha: BUILD.sha,
    });
  });

  test("CONTRACT · the request id rides on every line that has one", () => {
    const parsed = JSON.parse(
      buildLogLine("api_error", "warn", { code: "not_found" }, { ...base, request_id: "8f2a4c90-1111" }),
    ) as Record<string, unknown>;
    expect(parsed.request_id).toBe("8f2a4c90-1111");
  });
});

describe("caps", () => {
  test("CONTRACT · a stack keeps its top frames and loses the rest", () => {
    const stack = Array.from({ length: 200 }, (_, index) => `    at frame${index} (src/thing.ts:${index}:1)`).join("\n");
    const truncated = truncateStack(stack) ?? "";
    expect(truncated.length).toBeLessThanOrEqual(STACK_MAX_LENGTH + 1);
    expect(truncated).toContain("frame0");
    expect(truncated).not.toContain("frame199");
  });

  test("CONTRACT · an enormous payload produces a capped line without catastrophic backtracking", () => {
    // Not a performance budget: the failure this catches is an unbounded
    // quantifier in the scrub, which turns this input from milliseconds into
    // seconds and makes the logging path a denial of service. The bound is
    // loose on purpose so it measures the regex and not the build machine.
    const startedAt = performance.now();
    const line = buildLogLine(
      "worker_error",
      "error",
      { source: "x".repeat(200_000), message: "y".repeat(200_000), stack: "z".repeat(200_000) },
      base,
    );
    expect(performance.now() - startedAt).toBeLessThan(5_000);
    expect(line.length).toBeLessThanOrEqual(LINE_MAX_BYTES);
    expect(() => JSON.parse(line) as unknown).not.toThrow();
  });

  test("CONTRACT · an address straddling the truncation point does not survive as a fragment", () => {
    const message = `${"a".repeat(295)}ada@lovelace.example tail`;
    const parsed = JSON.parse(buildLogLine("worker_error", "error", { message }, base)) as { message: string };
    expect(parsed.message).not.toContain("ada@");
    expect(parsed.message).not.toContain("lovelace");
  });

  test("CONTRACT · redaction survives truncation rather than being cut in half", () => {
    const scrubbed = redactFreeText(`${"a".repeat(10)}ada@lovelace.example`);
    expect(scrubbed).not.toContain("@lovelace");
  });
});

describe("levels", () => {
  test("CONTRACT · an unknown LOG_LEVEL falls back to info rather than going silent", () => {
    expect(parseLogLevel("nonsense")).toBe("info");
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("debug")).toBe("debug");
  });

  test("CONTRACT · a logger below its threshold emits nothing at all", () => {
    const emitted: string[] = [];
    const logger = createLogger({
      level: "warn",
      build: BUILD,
      sink: (_level: LogLevel, line: string) => emitted.push(line),
    });
    logger.emit("http_request", "info", { status: 200 });
    logger.emit("api_error", "error", { status: 500 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('"event":"api_error"');
  });

  test("CONTRACT · a child logger inherits everything but the correlation id", () => {
    const emitted: string[] = [];
    const parent = createLogger({ level: "debug", build: BUILD, sink: (_l, line) => emitted.push(line) });
    parent.withRequestId("ray-1").emit("queue_message", "info", { queue: "mail" });
    expect(JSON.parse(emitted[0] as string)).toMatchObject({ request_id: "ray-1", build_sha: BUILD.sha });
  });
});

describe("errorFields", () => {
  test("CONTRACT · a thrown non-Error still produces a usable line", () => {
    expect(errorFields("just a string")).toMatchObject({ error_name: "NonError", message: "just a string" });
    expect(errorFields({ weird: true })).toMatchObject({ error_name: "NonError" });
  });

  test("CONTRACT · an Error contributes name, message and a truncated stack", () => {
    const fields = errorFields(new TypeError("bad shape"));
    expect(fields.error_name).toBe("TypeError");
    expect(fields.message).toBe("bad shape");
    expect(fields.stack?.length ?? 0).toBeLessThanOrEqual(STACK_MAX_LENGTH + 1);
  });
});

describe("stack frames", () => {
  test("CONTRACT · a stack keeps its frames and loses the machine that built it", () => {
    // This test is the thing that enforces the no-home-directory rule, so it is
    // the one file that must name the marker to do its job — and `check:repo`'s
    // content denylist scans the public tree for exactly that literal. Assemble
    // it from parts, the same way scripts/checks/repo-policy.mjs assembles its
    // own markers to avoid matching itself. Writing it whole fails the public
    // assembly gate on the test that protects the assembly.
    const homeDirectoryMarker = ["/", "Users", "/"].join("");
    const stack = [
      "Error: D1_ERROR: no such table: waves",
      `    at readDashboard (file://${homeDirectoryMarker}somebody/Projects/thing/dist/index.js:27063:164)`,
      "    at async dispatch (/srv/build/worker/index.js:29:11)",
    ].join("\n");
    const truncated = truncateStack(stack) ?? "";
    // The file name and line number are the diagnostic value; the path to a
    // developer's home directory is not, and it names a machine.
    expect(truncated).toContain("readDashboard");
    expect(truncated).toContain("index.js:27063:164");
    expect(truncated).not.toContain(homeDirectoryMarker);
    expect(truncated).not.toContain("/srv/build");
  });
});

describe("the silent threshold", () => {
  test("CONTRACT · silent emits nothing at any level", () => {
    const emitted: string[] = [];
    const logger = createLogger({ level: "silent", build: BUILD, sink: (_l, line) => emitted.push(line) });
    for (const level of LOG_LEVELS) logger.emit("http_request", level, { status: 200 });
    expect(emitted).toHaveLength(0);
  });

  test("CONTRACT · silent is configurable but not emittable, and anything else still means info", () => {
    expect(parseLogLevel("silent")).toBe("silent");
    // The emission union stays closed: `silent` is a threshold, not an event level.
    expect(LOG_LEVELS).not.toContain("silent" as never);
    expect(parseLogLevel("quiet")).toBe("info");
  });
});
