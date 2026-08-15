import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const checker = resolve(repositoryRoot, "scripts/checks/check-mirror-imports.mjs");
const badImport = resolve(repositoryRoot, "src/__mirror-boundary-bad-import.ts");

async function runChecker() {
  try {
    const result = await execFileAsync(process.execPath, [checker], { cwd: repositoryRoot });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("the mirror transport import boundary has teeth", async () => {
  await writeFile(
    badImport,
    'import { createFetchAirtableTransport } from "./jobs/mirror/transport";\nvoid createFetchAirtableTransport;\n',
    "utf8",
  );
  try {
    const failing = await runChecker();
    assert.equal(failing.code, 1);
    assert.match(failing.stdout, /__mirror-boundary-bad-import\.ts/);

    await unlink(badImport);
    const passing = await runChecker();
    assert.equal(passing.code, 0, passing.stdout + passing.stderr);
  } finally {
    await unlink(badImport).catch(() => {});
  }
});
