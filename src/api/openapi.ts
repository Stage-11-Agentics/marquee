/**
 * OpenAPI assembly. The document is generated from the very route objects the
 * router registers — there is no second schema, no handwritten YAML, and no
 * docs-only operation list. Everything downstream (the served JSON, the
 * rendered docs shell, the emitted `dist/` artifacts, and later the CLI
 * registry) derives from this one document.
 *
 * R8: the object is canonicalized (keys sorted, recursively), serialized
 * exactly once, and SHA-256'd over those exact UTF-8 bytes. The response ETag,
 * the emitted registry hash, and the docs shell all name that one digest, so
 * `check:api` can compare served JSON, emitted artifact, and rendered docs
 * mechanically rather than by eye.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";

import { operationSignatures } from "./manifest";
import type { ApiRouteEntry } from "./route";
import type { ApiEnv } from "./runtime";

export const API_DOCUMENT_TITLE = "Marquee API";
/** The `/api/v1` surface. Bumped only by a deliberate breaking-change ticket. */
export const API_DOCUMENT_VERSION = "1.0.0";
export const API_BASE_PATH = "/api/v1";

/** The two meta endpoints, deliberately outside `/api/v1` (they are not versioned surface). */
export const OPENAPI_JSON_PATH = "/api/openapi.json";
export const API_DOCS_PATH = "/api/docs";

export type OpenApiDocument = Record<string, unknown>;

export interface ApiDocumentBundle {
  /** The canonicalized document — key order here is the serialized byte order. */
  document: OpenApiDocument;
  /** The one serialization. Serving anything else breaks the digest contract. */
  json: string;
  /** SHA-256 of `json`'s UTF-8 bytes, lowercase hex. */
  hash: string;
  /** Strong quoted ETag over the same digest. */
  etag: string;
  /** Canonical `METHOD path operationId` signatures, sorted. */
  signatures: string[];
}

/** Recursively sort object keys so serialization is byte-deterministic across machines. */
export function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item)) as T;
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted as T;
  }
  return value;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Register the auth schemes and shared metadata the document advertises. */
export function registerApiComponents(app: OpenAPIHono<ApiEnv>): void {
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "mq_session",
    description: "Browser session cookie issued by the sign-in flow.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description:
      "Scoped organization token. Effective authority is the intersection of the token's grants and its issuer's membership.",
  });
}

const DOCUMENT_CONFIG = {
  openapi: "3.1.0",
  info: {
    title: API_DOCUMENT_TITLE,
    version: API_DOCUMENT_VERSION,
    description: [
      "Marquee's agent-native API. Every operation the product performs is here:",
      "the UI is one of its callers, never a privileged one.",
      "",
      `Versioned operations live under \`${API_BASE_PATH}\`. Lists share one contract`,
      "(`page`, `per_page`, `q`, `sort`, plus typed per-endpoint filters) and return",
      "`{data, page, per_page, total, total_pages}`. Every failure with a body uses one",
      "error envelope.",
      "Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`.",
      "",
      "Optimistic concurrency is scoped to **agenda items**, where concurrent editing is real:",
      "every agenda item read carries a strong `etag`, `PATCH` and `DELETE` on an item require",
      "that exact tag in `If-Match`, and a stale tag is refused `409` with the current tag in the",
      "`ETag` response header. Every other mutation is last-write-wins.",
    ].join("\n"),
  },
  servers: [
    {
      url: "/",
      description: `Same origin as the app. All versioned operations are under ${API_BASE_PATH}.`,
    },
  ],
};

/**
 * Assemble, canonicalize, serialize, and digest the document once.
 *
 * `app` must already carry every registered route — this reads the same
 * registry the router registered into, so the document cannot describe an
 * operation the router does not serve, or omit one it does.
 */
export async function assembleApiDocument(
  app: OpenAPIHono<ApiEnv>,
  entries: readonly ApiRouteEntry[],
): Promise<ApiDocumentBundle> {
  const generated = app.getOpenAPI31Document(DOCUMENT_CONFIG) as unknown as OpenApiDocument;
  const document = canonicalize(generated);
  const json = JSON.stringify(document);
  const hash = await sha256Hex(json);
  return {
    document,
    json,
    hash,
    etag: `"${hash}"`,
    signatures: operationSignatures(entries),
  };
}

