FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-53-audit-reset" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-53** (A-11 — the reset drill). Actor: `agent:auditor-mrq-53`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-53-audit-reset`, branch `mrq-53-audit-reset`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMCBGS36R8WQPA2F4YHQK.md` → `planned` → `in_progress` → audit → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional.**

## Reset is the judge's undo button, and nobody has driven it in anger

A judge will drive this deployed site through an eleven-step walkthrough. They will accept submissions, send reminders, place sessions, publish an agenda. **If they make a mess and reset does not genuinely restore a clean demo, the evaluation ends there** — and unlike a broken screen, this failure only appears after someone has already invested twenty minutes.

Drive the real thing, repeatedly. Do not read `src/lib/reset-demo/reseed-demo.ts` and conclude it works:

- **Reset from a DIRTY state, not a fresh one.** Accept and reject submissions, complete speaker tasks, place and publish agenda items, send reminders into the outbox, upload an attachment, create a saved view, run an import. THEN reset. Assert the seeded baseline is genuinely back — counts per table, not a 200.
- **Reset twice in a row.** The second must be as clean as the first; an idempotency bug here is invisible until a judge does it.
- **Check what reset must NOT do**: leave orphaned R2 objects, leave outbox rows that later drain and mail someone, or wipe rows it does not own. `WIPE_ORDER` in `reseed-demo.ts` is the FK-safe order — verify it still covers every table later tickets added. Tables have been added since it was written (webhooks, API tokens, saved views, imports, round promotions, decisions).
- **Confirm the demo persona still works after reset** — a reset that restores data but breaks demo login is a dead end.

**Assume a green test over a dead path until proven otherwise.** That shape has appeared five times on this run: seeded venues at identical coordinates, a helper with no production callers, a test carrying an answer the seed never wrote, a screen pointed at the wrong event ID, a guard pinned to line numbers.

## What to produce

**Findings with `file:line` and a concrete reproduction** — the sequence a judge performs and what survives that should not. Where you find nothing, name exactly which dirty states you created and which tables you compared. **Add a machine guard** — the strongest one here asserts `WIPE_ORDER` covers every table the schema defines, so a future migration cannot silently add a table reset forgets. **Key it on the invariant, not on coordinates.**

**Do not fix product code you are auditing** unless trivially safe and you say so; findings route to their owning tickets.

## Standing rules

Suite ~17–20s against 30s; whole gate 45s. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-53.json`** — if you own no `auto` AC, say so explicitly. Before the PR: `npm run pr-gate -- --ticket MRQ-53`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
