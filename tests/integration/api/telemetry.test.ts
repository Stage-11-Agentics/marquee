/**
 * The telemetry endpoints through the real Worker.
 *
 * The beacon is PUBLIC and takes free text from a browser, which makes its caps
 * the whole security story: an uncapped field on an unauthenticated endpoint is
 * an invitation. The diagnostics probe is the opposite — it costs real work
 * against every binding, so it must never answer an anonymous caller.
 */
import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const ORIGIN = "https://marquee.stage11.dev";

async function beacon(body: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/v1/telemetry/client-errors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validReport = {
  kind: "boundary",
  message: "Cannot read properties of undefined (reading 'pipeline')",
  stack: "    at DashboardContents (dashboard.tsx:1:1)",
  route: "/dashboard",
  build: "abc123def456",
  session: "0123456789abcdef",
  occurrences: 3,
};

test("CONTRACT · a well-formed browser report is accepted and not persisted", async () => {
  const response = await beacon(validReport);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ recorded: true });
});

test("CONTRACT · the beacon caps every free-text field", async () => {
  const oversize = await beacon({ ...validReport, message: "x".repeat(5_000) });
  expect(oversize.status).toBe(400);
  const envelope = await oversize.json<{ error: { code: string }; request_id: string }>();
  expect(envelope.error.code).toBe("malformed_request");
  // Even a rejected beacon is correlated.
  expect(envelope.request_id.length).toBeGreaterThan(0);

  expect((await beacon({ ...validReport, stack: "y".repeat(9_000) })).status).toBe(400);
  expect((await beacon({ ...validReport, route: "z".repeat(500) })).status).toBe(400);
  expect((await beacon({ ...validReport, occurrences: 10 ** 9 })).status).toBe(400);
});

test("CONTRACT · an unknown report kind is refused rather than logged blind", async () => {
  expect((await beacon({ ...validReport, kind: "exfiltrate" })).status).toBe(400);
  expect((await beacon({})).status).toBe(400);
});

test("CONTRACT · Web Vitals ride the same endpoint under their own shape", async () => {
  const response = await beacon({
    kind: "web_vital",
    metric: "LCP",
    value: 1_842,
    rating: "good",
    route: "/dashboard",
    build: "abc123def456",
    session: "0123456789abcdef",
  });
  expect(response.status).toBe(202);
  expect((await beacon({ kind: "web_vital", metric: "MADE_UP", value: 1, rating: "good", route: "/", build: "b", session: "s" })).status).toBe(400);
});

test("CONTRACT · deep diagnostics never answer an anonymous caller", async () => {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/telemetry/diagnostics`);
  expect(response.status).toBe(401);
  const envelope = await response.json<{ error: { code: string } }>();
  expect(envelope.error.code).toBe("unauthenticated");
});
