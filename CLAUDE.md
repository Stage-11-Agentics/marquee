# Marquee

Open-source speaker/session-management platform for conference organizers, built to run AIE NYC 2026. Replaces Sessionboard; competes against Sessionize's scope with the post-acceptance workflow neither ships. It began as Stage 11's entry in swyx's "$10,000 Kill My SaaS" hackathon.

## Orient here first

- `sequence/run-state.md` — where the work stands: current focus, decisions, active agents, open touchpoints. **Read this first on every session.**
- `DESIGN.md` — the binding design language: Flight Deck aesthetic (tokens in `prototypes/skins/skin-c.html`), voice, craft rules, and the pointer to the binding prototype. The build reproduces the prototype one-to-one.
- `PHILOSOPHY.md` — the one thing (fantastic conferences, effortlessly), the principles (respect the operator; the system does the chase work; agent-native by design; whole loop or nothing; own your conference; the organizer's language), and the taste rules. Binds every design and copy decision.
- `DEPLOY.md` — how the site gets built and shipped, and how to check what is actually live. **There is no auto-deploy: merging does not ship.** Read it before deploying, and improve it there rather than rediscovering the same gotchas per-run.
- `sequence/PRODUCT-DEFINITION.md` — Phase-2 synthesis: positioning, moat, scope, architecture bets.
- `sequence/research/` — the Phase-1 dossiers: `competition-requirements.md` (R1–R50 register — the ground truth every artifact keys to), `stakeholders.md`, `user-stories-draft.md`, `landscape-features.md`, `seams-feasibility.md`.

## Rules of the road

- The Tone workflow governs this project (tone-initiation → tone-prototype → tone-architect → lattice-orchestrator). Pipeline norms: living artifacts, AC lineage, one run-state.
- Requirements trace to R-numbers; stories to US-numbers; stable AC IDs are minted only at consolidation.
- The 11-step walkthrough loop is the product's spine: it must complete with zero dead ends. A dead end anywhere in it is a defect, whoever finds it.
- Speed is a feature (R7). Treat any slow list or transition as a defect.
- This repo is **public open source**. Nothing secret goes in it: no tokens, no Stage 11 internals, no `Atin/` content.
- **Do not report subscription usage, limits, or glideslope position unless asked.** The operator can see it and has it under control. It is visible in every agent's status line, which makes it tempting to volunteer — and with a fleet this size, one mention per agent becomes a stream of noise about a number nobody needs. Answer if asked; otherwise leave it alone.
- **The suite budget is 45s and the gate budget is 120s** (`scripts/checks/run-test.mjs`, `pr-gate.mjs`). Several agents build and test here at once, so the budgets are set to survive contention: a red suite must mean a real defect, never a busy machine. If a run fails on time alone, check the load before believing it.
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
- **Private stays private.** What gets published is a separate, curated artifact: the orphan
  branch `mrq-42-assembly` (tip `f4240644`), which carries the app tree without `sequence/`
  internals, `OPERATOR-PRECONDITIONS.md`, or the `.lattice` board. **Never push `main` to a
  public repo, and never merge the orphan into `main`** — it would delete everything the
  orphan omits, including the whole board.

## The primary checkout is the Lattice board's home, never a workspace

`/Users/atin/Projects/Stage11/deployments/Marquee` holds the one Lattice board.
Every linked worktree resolves to it — Lattice's `find_root()` deliberately jumps to
the primary worktree so the fleet shares one board instead of diverging copies. That
design holds only while the primary checkout is a stable anchor.

**So: no code work in the primary checkout.** No branching, no `git stash`, no
`git checkout <branch>`, no `git clean`, no rebasing, no editing source. It stays
parked on `main`. All work happens in a linked worktree:

```sh
git worktree add ../Marquee-worktrees/<branch> <branch>
```

- **Launch agents with the board pinned:** `c11 launch-agent … --env LATTICE_ROOT=/Users/atin/Projects/Stage11/deployments/Marquee`.
  Board resolution then never depends on cwd or on what branch anything is on.
- **Minting tickets is single-writer** — the orchestrator/intake agent only. Lattice's
  CLI has an unlocked read-decide-write window, and concurrent `lattice create` calls
  are how the ID counter corrupts and starts re-minting `MRQ-1`. Delegators updating
  their *own* task's status, plan, and comments is fine; those touch disjoint files.
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

- **`--effort high` is a downgrade, `--effort max` is the target.** `~/.codex/config.toml` sets `model_reasoning_effort = "xhigh"`, so an explicit `high` silently drops *below* the configured default — that was the original footgun. Passing nothing inherits xhigh; passing `max` is what the operator actually wants for build work (directive 2026-08-10). Only the sanctioned Luna-at-capacity fallback runs `terra` at `high`.
- **Always pass `--model`.** That config still pins `model = "gpt-5.6-sol"`, so a launch without `--model` quietly gets the wrong model.
- **Fast service tier is off** — `service_tier = "default"` in `~/.codex/config.toml` (machine-wide; backup at `~/.codex/config.toml.bak-marquee`). `c11 launch-agent` has no passthrough for `-c key=value`, so this has to live in the config rather than the launch line.

Model names are verified live before use, not assumed — `gpt-5.6-luna` and `gpt-5.6-terra` were both confirmed answering before being written here.
