# Fleet Capacity — running ten agents on one machine

**Written 2026-08-12, during the run, read-only.** No suite, build, or benchmark was run
to produce this: nine delegators were finishing real work and the machine under
investigation is the machine they were working on. Everything below is either measured
from state the fleet had already written down, read out of installed source, or read
over the network. Where a number would have required running the thing, it says so and
names the experiment instead.

**Scope:** why Hyperion locked up, whether Atlas can take the load, and what a
ten-agent fleet needs procedurally. Nothing here is urgent enough to touch before
22:00 PT tonight except the four items under **Do tonight**, all of which are outside
the repo.

---

## 1. Why the machine locked up

### The one-sentence version

Nine agents each ran a test suite that sizes its worker pool to the **whole machine**,
and nothing anywhere counts how many suites are running — so the box was asked for
about **135 concurrent test workers on 16 cores**, and the run queue, not the RAM,
is what gave out.

### The mechanism, with citations

**Each `npm test` asks for ~15 workers.** `vitest.config.ts` declares two projects and
sets no `maxWorkers`; neither `vitest.worker.config.ts` nor `vitest.node.config.ts`
sets one either. Vitest 4.1.10 then falls through to its default
(`node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:3765`):

```js
function resolveMaxWorkers(project) {
  if (project.config.maxWorkers) return project.config.maxWorkers;
  if (project.vitest.config.maxWorkers) return project.vitest.config.maxWorkers;
  const numCpus = os.availableParallelism();
  if (project.vitest.config.watch) return Math.max(Math.floor(numCpus / 2), 1);
  return Math.max(numCpus - 1, 1);            // ← 15 on this box
}
```

Hyperion reports `hw.ncpu = 16` (12 performance + 4 efficiency), so every `npm test`
invocation on this machine asks for **15 concurrent workers**, regardless of how many
other suites are already running.

**`maxConcurrency: 8` is not a cap on that.** Both project configs set
`maxConcurrency: 8`, which is easy to read as "at most 8 workers." It is not — it
bounds `test.concurrent` tests *within a single file*. It has no effect on process
count. Worth stating plainly because it is the natural place to look and it will
mislead the next reader.

**The existing "one run, one scheduler" fix is real, and it is intra-run only.**
`run-test.mjs:70-73` and the header of `vitest.config.ts` describe collapsing two
Vitest processes into one so the suite stops competing with itself. That works exactly
as advertised: both projects land in one task group and share one pool
(`cli-api...js:3696`, `pool.setMaxWorkers(maxWorkers)`), so a run gets 15 slots and not
30. But a Vitest process has no way to see its siblings in other worktrees. **The fix
addressed self-oversubscription and could not address fleet oversubscription.** That is
not a defect in the fix; it is the boundary of where a single process can help.

**Most of those workers are `workerd`, not plain forks.** In
`@cloudflare/vitest-pool-workers@0.20.3`, every pool slot allocated to the worker
project constructs its own runtime:

```js
// dist/pool/index.mjs:60139  (CloudflarePoolWorker.start)
this.mf = await getProjectMiniflare(…);
// dist/pool/index.mjs:60668  (getProjectMiniflare)
const mf = new Miniflare(mfOptions);
```

One Miniflare is one `workerd` process, with the whole Worker bundle loaded into an
isolate — plus a separate proxy-worker Miniflare (`index.mjs:59114`). So a single
`npm test` can hold on the order of **fifteen `workerd` processes**, each with real
startup cost and real resident memory. Nine of those at once is the event.

**And the suite is not the only load each agent creates.** `pr-gate.mjs:11-20` runs
three `tsc --noEmit` passes and a `vite build` *around* the suite; every rebase runs
`npm ci` (measured: 347 MB and **6,519 files** per `node_modules`, ×34 live worktrees),
which ORCHESTRATOR.md has already identified as a Spotlight-generating I/O event; and
agents keep a `wrangler dev` alive for browser validation.

That last one leaks. Read live, with **no suite running at all**:

```
wrangler   20 processes
workerd     6 processes
```

Two of those `workerd` have been up since **16:51 and 16:56 yesterday**, in worktrees
(`ux-sweep-passc`, `marquee-local`) whose agents are long gone. Orphaned dev servers
accumulate silently across a run and nothing reaps them.

