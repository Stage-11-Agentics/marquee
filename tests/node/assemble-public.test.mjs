import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assembler = resolve(repositoryRoot, "scripts/checks/assemble-public.mjs");

function git(repository, ...arguments_) {
  const result = spawnSync("git", ["-C", repository, ...arguments_], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("CONTRACT · public assembly is an allowlisted parentless snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "marquee-public-assembly-"));
  const source = join(root, "source");
  const output = join(root, "output");
  const privateTree = [".", "lat", "tice"].join("");
  const privateHost = ["marquee", ".", "stage", "11", ".dev"].join("");
  const privateTerm = ["Lat", "tice"].join("");
  try {
    await mkdir(join(source, "scripts/seed"), { recursive: true });
    await mkdir(join(source, "sequence/research/sources"), { recursive: true });
    await mkdir(join(source, privateTree, "orchestration"), { recursive: true });
    await mkdir(join(source, "prototypes/skins"), { recursive: true });
    await writeFile(join(source, "LICENSE"), "Apache License, Version 2.0\n", "utf8");
    await writeFile(
      join(source, "README.md"),
      `${privateHost} ${privateTerm} surface:7 workspace:8\n`,
      "utf8",
    );
    await writeFile(
      join(source, "scripts/seed/_source.ts"),
      'const path = ["sequence", "research", "sources", "aie-summit-2025-program.json"];\n',
      "utf8",
    );
    await writeFile(join(source, "sequence/research/sources/hidden.vtt"), "private\n", "utf8");
    await writeFile(join(source, `${privateTree}/orchestration/run-state.md`), "private\n", "utf8");
    await writeFile(
      join(source, "sequence/research/sources/aie-summit-2025-program.json"),
      JSON.stringify({
        _source: "private capture",
        sessions: [{
          id: "1",
          slug: "demo",
          title: "Demo session",
          track: "Track",
          type: "TALK",
          room: "Room",
          start: "2025-01-01T10:00:00",
          duration_min: 30,
          abstract: "Abstract",
          description: null,
          recording: "private",
          speakers: [{ name: "Ada", title: "Engineer", company: "Example", bio: "Bio", social: "https://example.com/ada", email: "ada@private.example" }],
        }],
      }),
      "utf8",
    );
    await writeFile(join(source, "prototypes/skins/skin-a.html"), "private\n", "utf8");
    await writeFile(join(source, "prototypes/skins/skin-c.html"), "public\n", "utf8");

    git(source, "init", "-q");
    git(source, "config", "user.email", "test@example.invalid");
    git(source, "config", "user.name", "Assembly Test");
    git(source, "add", ".");
    git(source, "commit", "-qm", "source snapshot");

    const result = spawnSync(
      process.execPath,
      [assembler, "--repo", source, "--ref", "HEAD", "--output", output, "--commit"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.excludedExactPaths, 24);
    assert.equal(report.pathCount, 5);
    assert.equal(git(source, "rev-list", "--parents", "-n", "1", report.commit), report.commit);

    const paths = git(source, "ls-tree", "-r", "--name-only", report.commit).split("\n");
    assert.equal(paths.includes(`${privateTree}/orchestration/run-state.md`), false);
    assert.equal(paths.includes("sequence/research/sources/hidden.vtt"), false);
    assert.equal(paths.includes("prototypes/skins/skin-a.html"), false);
    assert.equal(paths.includes("prototypes/skins/skin-c.html"), true);

    const fixture = JSON.parse(await readFile(join(output, "fixtures/seed/aie-summit-2025-program.json"), "utf8"));
    assert.deepEqual(Object.keys(fixture), ["sessions"]);
    assert.deepEqual(Object.keys(fixture.sessions[0].speakers[0]), ["name", "title", "company", "bio", "social"]);
    assert.equal(await readFile(join(output, "README.md"), "utf8"), "marquee.example task tracker surface-id workspace-id\n");
    assert.match(await readFile(join(output, "scripts/seed/_source.ts"), "utf8"), /"fixtures",\s*"seed"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
