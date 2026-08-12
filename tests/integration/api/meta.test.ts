/**
 * AC-106 — the document validates, the docs route answers, and both are served
 * by the real Worker through its real routing, not by an in-process fixture.
 */
import { SELF } from "cloudflare:test";
import { validate } from "@scalar/openapi-parser";
import { expect, test } from "vitest";

import { apiManifest } from "../../../src/routes/_manifest";

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

test("CONTRACT · MRQ-146 · concurrency claims and headers describe only agenda mutations", async () => {
  const body = await (await SELF.fetch(`${ORIGIN}/api/openapi.json`)).text();
  const document = JSON.parse(body) as {
    info: { description: string };
    paths: Record<string, Record<string, {
      operationId?: string;
      parameters?: Array<{ in?: string; name?: string }>;
    }>>;
  };

  // MRQ-150 restates MRQ-146's claim in full rather than in one clause: the scope is
  // still agenda items only, and the document names the bounded conflict cases instead.
  expect(document.info.description).toContain("Optimistic concurrency is scoped to **agenda items**");
  const normalizedDescription = document.info.description.replace(/\s+/g, " ");
  expect(normalizedDescription).toContain(
    "No operation other than the two agenda item mutations takes `If-Match`. Several mutations still refuse a concurrent change on their own terms — agenda publication, submission decisions, participation responses, and task completion each answer `409` when the record moved underneath the request — so a `409` is worth handling on any write.",
  );
  expect(body.match(/If-Match/g) ?? []).toHaveLength(2);

  const ifMatchOperations = Object.values(document.paths)
    .flatMap((operations) => Object.values(operations))
    .filter((operation) => operation.parameters?.some(
      (parameter) => parameter.in === "header" && parameter.name?.toLowerCase() === "if-match",
    ))
    .map((operation) => operation.operationId)
    .sort();
  expect(ifMatchOperations).toEqual(["removeAgendaItem", "updateAgendaItem"]);
});

test("CONTRACT · MRQ-146 · the skill is served as markdown rather than the SPA shell", async () => {
  const response = await SELF.fetch(`${ORIGIN}/SKILL.md`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/markdown");

  const body = await response.text();
  expect(body.split("\n").slice(0, 3)).toEqual([
    "# Marquee",
    "",
    "Marquee is a conference operating system. Use its API or CLI as the source of truth for program work; keep each action explicit and inspect the returned state.",
  ]);
  expect(body).not.toMatch(/^<!doctype html>/i);
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

/**
 * MRQ-150 — `info.description` is a claim a technical judge can falsify in one
 * request, so it is held to the route table rather than to an author's memory.
 * The document used to state that mutations carry `ETag`/`If-Match` optimistic
 * concurrency; two of two hundred did.
 */
test("CONTRACT · MRQ-150 · the document's concurrency claim matches the routes that actually enforce it", async () => {
  const enforcing = apiManifest
    .filter((route) => route.policy.concurrency === "if-match")
    .map((route) => `${route.method.toUpperCase()} ${route.path}`)
    .sort();

  // If this list grows, the sentence in `src/api/openapi.ts` has to grow with
  // it — that is the whole point of asserting the set rather than the count.
  expect(enforcing).toEqual([
    "DELETE /api/v1/events/{eventId}/agenda/items/{itemId}",
    "PATCH /api/v1/events/{eventId}/agenda/items/{itemId}",
  ]);

  const description = (await (await SELF.fetch(`${ORIGIN}/api/openapi.json`)).json<{ info: { description: string } }>())
    .info.description;
  const normalizedDescription = description.replace(/\s+/g, " ");
  expect(description).not.toContain("Mutations carry strong");
  expect(description).toContain("agenda items");
  expect(description).toContain("If-Match");
  expect(normalizedDescription).toContain("agenda publication, submission decisions, participation responses, and task completion");
});
