FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-50-audit-anon" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-50** (A-8 — reviewer anonymity byte-scan). Actor: `agent:auditor-mrq-50`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-50-audit-anon`, branch `mrq-50-audit-anon`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMC2F9XEPBYEHF9JC4V9T.md` → `planned` → `in_progress` → audit → self-review → PR → `pr_open`. **COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT.** **Opening the PR is the final step and is not optional** — one agent on this run finished everything, passed its gate, and died before opening the PR.

## You are an AUDITOR. You did not write this code, and that is the point.

Blind review is a headline feature. If a reviewer can see who wrote a submission, the product's central claim about fair evaluation is false — and it would be false quietly, because nothing errors.

**Byte-scan EVERY reviewer-visible response AND every export** for seeded identity strings. Not a sample. Enumerate the reviewer-reachable surface from the route manifest rather than from memory, and drive each one.

What to hunt, concretely: the submitter's and speakers' names, email addresses, person IDs, org/affiliation, headshot references, and anything else that identifies authorship. Check the **CSV export** especially — exports are the classic leak, because they are assembled by different code than the screen and are rarely re-checked. Check error messages and 404/403 bodies too; a "not found" that echoes a name leaks just as effectively as a 200.

**This run has produced the same failure four separate times: a green test over a dead feature.** Assume that shape is present here until you prove otherwise. MRQ-18 shipped blind-mode tests asserting `identity` is null and that bodies exclude "Demo Organizer" — verify those assertions actually cover the surface they appear to, and that no path added since (MRQ-28's two-round funnel and comparison mode, MRQ-33's record, MRQ-35's routing) reintroduced identity.

## What to produce

**Findings with `file:line` and a concrete failure input** — the request a reviewer makes and the string that comes back. A finding without a reproduction is an opinion. Where you find nothing, say so plainly and name exactly which surfaces and which identity strings you scanned; a clean audit that states its coverage is worth far more than one that implies it.

**Add a machine guard so a future ticket cannot silently reintroduce a leak.** `tests/node/comms.AC-250.test.mjs` is the model — it is now a TypeScript AST inventory over all of `src/`, not a regex. Prefer `tests/node`.

**Do not fix product code you are auditing** unless the fix is trivially safe and you say so explicitly; findings route to their owning tickets. Flag anything ambiguous to me rather than deciding it.

## Standing rules

Suite ~10–18s against 30s; whole gate 45s. After any rebase `npm ci` and let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-50.json`** — if you own no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-50`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
