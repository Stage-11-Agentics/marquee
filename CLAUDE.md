# Marquee

Open-source speaker/session-management platform for conference organizers, built to run AIE NYC 2026. Replaces Sessionboard; competes against Sessionize's scope with the post-acceptance workflow neither ships. It began as Stage 11's entry in swyx's "$10,000 Kill My SaaS" hackathon.

**`AGENTS.md` is a symlink to this file** — one source of truth for every runtime. Edit `CLAUDE.md` only; the symlink makes drift technically impossible.

## Orient here first

- `sequence/run-state.md` — where the work stands: current focus, decisions, active agents, open touchpoints. **Read this first on every session.**
- `DESIGN.md` — the binding design language: Flight Deck aesthetic (tokens in `prototypes/skins/skin-c.html`), voice, craft rules, and the pointer to the binding prototype. The build reproduces the prototype one-to-one.
- `PHILOSOPHY.md` — the one thing (fantastic conferences, effortlessly), the principles (respect the operator; the system does the chase work; agent-native by design; whole loop or nothing; own your conference; the organizer's language), and the taste rules. Binds every design and copy decision.
- `EVAL.md` — how to grade this build with swyx's sbek harness (kit at `.eval-kit-agent/`): the in-context path (your session as browser, pipelined judge subagents) and the official API path. Read it before any eval run.
- `DEPLOY.md` — how the site gets built and shipped, and how to check what is actually live. **There is no auto-deploy: merging does not ship.** Read it before deploying, and improve it there rather than rediscovering the same gotchas per-run.
- `sequence/PRODUCT-DEFINITION.md` — Phase-2 synthesis: positioning, moat, scope, architecture bets.
- `sequence/research/` — the Phase-1 dossiers: `competition-requirements.md` (R1–R50 register — the ground truth every artifact keys to), `stakeholders.md`, `user-stories-draft.md`, `landscape-features.md`, `seams-feasibility.md`.

## Working in the code

- **Stack:** Hono + Preact + Zod on Cloudflare Workers; Vite builds it, TypeScript throughout. Node ≥ 22.18. App code lives in `src/` (`api/`, `routes/`, `ui/`, `db/`, `jobs/`), schema in `migrations/`, tests in `tests/`.
- **Dev server:** `npm run dev` — builds the generated front door, then the Cloudflare plugin runs the real Worker locally.
- **Tests:** `npm test` (Vitest, workers pool). `npm run e2e` for Playwright.
- **Before every push:** run `npm run prepush` for the mandatory type, docs, clock, no-op, AC-trace, schema, and registry battery.
- **PR gate:** `npm run pr-gate` before opening a PR.
- **Live site:** `https://marquee.stage11.dev` — `curl /health` reports the deployed sha. See `DEPLOY.md` before shipping anything.

## Rules of the road

- The Tone workflow governs this project (tone-initiation → tone-prototype → tone-architect → lattice-orchestrator). Pipeline norms: living artifacts, AC lineage, one run-state.
- Requirements trace to R-numbers; stories to US-numbers; stable AC IDs are minted only at consolidation.
- The 11-step walkthrough loop is the product's spine: it must complete with zero dead ends. A dead end anywhere in it is a defect, whoever finds it.
- Speed is a feature (R7). Treat any slow list or transition as a defect.
- This repo is **public open source**. Nothing secret goes in it: no tokens, no Stage 11 internals, no `Atin/` content.
- **Do not report subscription usage, limits, or glideslope position unless asked.** The operator can see it and has it under control. It is visible in every agent's status line, which makes it tempting to volunteer — and with a fleet this size, one mention per agent becomes a stream of noise about a number nobody needs. Answer if asked; otherwise leave it alone.
- **The suite budget is 45s and the gate budget is 120s** (`scripts/checks/run-test.mjs`, `pr-gate.mjs`) — **objectives that print loudly and pass, not gates.** Slowness fails nothing in those two: over budget reports `pass-over-budget`, and `process.exitCode` comes from the test outcome. Only `HARD_LIMIT_MS` (600s, a hang detector) turns a slow run red, and it reports `timeout` rather than `fail`. So **read the status field rather than judging the machine**:

  | status | meaning |
  |---|---|
  | `fail` | real and **load-invariant**. Block on it. |
  | `pass-over-budget` | passed, slow. A warn, not a failure. |
  | `timeout` (local) | results unknown, and unknown is not passing. Re-run under the gate lock. |
  | `timeout` (CI, ~600000ms) | the ceiling — and it is being **grazed, not approached**. Re-run the same sha once before investigating. |

  **The CI ceiling has almost no headroom left, so read a CI `timeout` as expected rather than as a signal.** PR #329 tripped it at `600037ms` and then passed on a re-run of the identical sha with **under 30 seconds to spare**, while the same suite runs ~92s locally. Budget for a re-run on any CI timeout, and do not read one as evidence about your branch. The reverse error is the expensive one: this is exactly the reflex that ends in a real `fail` being waved through as "the known flaky ceiling", so keep `fail` and `timeout` strictly apart — `fail` is load-invariant and blocks, whatever the box was doing. **MRQ-280** owns getting the headroom back and will replace this note with a measured figure; until then, treat any specific number you may have read elsewhere for this suite as stale.

  **No check script reds on wall clock alone.** `check:seed` carries the same three-tier verdict as the suite — `pass` / `pass-over-budget` / `timeout` — and `exitCodeForSeedStatus` (`scripts/checks/seed-verdict.mjs`) returns 1 only for `fail` or `timeout`, so a slow seed reports loudly and passes. `check:speed` fails on **AC-sourced budgets only** (`shouldFail = acceptanceFailures.length > 0`, `scripts/checks/speed-budgets.mjs`); the seven §1.3 numbers are objectives that warn and never fail, per the 2026-08-09 ruling. A wall-clock red therefore always means a *binding acceptance criterion* was missed — never that the box was busy. Everywhere else, **never dismiss failing tests as a known baseline without naming the commit that made them pass** — that is how a branch ships red.
- Speaker records are `people` rows (org-scoped); never add a parallel per-event `speakers` table.
- Keep human properties (bio, headshot, title, company, socials, pronouns, dietary/accessibility) on `people`; keep this event's participation (Invited/Confirmed workflow status, travel, honorarium, session assignment) on `participations` or an event-scoped join.
- Never put workflow status on `people`: one person must be Confirmed at one conference and Invited at another; this is the one error that cannot be undone.
- Attach notes, tags, and custom values to org-level `person_id`, never to an event-scoped roster row.
- Use one list query with optional `event_id`; do not maintain separate directory and roster implementations.
- Keep search, filter, sort, and pagination server-side; lean on `idx_people_org_name` (R7: speed is a feature).
- Do not deepen the `attachments.event_id` wart: a person's headshot is org-level while the attachment row it points at is event-scoped.
- Full reasoning: `sequence/research/speaker-crm-scope.md` §2.

## Source control: GitHub is canonical for Marquee

**`Stage-11-Agentics/marquee` on GitHub — private — is the single home for this project.**
A collaborator works through it, so it is where the work has to live.

- **Private is the intended state, not a gap.** The repo stays private through the build.
  Going public is a step *of* the submission, taken deliberately when the submission is
  made — not a precondition someone should race to satisfy beforehand. The submission pack
  names the repo URL, and that URL is a 404 to an outsider until then; that is expected and
  is not a defect to fix. **Do not make this repo public.** Only the operator does that, and
  only as part of submitting.
- Remote is **`github`**; branch is **`main`**. There is no `origin`.
- **The Forgejo repo is retired. Do not push to it, fetch from it, or re-add it as a remote.**
  The `forgejo` remote has been removed from the checkout deliberately, so a stale command
  fails loudly instead of silently writing to a repo nobody reads. Two forges is how `main`
  drifts, and this project now has one.
- This is a deliberate exception to the Stage 11 default that Forgejo is canonical, recorded
  there too.
- PRs via `gh pr create --repo Stage-11-Agentics/marquee --base main`. No token handling —
  `gh` is already authenticated.
- **A reviewed, green PR should be merged — by you, now.** Once a code review has happened
  and the gate is green, merging is the expected next step, not a decision to escalate. Do
  not park finished work behind a human who has not been asked for anything. Merging does
  not deploy (`DEPLOY.md`), so the cost of merging is low and the cost of parking is not:
  an open PR rots against a `main` that several agents are moving, and the agent who
  rebases it later is rarely the one who understood it.
  - "Reviewed" means someone other than the author actually read the diff — a review agent
    or a human. Your own confidence is not a review, and neither is a green gate.
  - Merge your own PR once that review exists. Waiting for the reviewer to also press the
    button just adds a second round trip.
  - Do not merge on a red gate, on unresolved review comments, or when the PR says it is
    waiting on something. Say what is blocking it instead.
- **This repository goes public as it stands, history and all** (Atin, 2026-08-12). The
  competition requires an open-source repo, and the answer is to flip this one rather than
  push a curated artifact: `sequence/` and the `.lattice` board are the record of how the
  product was actually built, which is worth more to a reader than a tidy tree. The earlier
  plan — publishing the orphan branch `mrq-42-assembly` — is superseded. That branch is
  still not to be merged into `main`; the merge would delete everything it omits.
- **Write every commit as if it were already public, because it is.** All 820-odd commits
  are readable, so deleting a file at `HEAD` hides nothing that was there before. No
  credential value has ever been committed (gitleaks, full history, 2026-08-12) and it must
  stay that way: secrets are Wrangler secrets and `.dev.vars`, never a commit.

## The primary checkout is the Lattice board's home, never a workspace

`/Users/atin/Projects/Stage11/deployments/Marquee` holds the one Lattice board.
Every linked worktree resolves to it — Lattice's `find_root()` deliberately jumps to
the primary worktree so the fleet shares one board instead of diverging copies. That
design holds only while the primary checkout is a stable anchor.

**So: no branch work in the primary checkout.** No branching, no `git stash`, no
`git checkout <branch>`, no `git clean`, no rebasing. It stays parked on `main`.

**Quick edits are the exception — interactive sessions only** (operator ruling,
2026-08-14). An agent in live conversation with the operator may make a small,
low-risk change — docs, guidance, config, or a one-concern code fix with a small
blast radius — directly in the primary checkout, committed straight to `main`:

```sh
git pull --ff-only github main   # the checkout is usually behind; catch up first
# edit; run the relevant tests if code was touched
git add <specific paths> && git commit && git push github main
```

Know that a direct push **bypasses the `fast-gate` required check** (the push
warns, then lands anyway). For docs that costs nothing; for a code fix it means
the tests you ran locally *were* the gate — so actually run them.

What keeps this safe is that HEAD never leaves `main` and the tree never stays
dirty: pull `--ff-only` before starting, stage only your own paths (sibling agents'
live `.lattice` changes are not yours to commit), push immediately. If the change
grows beyond small — multiple concerns, a wide diff, an uncertain blast radius —
stop and move it to a worktree + PR instead. **Fleet delegators and orchestrated
agents do not get this path**; their contract stays worktree → PR → review → merge.
A side benefit: a quick edit to `CLAUDE.md`/`AGENTS.md` made this way is live for
every session immediately, with no fast-forward step to remember.

Everything larger happens in a linked worktree:

```sh
git fetch github
git worktree add ../Marquee-worktrees/<branch> -b <branch> github/main
```

`-b` creates the branch, so it fails loudly if that name already exists. Resuming a branch
someone already pushed? Drop `-b`, name the branch, and bring it up to date before working:

```sh
git worktree add ../Marquee-worktrees/<branch> <branch>
git -C ../Marquee-worktrees/<branch> rebase github/main
```

**Cut from `github/main`, never from `main`.** The rule above is precisely what makes the
local `main` pointer untrustworthy: the primary checkout is parked by design and nobody
pulls it, so it moves only when a human happens to. On 2026-08-13 it sat **29 commits
behind** and was missing `a04f80b1` — the fix for test fixtures that minted auth sessions
against a hardcoded date — so every worktree cut from local `main` inherited 22 expired-session
failures on its first run. Four agents diagnosed them independently before anyone checked
the base. The remote-tracking ref is the only trustworthy base here *because* of the
board-home rule, not in spite of it.

Already working and unsure? Verify rather than assume — a stale base is invisible until it
costs you an hour, and re-running never clears it:

```sh
if git fetch github; then
  if git merge-base --is-ancestor github/main HEAD; then echo "current"
  else echo "behind github/main — rebase"; fi
else echo "FETCH FAILED — comparison not attempted"; fi
```

**Three states, three messages, and never `-q`.** A failed fetch does not make `merge-base`
fail — it makes it answer confidently about a stale remote-tracking ref. Every worktree here
shares one `.git`, so two agents fetching at the same moment lose the ref lock
(`cannot lock ref 'refs/remotes/github/main'`) and the comparison that follows is about
whatever state happened to exist. Chaining with `&&` at least stops the comparison running,
but it still prints one string for two different situations; "behind" and "my fetch died"
need to be distinguishable, because only one of them is about your branch. And `-q` does not
suppress the ref-lock error — it removes the ordinary output that makes anyone notice the
fetch step at all, so nothing normal prints and nothing abnormal stands out.

Lost the race? **Just re-run `git fetch github`.** And check the ref before assuming you
needed to: if a concurrent fetch won the lock, it wrote the same remote truth you were
asking for, so you may already be current. (`--force` is not the fix — git documents it as
overriding the *non-fast-forward* refusal on a `<src>:<dst>` refspec, which is a different
mechanism from a ref-transaction compare-and-swap failure.)

That question — *is my base current?* — is the durable one. Checking for a specific
rescue commit instead (`--is-ancestor a04f80b1 HEAD`) answers today's incident and then
quietly expires: once that commit is deep in history every branch contains it, the check
prints OK forever, and a check that can no longer fail is worse than none, because it
still looks like reassurance.

**"Behind" is the normal state on a busy day, not a defect** — a branch cut an hour ago
will say so with nothing wrong with it. Rebase when your PR reports `CONFLICTING`, when you
are about to merge, or when you are seeing a wave of auth 401s; not merely because you are
behind, since every needless rebase throws away a gate run already queued. Behind *plus*
those 401s is the expired-fixture case above, and only rebasing cures it.

- **Launch agents with the board pinned:** `c11 launch-agent … --env LATTICE_ROOT=/Users/atin/Projects/Stage11/deployments/Marquee`.
  Board resolution then never depends on cwd or on what branch anything is on.
- **Minting tickets is single-writer** — the orchestrator/intake agent only. Lattice's
  CLI has an unlocked read-decide-write window, and concurrent `lattice create` calls
  are how the ID counter corrupts and starts re-minting `MRQ-1`. Delegators updating
  their *own* task's status, plan, and comments is fine; those touch disjoint files.
- **Merging a change to `CLAUDE.md` does not deliver it.** It is auto-loaded (as is
  `AGENTS.md`, its symlink) from the primary checkout's *working copy*, and the rule
  above keeps that checkout parked — so a merged guidance fix sits on the ref while
  every session goes on reading the old text. A quick edit committed directly on `main`
  here delivers itself; **whoever merges a `CLAUDE.md` change via PR fast-forwards the
  board home as part of that merge**, then verifies the working copy rather than the ref:

  ```sh
  cd /Users/atin/Projects/Stage11/deployments/Marquee
  git fetch github && git merge --ff-only github/main
  grep -n "<what you changed>" CLAUDE.md   # read the file, not the ref
  ```

  If the fast-forward refuses, it is untracked `.lattice` files the incoming commits also
  add: back them up, remove, fast-forward, restore byte-identical, verify with `diff`.
  Never `git clean`, never `--force` — that tree is the fleet's board.
- **Never "clean up" state you cannot attribute.** In a multi-agent tree, unfamiliar
  uncommitted changes are almost always a sibling agent's live work. Ask, or leave it.
  If the tree looks broken, raise a c11 flag rather than reaching for `stash` or
  `reset` — recovering a stash nobody knew to look in costs far more than waiting.
- **Never `git stash` anywhere in this repo — the stash stack is shared by every
  worktree.** Linked worktrees keep their own index and HEAD but share one `.git`,
  and `refs/stash` lives there. Two agents who stash at the same moment swap
  stacks: the second `git stash pop` takes the first agent's entry into the wrong
  worktree, and each of them silently loses their own work while acquiring a
  stranger's. This is not hypothetical — it happened twice in one minute on
  2026-08-12 (MRQ-136 and MRQ-138), and both agents had to recover from dangling
  commits found with `git fsck`.
  - Need a clean tree to test a before-and-after? **Commit to your branch and use
    `git checkout <sha> -- <paths>`**, or a scratch worktree. A branch costs nothing.
  - If you have already popped someone else's stash: their content is still a
    reachable commit. `git log -g refs/stash` lists live entries; a dropped one is
    dangling and findable with `git fsck --dangling`. `git stash apply <sha>` restores
    it. Tell the owning agent the sha rather than trying to push it back on the stack.
- The board is committed to `main` on purpose. Conflicts in `.lattice/events/*.jsonl`
  and `ids.json` are survivable and visible; uncommitted board state disappears silently.

## Delegator harness defaults (this project)

**Model routing by kind of work** (operator directive, 2026-08-10):

| Work | Model |
|---|---|
| **Build / implementation — the workhorse** | codex **`gpt-5.6-luna` at `max` effort** — the ideal, and the default to return to |
| **Particularly hard build items** | codex **`gpt-5.6-terra`** or **`gpt-5.6-sol`** |
| **Luna repeatedly at capacity** | temporarily **`gpt-5.6-terra` at `high`** for a couple of agents — a fallback, not a destination |
| **Planning** | codex **`gpt-5.6-sol`** — or Claude |
| **Design** | **Claude** |

**Luna at max effort is the preference.** Fall back only when Luna genuinely refuses, and move back the moment it answers again.

Claude delegators run **sonnet**, not opus (operator ruling, same day); opus is reserved for tickets whose contracts every later ticket inherits.

Launch line:

```
c11 launch-agent --type codex --model gpt-5.6-luna --effort max \
  --workspace <ws> --pane <pane> --suppressed --prompt-file <boot>
```

Three footguns, all hit in this run:

- **`--effort high` is a downgrade, `--effort max` is the target.** `max` is what the operator wants for build work (directive 2026-08-10), and an explicit `high` lands below it. **Never rely on the inherited default:** `~/.codex/config.toml` currently reads `model_reasoning_effort = "high"`, so passing nothing now inherits `high` rather than the `xhigh` this section once assumed. Pass the tier every time. Only the sanctioned Luna-at-capacity fallback runs `terra` at `high`.
- **Always pass `--model`.** That config still pins `model = "gpt-5.6-sol"`, so a launch without `--model` quietly gets the wrong model.
- **Fast mode is available, and `c11 launch-agent` cannot reach it.** `service_tier` is the switch — `codex features list` shows `fast_mode  stable  true`, while `~/.codex/config.toml` holds `service_tier = "default"` (machine-wide; backup at `~/.codex/config.toml.bak-marquee`). `launch-agent` has no `-c key=value` passthrough, and editing the config to turn fast on would silently re-tier every other codex agent in the fleet mid-run. So for a fast agent, skip `launch-agent`: open a bare surface with `c11 new-surface`, then `c11 send` the invocation yourself.

```sh
codex --yolo -c service_tier=fast -c model_reasoning_effort=max --model gpt-5.6-luna
```

  Confirm it took by reading the status line — it must say `gpt-5.6-luna max fast` and `Fast on`. Both `-c` overrides are load-bearing: the config's defaults sit below each one, so omitting either quietly gives you a slower or dumber agent than you asked for. You trade `launch-agent`'s identity stamping for this, so set `--title`/`set-description` by hand.

Model names are verified live before use, not assumed — `gpt-5.6-luna` and `gpt-5.6-terra` were both confirmed answering before being written here.
