/**
 * AC-106 — the document validates, the docs route answers, and both are served
 * by the real Worker through its real routing, not by an in-process fixture.
 */
import { SELF } from "cloudflare:test";
import { validate } from "@scalar/openapi-parser";
import { expect, test } from "vitest";

const ORIGIN = "https://marquee.stage11.dev";

test("AC-106 · the served OpenAPI document validates as OpenAPI 3.1", async () => {
  const response = await SELF.fetch(`${ORIGIN}/api/openapi.json`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");

  const body = await response.text();
  const result = await validate(body);
  expect(result.errors ?? []).toEqual([]);
  expect(result.valid).toBe(true);
  expect(result.version).toBe("3.1");
});

test("AC-106 · the document advertises both auth schemes and the shared error envelope", async () => {
  const document = await (await SELF.fetch(`${ORIGIN}/api/openapi.json`)).json<{
    info: { title: string; version: string };
    components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
    paths: Record<string, Record<string, { operationId: string }>>;
  }>();

  expect(document.info.title).toBe("Marquee API");
  expect(Object.keys(document.components.securitySchemes).sort()).toEqual(["bearerAuth", "cookieAuth"]);
  expect(document.components.schemas).toHaveProperty("ApiErrorEnvelope");
  expect(Object.keys(document.paths)).toContain("/api/openapi.json");
  expect(Object.keys(document.paths)).toContain("/api/docs");
  expect(Object.keys(document.paths)).toEqual(
    expect.arrayContaining([
      "/api/v1/public/uploads/sign",
      "/api/v1/public/uploads/{id}/complete",
      "/api/v1/me/uploads/sign",
      "/api/v1/me/uploads/{id}/complete",
      "/api/v1/media/{key}",
    ]),
  );
  expect(document.paths["/api/v1/public/uploads/sign"].post.operationId).toBe("signPublicUpload");
  expect(document.paths["/api/v1/me/uploads/sign"].post.operationId).toBe("signTaskUpload");
});

test("AC-106 · the ETag digests the exact bytes served, so a caller can verify the document", async () => {
  const response = await SELF.fetch(`${ORIGIN}/api/openapi.json`);
  const body = await response.text();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  expect(response.headers.get("etag")).toBe(`"${hex}"`);

  // Deterministic: the same deployment serves byte-identical documents.
  const second = await (await SELF.fetch(`${ORIGIN}/api/openapi.json`)).text();
  expect(second).toBe(body);
});

test("AC-106 · the docs route returns HTML rendered from the same document, with no external asset", async () => {
  const response = await SELF.fetch(`${ORIGIN}/api/docs`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");

  const html = await response.text();
  const documentResponse = await SELF.fetch(`${ORIGIN}/api/openapi.json`);
  const servedEtag = documentResponse.headers.get("etag") ?? "";
  const renderedHash = /name="marquee-openapi-sha256" content="([0-9a-f]{64})"/.exec(html)?.[1];

  // The rendered docs name the digest of the served JSON — that equality is
  // what check:api compares mechanically.
  expect(`"${renderedHash}"`).toBe(servedEtag);
  expect(html).toContain('href="/api/openapi.json"');
  // Self-contained: no CDN script, stylesheet, font, or image (R8).
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/https?:\/\/(?!marquee)/i);

  const document = await documentResponse.json<{ paths: Record<string, Record<string, unknown>> }>();
  const operationCount = Object.values(document.paths).reduce<number>(
    (total, operations) => total + Object.keys(operations).length,
    0,
  );
  expect(html).toContain(`name="marquee-openapi-operations" content="${operationCount}"`);
});
