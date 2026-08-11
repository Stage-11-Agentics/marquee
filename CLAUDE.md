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

## Delegator harness defaults (this project)

Build delegators run on **codex at `xhigh` reasoning effort**. The codex config already sets `model = "gpt-5.6-sol"` and `model_reasoning_effort = "xhigh"` globally, so **launch without an `--effort` flag** — passing `--effort high` silently *downgrades* the agent below the configured default:

```
c11 launch-agent --type codex --workspace <ws> --pane <pane> --suppressed --prompt-file <boot>
```

Claude delegators, when used, run on **sonnet** (operator ruling 2026-08-10), never opus; opus is reserved for tickets whose contracts every later ticket inherits.
