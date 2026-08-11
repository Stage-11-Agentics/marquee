#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const bundle = resolve(root, "dist/marquee/index.js");
await access(bundle).catch(() => {
  throw new Error("build the Worker first with `npx vite build`");
});

const worker = await import(`${pathToFileURL(bundle).href}?registry=${Date.now()}`);
if (!worker.app?.fetch) throw new Error("the Worker bundle does not export a Hono app");
const response = await worker.app.fetch(
  new Request("https://marquee.local/api/openapi.json"),
  { CACHE: {}, DB: {} },
  { waitUntil() {}, passThroughOnException() {} },
);
if (!response.ok) throw new Error(`OpenAPI route returned ${response.status}`);
const text = await response.text();
const document = JSON.parse(text);
const operations = Object.entries(document.paths ?? {})
  .flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => ({
    signature: `${method.toUpperCase()} ${path} ${operation.operationId}`,
    path,
    operationId: operation.operationId,
  })))
  .sort((left, right) => left.signature.localeCompare(right.signature));
const output = {
  source: "/api/openapi.json",
  documentSha256: createHash("sha256").update(text, "utf8").digest("hex"),
  operations: operations.map((operation) => operation.signature),
};
await writeFile(resolve(root, "cli/api-registry.json"), `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`wrote cli/api-registry.json (${operations.length} operations)\n`);
