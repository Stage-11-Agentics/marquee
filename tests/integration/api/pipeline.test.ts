/**
 * The one error envelope and the standard headers, driven through the real
 * Worker. These are the shapes every later route inherits, so they are proved
 * on the shipped pipeline rather than on a hand-built app.
 */
import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const ORIGIN = "https://marquee.stage11.dev";

test("CONTRACT · an unmatched API path returns the one error envelope with a request id", async () => {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/nothing-here`);
  expect(response.status).toBe(404);
  const body = await response.json<{ error: { code: string; message: string }; request_id: string }>();
  expect(body.error.code).toBe("not_found");
  expect(typeof body.error.message).toBe("string");
  expect(body.request_id.length).toBeGreaterThan(0);
  expect(response.headers.get("x-request-id")).toBe(body.request_id);
  // 404 conceals: it never names what would have been there.
  expect(JSON.stringify(body)).not.toMatch(/stack|sqlite|SELECT |binding/i);
});

test("CONTRACT · every API response carries the standard rate-limit headers", async () => {
  const response = await SELF.fetch(`${ORIGIN}/api/openapi.json`);
  expect(response.headers.get("ratelimit-limit")).toMatch(/^\d+$/);
  expect(response.headers.get("ratelimit-remaining")).toMatch(/^\d+$/);
  expect(response.headers.get("ratelimit-reset")).toMatch(/^\d+$/);
  // Retry-After is only for an actual 429.
  expect(response.headers.get("retry-after")).toBeNull();
});

test("CONTRACT · a client-supplied request id is never trusted", async () => {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/nothing-here`, {
    headers: { "x-request-id": "attacker-chosen-id" },
  });
  expect(response.headers.get("x-request-id")).not.toBe("attacker-chosen-id");
});

test("CONTRACT · the app's non-API routes are unaffected by the API mount", async () => {
  const health = await SELF.fetch(`${ORIGIN}/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ service: "marquee", status: "ok" });
});
