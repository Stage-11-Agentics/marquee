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
