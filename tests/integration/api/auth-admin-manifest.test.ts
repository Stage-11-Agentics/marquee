import { expect, test } from "vitest";
import { SELF } from "cloudflare:test";

const EXPECTED_OPERATIONS = [
  ["post", "/api/v1/auth/demo"],
  ["post", "/api/v1/auth/magic-link"],
  ["get", "/api/v1/auth/exchange"],
  ["post", "/api/v1/auth/logout"],
  ["get", "/api/v1/auth/me"],
  ["post", "/api/v1/admin/reset-demo"],
  ["get", "/api/v1/admin/reset-demo/{jobId}"],
] as const;

test("AC-105 · auth and admin operations are present in the served OpenAPI manifest", async () => {
  const response = await SELF.fetch("https://marquee.stage11.dev/api/openapi.json");
  expect(response.status).toBe(200);

  const document = await response.json<{
    paths: Record<string, Record<string, { operationId?: string }> | undefined>;
  }>();
  for (const [method, path] of EXPECTED_OPERATIONS) {
    expect(document.paths[path]?.[method]?.operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
  }
});
