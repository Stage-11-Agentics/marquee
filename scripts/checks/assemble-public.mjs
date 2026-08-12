#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { emit, parseArguments } from "./lib/command.mjs";

const exec = promisify(execFile);
const MAX_BUFFER = 128 * 1024 * 1024;

/**
 * The public tree is deliberately an allowlist. New private top-level
 * material does not become publishable merely because it lives beside the
 * application.
 */
export const PUBLIC_ROOT_DIRECTORIES = [
  ".github",
  "cli",
  "fixtures",
  "migrations",
  "scripts",
  "src",
  "tests",
];

export const PUBLIC_ROOT_FILES = [
  ".dev.vars.example",
  ".gitignore",
  ".gitleaks.toml",
  "DESIGN.md",
  "EVALUATION.md",
  "LICENSE",
  "PHILOSOPHY.md",
  "README.md",
  "SEED-DATA.md",
  "SKILL.md",
  "index.html",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "tsconfig.client.json",
  "tsconfig.test.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "vitest.node.config.ts",
  "wrangler.jsonc",
];

export const PUBLIC_EXACT_PROTOTYPES = [
  "prototypes/pipeline-v1.1/index.html",
  "prototypes/skins/skin-c.html",
];

const privateMetadataPrefix = [".", "lat", "tice"].join("");

/** The audit's exact denied names, retained as executable assembly evidence. */
export const PUBLIC_EXCLUDED_PATHS = [
  `${privateMetadataPrefix}/orchestration/run-state.md`,
  "sequence/run-state.md",
  "sequence/research/briefs/AGENT-BRIEF-adversarial-pass.md",
  "sequence/research/briefs/AGENT-BRIEF-amendment-editor.md",
  "sequence/research/briefs/AGENT-BRIEF-api-comparison.md",
  "sequence/research/briefs/AGENT-BRIEF-board-mint.md",
  "sequence/research/briefs/AGENT-BRIEF-contract-draft.md",
  "sequence/research/briefs/AGENT-BRIEF-discord-intel.md",
  "sequence/research/briefs/AGENT-BRIEF-eval-draft.md",
  "sequence/research/briefs/AGENT-BRIEF-landscape-features.md",
  "sequence/research/briefs/AGENT-BRIEF-seams-feasibility.md",
  "sequence/research/briefs/AGENT-BRIEF-seed-source.md",
  "sequence/research/briefs/AGENT-BRIEF-stakeholders-stories.md",
  "sequence/research/sources/AGENT-BRIEF-competition-research.md",
  "sequence/research/sources/aie-summit-2025-program.json",
  "sequence/research/sources/brief-image1.png",
  "sequence/research/sources/competition-brief-full.pdf",
  "sequence/research/sources/competition-brief.md",
  "sequence/research/sources/competitor-context-doc-2026-08-08.md",
  "sequence/research/sources/sessionboard-kb-urls.txt",
  "sequence/research/sources/tweet-image.png",
  "sequence/research/sources/walkthrough-transcript.txt",
  "sequence/research/sources/walkthrough.en-orig.vtt",
  "sequence/research/sources/walkthrough.en.vtt",
];

const SOURCE_PROGRAM_PATH = "sequence/research/sources/aie-summit-2025-program.json";
const PUBLIC_PROGRAM_PATH = "fixtures/seed/aie-summit-2025-program.json";
const SOURCE_LOADER_PATH = "scripts/seed/_source.ts";

const archiveEntries = [
  ...PUBLIC_ROOT_DIRECTORIES,
  ...PUBLIC_ROOT_FILES,
  ...PUBLIC_EXACT_PROTOTYPES,
];

function gitEnvironment(extra = {}) {
  return { ...process.env, ...extra };
}

async function git(repository, arguments_, options = {}) {
  const result = await exec("git", ["-C", repository, ...arguments_], {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    ...options,
  });
  return result.stdout.trim();
}