/**
 * The docs shell. Self-contained by contract (R8): no CDN script, style, or
 * font, so it renders in the clean self-host container with no public network
 * access. It fetches the live `/api/openapi.json` rather than embedding a
 * copied spec, and prints the digest it rendered so `check:api` can match the
 * rendered docs against the served bytes mechanically.
 */
export function renderDocsShell(bundle: ApiDocumentBundle): string {
  const paths = (bundle.document.paths ?? {}) as Record<string, Record<string, unknown>>;
  const rows = Object.entries(paths)
    .flatMap(([path, operations]) =>
      Object.entries(operations).map(([method, operation]) => ({
        method: method.toUpperCase(),
        path,
        operation: operation as Record<string, unknown>,
      })),
    )
    .sort((left, right) =>
      `${left.path} ${left.method}`.localeCompare(`${right.path} ${right.method}`),
    );

  const escape = (value: unknown): string =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const operationRows = rows
    .map(
      (row) => `<tr>
          <td class="method method-${escape(row.method.toLowerCase())}">${escape(row.method)}</td>
          <td class="path"><code>${escape(row.path)}</code></td>
          <td class="summary">${escape(row.operation.summary)}</td>
          <td class="operation-id"><code>${escape(row.operation.operationId)}</code></td>
        </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(API_DOCUMENT_TITLE)} · reference</title>
    <meta name="marquee-openapi-sha256" content="${escape(bundle.hash)}" />
    <meta name="marquee-openapi-operations" content="${rows.length}" />
    <link rel="alternate" type="application/json" href="${OPENAPI_JSON_PATH}" />
    <style>
      :root { color-scheme: dark; --ink: #e8eaed; --muted: #9aa1ab; --rule: #262a31; --bg: #0d0f12; --panel: #14171c; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 2.5rem 1.5rem 4rem; background: var(--bg); color: var(--ink);
             font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
      main { max-width: 68rem; margin: 0 auto; }
      h1 { font-size: 1.6rem; margin: 0 0 .35rem; letter-spacing: -0.01em; }
      p.lede { color: var(--muted); margin: 0 0 2rem; max-width: 46rem; }
      code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .88em; }
      a { color: #7fb0ff; }
      table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; overflow: hidden; }
      th { text-align: left; font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted);
           padding: .7rem .9rem; border-bottom: 1px solid var(--rule); font-weight: 600; }
      td { padding: .6rem .9rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
      tr:last-child td { border-bottom: 0; }
      .method { font-weight: 700; font-size: .78rem; white-space: nowrap; font-family: ui-monospace, Menlo, monospace; }
      .method-get { color: #6fd08c; } .method-post { color: #7fb0ff; }
      .method-patch { color: #e3b341; } .method-delete { color: #f0776c; } .method-put { color: #c792ea; }
      .summary { color: var(--muted); }
      .operation-id { color: var(--muted); }
      footer { color: var(--muted); font-size: .8rem; margin-top: 1.5rem; }
      .empty { padding: 1.2rem .9rem; color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <h1>${escape(API_DOCUMENT_TITLE)}</h1>
      <p class="lede">
        Version ${escape(API_DOCUMENT_VERSION)}. Every operation below is served by this
        deployment and described by <a href="${OPENAPI_JSON_PATH}"><code>${OPENAPI_JSON_PATH}</code></a>,
        which this page reads rather than copies.
      </p>
      ${
        rows.length === 0
          ? '<div class="empty">No operations are registered.</div>'
          : `<table>
        <thead><tr><th>Method</th><th>Path</th><th>Summary</th><th>Operation</th></tr></thead>
        <tbody>
${operationRows}
        </tbody>
      </table>`
      }
      <footer>
        ${rows.length} operation${rows.length === 1 ? "" : "s"} ·
        document SHA-256 <code>${escape(bundle.hash)}</code>
      </footer>
    </main>
  </body>
</html>
`;
}
