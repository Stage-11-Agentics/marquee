/**
 * Two ways a green local run stopped meaning anything, both found by reviewing
 * PR #99 rather than by a failing test.
 *
 * The checks in here read source rather than execute the gate, because
 * executing it takes two minutes and this suite is the inner-loop clock. What
 * they protect is narrow and worth protecting: the two decisions that, when
 * made the other way, produce a confident answer about the wrong thing.
 */
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(ROOT, path), "utf8");

test("CONTRACT · check:api decides freshness from inputs, never from existence", async () => {
  const source = await read("scripts/checks/check-api.mjs");

  // The bundle is rebuilt when src/ is newer, not merely when it is absent.
  // "Absent" is only ever true on a clean checkout, which is why CI never saw
  // this: in a worktree that survives a merge the bundle is present and stale,
  // and dist/ is ignored so git cannot correct it.
  assert.match(source, /async function bundleIsStale\(\)/);
  assert.match(source, /newestSource > bundle\.mtimeMs/);
  assert.doesNotMatch(source, /const exists = await access\(BUNDLE\)/);

  // The generated CLI registry is regenerated when the bundle it describes is
  // newer than it. This is the exact false red hit on #99: every route added by
  // the merge was reported missing from a registry that would list them the
  // moment it was rewritten.
  assert.match(source, /bundleStat\.mtimeMs > registryStat\.mtimeMs/);
  assert.doesNotMatch(source, /if \(!\(await access\(registryPath\)/);
});

test("CONTRACT · the full gate runs without a ticket, and still rejects a malformed one", async () => {
  const source = await read("scripts/checks/pr-gate.mjs");

  // Demanding a ticket made the gate unrunnable for unticketed work, and the
  // hand-rolled `check:*` list people substituted omits check:clocks and the
  // merged AC trace — the pair that reached CI red on #99 after a green local
  // run. A gate nobody can run is not a gate.
  assert.match(source, /args\.ticket !== undefined && !\/\^MRQ-\\d\+\$\/\.test/);
  assert.doesNotMatch(source, /pr-gate requires --ticket/);

  // Without a ticket the AC trace runs --scope=merged, exactly as CI does.
  assert.match(source, /"--scope=merged", \.\.\.\(args\.ticket \? \[`--ticket=\$\{args\.ticket\}`\] : \[\]\)/);
});

test("CONTRACT · every step CI runs is a step the local gate runs", async () => {
  // The gap that let #99 go red: a local run that is green while CI is not is
  // worse than no local run, because it is trusted. Whatever CI adds must
  // appear in pr-gate too, so the one command an agent can run is a superset
  // of the one that can block the merge.
  const workflow = await read(".github/workflows/ci.yml");
  const gate = await read("scripts/checks/pr-gate.mjs");

  const ciSteps = [...workflow.matchAll(/^\s+- run: (.+)$/gm)]
    .map((match) => match[1].trim())
    .filter((step) => step !== "npm ci");
  assert.ok(ciSteps.length >= 8, `expected CI to declare its steps, parsed ${ciSteps.length}`);

  const gateCovers = (step) => {
    const npmScript = step.match(/^npm run ([\w:-]+)/);
    if (npmScript) return gate.includes(`"${npmScript[1]}"`);
    if (step === "npm test") return gate.includes('"npm", ["test"]');
    const tsconfig = step.match(/tsc -p (\S+)/);
    if (tsconfig) return gate.includes(`"${tsconfig[1]}"`);
    if (step.includes("vite build")) return gate.includes('vite, ["build"]');
    if (step === "npx playwright install chromium") return gate.includes('playwright, ["install", "chromium"]');
    return false;
  };

  const uncovered = ciSteps.filter((step) => !gateCovers(step));
  assert.deepEqual(uncovered, [], `CI runs steps the local gate does not: ${uncovered.join(", ")}`);
});
