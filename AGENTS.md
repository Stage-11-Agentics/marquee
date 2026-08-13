# Marquee

Open-source speaker/session-management platform for conference organizers, built to run AIE NYC 2026. Replaces Sessionboard; competes against Sessionize's scope with the post-acceptance workflow neither ships. Originated as Stage 11's entry in swyx's "$10,000 Kill My SaaS" hackathon.

## Orient here first

- `sequence/run-state.md` — the arc's resume anchor: current stage/phase, decisions, active agents, open touchpoints. **Read this first on every session.**
- `DESIGN.md` — the binding design language: Flight Deck aesthetic (tokens in `prototypes/skins/skin-c.html`), voice, craft rules, and the pointer to the binding prototype. The build reproduces the prototype one-to-one.
- `PHILOSOPHY.md` — the one thing (fantastic conferences, effortlessly), the principles (respect the operator; the system does the chase work; agent-native by design; whole loop or nothing; own your conference; the organizer's language), and the taste rules. Binds every design and copy decision.
- `EVAL.md` — how to grade this build with swyx's sbek harness (kit at `.eval-kit-agent/`): the in-context path (your session as browser, pipelined judge subagents) and the official API path. Read it before any eval run.
- `DEPLOY.md` — how the site gets built and shipped, and how to check what is actually live. **There is no auto-deploy: merging does not ship.** Read it before deploying, and improve it there rather than rediscovering the same gotchas per-run.
- `sequence/PRODUCT-DEFINITION.md` — Phase-2 synthesis: positioning, moat, scope, architecture bets.
- `sequence/research/` — the Phase-1 dossiers: `competition-requirements.md` (R1–R50 register — the ground truth every artifact keys to), `stakeholders.md`, `user-stories-draft.md`, `landscape-features.md`, `seams-feasibility.md`.

## Working in the code

- **Stack:** Hono + Preact + Zod on Cloudflare Workers; Vite builds it, TypeScript throughout. Node ≥ 22.18. App code lives in `src/` (`api/`, `routes/`, `ui/`, `db/`, `jobs/`), schema in `migrations/`, tests in `tests/`.
- **Dev server:** `npx vite dev` — the Cloudflare plugin runs the real Worker locally.
- **Tests:** `npm test` (Vitest, workers pool). `npm run e2e` for Playwright.
- **PR gate:** `npm run pr-gate` before opening a PR.
- **Live site:** `https://marquee.stage11.dev` — `curl /health` reports the deployed sha. See `DEPLOY.md` before shipping anything.

## Rules of the road

- Requirements trace to R-numbers; stories to US-numbers; stable AC IDs are minted only at consolidation.
- Speed is a feature (R7). Treat any slow list or transition as a defect.
- This repo will be **public open source** (competition requirement). Nothing secret goes in it: no tokens, no Stage 11 internals, no `Atin/` content.
- **Do not report subscription usage, limits, or glideslope position unless asked.** The operator watches it; volunteered mentions from a fleet are noise.
- **The suite budget is 45s and the gate budget is 120s** (`scripts/checks/run-test.mjs`, `pr-gate.mjs`), sized to survive several agents building at once. A red suite must mean a real defect; if a run fails on time alone, check machine load before believing it.

## Source control: GitHub is canonical for Marquee

**`Stage-11-Agentics/marquee` on GitHub — private — is the single home for this project** (a deliberate exception to the Stage 11 Forgejo default; a collaborator works through GitHub).

- Remote is **`github`**; branch is **`main`**. There is no `origin`.
- **The Forgejo repo is retired.** Do not push to it, fetch from it, or re-add it as a remote — it was removed so stale commands fail loudly.
- PRs via `gh pr create --repo Stage-11-Agentics/marquee --base main`; `gh` is already authenticated.
- **Private stays private.** The public competition artifact is the orphan branch `mrq-42-assembly` (tip `f4240644`): the app tree without `sequence/`, `OPERATOR-PRECONDITIONS.md`, or the `.lattice` board. **Never push `main` to a public repo, and never merge the orphan into `main`** — the merge would delete everything the orphan omits, including the board.

## The primary checkout is the Lattice board's home, never a workspace

`/Users/atin/Projects/Stage11/deployments/Marquee` holds the one Lattice board;
every linked worktree resolves to it via Lattice's `find_root()`, so the fleet shares
one board instead of diverging copies.

**No code work in the primary checkout.** No branching, stashing, checkouts,
`git clean`, rebasing, or editing source. It stays parked on `main`. All work
happens in a linked worktree:

```sh
git worktree add ../Marquee-worktrees/<branch> <branch>
```

- **Launch agents with the board pinned:** `c11 launch-agent … --env LATTICE_ROOT=/Users/atin/Projects/Stage11/deployments/Marquee`,
  so board resolution never depends on cwd or branch.
- **Minting tickets is single-writer** — orchestrator/intake only. Concurrent
  `lattice create` calls corrupt the ID counter. Delegators updating their *own*
  task's status, plan, and comments is fine; those touch disjoint files.
- **Never "clean up" state you cannot attribute.** Unfamiliar uncommitted changes
  are almost always a sibling agent's live work. Ask, or leave it; raise a c11 flag
  rather than reaching for `stash` or `reset`.
- The board is committed to `main` on purpose. Conflicts in `.lattice/events/*.jsonl`
  and `ids.json` are survivable and visible; uncommitted board state disappears silently.