### Which resource actually failed: CPU, not memory, not descriptors

Named explicitly because the three are usually conflated and the fix differs for each.

| Candidate | Evidence | Verdict |
|---|---|---|
| **CPU / run-queue** | Load averages read tonight: **22.88 / 66.73 / 89.71** on 16 cores. The 15-minute figure is **~5.6 runnable threads per core**. `run-state.md` records **158** earlier in the run. | **This is it.** |
| Memory | `vm.swapusage: total = 0.00M` — macOS never allocated a swap file. At read time: ~12 GB pages free, compressor holding 7.6 GB. A box dying of memory pressure has swap and a pinned compressor. | Not the cause. |
| Processes / descriptors | 1,295 total processes against `kern.maxprocperuid` 10,666; `ulimit -n` 1,048,576 against `kern.maxfilesperproc` 245,760. Two orders of magnitude of headroom. | Not the cause. |

**Why CPU starvation reads as a "lockup" rather than as slowness.** `WindowServer` and
c11's renderer are ordinary threads. Test workers and `workerd` children run at default
QoS with no de-prioritisation. At ~90 runnable threads per 16 cores, the compositor
waits behind compute the same as everything else, and the machine stops drawing. It
never ran out of anything — it ran out of *turns*.

**What would settle it beyond doubt:** a `vm_stat` / `memory_pressure` sample taken
*during* saturation rather than after. My readings are post-hoc. The CPU evidence is
strong enough to act on; I would still want that sample before calling memory closed
forever.

### The measured proof — the fleet already wrote it down

Every run of `run-test.mjs` appends `{observedMs, recordedAt}` to `speed-report.json`
(`lib/command.mjs:62-94`). Across the 40 live worktrees that is **144 recorded suite
runs**. Reconstructing each run's window as `[recordedAt − observedMs, recordedAt]` and
counting how many *distinct worktrees* had a suite in flight at the same time:

| Concurrent worktrees | Runs | **Median suite** | Min | Max |
|---:|---:|---:|---:|---:|
| 1 | 74 | **28.5 s** | 0.05 s | 115.0 s |
| 2 | 35 | **39.2 s** | 17.1 s | 152.2 s |
| 3 | 13 | **56.4 s** | 44.8 s | 128.1 s |
| 4 | 18 | **93.7 s** | 57.7 s | 142.9 s |
| 5 | 4 | **152.2 s** | 52.5 s | 160.5 s |

And the quiet-machine floor, measured repeatedly and consistently — primary checkout:
`15450, 14243, 16551, 16031, 17115, 17263` ms; `passc-fixes`: `14873, 14880, 15909,
18095` ms.

**Three conclusions follow, and the third is the important one.**

**(a) The suite is not slow. It is ~15 s, well inside its 45 s objective, when it owns
the machine.** The 85.7 s "baseline" and the 145–158 s figures in `run-state.md` are
contention measurements and CI measurements that have been read as suite measurements.
`run-test.mjs`'s own header warns that wall time on a hermetic parallel suite is
dominated by how many cores it can get — that warning turns out to describe this
project's entire speed problem, arriving from a direction nobody was watching.

**(b) The 45 s budget has been functioning as a load meter that everyone read as a code
meter.** `run-state.md` records three agents independently diagnosing "it's the box, not
my change" on 2026-08-11. That is three context windows spent re-deriving a number the
harness was already holding.

**(c) Concurrency in the test suite buys nothing above about two.** Five suites running
together deliver five results in ~152 s. Five suites running *one at a time* deliver
five results in 5 × 28.5 ≈ **142 s** — and leave the machine responsive throughout.
Serialising local test runs is already **no slower in total throughput**. Everything in
§3 rests on this line.

**Honest caveats on the table.** Bucketing counts any temporal overlap, so a run tagged
"1 concurrent" may still have overlapped an `npm ci`, a `vite build`, or a `wrangler
dev` — which is why the n=1 bucket has a 115 s maximum. And runs that were killed
during the freeze recorded nothing at all, so the real tail is **worse** than shown,
not better.

### What this means for CI

CI was never the load — `.github/workflows/ci.yml` runs on GitHub-hosted
`ubuntu-latest`. What matters is how good it already is. Run `31563356654`, measured
step by step over the API:

