FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-63-transit" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-63** (BUILDPLAN **M-58** — transit conflicts: geography as a scheduling constraint). Actor: `agent:delegator-mrq-63`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-63-transit`, branch `mrq-63-transit`, cut clean off `forgejo/master` (`b50f067`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-63 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

**Push `mrq-63-transit` to Forgejo as soon as it has its first commit**, and after every meaningful commit after that. Do not wait for the PR. **Write your plan to the plan file early and in rough form** rather than holding it in context — a compaction mid-planning loses the whole window.

## Almost all of this is already built — your job is to connect it

**Do not write a new haversine, a new walking-time formula, or a second conflict evaluator.** MRQ-62 (merged) shipped `src/lib/venue-geometry.ts` with `haversineMetres()`, `walkingMinutes()` (haversine × 1.3 ÷ 80 m/min, floored at 1), and `getTransitConflicts()` — already correct, already unit-tested against fixture coordinates, already producing a live conflict on the seeded agenda (9 min walk + 3 min access = 12 needed, 0 available, Sheraton → New York Marriott Marquis). MRQ-20 (merged) shipped the agenda with its existing `getConflicts` call.

Your ticket is the wiring: **transit becomes a third conflict class beside room overlap and speaker double-booking, flowing through the ONE existing `getConflicts` call.** The ticket says it in its own words — *"Must flow into the existing dashboard count, conflicts drawer, and affected tiles through the ONE existing `getConflicts` call. A parallel path is a defect."* Read `lattice show MRQ-63 --json` in full.

ACs: **AC-258, AC-259.** SPEC Amendment 14. US-78.

## The two rules that decide whether this is right

1. **Warns, never blocks — the same contract as every other conflict class.** A transit conflict must not prevent a placement, and must not behave differently from a double-booking in the drawer or the count.
2. **AC-259's byte-scan: the string "Travel" must never appear as a conflict label** in any surface, API payload, or copy — while remaining intact in the speaker task set ("Hotel and Travel Reservations" is a legitimate form task and must survive). The label is **"Transit"**. Run the scan yourself before you open the PR: `grep -rn "Travel" src/ scripts/ migrations/` and confirm every hit is the speaker task.

**AC-259 must be observed live, not asserted as a column.** `check:seed` already asserts a real Transit conflict exists in the seeded data; your addition is that it becomes **visible on load** in the dashboard count, the conflicts drawer, and the affected tiles. A test that checks a non-zero number without the conflict reaching the surface reproduces the exact green-test-dead-feature defect MRQ-62 was minted to fix. I hand-review this one myself.

## Craft

`PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract and already shows the transit case (Metropolitan Ballroom → Marquis Room A). **Elements never jump** — adding a third conflict class must not resize the drawer, reflow tiles, or shift the count; reserve space and use tabular numerals. The message shape is already set by the merged helper: *"Transit — 9 min walk to New York Marriott Marquis, plus 3 min building access. Needs 12 min; has 0."* Keep the model's honesty — the 1.3 factor is a street-grid allowance and claims no more precision than that.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-63.json`**. Note MRQ-62 already *exercises* AC-259; you now **own** the surfacing half — state the split explicitly in your claims file and PR body so `trace:ac` ownership stays single-owner. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. Route modules that serve JSON are named `*.routes.ts`.

Before the PR: `npm run pr-gate -- --ticket MRQ-63`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
