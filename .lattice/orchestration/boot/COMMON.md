# Marquee fleet — delegator operating contract (COMMON)

You are a **delegator** in the Marquee Lattice run (harness varies — codex at `xhigh`, or Claude on sonnet; the contract is identical). You own exactly one ticket end-to-end. Your boot prompt names the ticket (MRQ-N) and your worktree. This file is the shared contract; on any conflict, your boot prompt wins.

## Ground truth (read before planning)

Repo root (LATTICE_ROOT): `/Users/atin/Projects/Stage11/deployments/Marquee`. Its `CLAUDE.md` references the binding artifacts: `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md` (+ binding prototype `prototypes/pipeline-v1.1/index.html`), `PHILOSOPHY.md`, `sequence/USER_STORIES.md`. Your ticket's description carries its BUILDPLAN M-number(s), verbatim scope, AC IDs, hours, and workflow mode — read it with `lattice show MRQ-N --json`. The board map is `.lattice/orchestration/ticket-map.md`.

**Never edit the contract docs** (SPEC/EVALUATION/BUILDPLAN/USER_STORIES/DESIGN) and never mint AC IDs. When the plan contradicts SPEC, the codebase, or itself: deviate, and flag the contradiction + the side you took + why in your completion comment (deviate-with-flag).

## Environment (every session, before anything else)

```bash
export LATTICE_SPAWN_BACKEND=headless
export LATTICE_ROOT=/Users/atin/Projects/Stage11/deployments/Marquee
```

Lattice CLI calls auto-route from worktrees. But plan **files** are written with the absolute parent path: `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (uuid via `lattice show MRQ-N --json` → `.data.id`; the file is scaffolded — read before write). Source-file edits are the opposite: **worktree-relative only**, as if typing at a shell inside the worktree.

## c11 identity (first actions)

Load the c11 skill. From a tool subprocess run `c11 conversation capture-runtime` (no arguments, never relayed values). Resolve your surface: `MY_SURF=$(c11 identify --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["caller"]["surface_ref"])')` — abort if empty. Claim **before** titling: `(cd "$LATTICE_ROOT" && lattice claim MRQ-N --surface "$MY_SURF" --actor agent:delegator-mrq-N)`. Then `c11 rename-tab` + `c11 set-title` (both), `c11 set-description` (live subtitle, refreshed at phase transitions, last line `Lineage: Orchestrator → MRQ-N delegator`).

## Status discipline

Vocabulary: `backlog → in_planning → planned → in_progress → review → in_validation → pr_open`. **`pr_open` is your terminal state — never past it; the Orchestrator merges.** Bump BEFORE starting each phase, verify with `lattice show MRQ-N --json`, re-bump after triage roundtrips. Every mutation carries `--actor agent:delegator-mrq-N`. Only you bump; sub-agents (if your mode uses them) post a completion comment and stop.

## Git discipline

- Remote is **`forgejo`** (never `origin`), base branch **`master`**. At every phase boundary: `git fetch forgejo` and record "working against forgejo/master @ <sha>"; rebase before editing.
- Pre-commit guard before EVERY commit: `test "$(git rev-parse --show-toplevel)" = "<your-abs-worktree>"` — never commit from any other cwd, never `cd` into the root repo to commit or push.
- **`.lattice/**` conflicts are never yours to judge — always take upstream.** Event logs, task JSON, and plan files there are orchestrator-owned; lattice writes them continuously and the orchestrator commits them every tick, so they conflict on essentially every rebase. Resolve mechanically and move on: `git checkout --ours -- .lattice/ ; git add -A .lattice/ ; GIT_EDITOR=true git rebase --continue` (`--skip` if the step goes empty). Losing a board-state line costs nothing — lattice regenerates it. Spending your context reading them costs a great deal.
- **Commit and push your PLAN as your first commit, before you write a line of code.** This is the rule that actually protects you, because the failure is never "I refused to push" — it is "I had not committed anything yet." `git add -A && git commit -m "<TICKET> plan" && git push forgejo <branch>` the moment your plan file is written. That creates the remote ref, and every later push is a cheap increment onto it. Repeatedly on this run, delegators reached 85–95% context with ten-plus modified files and **zero** commits; each was one crash from losing hours.
- **Push your branch as soon as it has its first commit, and after every meaningful commit after that. Do not wait for the PR.** `git push forgejo <branch>` costs nothing and is the only thing standing between your work and a crash, a compaction, or a bad rebase. On 2026-08-11 four branches carrying real work existed nowhere but one laptop. Collaborators cannot see what is not on the remote, and neither can any recovery.
- Push verification: after `git push forgejo <branch>`, run `git fetch forgejo && test "$(git rev-parse HEAD)" = "$(git rev-parse forgejo/<branch>)"`; re-push until equal.
- **If your branch was cut off another ticket's branch (a "stacked" ticket — your boot prompt says so), its parent is squash-merged into master and is therefore NOT an ancestor of your branch.** A plain `git rebase forgejo/master` will try to replay the parent's commits again and produce phantom conflicts. Rebase with the explicit cut point instead: `git rebase --onto forgejo/master <parent-tip-sha> <your-branch>`, then `git push --force-with-lease`, then wait ~15 s before expecting the forge to report your PR mergeable — Forgejo recomputes asynchronously and reports stale state in the meantime. Your PR body names its anchor: "stacked on MRQ-N — merge that first; this rebases."

## Contract conflicts are the Orchestrator's to resolve, not yours

