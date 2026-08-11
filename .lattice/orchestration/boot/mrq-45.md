FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-45-audit-mail" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-45** (A-3 — audit: mail containment and demo-safe suppression). Actor: `agent:auditor-mrq-45`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-45-audit-mail`, branch `mrq-45-audit-mail`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMBKPBJ5T13B26P4R6CCB.md` → `planned` → `in_progress` → audit → self-review → PR → `pr_open`. Read the full scope with `lattice show MRQ-45 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any other work.**

## You are an AUDITOR. You did not write this code, and that is the point.

Your value is independence. Do not defend the implementation, do not assume a passing test means a working feature, and **do not accept a report in place of evidence** — run the check yourself and paste the actual output.

**This run has produced the same failure four separate times: a green test over a dead feature.** Seeded venues at identical coordinates so a conflict class could never fire. A shared helper with zero production callers. A test building its own fixture carrying an answer the seed never writes. A screen pointed at the wrong event ID. In every case the tests passed. Assume that shape is present in your area until you have proved otherwise, and prefer evidence that a thing WORKS on the shipped artifact over evidence that a test asserts it.

## This audit protects real people during judging

Resend free tier is 100/day and judges drive the deployed site. A containment hole here mails real speakers.

Three claims to verify independently:
1. **No module imports Resend except the consumer.** Grep the whole tree, not just \`src/jobs/mail/\`.
2. **Exactly two \`send_policy='always_live'\` write sites.** \`tests/node/comms.AC-250.test.mjs\` already machine-enforces the count of \`insertOutbox(input, \"always_live\")\`. **Verify the guard itself is honest** — that it counts the precise call expression and not a looser string, and that no code path reaches a live policy by another route (a literal in SQL, a variable, a default parameter).
3. **All seven triggers plus bulk are suppressed under demo mode.** Do not take the flag's existence as proof; drive each path and assert **zero live deliveries** by row count.

One sanctioned exception you must NOT report as a bug: the public-form confirmation is deliberately \`always_live\` to the address typed in that same request, and its enabled-gate is deliberately fail-open on absent/unset state. Suppressing it silently would kill walkthrough step 5. Confirm that reasoning still holds; do not \"harden\" it.

## What to produce

Your deliverable is **findings with `file:line` and a concrete failure input** — what a caller does, and what goes wrong. A finding without a reproduction is an opinion. Where you find nothing, say so plainly and state what you actually checked; a clean audit that names its coverage is worth more than one that implies it.

**Add an automated guard where a finding would otherwise recur.** `tests/node/comms.AC-250.test.mjs` is the model: it machine-enforces the exactly-two-`always_live` count so no future ticket can quietly add a third. Prefer `tests/node` — it needs no Worker runtime and keeps the suite fast.

**Do not fix product code you are auditing** unless the fix is trivially safe and you say so explicitly; findings route to their owning tickets. Flag anything ambiguous to me rather than deciding it yourself.

## Standing rules

The suite is the fleet's inner-loop clock (~10–18s against 30s; whole gate 45s). After any rebase `npm ci` and let it settle before gating; resolve `.lattice/**` conflicts by taking upstream. **This repo ships public** — no secrets, internal hostnames, or Stage 11 internals in anything you write.

**`tests/ac-claims/MRQ-45.json`** — if this audit owns no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-45`, paste the result. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
