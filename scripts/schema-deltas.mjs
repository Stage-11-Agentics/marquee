import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DELTA_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "schema-deltas");
const DELTA_FILE = /^(\d+_.+)\.json$/;

function readDelta(filename) {
  const migrationName = filename.replace(/\.json$/, "");
  const path = join(DELTA_DIRECTORY, filename);
  let delta;
  try {
    delta = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid schema delta ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const keys = Object.keys(delta ?? {}).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "foreignKeys" ||
    keys[1] !== "tables" ||
    !Number.isInteger(delta.tables) ||
    !Number.isInteger(delta.foreignKeys)
  ) {
    throw new Error(
      `Invalid schema delta ${path}: expected { "tables": <integer>, "foreignKeys": <integer> }`,
    );
  }

  return [migrationName, Object.freeze({ tables: delta.tables, foreignKeys: delta.foreignKeys })];
}

const deltaFiles = readdirSync(DELTA_DIRECTORY)
  .filter((filename) => DELTA_FILE.test(filename))
  .sort();

// Each migration owns one file. New migrations add a file; they never edit a
// shared total or another migration's receipt. Sorting keeps the exported map
// deterministic while leaving concurrent migration PRs on separate paths.
export const SCHEMA_DELTAS = Object.freeze(
  Object.fromEntries(deltaFiles.map((filename) => readDelta(filename))),
);