| Step | Duration |
|---|---:|
| checkout + setup-node | 4 s |
| `npm ci` | 6 s |
| three `tsc --noEmit` | 5 s |
| `vite build` | 3 s |
| `check:design` | <1 s |
| **`npm test`** | **134 s** |
| `trace:ac` | <1 s |
| **whole job** | **2 m 36 s** |

The last fifteen runs: 2 m 41 s to 3 m 16 s, all green. The suite is slower there
(134 s on a 4-vCPU runner vs ~15 s on a quiet M4 Max) — and it does not matter, because
it costs this machine nothing and it beats a locally-contended run outright. At four
concurrent agents the local suite median alone is 93.7 s, before the build and
typechecks. **CI is already faster than the fleet's own gate under fleet conditions.**

---

## 2. Atlas as a test / CI host

### Ground truth, measured over Tailscale tonight

| | |
|---|---|
| Model | `Mac14,14` — Mac Studio **M2 Ultra**, **24 cores** (16P + 8E), **128 GB** |
| Uptime / reachability | up 2 days; ~25 ms RTT from Hyperion; `atlas` resolves on the tailnet |
| Disk | `/System/Volumes/Data` 926 GB, **148 GB free (84 % used)** |
| Toolchain | `node` 26.0.0 and `gh` at `/opt/homebrew/bin`; c11, `claude`, `codex`, `lattice` per `platform/atlas.md` |
| Swap | none allocated |

**Correction to the brief: Atlas is not idle.** Load averages **10.58 / 20.75 / 22.55**.
The %CPU snapshot totals only ~235 % of a 2400 % ceiling with a single `node` at 89 %,
so it is *lightly loaded with many blocked threads* rather than CPU-bound — but it is
carrying real tenants: `ollama` at **6.4 GB** with `gregorovich-light` resident in an
MLX runner, Overtone's Python at 3.3 GB, OrbStack at 2.1 GB, another node at 2.2 GB,
plus Gaffer Core (`:8737`), train_watching_club (`:8747`), skyview (`:8760`),
earthview (`:8762`), syncthing and go2rtc. Roughly 15 GB resident and a handful of busy
cores. **There is real room for ~16 cores of build work. There is not room to treat the
box as empty.**

**Useful precedent:** Atlas already runs a self-hosted CI runner —
`~/go/bin/runner daemon --config ~/forgejo-runner/config.yml`, up since Aug 9. The
pattern exists there, which lowers setup cost and raises one caution: two runner
daemons on one host means two label namespaces to keep straight.

### Shape A — self-hosted GitHub Actions runner on Atlas

**Setup cost:** ~30–45 minutes. Download the `osx-arm64` runner, register at repo scope,
`./svc.sh install` for launchd persistence, then add a job with
`runs-on: [self-hosted, macos, arm64]`.

**What it buys.** ARM-native parity with the machines the fleet actually develops on —
which catches the class of bug an x86 Linux runner structurally cannot, and vice versa.
No Actions minutes consumed. A warm `node_modules` and npm cache between runs, so the
6 s `npm ci` largely disappears. And 24 cores instead of 4, so the suite should land far
closer to its ~15 s floor than to CI's 134 s.

**What it costs — and this is the real cost, not the setup.** GitHub's standing guidance
is that self-hosted runners are unsafe on **public** repos, because a fork PR executes
attacker-supplied code on your hardware. Marquee's `main` is private, which removes that
vector today. Two things follow and both are load-bearing:

- **The public orphan (`mrq-42-assembly`) must never carry this workflow**, and if the
  repo is ever made public the runner comes off *first*, not "soon after."
- The runner would execute as Atin's user on the machine holding Vaultwarden sessions,
  Codex OAuth tokens, `~/.netrc`, and the SSH key. `npm ci` on every run is already a
  supply-chain surface; a runner turns a compromised transitive dependency into a
  *scheduled* foothold on the always-on host. **Mitigate by running the runner as a
  dedicated macOS user with its own home**, or inside an OrbStack Linux VM (already
  installed) — the VM restores isolation but gives up the ARM-macOS parity that was the
  main reason to do this.

**How it fails.** Runner offline → PRs queue indefinitely with no fallback; keep
`ubuntu-latest` as the required gate and add self-hosted as a *second, advisory* job
until it has earned trust. State leaks between runs — self-hosted runners do not get a
clean box, so a stale `node_modules`, a leftover `.wrangler` directory, or a leaked
`wrangler dev` holding port 8787 poisons the next run and presents as a code defect.
And 148 GB free shrinks quickly at 347 MB per checkout.

