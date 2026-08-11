FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-43-audit-repo" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-43** (A-1 — audit: repo hygiene and full-history scan). Actor: `agent:auditor-mrq-43`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-43-audit-repo`, branch `mrq-43-audit-repo`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMBDPJM08EB2BXMJEDBMC.md` → `planned` → `in_progress` → audit → self-review → PR → `pr_open`. Read the full scope with `lattice show MRQ-43 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any other work.**

## You are an AUDITOR. You did not write this code, and that is the point.

Your value is independence. Do not defend the implementation, do not assume a passing test means a working feature, and **do not accept a report in place of evidence** — run the check yourself and paste the actual output.

**This run has produced the same failure four separate times: a green test over a dead feature.** Seeded venues at identical coordinates so a conflict class could never fire. A shared helper with zero production callers. A test building its own fixture carrying an answer the seed never writes. A screen pointed at the wrong event ID. In every case the tests passed. Assume that shape is present in your area until you have proved otherwise, and prefer evidence that a thing WORKS on the shipped artifact over evidence that a test asserts it.

## This repo ships PUBLIC — you are the last line before strangers read it

Scope: secret scan, \`Atin/\` and internal paths, third-party denylist, **full history** — not just the working tree. A secret removed in a later commit is still public if it is reachable in history.

Check for: tokens and API keys; internal hostnames (\`forgejo.stage11.ai\`, tailnet names); Stage 11 internals and orchestration vocabulary (\`.lattice/\`, Lattice, delegator, orchestrator) leaking into shipped files; real email addresses (only \`firstname.lastname@example.com\` is sanctioned); real headshots or external image URLs; anything under \`Atin/\`.

**Note the deliberate design:** \`.lattice/\` currently lives in this repo and is full of orchestration detail. MRQ-42 owns assembling a clean public history via an orphan commit. Your job is to say precisely WHAT must not survive that assembly, with paths — so MRQ-42 has a checklist rather than a judgement call. Run the scan twice as the ticket says: once on the assembled orphan history when it exists, and once on the pushed remote.

\`check:repo\` exists and has reported pre-existing findings that were never triaged. Run it, read every finding, and say which are real.

## What to produce

Your deliverable is **findings with `file:line` and a concrete failure input** — what a caller does, and what goes wrong. A finding without a reproduction is an opinion. Where you find nothing, say so plainly and state what you actually checked; a clean audit that names its coverage is worth more than one that implies it.

**Add an automated guard where a finding would otherwise recur.** `tests/node/comms.AC-250.test.mjs` is the model: it machine-enforces the exactly-two-`always_live` count so no future ticket can quietly add a third. Prefer `tests/node` — it needs no Worker runtime and keeps the suite fast.

**Do not fix product code you are auditing** unless the fix is trivially safe and you say so explicitly; findings route to their owning tickets. Flag anything ambiguous to me rather than deciding it yourself.

## Standing rules

The suite is the fleet's inner-loop clock (~10–18s against 30s; whole gate 45s). After any rebase `npm ci` and let it settle before gating; resolve `.lattice/**` conflicts by taking upstream. **This repo ships public** — no secrets, internal hostnames, or Stage 11 internals in anything you write.

**`tests/ac-claims/MRQ-43.json`** — if this audit owns no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-43`, paste the result. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
