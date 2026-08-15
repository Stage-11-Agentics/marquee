/**
 * The auto-eval spine's cleanup trap, proved by running it.
 *
 * Its sibling tests/node/gate-truth.test.mjs reads source rather than
 * executing, because executing the gate costs two minutes. Here that trade is
 * inverted and the reason matters: the defect this file exists to pin is a
 * cleanup path that SILENTLY DOES NOT RUN. Source reading is precisely the
 * instrument that misses it — the trap is present, correctly written, and
 * unreachable. `grep 'trap .* ERR'` passes on the broken script. So these
 * tests spawn the real loop.sh against stubbed ssh/scp, which costs
 * milliseconds, and assert on what actually happened to the freeze file.
 *
 * The bug: without `set -E` (errtrace) an ERR trap set inside a function is not
 * inherited by the functions that function calls. cmd_fire sets its trap and
 * then calls atlas(), which is where a refused kickoff fails — so errexit killed
 * the script before the trap body ran, and the deploy freeze was left on the
 * entire fleet with no diagnostic. That marker is what makes every other agent's
 * check:deploy report "frozen, do not deploy", so an orphaned one blocks the
 * fleet until a human finds a file nobody knew to look for.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const LOOP = resolve(ROOT, "sequence/auto-eval/loop.sh");

/**
 * A sandbox where `fire` can run for real: stub ssh/scp on PATH, and point
 * every path loop.sh writes to at a temp dir. `atlas-job status` answers
 * "stopped" so the round-in-flight guard lets us through to the kickoff, and
 * the kickoff itself refuses — which is the exact path the trap exists for.
 */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "auto-eval-guards-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const state = join(dir, "state");
  mkdirSync(state);

  writeFileSync(
    join(bin, "ssh"),
    `#!/bin/sh
case "$*" in
  *kickoff-round.sh*)
    echo "REFUSING: live is aaaaaaaaaaaa, you expected deadbeef1234." >&2
    exit 1 ;;
  *atlas-job\\ status*)
    echo "sbek-round9              stopped  pid -        2026-08-13T22:24:59Z" ;;
  *) : ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "scp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(join(bin, "ssh"), 0o755);
  chmodSync(join(bin, "scp"), 0o755);

  writeFileSync(
    join(state, "state.json"),
    JSON.stringify({ round: 9, anchor: null, anchorPct: null, runStamp: null, sha: null, halted: false }),
  );

  return {
    dir,
    freeze: join(dir, ".deploy-freeze"),
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      MARQUEE_ROOT: dir,
      KIT_LOCAL: join(dir, "kit"),
      STATE_DIR: state,
      FREEZE_FILE: join(dir, ".deploy-freeze"),
    },
  };
}

test("CONTRACT · a refused kickoff lifts the deploy freeze it declared", () => {
  const box = sandbox();
  let failed = false;
  let stderr = "";
  try {
    execFileSync("bash", [LOOP, "fire", "deadbeef1234"], { env: box.env, encoding: "utf8" });
  } catch (error) {
    failed = true;
    stderr = `${error.stderr ?? ""}`;
  }

  // Refusing is half the contract: a kickoff that cannot start must not report
  // a started round.
  assert.equal(failed, true, "fire must exit non-zero when the kickoff refuses");
  assert.match(stderr, /kickoff refused/, "the trap's diagnostic must reach the operator");

  // PRESENCE FIRST. Asserting only that the sandbox marker is absent is
  // vacuous: if the env overrides ever stop being honoured, the freeze is
  // written to the REAL primary checkout, the sandbox path is never created,
  // `existsSync` is trivially false, and this test PASSES while orphaning a
  // marker that blocks every other agent's deploy. An assertion that something
  // is gone means nothing without evidence it was there. cmd_fire announces the
  // path it declared, so require that path to be the sandbox one.
  const declared = stderr.match(/deploy freeze declared at (\S+)/);
  assert.ok(declared, "fire must announce the freeze path it declared");
  assert.equal(
    declared[1],
    box.freeze,
    "the freeze must have been declared INSIDE the sandbox — otherwise this test proves nothing and has written to the real checkout",
  );

  // The other half, and the one that was broken: the marker must be gone. It
  // gates every other agent's check:deploy, so an orphan freezes the fleet.
  assert.equal(
    existsSync(box.freeze),
    false,
    "the deploy freeze must not survive a refused kickoff — an orphaned marker blocks every other agent's deploy with no diagnostic",
  );
});

test("CONTRACT · loop.sh sets -E, without which the trap above cannot fire", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(LOOP, "utf8");

  // Belt to the previous test's braces, and a specific one: `set -euo pipefail`
  // reads as correct and disables the cleanup path entirely. Someone
  // "tidying" the flags back would otherwise reintroduce the bug with a green
  // suite, because the behavioural test above is the only thing that notices.
  assert.match(source, /^set -Eeuo pipefail$/m, "errtrace must stay on; ERR traps in functions depend on it");

  // The trap body must exit. Under -E it fires twice — once inside atlas(),
  // once in cmd_fire — and only `die` stops the second firing falling through
  // to the success path.
  assert.match(source, /trap '[^']*rm -f "\$FREEZE_FILE"; die /, "the ERR trap must still exit, not merely clean up");
});

/**
 * The other half of the same lesson: a guard that answers "no round is running"
 * when it could not ask at all. Both callers respond to that answer by mutating
 * the thing a round is measuring — cmd_barrier resets the demo and deploys,
 * cmd_fire starts a second round against one mutable site — so an unreachable
 * Atlas must read as "busy", never as "idle".
 *
 * Proved by running it, for the same reason as above: the broken form is a
 * perfectly ordinary-looking pipe into grep, and reading it is what missed it.
 */
function unreachableSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "auto-eval-failopen-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const state = join(dir, "state");
  mkdirSync(state);
  // Every ssh fails, as it does when the link to Atlas drops.
  writeFileSync(join(bin, "ssh"), "#!/bin/sh\nexit 255\n", { mode: 0o755 });
  writeFileSync(join(bin, "scp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(join(bin, "ssh"), 0o755);
  chmodSync(join(bin, "scp"), 0o755);
  writeFileSync(
    join(state, "state.json"),
    JSON.stringify({ round: 9, anchor: null, anchorPct: null, runStamp: null, sha: null, halted: false }),
  );
  return {
    freeze: join(dir, ".deploy-freeze"),
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      MARQUEE_ROOT: dir,
      KIT_LOCAL: join(dir, "kit"),
      STATE_DIR: state,
      FREEZE_FILE: join(dir, ".deploy-freeze"),
    },
  };
}

test("CONTRACT · fire refuses outright when Atlas cannot be asked", () => {
  const box = unreachableSandbox();
  let stderr = "";
  try {
    execFileSync("bash", [LOOP, "fire", "deadbeef1234"], { env: box.env, encoding: "utf8" });
    assert.fail("fire must not start a round while Atlas is unreachable");
  } catch (error) {
    stderr = `${error.stderr ?? ""}`;
  }

  // The distinction under test is which refusal this is. On the unfixed script
  // the round-in-flight guard reads a dropped ssh as "nothing running", falls
  // through, declares the freeze, and only then fails at the kickoff — so it
  // reports "kickoff refused". Fixed, it never gets that far.
  assert.match(
    stderr,
    /REFUSING: a round is already in flight/,
    "an unreachable Atlas must be refused as 'a round may be running', not treated as idle",
  );
  assert.equal(
    existsSync(box.freeze),
    false,
    "a refusal this early must not have declared a freeze at all",
  );
});

test("CONTRACT · loop.sh's own guards keep unreachable apart from stopped", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(LOOP, "utf8");

  // The defect was piping ssh straight into grep, which collapses "could not
  // ask" into "answered no".
  assert.doesNotMatch(
    source,
    /atlas "~\/bin\/atlas-job status[^"]*"\s*\|\s*grep/,
    "job status must not be read by piping ssh into grep — a dropped link then reads as 'not running'",
  );
  assert.match(source, /job_state\(\) \{/, "the three-valued helper must exist");
  assert.match(source, /\[\[ \$state == running \|\| \$state == unreachable \]\]/, "round_running must fail closed");
  assert.match(source, /unreachable\) stopped=0; say "atlas unreachable/, "watch must not complete on silence");
  assert.match(source, /\(\( stopped >= 2 \)\)/, "watch must require two consecutive stopped readings");
});

/**
 * A sandbox where `watch` reaches its completion branch immediately. Atlas
 * answers "stopped"; whether the run left a report.json behind is the variable
 * under test. WATCH_INTERVAL=0 collapses the two-tick requirement from ninety
 * real seconds to nothing, so the contract is pinned inside the suite budget
 * rather than excused from it.
 */
function stoppedSandbox({ reportExists }) {
  const dir = mkdtempSync(join(tmpdir(), "auto-eval-watch-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const state = join(dir, "state");
  mkdirSync(state);

  writeFileSync(
    join(bin, "ssh"),
    `#!/bin/sh
case "$*" in
  *atlas-job\\ status*)
    echo "sbek-round12             stopped  pid -        2026-08-15T21:19:13Z" ;;
  *report.json*)
    exit ${reportExists ? 0 : 1} ;;
  *judgements*)
    echo "call-for-papers.json" ;;
  *) : ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "scp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(bin, "rsync"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  for (const f of ["ssh", "scp", "rsync"]) chmodSync(join(bin, f), 0o755);
  writeFileSync(
    join(state, "state.json"),
    JSON.stringify({ round: 12, anchor: null, anchorPct: null, runStamp: null, sha: null, halted: false, voidRuns: [] }),
  );
  return {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      MARQUEE_ROOT: dir,
      KIT_LOCAL: join(dir, "kit"),
      STATE_DIR: state,
      FREEZE_FILE: join(dir, ".deploy-freeze"),
      WATCH_INTERVAL: "0",
    },
  };
}

