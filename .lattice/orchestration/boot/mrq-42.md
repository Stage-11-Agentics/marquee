FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-42-assembly" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-42** (AC-coverage closure and public-repo assembly). Actor: `agent:delegator-mrq-42`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-42-assembly`, branch `mrq-42-assembly`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMBANA8WWRP0HECNZ2255.md` → `planned` → `in_progress` → implement → self-review → PR → `pr_open`. **COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT.** **Opening the PR is the final step and is not optional.**

## You are the ship gate. Read MRQ-43's checklist first — it is your executable input.

`.lattice/artifacts/payload/art_01KZR1P0MS8QQGZYSREFW1TNVS.md` is a completed independent audit that tells you mechanically what must not survive assembly. Read it in full before planning. Its headline facts:

- **Exclude `.lattice/**` entirely — 827 path names at the tip and 827 across the full commit walk.** A stranger cloning the public repo could otherwise read task descriptions, prompts, actor IDs, review evidence and orchestration state from `git log` alone.
- **Exclude `sequence/research/**`** (32 paths) unless you produce an explicit, reviewed allowlist. Research dossiers, the sources tree, and agent briefs are not public.
- The audit lists **24 exact denied path names** from the complete commit/path walk — treat that list as authoritative and reject every one.
- **Do not enumerate history with `git rev-list --objects`. It dedupes identical blobs and under-reports** — it missed `sequence/research/sources/walkthrough.en.vtt` entirely. Use `git ls-tree` and `git log --name-only`.

## The orphan is the deliverable

Assemble a clean public history as an **orphan commit with no ancestry from this working repo** (EVALUATION gate 16). Then run `npm run check:repo -- --repo <path> --ref <orphan-ref>` against the assembled orphan, and again against the pushed remote once it exists. Bare `check:repo` exits 1 demanding explicit `--repo`/`--ref` — that is correct fail-closed behaviour, not a bug.

**A blocking prerequisite you must NOT work around: `gitleaks` is not installed on this machine and has never executed.** `check-repo.mjs:47-49` degrades exit-127 into a `gitleaks-unavailable` finding rather than failing hard, and the local ruleset covers paths and internal vocabulary only — it cannot establish "zero generic API keys/tokens", which is exactly what gate 16 claims. **Do not install it, do not fake it, and do not report a clean secret scan without it.** Assemble everything else, report `gitleaks-unavailable` as an outstanding operator prerequisite in your PR body, and tell me. I have escalated it.

## The other half: AC-coverage closure

`trace:ac` must be clean over the merged tree. Where an AC is genuinely uncovered, **say so and name it** rather than claiming coverage — several tickets on this run correctly declared `op-assist` items uncovered-pending-operator, and that honesty is the standard. Gate 19 requires any cut to be named explicitly.

## Standing rules

The suite is ~10–18s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci` and let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream. Six agents are live — prefer small isolated commits.

Before the PR: `npm run pr-gate -- --ticket MRQ-42`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