**How an agent drives it:** unchanged. `gh pr create`, then `gh pr checks --watch`.
That invariance is most of the value.

### Shape B — a remote test service agents call instead of running locally

**This is the shape that addresses the actual failure**, because it puts a counter in
the one place that currently has none.

**What it is.** A small always-on service on Atlas, tailnet-only, that accepts a git ref
(or a patch), checks out into a pooled worktree, runs `npm ci && npm test` — or the whole
`pr-gate` — behind a **global semaphore of N**, and streams back the JSON
`run-test.mjs` already emits. Agents call `marquee-test <ref>` where they now call
`npm test`.

**What it buys.** The failure mode disappears at the source: the only place suites run
is a box with an explicit, visible queue depth. It preserves the *inner* loop in a way
CI cannot — no PR required, so an agent can test a half-finished change. And it creates
the single artifact nobody currently has: a place that knows how many suites are in
flight.

**What it costs.** The most work of the three: queue, worktree pool, log streaming, auth
(tailnet-only is not the same as no auth), and the genuinely hard part — **testing
uncommitted work**. Either agents commit first (which this fleet already learned to do
— "commit early, commit broken", `run-state.md` 2026-08-11) or you ship patches over
the wire. Call it 3–6 hours done properly.

**How it fails.** A single point of failure for ten agents. Atlas sleeping or Tailscale
flapping stalls the whole fleet. A queue whose depth the operator cannot see just moves
the wait somewhere invisible, so it must report queue position, not just results. And
results are only trustworthy if each run is hermetic, which means either paying `npm ci`
every time or maintaining a warm pool very carefully.

**Verdict: the right end-state, the wrong thing to build before a 22:00 deadline.**
Shape A delivers most of the benefit for a tenth of the work, because the remote gate
*already exists and is already green*.

### Shape C — hosting part of the agent fleet on Atlas

**What it buys.** It moves the *agents' own* cost off Hyperion, and that cost is not
small. Measured live: 20 `claude` processes at **12.3 GB** combined RSS, 28 `codex`
processes, and **c11 itself at 15.2 GB**. Agents are a substantial fraction of the load
even with no suite running. Atlas already has c11, `claude`, `codex`, `lattice` and
`gh`, plus a documented remote-drive pattern (`platform/atlas.md`, the Scanner
precedent).

**What blocks it, specifically.** `code/` is deliberately excluded from Syncthing and
`deployments/` is not synced either, so Atlas needs its own clone and its own worktrees.
That is fine. What is not fine is that **the Lattice board lives on Hyperion.**
Lattice's `find_root()` jumping to the primary worktree is a *local filesystem*
mechanism; an Atlas-hosted delegator cannot participate in it. Given that this project's
entire coordination model is "every worktree resolves to one board," that is a blocker,
not a detail.

**Verdict: real, and gated on solving board topology first.** Not tonight. The nearer
version — put *non-ticket* agents (research, audits, this document) on Atlas, since they
never touch the board — is available immediately and costs nothing.

---

## 3. Process for a ten-agent fleet

**The organising diagnosis: the fleet has no admission control.** Every symptom follows.
Ten agents each independently decide to run a 15-worker suite; no counter exists
anywhere; the only backstop is an operator noticing the UI has stopped drawing.

Ordered by value per unit of effort.

### 1. Move the gate to CI. Highest value, lowest effort, already built.

The local `pr-gate` exists for a reason that has expired. `run-state.md`, 2026-08-09:
*"local pr-gate command adopted because private Forgejo has no CI runner."*
`HANDOVER.md` still tells every delegator: *"Private Forgejo has no CI runner, so this
local gate is the only thing between a broken PR and master."*

That is no longer true. GitHub Actions runs the same checks in 2 m 40 s and has been
green fifteen for fifteen tonight. The delegator contract should become:

- **Locally:** `tsc --noEmit` and your own new test files. Both cheap, both
  load-independent, both catch the errors you are most likely to have made.
- **Then:** push, `gh pr checks --watch`, and treat that as the gate.

