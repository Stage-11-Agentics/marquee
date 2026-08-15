import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const checkRoutes = resolve(repositoryRoot, "scripts/checks/check-routes.mjs");
const routeMap = resolve(repositoryRoot, "docs/ROUTES.md");

function runCheck(...arguments_) {
  return spawnSync("npm", ["run", "check:routes", ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env },
  });
}

test("CONTRACT · check:routes passes and --write preserves the committed map", async () => {
  const before = await readFile(routeMap, "utf8");
  const check = runCheck();
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /"command": "check:routes"/);
  assert.match(check.stdout, /"status": "pass"/);

  const write = runCheck("--", "--write");
  assert.equal(write.status, 0, write.stdout + write.stderr);
  assert.match(write.stdout, /"wrote": "docs\/ROUTES\.md"/);
  assert.equal(await readFile(routeMap, "utf8"), before);
});

test("CONTRACT · the route resolver fails loudly on a genuinely broken import", async () => {
  const source = await readFile(checkRoutes, "utf8");
  const hook = source.match(/registerHooks\(\{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(hook, "check:routes must retain an explicit resolve hook fixture can exercise");

  const fixture = await mkdtemp(resolve(tmpdir(), "marquee-route-hook-"));
  try {
    await writeFile(resolve(fixture, "entry.mjs"), 'import "./genuinely-missing-module";\n', "utf8");
    await writeFile(
      resolve(fixture, "runner.mjs"),
      [
        'import { registerHooks } from "node:module";',
        'import { existsSync } from "node:fs";',
        'import { resolve } from "node:path";',
        'import { fileURLToPath, pathToFileURL } from "node:url";',
        hook,
        'await import("./entry.mjs");',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(process.execPath, [resolve(fixture, "runner.mjs")], {
      cwd: fixture,
      encoding: "utf8",
    });
    const output = result.stdout + result.stderr;
    assert.notEqual(result.status, 0, "a missing import must not be swallowed by the resolver");
    assert.match(output, /genuinely-missing-module/);
    assert.match(output, /ERR_MODULE_NOT_FOUND|Cannot find module/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
