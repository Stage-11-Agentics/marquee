import assert from "node:assert/strict";
import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const productRoots = ["src", "dist"];
const allowedBadgeRoot = "prototypes/";
const badgeMarkers = [
  { name: "prototype-badge class", pattern: /prototype-badge/ },
  { name: "badge copy", pattern: /Prototype\s*[·—-]\s*mock\s+data/i },
  { name: "uppercase PROTOTYPE marker", pattern: /\bPROTOTYPE\b/ },
];

async function filesUnder(relativeRoot) {
  try {
    const paths = await readdir(resolve(root, relativeRoot), { recursive: true });
    const files = await Promise.all(paths.map(async (path) => {
      const absolute = resolve(root, relativeRoot, path);
      return (await lstat(absolute)).isFile() ? `${relativeRoot}/${path}` : null;
    }));
    return files.filter((path) => path !== null).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function markerMatches(relativePath) {
  const source = await readFile(resolve(root, relativePath), "utf8");
  return badgeMarkers.filter(({ pattern }) => source.match(pattern) !== null).map(({ name }) => name);
}

test("CONTRACT · the prototype badge is confined to prototype artifacts", async () => {
  const files = (await Promise.all([
    ...productRoots.map(filesUnder),
    filesUnder("prototypes"),
  ])).flat();
  const matches = [];
  for (const path of files) {
    const markers = await markerMatches(path);
    if (markers.length) matches.push({ path, markers });
  }

  const outsideAllowlist = matches.filter(({ path }) => !path.startsWith(allowedBadgeRoot));
  assert.deepEqual(
    outsideAllowlist,
    [],
    `badge markers must stay under ${allowedBadgeRoot}: ${JSON.stringify(outsideAllowlist)}`,
  );

  const bindingPrototype = matches.find(({ path }) => path === "prototypes/pipeline-v1.1/index.html");
  assert.ok(bindingPrototype, "the binding prototype must retain its badge markers");
  const bindingSource = await readFile(resolve(root, "prototypes/pipeline-v1.1/index.html"), "utf8");
  assert.match(bindingSource, /prototype-badge/);
  assert.match(bindingSource, /Prototype\s*·\s*mock\s+data/);
});
