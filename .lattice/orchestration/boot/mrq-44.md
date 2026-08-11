FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-44-audit-badge" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-44** (A-2 — PROTOTYPE badge absent from the product). Actor: `agent:auditor-mrq-44`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-44-audit-badge`, branch `mrq-44-audit-badge`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMBGQVN17NRVHJ2GN0T49.md` → `planned` → `in_progress` → audit → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit** — push, not just commit. **Opening the PR is the final step and is not optional.**

## You back EVALUATION gate 15, which is unconditional

The claim: **the PROTOTYPE badge exists only under `prototypes/`, and no product route renders it.** A judge who sees "Prototype · mock data" on a shipped screen concludes the product is a mockup — the single most damaging false impression available to us, and it would be entirely self-inflicted.

Verify it properly rather than grepping once:

- Enumerate every product route from the generated manifest and `src/ui/shell/route-table.ts`, and confirm none renders the badge markup or the `prototype-badge` class.
- Check the built output, not only source: `npm run build` then scan `dist/`. A badge reachable through a component that only renders under some state will not show up in a naive source grep.
- Confirm the badge and its CSS class genuinely live only under `prototypes/`.
- Check the reverse too: the **binding prototype at `prototypes/pipeline-v1.1/index.html` MUST keep its badge** (`prototype-badge`, "Prototype · mock data"). Removing it there would be its own defect — that file is a design contract, not a shipped surface.

**Assume a green test over a dead check until proven otherwise** — that shape has appeared five times on this run, most recently a guard that pinned line numbers and cried wolf when unrelated code moved.

## What to produce

**Findings with `file:line` and a concrete reproduction** — the route a judge visits and what renders. Where you find nothing, name exactly which routes and which artifacts (source and `dist/`) you scanned; a clean audit that states its coverage is worth far more than one that implies it.

**Add a machine guard** so a future ticket cannot reintroduce the badge into the product. Model it on `tests/node/comms.AC-250.test.mjs`. **Key it on the invariant, not on coordinates** — assert which files may contain the badge, never exact line numbers; a guard that fails on unrelated drift gets silenced rather than heeded.

**Do not fix product code you are auditing** unless the fix is trivially safe and you say so; findings route to their owning tickets.

## Standing rules

Suite ~15–20s against 30s; whole gate 45s. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-44.json`** — if you own no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-44`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
