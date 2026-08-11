# Marquee

Open-source speaker/session-management platform for conference organizers — Stage 11's entry in swyx's "$10,000 Kill My SaaS" hackathon (deadline **Wed 2026-08-12 22:00 PT**), built to actually run AIE NYC 2026 afterward. Replaces Sessionboard; competes against Sessionize's scope with the post-acceptance workflow neither ships.

## Orient here first

- `sequence/run-state.md` — the arc's resume anchor: current stage/phase, decisions, active agents, open touchpoints. **Read this first on every session.**
- `DESIGN.md` — the binding design language: Flight Deck aesthetic (tokens in `prototypes/skins/skin-c.html`), voice, craft rules, and the pointer to the binding prototype. The build reproduces the prototype one-to-one.
- `PHILOSOPHY.md` — the one thing (fantastic conferences, effortlessly), the principles (respect the operator; the system does the chase work; agent-native by design; whole loop or nothing; own your conference; the organizer's language), and the taste rules. Binds every design and copy decision.
- `sequence/PRODUCT-DEFINITION.md` — Phase-2 synthesis: positioning, moat, scope, architecture bets.
- `sequence/research/` — the Phase-1 dossiers: `competition-requirements.md` (R1–R50 register — the ground truth every artifact keys to), `stakeholders.md`, `user-stories-draft.md`, `landscape-features.md`, `seams-feasibility.md`.

## Rules of the road

- The Tone workflow governs this project (tone-initiation → tone-prototype → tone-architect → lattice-orchestrator). Pipeline norms: living artifacts, AC lineage, one run-state.
- Requirements trace to R-numbers; stories to US-numbers; stable AC IDs are minted only at consolidation.
- The walkthrough video is the evaluation rubric: the 11-step loop must complete with zero dead ends.
- Speed is a graded feature (R7). Treat any slow list or transition as a defect.
- This repo will be **public open source** (competition requirement). Nothing secret goes in it: no tokens, no Stage 11 internals, no `Atin/` content.

## Source control: GitHub is canonical for Marquee (operator ruling, 2026-08-11)

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
- **Private stays private.** The competition needs a *public* repo, and that is a separate,
  curated artifact: the orphan branch `mrq-42-assembly` (tip `f4240644`), which carries the
  app tree without `sequence/` internals, `OPERATOR-PRECONDITIONS.md`, or the `.lattice`
  board. **Never push `main` to a public repo, and never merge the orphan into `main`** — it
  would delete everything the orphan omits, including the whole board.

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