test("CONTRACT · watch reports a killed run as DIED, not COMPLETE", () => {
  // Round 12: Atlas hung mid-round and rebooted. The job was gone, so two
  // consecutive `stopped` readings arrived and the watch announced
  // RUN-COMPLETE for a run that had browsed 14 of 20 scenarios, judged three of
  // seven areas and written no report. RUN-COMPLETE is the signal the
  // coordinator acts on, and its protocol runs sync → score → guard → barrier,
  // so the false completion walks into scoring a partial run, anchoring on it,
  // and deploying. "No process" is not "finished".
  const box = stoppedSandbox({ reportExists: false });
  let stdout = "";
  let stderr = "";
  try {
    execFileSync("bash", [LOOP, "watch", "2026-08-15T21-19-37"], { env: box.env, encoding: "utf8" });
    assert.fail("watch must not exit 0 for a run that left no report.json");
  } catch (error) {
    stdout = `${error.stdout ?? ""}`;
    stderr = `${error.stderr ?? ""}`;
  }

  assert.doesNotMatch(stdout, /RUN-COMPLETE/, "a killed run must never be announced as complete");
  assert.match(stdout, /RUN-DIED 20\d\d-\d\d-\d\dT[\d:]+Z 2026-08-15T21-19-37/, "it must say so, with the stamp");
  assert.match(stderr, /KILLED, not finished/, "and the diagnostic must name what happened");
  assert.match(stderr, /voidRuns/, "and tell the operator how to record it");
});

test("CONTRACT · watch still completes normally when the run left a report", () => {
  // The guard above must not cost us the ordinary path: a genuinely finished
  // round writes report.json in its scoring phase, and that is what separates
  // it from a corpse.
  const box = stoppedSandbox({ reportExists: true });
  const stdout = execFileSync("bash", [LOOP, "watch", "2026-08-15T21-19-37"], {
    env: box.env,
    encoding: "utf8",
  });

  assert.match(stdout, /RUN-COMPLETE 20\d\d-\d\d-\d\dT[\d:]+Z 2026-08-15T21-19-37/);
  assert.doesNotMatch(stdout, /RUN-DIED/);
});
