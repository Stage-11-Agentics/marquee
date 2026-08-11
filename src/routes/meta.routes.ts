/**
 * The two meta endpoints. They are ordinary route modules discovered by the
 * same glob as everything else — the document describes them because they are
 * registered, not because anything special was written down about them.
 *
 * Neither is under `/api/v1`: they describe the versioned surface rather than
 * belonging to it.
 */
import { z } from "@hono/zod-openapi";

import {
  API_DOCS_PATH,
  API_DOCUMENT_TITLE,
  OPENAPI_JSON_PATH,
  renderDocsShell,
} from "../api/openapi";
import { defineApiRoute, errorResponses } from "../api/route";

const openApiDocumentSchema = z
  .record(z.string(), z.unknown())
  .openapi("OpenApiDocument", {
    description: `The assembled OpenAPI 3.1 document for ${API_DOCUMENT_TITLE}.`,
  });

const getOpenApiDocument = defineApiRoute(
  {
    method: "get",
    path: OPENAPI_JSON_PATH,
    operationId: "getOpenApiDocument",
    summary: "The OpenAPI document for this deployment",
    description:
      "Generated from the running route registry. The response body is the canonical serialization the ETag digests, so a caller can verify it byte-for-byte.",
    tags: ["Meta"],
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: {
        content: { "application/json": { schema: openApiDocumentSchema } },
        description: "The assembled document.",
      },
      ...errorResponses([429, 500]),
    },
  },
  (context) => {
    const bundle = context.get("apiDocument")();
    context.header("ETag", bundle.etag);
    context.header("Cache-Control", "no-cache");
    return context.json(bundle.document, 200);
  },
);

const getApiDocs = defineApiRoute(
  {
    method: "get",
    path: API_DOCS_PATH,
    operationId: "getApiDocs",
    summary: "Human-readable API reference",
    description:
      "A self-contained reference rendered from the same document served at /api/openapi.json — no CDN asset, no copied spec.",
    tags: ["Meta"],
    policy: {
      auth: { kind: "public" },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: {
        content: { "text/html": { schema: z.string() } },
        description: "The rendered reference.",
      },
      ...errorResponses([429, 500]),
    },
  },
  (context) => {
    const bundle = context.get("apiDocument")();
    context.header("Cache-Control", "no-cache");
    return context.html(renderDocsShell(bundle));
  },
);

export const apiRoutes = [getOpenApiDocument, getApiDocs];
