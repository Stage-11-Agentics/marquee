FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-33-record-board" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-33** (BUILDPLAN **M-32 + M-53** — admin create, the submission record, and the read-only program board; ~9h). Actor: `agent:delegator-mrq-33`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-33-record-board`, branch `mrq-33-record-board`, cut clean off `forgejo/master` (`40bfda6`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-33 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

**Push `mrq-33-record-board` to Forgejo as soon as it has its first commit**, and after every meaningful commit after that. Do not wait for the PR.

## The ruling that shapes this whole ticket

**AC-243 (client ruling, Amendment 7): no card drags, no lifecycle action on cards.** The board is a *thin read-only surface onto the record* — "the record owns every stage-appropriate action." Card click / Enter / Space navigates to the record; that is all a card does. Consequential actions live on the detail screen deliberately, because a board that can accept or reject by drag makes irreversible decisions too cheap.

Two things follow that are easy to get wrong:
- **Agenda drag/drop is unchanged** — this ruling is about the program board only. Do not go remove drag from the agenda.
- **`trace:ac` fails if AC-239 is treated as live or reused.** It was struck and replaced by AC-243. Do not claim it, reference it, or resurrect its behaviour.

## Scope and ACs

Read the full scope with `lattice show MRQ-33 --json`. ACs: **AC-118 – AC-120, AC-238, AC-240, AC-243, AC-251.**

**M-32 — admin create + record:** abstract/session, bypass, origin, participants/answers/scores/routing/history, scheduled slot visibility, stage actions on the record.

**M-53 — read-only program board:** every non-draft submission appears **once** across seven stages, full filters with counts and reset, **virtualized at seed scale**.

**AC-251 (Amendment 10 fold, SPEC allocates +1h):** the record's **evaluation panel** lists its current reviewers per round with coverage counts; an admin can assign or remove a specific reviewer there (writing `round_assignments`), the affected reviewer's queue updates, and **track-scope rules are still enforced**. API/CLI equivalent is `/rounds/:id/assignments` CRUD. SPEC tags this UI "beyond v1.5 prototype — acknowledged divergence, build per spec," so build it per spec rather than reproducing the prototype here.

**Track-scope enforcement is a guardrail I hand-review.** MRQ-3 enforced per-event reviewer scoping down to a database CHECK that rejects org-wide reviewer memberships. Assigning a reviewer through your new panel must not become the hole that bypasses it. Prove it: assigning a reviewer to a round outside their track scope is rejected, and assert **both** the status code **and** that no `round_assignments` row was written. A status-only assertion passes while the write lands.

## What you inherit — build on it, don't reinvent

- **MRQ-8** — API core, generated route manifest (glob over `*.routes.ts`), error envelope, and the **list contract** (`page/per_page/q/sort/filters` → `{data, page, per_page, total}`). Use it as-is for the board's filters; do not invent a second pagination shape. `check:api` fails a route that bypasses the manifest.
- **MRQ-19 (merged)** — bulk and record-owned decisions with cascade. Both the single and bulk paths already funnel through one `insertDecisions` writer in `src/jobs/cascade/decisions.ts`. **Your record's stage actions call that path; they do not fork it.** A second decision-writing path is exactly the defect AC-235 exists to prevent.
- **MRQ-9** — the submissions list. **MRQ-11** — the program dashboard. **MRQ-10 (just merged)** — conference settings. **MRQ-18** (reviewer queue) is in flight and also touches `round_assignments`; if you hit a contract disagreement with it, flag it to the Orchestrator and keep moving — contract conflicts are mine to resolve, not yours to reconcile silently.

## Craft and speed

`PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. **Elements never jump** — filters must not reflow the board as counts change; reserve space, fixed-width toggles, tabular numerals for every count, "—" instead of removed rows. **Speed is a graded feature (R7):** the board is virtualized at seed scale, and AC-240 covers real-ugly data — long diacritic names, truncating titles, thousand-row lists. The organizer's noun in UI copy is **"conference"**, not "event"; the wire API keeps `/api/v1/events/...` deliberately (SPEC Amendment 13).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-33.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`.

Before the PR: `npm run pr-gate -- --ticket MRQ-33`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
