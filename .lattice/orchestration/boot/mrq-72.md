FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-72-reset-fix" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-72** (reset demo is broken end to end). Actor: `agent:delegator-mrq-72`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-72-reset-fix`, branch `mrq-72-reset-fix`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZR7ZSRBNY9J31VFRCXK3884.md` → `planned` → `in_progress` → implement → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional** — an agent on this run finished everything, passed its gate, and died before opening the PR.

**Read the full ticket first: `lattice show MRQ-72 --json`.** It lists four defects in priority order with the reasoning. This brief adds only what you need beyond it.

## Why this is the most urgent ticket on the board

Reset is the judge's undo button. Its failure mode is the cruellest available: it only appears **after** someone has already invested twenty minutes in the walkthrough. Right now a judge who makes a mess and presses **Reset demo** gets nothing — the button is a placeholder — and if they reach reset another way they get a hollow demo, because restore writes a minimal fixture rather than the shipped seed.

Fix the button and the restore first; those two are the dead end. Cross-tenant scoping and R2 orphans matter but do not end an evaluation.

## Prove everything by row count, from a DIRTY state

This run has produced the same defect six times: a green test over a dead path. Do not reset a fresh database and call it proven. **Make a mess first** — accept and reject submissions, complete speaker tasks, place and publish agenda items, queue reminders into the outbox, upload an attachment, create a saved view, run an import. THEN reset, and assert the seeded baseline is genuinely back with **counts per table**, not a 200. Then **reset again** — the second must be as clean as the first.

## Constraints that are not yours to change

- **`WIPE_ORDER` stays FK-safe**, and MRQ-53's merged guard `tests/node/reset-wipe-order.test.mjs` asserts it covers every table every migration defines. **Do not weaken that guard** — extend `WIPE_ORDER` if you touch tables. **MRQ-66 is adding `webhook_endpoints` and `webhook_deliveries` in migration 0005 right now and must add them to `WIPE_ORDER`** — expect a conflict there and resolve by keeping BOTH sets of tables in FK-safe order.
- **Add no migration.** 0001–0004 are merged and immutable; 0005 is MRQ-66's.
- **Reset must leave demo login working.** A reset that restores data but breaks the demo persona is still a dead end — assert the persona can log in afterwards.
- `src/lib/reset-demo/reseed-demo.ts` is the one reseed path. Do not fork it.
- The **two `always_live` mail sites** are machine-enforced by an AST inventory in `tests/node/comms.AC-250.test.mjs`; reset must not become a third, and must not leave outbox rows that later drain and mail a real person.

## Standing rules

**Guardrail tests assert the status code AND the absence/presence of the thing**, with a positive control. **Any guard keys on the invariant, never on coordinates.** Suite ~18–27s against 30s; whole gate 45s; prefer `tests/node`. After any rebase `npm ci`, settle ~20s, then gate; resolve `.lattice/**` conflicts by taking upstream. `PHILOSOPHY.md`/`DESIGN.md` bind; prototype **v1.9**; **elements never jump** — reserve the sidebar button's space so its label change moves nothing. Organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files or UI.

**`tests/ac-claims/MRQ-72.json`** — AC-230 is owned by MRQ-3; declare what you exercise rather than claiming it. Before the PR: `npm run pr-gate -- --ticket MRQ-72`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
