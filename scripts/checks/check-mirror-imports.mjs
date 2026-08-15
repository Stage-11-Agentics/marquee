import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

export const MIRROR_TRANSPORT = resolve(REPOSITORY_ROOT, "src/jobs/mirror/transport.ts");
const MIRROR_JOB_ROOT = resolve(REPOSITORY_ROOT, "src/jobs/mirror");
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function candidatePaths(importer, specifier) {
  if (!specifier.startsWith(".")) return [];
  const base = resolve(dirname(importer), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, resolve(base, "index.ts")];
}

export async function findMirrorImportViolations(root = REPOSITORY_ROOT) {
  const sourceRoot = resolve(root, "src");
  const mirrorRoot = resolve(root, "src/jobs/mirror");
  const transport = resolve(root, "src/jobs/mirror/transport.ts");
  const violations = [];
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = candidatePaths(file, match[1]).find((candidate) => candidate === transport);
      if (!target) continue;
      const importerRelative = relative(mirrorRoot, file);
      if (importerRelative.startsWith("..")) {
        violations.push({ file: relative(root, file), specifier: match[1] });
      }
    }
  }
  return violations;
}

// Tests may point this checker at an isolated synthetic tree. The gate leaves
// the default rooted at the real repository, so production evidence still
// covers every source module without letting a node test mutate src/.
const violations = await findMirrorImportViolations(process.env.MIRROR_IMPORT_ROOT ?? REPOSITORY_ROOT);
if (violations.length > 0) {
  emit({ command: "check:mirror-imports", status: "fail", violations });
  process.exitCode = 1;
} else {
  emit({ command: "check:mirror-imports", status: "pass", boundary: "src/jobs/mirror/*" });
}
