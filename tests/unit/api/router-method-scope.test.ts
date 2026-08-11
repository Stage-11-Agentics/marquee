import { expect, test } from "vitest";
import { z } from "@hono/zod-openapi";

import { createApiRouter } from "../../../src/api/router";
import { defineApiRoute, jsonResponse } from "../../../src/api/route";

const getRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/tokens",
    operationId: "methodScopeGetFixture",
    summary: "GET method-scope fixture",
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ method: z.literal("get") }), "GET fixture") },
  },
  (context) => context.json({ method: "get" as const }, 200),
);

const postRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/tokens",
    operationId: "methodScopePostFixture",
    summary: "POST method-scope fixture",
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ method: z.literal("post") }), "POST fixture") },
  },
  (context) => context.json({ method: "post" as const }, 200),
);

test("CONTRACT · same-path GET and POST policies do not bleed into each other", async () => {
  const buckets: string[] = [];
  const router = await createApiRouter([getRoute, postRoute], {
    rateLimiter: {
      async check(input) {
        buckets.push(input.bucket);
        return { allowed: true, limit: 100, remaining: 99, reset: 1 };
      },
    },
  });

  const post = await router.app.request("https://marquee.stage11.dev/api/v1/org/tokens", { method: "POST" }, {} as never);
  expect(post.status).toBe(200);
  expect(await post.json()).toEqual({ method: "post" });
  expect(buckets).toEqual(["write"]);

  const get = await router.app.request("https://marquee.stage11.dev/api/v1/org/tokens", {}, {} as never);
  expect(get.status).toBe(200);
  expect(await get.json()).toEqual({ method: "get" });
  expect(buckets).toEqual(["write", "read"]);
});