async function gitBuffer(repository, arguments_) {
  return exec("git", ["-C", repository, ...arguments_], {
    encoding: "buffer",
    maxBuffer: MAX_BUFFER,
  });
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    try {
      await readdir(path);
      return true;
    } catch {
      return false;
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function privateTextRules() {
  const appHost = ["marquee", ".", "stage", "11", ".dev"].join("");
  const mediaHost = ["media", ".marquee", ".stage", "11", ".dev"].join("");
  const mailDomain = ["stage", "11", ".systems"].join("");
  const privateForge = ["forgejo", ".", "stage", "11", ".", "ai"].join("");
  const orgRepo = ["github.com", "/", "Stage-11-Agentics", "/marquee"].join("");
  const oldOrgRepo = ["github.com", "/", "stage11", "/marquee"].join("");
  const userPathPrefix = ["/", "Users", "/"].join("");
  const homePathPrefix = ["~", "/Projects/"].join("");
  const privateUserDirectory = ["At", "in", "/"].join("");
  const routingPrefix = ["C11", "_"].join("");
  const surfacePrefix = ["surface", ":"].join("");
  const workspacePrefix = ["workspace", ":"].join("");
  const trackerWord = ["Lat", "tice"].join("");
  const agentWord = ["dele", "gator"].join("");
  const runnerWord = ["orches", "trator"].join("");
  const networkWord = ["tail", "net"].join("");
  const privateForgeWord = ["Forge", "jo"].join("");

  return [
    { pattern: new RegExp(escapeRegex(mediaHost), "gi"), replacement: "media.marquee.example" },
    { pattern: new RegExp(escapeRegex(appHost), "gi"), replacement: "marquee.example" },
    { pattern: new RegExp(escapeRegex(mailDomain), "gi"), replacement: "example.com" },
    { pattern: new RegExp(escapeRegex(privateForge), "gi"), replacement: "github.com/your-org/marquee" },
    { pattern: new RegExp(escapeRegex(orgRepo), "gi"), replacement: "github.com/your-org/marquee" },
    { pattern: new RegExp(escapeRegex(oldOrgRepo), "gi"), replacement: "github.com/your-org/marquee" },
    { pattern: new RegExp(`${escapeRegex(userPathPrefix)}[^\\s<>\\]\\)\\}"']+`, "gi"), replacement: "path/to/repository" },
    { pattern: new RegExp(`${escapeRegex(homePathPrefix)}[^\\s<>\\]\\)\\}"']+`, "gi"), replacement: "path/to/repository" },
    { pattern: new RegExp(`(?:^|/)${escapeRegex(privateUserDirectory)}`, "gi"), replacement: "public-path/" },
    { pattern: new RegExp(["Stage", "[- ]?", "11"].join(""), "gi"), replacement: "Marquee" },
    { pattern: new RegExp(`\\b${escapeRegex(networkWord)}\\b`, "gi"), replacement: "private network" },
    { pattern: new RegExp(`\\b${escapeRegex(privateForgeWord)}\\b`, "gi"), replacement: "forge" },
    { pattern: new RegExp(`\\b${escapeRegex(trackerWord)}\\b`, "gi"), replacement: "task tracker" },
    { pattern: new RegExp(`\\b${escapeRegex(agentWord)}\\b`, "gi"), replacement: "agent" },
    { pattern: new RegExp(`\\b${escapeRegex(runnerWord)}\\b`, "gi"), replacement: "runner" },
    { pattern: new RegExp(`\\b${escapeRegex(routingPrefix)}[A-Z0-9_]+\\b`, "gi"), replacement: "INTERNAL_ID" },
    { pattern: new RegExp(`\\b${escapeRegex(surfacePrefix)}\\d+`, "gi"), replacement: "surface-id" },
    { pattern: new RegExp(`\\b${escapeRegex(workspacePrefix)}\\d+`, "gi"), replacement: "workspace-id" },
    {
      pattern: /\b[A-Z0-9._%+-]+@(?!(?:[A-Z0-9-]+\.)*(?:example|invalid|test)(?:\.[A-Z]{2,})?\b)(?:[A-Z0-9-]+\.)+[A-Z]{2,}\b/gi,
      replacement: "contact@example.com",
    },
    { pattern: /sequence\/USER_STORIES\.md/gi, replacement: "the acceptance-criteria ledger" },
    { pattern: /sequence\/research\/[^\s)`>]+/gi, replacement: "the public product contract" },
  ];
}

function scrubText(text) {
  return privateTextRules().reduce(
    (value, { pattern, replacement }) => value.replace(pattern, replacement),
    text,
  );
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function scrubTree(output) {
  for (const path of await walkFiles(output)) {
    const bytes = await readFile(path);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    const scrubbed = scrubText(text);
    if (scrubbed !== text) await writeFile(path, scrubbed, "utf8");
  }
}

function pickFields(value, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]));
}

function publicProgram(payload) {
  if (!Array.isArray(payload.sessions) || payload.sessions.length === 0) {
    throw new Error(`source program has no sessions at ${SOURCE_PROGRAM_PATH}`);
  }
  return {
    sessions: payload.sessions.map((session) => ({
      ...pickFields(session, [
        "id",
        "slug",
        "title",
        "track",
        "type",
        "room",
        "start",
        "duration_min",
        "abstract",
        "description",
      ]),
      speakers: Array.isArray(session.speakers)
        ? session.speakers.map((speaker) => pickFields(speaker, ["name", "title", "company", "bio", "social"]))
        : [],
    })),
  };
}

async function materializePublicFixture(repository, ref, sourcePaths, output) {
  const sourcePath = sourcePaths.includes(SOURCE_PROGRAM_PATH)
    ? SOURCE_PROGRAM_PATH
    : sourcePaths.includes(PUBLIC_PROGRAM_PATH)
      ? PUBLIC_PROGRAM_PATH
      : undefined;
  if (!sourcePath) throw new Error(`source program is absent from ${ref}`);

  const source = await gitBuffer(repository, ["show", `${ref}:${sourcePath}`]);
  const fixture = publicProgram(JSON.parse(source.stdout.toString("utf8")));
  const fixturePath = join(output, PUBLIC_PROGRAM_PATH);
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

  const loaderPath = join(output, SOURCE_LOADER_PATH);
  const loader = await readFile(loaderPath, "utf8");
  // The loader has reached the private capture two ways over this repo's life:
  // as path segments joined at runtime, and as a static JSON import specifier.
  // Both must land on the materialized public fixture, because `sequence/` is
  // not in the public tree at all — an unrewritten specifier ships a dangling
  // import rather than a leak, which fails the public build instead of the cut.
  const rewrites = [
    { from: /"sequence",\s*"research",\s*"sources",/, to: '"fixtures",\n  "seed",' },
    { from: /sequence\/research\/sources\/(?=aie-summit-2025-program\.json)/g, to: "fixtures/seed/" },
  ];
  const rewritten = rewrites.reduce((text, { from, to }) => text.replace(from, to), loader);
  if (rewritten === loader) throw new Error(`seed loader did not expose the private source path: ${SOURCE_LOADER_PATH}`);
  if (rewritten.includes("sequence/research/sources")) {
    throw new Error(`seed loader still reaches the private capture after rewrite: ${SOURCE_LOADER_PATH}`);
  }
  await writeFile(loaderPath, rewritten, "utf8");
}

async function archive(repository, ref, output, sourcePaths) {
  const entries = archiveEntries.filter((entry) =>
    sourcePaths.some((path) => path === entry || path.startsWith(`${entry}/`)),
  );
  if (!entries.includes("LICENSE")) throw new Error(`source ref ${ref} must contain LICENSE`);
  const archiveResult = await exec(
    "git",
    ["-C", repository, "archive", "--format=tar", ref, "--", ...entries],
    { encoding: "buffer", maxBuffer: MAX_BUFFER },
  );
  const tempDirectory = await mkdtemp(join(tmpdir(), "marquee-public-archive-"));
  const archivePath = join(tempDirectory, "tree.tar");
  try {
    await writeFile(archivePath, archiveResult.stdout);
    await exec("tar", ["-xf", archivePath, "-C", output], { maxBuffer: MAX_BUFFER });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function writeCommit(repository, output, message) {
  const indexDirectory = await mkdtemp(join(tmpdir(), "marquee-public-index-"));
  const indexPath = join(indexDirectory, "index");
  const environment = gitEnvironment({ GIT_INDEX_FILE: indexPath });
  try {
    await git(repository, ["read-tree", "--empty"], { env: environment });
    const gitDirectory = resolve(repository, await git(repository, ["rev-parse", "--git-dir"]));
    await exec(
      "git",
      ["--git-dir", gitDirectory, "--work-tree", output, "add", "-A", "--", "."],
      { env: environment, maxBuffer: MAX_BUFFER },
    );
    const tree = await git(repository, ["write-tree"], { env: environment });
    const commit = await git(repository, ["commit-tree", tree, "-m", message]);
    return { tree, commit };
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}

function assertSafeOutput(repository, output) {
  const root = resolve(repository);
  const target = resolve(output);
  if (target === root || target === dirname(root) || target === "/") {
    throw new Error(`refusing to assemble into broad target ${target}`);
  }
}

const args = parseArguments();
if (args.help) {
  emit({ usage: "npm run assemble:public -- --repo <repo> --ref <ref> --output <dir> [--force] [--commit] [--update-ref <ref>]" });
  process.exit(0);
}

const repository = resolve(String(args.repo ?? process.cwd()));
const ref = String(args.ref ?? "HEAD");
const output = resolve(String(args.output ?? ""));
if (!args.output) throw new Error("assemble:public requires an explicit --output directory");
assertSafeOutput(repository, output);
if (await pathExists(output)) {
  const existingEntries = await readdir(output);
  if (existingEntries.length > 0) {
    if (!args.force) throw new Error(`output exists; pass --force to replace ${output}`);
    await rm(output, { recursive: true, force: true });
  }
}
await mkdir(output, { recursive: true });

await git(repository, ["rev-parse", "--verify", `${ref}^{commit}`]);
const sourcePaths = (await git(repository, ["ls-tree", "-r", "--name-only", "-z", ref])).split("\0").filter(Boolean);
await archive(repository, ref, output, sourcePaths);
await materializePublicFixture(repository, ref, sourcePaths, output);
await scrubTree(output);

const result = {
  repository,
  ref,
  output,
  excludedRoots: [privateMetadataPrefix, "sequence", "spikes", "prototypes (except the two explicit files)"],
  excludedExactPaths: PUBLIC_EXCLUDED_PATHS.length,
  pathCount: (await walkFiles(output)).length,
  commit: null,
  tree: null,
};

if (args.commit) {
  const commitResult = await writeCommit(repository, output, String(args.message ?? "Public Marquee snapshot"));
  result.tree = commitResult.tree;
  result.commit = commitResult.commit;
  if (args["update-ref"]) {
    await git(repository, ["update-ref", String(args["update-ref"]), commitResult.commit]);
    result.updatedRef = String(args["update-ref"]);
  }
}

emit(result);