This removes roughly 90 % of local test load, needs **no code change**, and is *more*
trustworthy than what it replaces — CI runs the merged-base result on a clean box,
which no local gate has ever done.

### 2. One machine-wide test lock, for the runs that must stay local.

macOS ships `/usr/bin/lockf` (verified present; `flock` is **not** available here):

```sh
lockf    /tmp/marquee-suite.lock npm test    # queue for your turn
lockf -t 0 /tmp/marquee-suite.lock npm test  # or fail fast and go do something else
```

Wrap it as `~/.local/bin/mq-test` so it is one word in every boot prompt. **This changes
no file in the repo**, which is exactly why it is the one structural fix that is safe
while nine agents are mid-flight. And the table in §1 says it is free: five serialised
runs finish in ~142 s against ~152 s for five concurrent ones.

### 3. Cap workers per run, so N suites can share one box sanely.

*(After the deadline — this is a repo change.)*

```ts
// vitest.config.ts
maxWorkers: Number(process.env.MARQUEE_TEST_WORKERS) || 4,
```

Four workers × ten agents is 40 on 16 cores: still oversubscribed, but survivable,
against the ~150 the fleet asks for today. This is precisely the step the existing "one
run, one scheduler" comment stops one short of — it fixed what a single process can see
and left what it cannot.

**It has to be a config change.** Vitest 4 exposes no `VITEST_MAX_WORKERS` environment
variable (checked against the env-var strings in the shipped bundle) and
`run-test.mjs:74` does not forward argv, so `--max-workers` cannot reach it from
outside. There is no way to do this tonight without editing the harness, and editing
the harness tonight is how you break nine agents at once.

**Pair it with the lock.** Neither is sufficient alone: the cap makes each run a good
citizen, the lock bounds how many citizens there are.

### 4. Reap orphans — they are a tax that grows all run.

Right now, no suite running: **20 `wrangler` and 6 `workerd`** processes, two of them
eight hours old, belonging to agents that no longer exist. Each `wrangler dev` is a node
parent plus two `workerd`. Ten agents each leaving one behind is permanent, invisible
load.

Build `mq-reap` to **list** wrangler/workerd whose worktree has no live agent — and
print, never kill. "Never discard state you cannot attribute" applies to processes as
much as to working trees; a `workerd` might be holding a validation session someone is
mid-way through.

### 5. Let the operator see saturation before the machine dies.

Today the notification channel for saturation is the UI freezing. Two cheap instruments:

- **A sidebar heartbeat.** One c11 surface looping `uptime` plus a live
  `vitest`/`workerd` count into `c11 set-status`. Thresholds worth writing down:
  **load ≥ 2× core count (32 here) is yellow; ≥ 4× (64) is where interactive latency
  goes.** Tonight's readings — 22.88 / 66.73 / 89.71 — say the box spent the last
  quarter-hour well past red with nothing announcing it.
- **Record load in `speed-report.json`.** `run-test.mjs` already writes a verdict every
  run; adding the 1-minute load average at start and end makes each timing
  self-describing, and no future agent has to spend a context window re-deriving
  "was it the box or my change?" Three did exactly that on 2026-08-11.

### 6. Keep stagger-and-hold, but as the fallback it is.

ORCHESTRATOR.md already documents the manual test-hold and staggered-release
discipline, including its limit (*"a hold only helps against load YOU create"*). It
works. It is also a human standing in for a semaphore, at the cost of the operator's
attention every time. Items 2 and 3 make it unnecessary for the common case; keep it for
the uncommon one.

### 7. Worktree and disk cost at ten agents.

Measured: **347 MB / 6,519 files** per `node_modules`; **34 of 40** live worktrees have
one; `Marquee-worktrees/` totals **14 GB**; `~/.npm/_cacache` is **4.8 GB**; the Data
volume is **97 % full with 147 GB free**.

**Disk did not kill the machine and I want to be plain about that.** But ~220,000 files
across 34 worktrees is a lot for `mdworker` to index, and ORCHESTRATOR.md has already
caught Spotlight driving a load spike to 61 after four simultaneous `npm ci` runs. Two
cheap wins after the deadline: add `Marquee-worktrees/` to Spotlight's privacy list, and
evaluate a shared package store (pnpm, or a warm cache path) so ten worktrees stop each
materialising 347 MB.

### 8. Make the suite genuinely fast — but know what you are buying.

