FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-67-cancellation" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-67** (M-62 — task cancellation and idempotent acceptance reconciliation; owns **AC-264 – AC-267**). Actor: `agent:delegator-mrq-67`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-67-cancellation`, branch `mrq-67-cancellation`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZQFM4GBH3Q4X1ZEAGGWA4HP.md` → `planned` → `in_progress` → implement → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional.**

## Your stated dependency is already satisfied — do not wait for MRQ-66

The ticket says it depends on M-61 for the migration. **I verified: `speaker_tasks.cancelled_at INTEGER` and its index `(submission_id, status, cancelled_at)` already shipped in merged migration `0004_calendar_reversal.sql`.** MRQ-66 is now webhook-tables-only and you do not need it — your ticket mentions webhooks zero times. **Add no migration of your own**; 0001–0004 are merged and immutable.

## Why this matters more than its rank suggests

From the ticket, and this is the live hazard: AC-123 already graded the un-accept dialog's cancel/retain choice and the prototype already drew the control, while `speaker_tasks.status` shipped as `open|done` with no cancellation concept. **AC-125 puts "task overdue" in the minimum automated-trigger set — so an open task on a cancelled talk keeps mailing a real speaker about a talk that no longer exists.** That is a real person receiving a real chase email about work that was withdrawn. Fix that.

**Cancellation is `cancelled_at IS NOT NULL`, never a third status value.** The CHECK stays `status IN ('open','done')`. The rationale is binding: a third enum leaves every existing `status='open'` read site silently including cancelled work, whereas the timestamp predicate makes an unconverted read site **loudly wrong in review**. So: find every read site that filters on `status='open'` and decide, per site, whether it must also require `cancelled_at IS NULL`. The overdue-trigger path certainly must.

## Idempotent acceptance reconciliation

The second function. Re-running reconciliation must not duplicate tasks, resurrect cancelled ones, or re-notify. Prove it by count: run it twice, assert task rows and outbox rows are unchanged the second time. `outbox.idempotency_key` is `sha256(template_key, entity_id, person_id)` and UNIQUE — rely on the constraint, never a pre-check that races.

## Build on merged seams; never fork one

`src/jobs/cascade/decisions.ts` has ONE `insertDecisions` writer and already owns the un-accept reversal (MRQ-25). `src/jobs/mail/{outbox,render,merge-data}.ts` has **exactly two `always_live` sites**, machine-enforced by an AST inventory in `tests/node/comms.AC-250.test.mjs` — your cancellation mail is `demo_safe`, never a third live site. MRQ-16's portal and MRQ-24's chase board both read task state; a cancelled task must disappear from the chase matrix without breaking either.

**MRQ-53 is auditing the reset drill right now** and its guard asserts `WIPE_ORDER` covers every table. You add no tables, so you should not collide — but rebase before gating.

## Standing rules

**Guardrail tests assert the status code AND the absence of the thing** — counts before and after — **with a positive control**. **Any guard keys on the invariant, never on coordinates.** Suite ~19–27s against 30s; whole gate 45s; prefer `tests/node`. After any rebase `npm ci`, settle ~20s, then gate; resolve `.lattice/**` conflicts by taking upstream. `PHILOSOPHY.md`/`DESIGN.md` bind; prototype **v1.9**; **elements never jump**. Organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files or UI.

**`tests/ac-claims/MRQ-67.json`** claiming AC-264 – AC-267. Before the PR: `npm run pr-gate -- --ticket MRQ-67`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
