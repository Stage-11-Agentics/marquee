FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-21-swimlane" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-21** (BUILDPLAN **M-19b** — agenda track swimlanes and conflicts). Actor: `agent:delegator-mrq-21`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-21-swimlane`, branch `mrq-21-swimlane`, cut clean off `forgejo/master` (`8338356`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHM9AXPD25H69HA8SS04ZS.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before you write a line of code** — `git add -A && git commit -m "MRQ-21 plan" && git push forgejo mrq-21-swimlane`. Delegators on this run have repeatedly reached 90% context with a dozen modified files and zero commits. Do not be the next one.

## AC-81 is structural, not cosmetic — this is the whole ticket

*"Lane container count equals track count, each lane has its own bounding box, every session's box sits inside its own track's lane."* **A colour overlay alone FAILS.** Tinting sessions by track and calling it a swimlane is the obvious shortcut and it is explicitly rejected. Build real per-track lane containers with day bands and slot columns.

Test it structurally, the way the AC is written: assert the **count** of lane containers equals the track count, and that each session's element is a descendant of its own track's lane — not that a class name exists somewhere. A DOM-shape assertion that passes with one lane and coloured tiles is the exact defect this AC was written to catch.

**AC-77 is parameterized over all four participation roles — speaker, co-speaker, moderator, chairperson.** Conflict computation covers rooms **and every** role. Do not implement it for `speaker` and assume the rest follow; write the test as a loop over all four and prove each one raises.

## Extend the one conflict path — do not fork it

MRQ-63 merged minutes ago (`8338356`) and is the shape to follow. `getConflicts` in `src/routes/agenda.queries.ts` now computes **three** classes — room overlap, speaker double-booking, and transit — and pushes them all into **one** `conflicts` array that feeds the dashboard count, the drawer, and the tiles. Your role-parameterized conflicts join that same array through that same function. **A parallel path is a defect**, and the transit work is a worked example of doing it right: it imported `getTransitConflicts` from `src/lib/venue-geometry.ts` rather than reimplementing the maths.

**Warn, never block.** Every conflict class in this product warns; none prevents a placement. Prove it: after raising a conflict, the placement request still returns 201.

**Do not weaken MRQ-63's tests.** `tests/integration/api/agenda-transit.AC-258-259.test.ts` asserts an exact Transit message and that the agenda payload never contains the string "Travel" (AC-259's byte-scan; the speaker task "Hotel and Travel Reservations" must survive). If you touch that file, expect me to diff it.

## Craft and the felt checkpoint

`PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. **Elements never jump** — swimlanes are unusually exposed: adding a lane, filtering a track, or flagging a conflict must not reflow the board. Reserve space, keep lane heights stable, tabular numerals for counts.

**Felt checkpoint C5 runs on this surface:** place ten sessions with a trackpad and with a mouse — *no perceptible lag, no snap-back, no ghost offset*. That is a human check on deployed infra and it is not yours to sign off, but build as though someone is about to do exactly that, and say in your PR body what you did to make drag feel solid. Speed is a graded feature (R7).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-21.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. JSON route modules are named `*.routes.ts`.

Before the PR: `npm run pr-gate -- --ticket MRQ-21`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
