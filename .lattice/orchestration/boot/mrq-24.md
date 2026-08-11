FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-24-chase" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-24** (BUILDPLAN **M-23 + M-40** — the chase board and slide upload; ~8h). Actor: `agent:delegator-mrq-24`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-24-chase`, branch `mrq-24-chase`, cut clean off `forgejo/master` (`19f8f1d`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-24 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code.**

## This is the product's differentiator, not a table

`PHILOSOPHY.md` says *the system does the chase work*. This screen is where that claim is either true or marketing. Read the full scope with `lattice show MRQ-24 --json`. ACs: **AC-91 – AC-94** (chase board) and **AC-146 – AC-148, AC-232** (slide upload).

Chase board: an accepted-speaker × task matrix with state glyphs, live filter chips with counts, task-type and track filters, select-all → **`Send reminder (N)`**, per-row Nudge, a compose drawer with template + merge preview + per-recipient outbox rows and a per-speaker send log, a speaker context drawer (tasks, message history, sessions, bio), and live update as speakers complete tasks.

**The plan calls out one house rule in its own words: `Send reminder (N)` is FIXED-WIDTH — relabelling must not move anything.** That is the elements-never-jump rule at its sharpest, because N changes on every selection.

Slide upload (M-40): file types, limit, progress, recovery, and the **live organizer view** of an upload — which *is* the chase board's task-matrix cell, which is why these are one ticket.

## The guardrail I hand-review at merge

You are sending mail in bulk. **`outbox.send_policy` has exactly TWO `always_live` write sites** (`src/jobs/mail/outbox.ts`) and reminders are **not** a third — they enqueue `demo_safe` like everything else. Resend's free tier is 100/day and judging is imminent; a chase board that sends live during the demo mails real people and burns the quota.

**AC-117 idempotency is yours to honour, not to reinvent:** `outbox.idempotency_key` is `sha256(template_key, entity_id, person_id)` and is UNIQUE in the schema. Rely on the constraint, never a pre-check that races. Prove it: fire the same bulk reminder twice, assert **one** row and **one** delivery.

## Build on what is merged — do not fork any of it

- **MRQ-12** — mail core and the demo-safe outbox. **MRQ-25 (just merged)** — calendar invites and the reversal cascade; `outbox` now carries `entity_id`, which is what makes the idempotency key work.
- **MRQ-14** — uploads: presign, verify, serve. Your slide upload uses that path; do not write a second one.
- **MRQ-19** — bulk and record-owned decisions. Both single and bulk decision paths funnel through **one** `insertDecisions` writer in `src/jobs/cascade/decisions.ts`. Follow that shape.
- **MRQ-16 (just merged)** — the speaker portal, which is where tasks get completed. Your "live update as speakers complete tasks" reads the same task state the portal writes; agree with it rather than inventing a parallel notion of done.
- **MRQ-8** — the list contract and the generated route manifest (`*.routes.ts`; `check:api` fails a route that bypasses it).

## Craft

`PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. Elements never jump: fixed-width action buttons, reserved space for chip counts, tabular numerals everywhere, "—" instead of removed rows. Honest empty states — "nothing outstanding" is a real and good answer. The organizer's noun in UI copy is **"conference"** (the wire API keeps `/api/v1/events/...` — SPEC Amendment 13).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-24.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test.

**The fast suite is at 26s against a hard 30s budget and already turned master red once tonight.** Keep your integration tests lean — prefer `tests/node` for anything that does not need a Worker runtime, and do not add integration files you do not need.

Before the PR: `npm run pr-gate -- --ticket MRQ-24`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