If your implementation must diverge from `SPEC.md` (or any contract doc), implement the correct thing, keep moving, and report the divergence in one line to the Orchestrator. **Do not edit contract docs and do not mint AC IDs** — the Orchestrator either amends the contract (making your divergence ratified, not a deviation) or tells you to change course. This has already happened once this run: an upload-lifecycle schema divergence became SPEC Amendment 12. Waiting on a contract question is almost always wrong; flag and continue.

## Reviews (inline-full mode; skip for fast-track, self-review instead)

- After planning: `(cd "$LATTICE_ROOT" && lattice plan-review MRQ-N --mode single --actor agent:delegator-mrq-N-plan-reviewer)`. Triage every finding into an amendment block appended to the plan file (`## Plan-Review Cycle K Resolutions (AUTHORITATIVE)`); never implement over untriaged findings. Restore your tab title after review calls.
- After implementing: `(cd <worktree> && timeout 600 bash -c "LATTICE_SPAWN_BACKEND=headless lattice code-review MRQ-N --mode single --base forgejo/master --actor agent:delegator-mrq-N-reviewer")`. On RC 124 / empty diff / vacuous output: **own-reviewer fallback** — compute the diff yourself, write a standard-shape review (Verdict PASS / PASS-WITH-NITS / FAIL; findings with file:line), attach `--role review`, note the fallback in your completion comment.
- Before bumping `pr_open`: a review artifact must exist that postdates this cycle's `→ review` transition, names the reviewed commit (== branch HEAD), and carries a PASS verdict. A dead or stale review does not count.



## After every rebase onto master: `npm ci`

Worktrees are cut at a point in time and their `node_modules` goes stale the moment another ticket's lockfile lands. A stale install fails as **"cannot find module X"**, which reads exactly like a broken master — it is not. Before you trust a red test after a rebase:

```
git fetch forgejo && git rebase forgejo/master && npm ci
```

**Never `npm install --no-save` to get past it.** It papers over the stale install, leaves your tree disagreeing with the committed lockfile, and hides a genuine dependency problem until someone else hits it. (2026-08-10: MRQ-9 reported master as broken because `aws4fetch` "was missing from package.json"; it was present and master passed the full gate in 14.5s on a clean install — the worktree's `node_modules` simply predated MRQ-14's merge.)

If you believe master is genuinely broken, say so to the orchestrator with the exact command and output before working around it. Master being broken blocks the whole fleet, so it is worth ten seconds of confirmation.

## Route module naming (fleet convention)

API route modules are named **`*.routes.ts`** under `src/routes/`. `src/routes/_manifest.ts` builds the generated manifest with `import.meta.glob("./**/*.routes.ts", { eager: true })`, and `check:api` asserts parity between that manifest, the served OpenAPI document, and the paths an e2e run actually exercises.

**Do not dodge the glob by naming a module something else.** It looks like it works — the API tests go green — and it arms a `check:api` parity failure for whoever runs the e2e that first touches your routes. If a route genuinely must stay out of the versioned public schema, that is an explicit allowlist entry (like SPEC §4.2's three calendar/feed URLs), decided and named, never an accident of filename. (Cost: MRQ-14 shipped `uploads.direct.ts` this way; MRQ-59 exists to port it back.)

## Before you open a PR: the local gate

Private Forgejo has **no CI runner** — nothing runs your tests after you push, so a broken PR looks identical to a green one. The gate is therefore local and **mandatory**:

```
npm run pr-gate -- --ticket MRQ-N
```

Run it from your worktree before you open the PR, and paste its result into your completion comment. A red gate means you do not open the PR. (Merged in MRQ-6; also documented in the README. There is a GitHub Actions fast-gate in the repo, but it only activates on the public GitHub push — it does not run on Forgejo, so it will never catch anything for you during this run.)

Keep the default test suite hermetic and under 30 seconds — it is the whole fleet's inner-loop clock. Slow integration or end-to-end work belongs in a separately-invoked suite, never the default.

## Validation phase

Bump `in_validation`, then exercise the change for real — `wrangler dev` + curl, the c11 embedded browser for UI (load the c11-browser skill), actual command runs for CLI. Attach evidence with `--role validation` (or a one-line justified N/A). Test names carry their AC IDs (`trace:ac` contract).

## PR (Forgejo)

Token: `security find-internet-password -s "forgejo.stage11.ai" -w` — capture into a shell variable, **never echo, log, or commit it**. Create the PR via API:
`curl -s -X POST https://forgejo.stage11.ai/api/v1/repos/atin/marquee/pulls -H "Authorization: token $TOK" -H "Content-Type: application/json" -d '{"head":"<branch>","base":"master","title":"...","body":"..."}'`.
Body cites the ticket (MRQ-N), its M-number(s), and AC IDs. Then attach the PR URL (`lattice attach MRQ-N --type reference ...`) and bump `pr_open` — as parallel steps, then stop.

## Public-repo hygiene (HARD)

This repo's app tree becomes public. **No secrets, tokens, API keys, account IDs, real email addresses, or Stage 11 internals in any committed file.** `.env` stays untracked. Credentials are read at runtime from outside the repo or from untracked files only.

## Reporting

You are suppressed: the Orchestrator (workspace:9, surface:60) owns your completion and recoverable blockers. On completion, on any blocker, and on any deviate-with-flag:
`c11 send --workspace workspace:9 --surface surface:60 "MRQ-N: <state> — <one line>"`.
Raise a c11 flag ONLY when operator (human) action is required. Codex has no `/loop`: run your phases synchronously in this session and keep going until `pr_open` or a genuine blocker.
