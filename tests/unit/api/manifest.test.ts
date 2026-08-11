/**
 * AC-105 — route-manifest parity at its source: what the registry contains is
 * exactly what the document describes, and a route can only enter the registry
 * by existing as a conforming module. Fixture modules are injected into the
 * pure builder (R2), so they prove discovery without being discoverable.
 */
import { z } from "@hono/zod-openapi";
import { expect, test } from "vitest";

// `?raw` rather than `fs`: the fast suite runs inside the Workers runtime,
// which has no filesystem, and the bundled source is the real shipped source.
import indexSource from "../../../src/index.ts?raw";
import manifestSource from "../../../src/routes/_manifest.ts?raw";
import routerSource from "../../../src/api/router.ts?raw";

import {
  ManifestError,
  buildManifest,
  normalizePath,
  operationSignatures,
} from "../../../src/api/manifest";
import { createApiRouter } from "../../../src/api/router";
import { defineApiRoute, jsonResponse } from "../../../src/api/route";

const okSchema = z.object({ ok: z.boolean() });

function fixtureRoute(method: "get" | "post", path: string, operationId: string) {
  return defineApiRoute(
    {
      method,
      path,
      operationId,
      summary: `fixture ${operationId}`,
      policy: {
        auth: { kind: "public" },
        rateLimit: { bucket: "read" },
        concurrency: "none",
      },
      responses: { 200: jsonResponse(okSchema, "ok") },
    },
    (context) => context.json({ ok: true }, 200),
  );
}

function fixtureModule(...routes: ReturnType<typeof fixtureRoute>[]) {
  return { apiRoutes: routes };
}

test("AC-105 · a conforming module is discovered without being named in any list", () => {
  const entries = buildManifest({
    "./zebra.routes.ts": fixtureModule(fixtureRoute("get", "/api/v1/zebras", "listZebras")),
    "./alpha.routes.ts": fixtureModule(fixtureRoute("get", "/api/v1/alphas", "listAlphas")),
  });
  expect(entries.map((entry) => entry.operationId)).toEqual(["listAlphas", "listZebras"]);
});

test("AC-105 · registration order is deterministic and independent of glob key order", () => {
  const routes = [
    fixtureRoute("get", "/api/v1/b", "getB"),
    fixtureRoute("post", "/api/v1/a", "createA"),
    fixtureRoute("get", "/api/v1/a", "getA"),
  ];
  const forward = buildManifest({
    "./one.routes.ts": fixtureModule(routes[0]),
    "./two.routes.ts": fixtureModule(routes[1], routes[2]),
  });
  const reversed = buildManifest({
    "./two.routes.ts": fixtureModule(routes[2], routes[1]),
    "./one.routes.ts": fixtureModule(routes[0]),
  });
  expect(operationSignatures(forward)).toEqual(operationSignatures(reversed));
  expect(operationSignatures(forward)).toEqual([
    "GET /api/v1/a getA",
    "GET /api/v1/b getB",
    "POST /api/v1/a createA",
  ]);
});

test("AC-105 · a duplicate route names both module files, not the URL", () => {
  const call = () =>
    buildManifest({
      "./first.routes.ts": fixtureModule(fixtureRoute("get", "/api/v1/dupe", "firstDupe")),
      "./second.routes.ts": fixtureModule(fixtureRoute("get", "/api/v1/dupe", "secondDupe")),
    });
  expect(call).toThrowError(ManifestError);
  expect(call).toThrowError(/\.\/second\.routes\.ts:.*also declared by \.\/first\.routes\.ts/);
});

test("AC-105 · a duplicate operationId names both module files", () => {
  const call = () =>
    buildManifest({
      "./first.routes.ts": fixtureModule(fixtureRoute("get", "/api/v1/one", "sameId")),
      "./second.routes.ts": fixtureModule(fixtureRoute("get", "/api/v1/two", "sameId")),
    });
  expect(call).toThrowError(/duplicate operationId 'sameId'.*\.\/first\.routes\.ts/);
});

test("AC-105 · a malformed module fails at assembly with its filename", () => {
  expect(() => buildManifest({ "./broken.routes.ts": { notApiRoutes: [] } })).toThrowError(
    /\.\/broken\.routes\.ts: missing or non-array 'apiRoutes' export/,
  );
  expect(() => buildManifest({ "./empty.routes.ts": { apiRoutes: [] } })).toThrowError(
    /\.\/empty\.routes\.ts: 'apiRoutes' is empty/,
  );
  expect(() =>
    buildManifest({ "./handlerless.routes.ts": { apiRoutes: [{ method: "get", path: "/x", operationId: "x", route: {}, policy: {} }] } }),
  ).toThrowError(/\.\/handlerless\.routes\.ts: malformed route entry/);
});

test("AC-105 · paths are OpenAPI-shaped, so signatures and document paths cannot diverge", () => {
  expect(normalizePath("/api/v1/events/{eventId}")).toBe("/api/v1/events/{eventId}");
  expect(() => normalizePath("/api/v1/events/:eventId")).toThrowError(/OpenAPI '\{param\}' syntax/);
  expect(() => normalizePath("/api/v1/events/")).toThrowError(/trailing slash/);
  expect(() =>
    buildManifest({ "./hono.routes.ts": fixtureModule(fixtureRoute("get", "/api/v1/x/:id", "honoStyle")) }),
  ).toThrowError(/\.\/hono\.routes\.ts:.*OpenAPI '\{param\}' syntax/);
});

test("AC-105 · the registry's signature set equals the document's operation set exactly", async () => {
  const entries = buildManifest({
    "./one.routes.ts": fixtureModule(
      fixtureRoute("get", "/api/v1/widgets", "listWidgets"),
      fixtureRoute("post", "/api/v1/widgets", "createWidget"),
    ),
    "./two.routes.ts": fixtureModule(fixtureRoute("get", "/api/v1/gizmos/{gizmoId}", "getGizmo")),
  });
  const { document } = await createApiRouter(entries);
  const documented = Object.entries(
    (document.document.paths ?? {}) as Record<string, Record<string, { operationId: string }>>,
  )
    .flatMap(([path, operations]) =>
      Object.entries(operations).map(
        ([method, operation]) => `${method.toUpperCase()} ${path} ${operation.operationId}`,
      ),
    )
    .sort();
  expect(documented).toEqual(document.signatures);
});

test("AC-105 · no central registration list and no handwritten OpenAPI document exist", () => {
  // The generated manifest may name the glob and the builder — nothing else.
  const imports = [...manifestSource.matchAll(/^import .*from "(.+)";$/gm)].map((match) => match[1]);
  expect(imports).toEqual(["../api/manifest"]);
  expect(manifestSource).toContain('import.meta.glob("./**/*.routes.ts", { eager: true })');
  expect(manifestSource).not.toMatch(/\.routes"|\/routes\/[a-z]/);

  expect(indexSource).not.toMatch(/apiRoutes|defineApiRoute|\.openapi\(/);

  expect(routerSource).not.toMatch(/from "\.\.\/routes\//);
});
