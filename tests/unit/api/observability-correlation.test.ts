/**
 * The correlation contract, driven through the shipped pipeline.
 *
 * This is the test that would have caught the defect this ticket exists for.
 * The server generated a request id, returned it in the envelope, and logged
 * the error WITHOUT it — the id existed at both ends and joined nothing. Here
 * the envelope, the `X-Request-Id` header, the `http_request` line and the
 * `api_error` line are all required to agree on one id.
 *
 * `createApiRouter` is the shipped pipeline, so this runs Worker-free in the
 * node pool rather than paying for a Miniflare isolate to prove the same thing.
 */
import { z } from "@hono/zod-openapi";
import { afterEach, expect, test, vi } from "vitest";

import { ApiError } from "../../../src/api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../../../src/api/route";
import { createApiRouter } from "../../../src/api/router";

const ORIGIN = "https://marquee.stage11.dev";

const okRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/observability-ok",
    operationId: "observabilityOkFixture",
    summary: "Fixture that succeeds",
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ ok: z.literal(true) }), "ok"), ...errorResponses([500]) },
  },
  (context) => context.json({ ok: true as const }, 200),
);

const boomRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/observability-boom",
    operationId: "observabilityBoomFixture",
    summary: "Fixture that throws an unexpected error",
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ ok: z.literal(true) }), "ok"), ...errorResponses([500]) },
  },
  () => {
    throw new Error("the database went away mid-query for ada@lovelace.example");
  },
);

const expectedRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/observability-missing",
    operationId: "observabilityMissingFixture",
    summary: "Fixture that throws an expected ApiError",
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ ok: z.literal(true) }), "ok"), ...errorResponses([404, 500]) },
  },
  () => {
    throw ApiError.notFound();
  },
);

interface Captured {
  lines: Record<string, unknown>[];
  restore: () => void;
}

/** Capture what the Worker actually writes, rather than a stand-in sink. */
function captureLogs(): Captured {
  const lines: Record<string, unknown>[] = [];
  const collect = (value: unknown) => {
    if (typeof value !== "string") return;
    try {
      lines.push(JSON.parse(value) as Record<string, unknown>);
    } catch {
      // Not one of ours.
    }
  };
  const spies = [
    vi.spyOn(console, "log").mockImplementation(collect),
    vi.spyOn(console, "warn").mockImplementation(collect),
    vi.spyOn(console, "error").mockImplementation(collect),
  ];
  return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

afterEach(() => vi.restoreAllMocks());

async function drive(path: string): Promise<{ response: Response; lines: Record<string, unknown>[] }> {
  const router = await createApiRouter([okRoute, boomRoute, expectedRoute]);
  const captured = captureLogs();
  try {
    const response = await router.app.request(`${ORIGIN}${path}`, {}, { LOG_LEVEL: "debug" } as never);
    // The body has to be read before the spies are restored: the envelope and
    // the lines are compared against each other.
    await response.clone().text();
    return { response, lines: captured.lines };
  } finally {
    captured.restore();
  }
}

test("CONTRACT · a successful request logs one http_request line carrying its own id", async () => {
  const { response, lines } = await drive("/api/v1/events/evt_1/observability-ok");
  expect(response.status).toBe(200);
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toBeTruthy();

  const requestLines = lines.filter((line) => line.event === "http_request");
  expect(requestLines).toHaveLength(1);
  expect(requestLines[0]).toMatchObject({
    request_id: requestId,
    method: "GET",
    // The route TEMPLATE, never the raw URL.
    route: "/api/v1/events/{eventId}/observability-ok",
    status: 200,
    event_id: "evt_1",
    level: "info",
  });
  expect(typeof requestLines[0]?.duration_ms).toBe("number");
});

test("CONTRACT · a forced 500's envelope and its api_error line agree on the request id", async () => {
  const { response, lines } = await drive("/api/v1/events/evt_1/observability-boom");
  expect(response.status).toBe(500);
  const envelope = (await response.json()) as { error: { code: string }; request_id: string };
  const requestId = response.headers.get("x-request-id");

  expect(envelope.request_id).toBe(requestId);
  expect(envelope.error.code).toBe("internal_error");

  const errorLine = lines.find((line) => line.event === "api_error");
  expect(errorLine).toBeDefined();
  // THE POINT OF THE TICKET: the id on screen greps to the line that explains it.
  expect(errorLine).toMatchObject({
    request_id: requestId,
    route: "/api/v1/events/{eventId}/observability-boom",
    status: 500,
    expected: false,
    level: "error",
    error_name: "Error",
  });
  // An unexpected failure keeps its stack in the log and out of the response.
  expect(typeof errorLine?.stack).toBe("string");
  expect(JSON.stringify(envelope)).not.toContain("database went away");
  // And the address quoted by the exception message never reaches the log.
  expect(JSON.stringify(errorLine)).not.toContain("ada@lovelace.example");
  expect(JSON.stringify(errorLine)).toContain("[redacted-email]");

  const requestLine = lines.find((line) => line.event === "http_request");
  expect(requestLine).toMatchObject({ request_id: requestId, status: 500 });
});

test("CONTRACT · an expected failure logs at warn without a stack", async () => {
  const { lines } = await drive("/api/v1/events/evt_1/observability-missing");
  const errorLine = lines.find((line) => line.event === "api_error");
  expect(errorLine).toMatchObject({ level: "warn", expected: true, code: "not_found", status: 404 });
  expect(errorLine?.stack).toBeUndefined();
});

test("CONTRACT · an unmatched path still logs, and names no route it does not have", async () => {
  const { response, lines } = await drive("/api/v1/nothing-here");
  expect(response.status).toBe(404);
  expect(lines.find((line) => line.event === "api_error")).toMatchObject({ route: "unmatched", status: 404 });
  expect(lines.find((line) => line.event === "http_request")).toMatchObject({ route: "unmatched" });
});