The 45 s objective is **already met on a quiet machine** (14–17 s). The 145–158 s figure
that motivated the "fewer files needing a Worker" lever is a CI-runner-plus-contention
number.

`surface:254`'s lever is still worth pulling. The per-file tax is a Miniflare isolate
plus `cloudflare:test` — ~19 s per file, hidden behind 15-way parallelism — which is why
the suite is ~15 s on 16 cores and 134 s on 4. Cutting it would take CI from 134 s to
something much smaller and shrink the per-agent footprint that makes contention bite.
It is also worth noticing *why* this suite is such a bad citizen: its parallelism is
what makes it fast, and its parallelism is what makes it hostile to sharing a machine.

But it is **not** what stands between the fleet and a responsive machine. Admission
control is. Ranking this after items 1–3 is the honest call, and it reverses the
priority `run-state.md` currently carries.

---

## Do tonight — cheap, safe, zero repo changes

Nothing here touches a file the nine in-flight agents can see.

1. **Tell the fleet to gate on CI.** `gh pr checks --watch` replaces
   `npm run pr-gate`; local checks limited to `tsc --noEmit` plus the diff's own test
   files. One `c11 send` to each live delegator. Biggest single load reduction available
   and it costs nothing.
2. **Install `~/.local/bin/mq-test`** wrapping `lockf /tmp/marquee-suite.lock npm test`,
   and put it in the next boot prompt. Outside the repo, so no agent's tree changes.
3. **Stand up the load heartbeat** on one c11 surface so saturation is visible before
   it is fatal.
4. **Print the orphaned `wrangler dev` list** (20 wrangler / 6 workerd right now, two
   eight hours old) and let the operator decide what dies. Print, do not kill.

## Do after the deadline — structural

5. `maxWorkers` cap in `vitest.config.ts`, env-overridable (§3.3).
6. Retire the local `pr-gate` from the delegator contract; make the CI gate *the*
   contract, keeping `pr-gate` for genuinely offline work. Update `HANDOVER.md` and
   `boot/COMMON.md`, which still tell every delegator that no CI runner exists.
7. Self-hosted arm64 runner on Atlas as a **second, advisory** job, under a dedicated
   macOS user, never attached to the public orphan (§2 Shape A).
8. Record machine load alongside every timing in `speed-report.json` (§3.5).
9. Pull the "fewer files needing a Worker" lever — for CI time and per-agent footprint,
   not for the 45 s objective, which is already met (§3.8).
10. Decide whether the remote test service (Shape B) is worth building. It is the right
    end-state; it needs Lattice board topology answered first if agents move too.

---

## Unverified — and the experiment that would settle each

Stated separately so nothing above has to carry a number I did not measure.

| Claim | Status | Experiment |
|---|---|---|
| ~15 `workerd` peak per `npm test`, ~150–300 MB each | **Reasoned** from pool source; not observed | `while :; do pgrep -c -x workerd; sleep 1; done` beside one run on a quiet box |
| `maxWorkers: 4` costs a solo run little and helps a contended one a lot | **Predicted** (~15 s → ~35–45 s solo; large win at 5-way) | Two runs solo at 15 and 4; then five concurrent at each setting |
| Atlas would beat CI's 134 s suite | **Predicted** ~15–25 s at 24 cores | Clone to Atlas, one `npm test` on a quiet window |
| Memory was never the constraint | **Strong but post-hoc** (swap 0, 12 GB free, read after the fact) | `memory_pressure` sampled *during* saturation |
| Actions minutes are not a constraint | **Arithmetic, not a reading** — `admin:org` scope needed for the real number | Team plan includes 3,000 Linux min/month; ~3 min/run × ~40 runs/day ≈ 120 min/day → a 5-day sprint ≈ 600 min, comfortably inside; a sustained month at this rate would exceed it at $0.008/min after |

---

## Appendix — how the concurrency table was built

No new load: it reads `speed-report.json` from all 40 worktrees, treats each history
entry's window as `[recordedAt − observedMs, recordedAt]`, and counts distinct
worktrees whose windows overlap. 144 suite runs total; 61 of them after 03:40 Z,
totalling **4,086 seconds of suite wall-clock in roughly one hour** — on a machine with
16 cores and nine agents also thinking, building, and typechecking on it.
