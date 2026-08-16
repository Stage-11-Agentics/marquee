import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const checker = resolve(repositoryRoot, "scripts/checks/check-mirror-imports.mjs");

async function runChecker(root) {
  try {
    const result = await execFileAsync(process.execPath, [checker], {
      cwd: repositoryRoot,
      env: { ...process.env, MIRROR_IMPORT_ROOT: root },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("CONTRACT · the mirror transport import boundary has teeth", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "marquee-mirror-boundary-"));
  const sourceRoot = join(fixtureRoot, "src");
  const badImport = join(sourceRoot, "__mirror-boundary-bad-import.ts");
  const badSchemaImport = join(sourceRoot, "ui/settings/AirtablePage.tsx");
  await mkdir(join(sourceRoot, "jobs/mirror"), { recursive: true });
  await mkdir(join(sourceRoot, "ui/settings"), { recursive: true });
  await writeFile(join(sourceRoot, "jobs/mirror/transport.ts"), "export {};\n", "utf8");
  await writeFile(join(sourceRoot, "jobs/mirror/schema.ts"), "export {};\n", "utf8");
  await writeFile(
    badImport,
    'import { createFetchAirtableTransport } from "./jobs/mirror/transport";\nvoid createFetchAirtableTransport;\n',
    "utf8",
  );
  await writeFile(
    badSchemaImport,
    'import { ensureMirrorSchema } from "../../jobs/mirror/schema";\nvoid ensureMirrorSchema;\n',
    "utf8",
  );
  try {
    const failing = await runChecker(fixtureRoot);
    assert.equal(failing.code, 1);
    assert.match(failing.stdout, /__mirror-boundary-bad-import\.ts/);
    assert.match(failing.stdout, /ui\/settings\/AirtablePage\.tsx/);

    await rm(badImport);
    await rm(badSchemaImport);
    const passing = await runChecker(fixtureRoot);
    assert.equal(passing.code, 0, passing.stdout + passing.stderr);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
