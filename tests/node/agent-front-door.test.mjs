import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(repositoryRoot, "src/agent-front-door/manifest.json");
const llmsPath = resolve(repositoryRoot, "src/agent-front-door/llms.txt");
const bundlePath = resolve(repositoryRoot, "dist/marquee/index.js");

function runCheckDocs(...arguments_) {
  return spawnSync("npm", ["run", "check:docs", ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, LOG_LEVEL: "silent" },
  });
}

test("CONTRACT · check:docs is a fast-gate-reachable generated-doc check", () => {
  const result = runCheckDocs();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"command": "check:docs"/);
  assert.match(result.stdout, /"status": "pass"/);
});

test("CONTRACT · every link advertised by llms.txt resolves in-process", async () => {
  const { app } = await import(`${resolve(bundlePath)}?agent-front-door-test=${Date.now()}`);
  const event = {
    id: "event-front-door",
    slug: "front-door",
    name: "Front Door",
    tagline: null,
    starts_on: "2026-10-12",
    ends_on: "2026-10-14",
    timezone: "America/New_York",
    venue: null,
    accent: null,
  };
  const database = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          return /FROM events/i.test(sql) ? event : null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
  const assets = {
    fetch: async () => new Response(
      "<!doctype html><html><head><title>Marquee</title></head><body><div id=\"app\"></div></body></html>",
      { headers: { "content-type": "text/html" } },
    ),
  };
  const environment = { CACHE: {}, DB: database, ASSETS: assets };
  const executionContext = { waitUntil() {}, passThroughOnException() {} };
  const request = (path) => app.fetch(
    new Request(`https://front-door.example.test${path}`),
    environment,
    executionContext,
  );

  const llms = await readFile(llmsPath, "utf8");
  const paths = [...llms.matchAll(/\]\((\/[^)\s]+)\)/g)].map((match) => match[1]);
  if (paths.length < 10) throw new Error("llms.txt should advertise the machine and document doors");

  for (const path of new Set(paths)) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
  }
});

test("CONTRACT · served manifest routes are canonical source bytes with no contract docs", async () => {
  const { app } = await import(`${resolve(bundlePath)}?agent-front-door-manifest-test=${Date.now()}`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const database = { prepare: () => ({ bind() { return this; }, async first() { return null; } }) };
  const environment = { CACHE: {}, DB: database };
  const executionContext = { waitUntil() {}, passThroughOnException() {} };

  for (const entry of manifest) {
    assert.notEqual(entry.source, "SPEC.md");
    assert.notEqual(entry.source, "EVALUATION.md");
    const source = await readFile(resolve(repositoryRoot, entry.source), "utf8");
    const response = await app.fetch(
      new Request(`https://front-door.example.test${entry.url}`),
      environment,
      executionContext,
    );
    assert.equal(response.status, 200, `${entry.url} returned ${response.status}`);
    assert.equal(
      await response.text(),
      `<!-- Canonical source: ${entry.source}; served at ${entry.url}. -->\n${source}`,
    );
  }
});
