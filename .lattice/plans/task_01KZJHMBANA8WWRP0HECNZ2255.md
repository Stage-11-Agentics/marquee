# MRQ-42: AC-coverage closure and public-repo assembly

BUILDPLAN: M-50 + M-56 — cross-cutting (§5) · MERGED at mint (3 h + 3 h = 6 h; both extend `scripts/checks/*` with no dependencies, and both are the release-verification plumbing the terminal gate runs)

🔒 **GATE-BACKING — NEVER IN THE CUT BAND** (M-56 backs gate 16; M-50 backs gate 3). The merged ticket inherits the lock.

**M-50 — `trace:ac` closure** (3 h)
Scope (verbatim): every live `auto` AC in scope named by at least one test; AC-239 treated as a tombstone and any reuse/unknown ID rejected; coverage report attached.
`--scope=all` is the gate's form and runs from CP-2 onward; `--scope=merged` is the PR default.

**M-56 — Public-repo assembly** (3 h)
Scope (verbatim): build the publishable tree as an **orphan/squashed initial commit with no ancestry from this working repo** (`src/`, `migrations/`, `scripts/`, `cli/`, `README.md`, `LICENSE`, `SKILL.md`, `SEED-DATA.md`, `PHILOSOPHY.md`, plus whichever of SPEC/EVALUATION/BUILDPLAN survive §8 item 10's curation). Extend `check:repo`'s ruleset with the third-party-content denylist and run it over the assembled history *before* the remote exists. **Backs gate 16; never in the cut band.** Rehearsed at the CP-3 dry run, not improvised at 21:00 Tuesday.
Why an orphan commit (§8 item 12a): this working repo's history carries the organizers' full brief PDF, another entrant's context document archived from Discord, absolute `/Users/…` paths, Stage 11 account posture, and c11 workspace/surface IDs. Deleting at the tip does not remove them, and republishing a redistributed brief or a rival's document under Apache-2.0 **cannot be un-pushed**.
Denylist to add to `check:repo`: `sources/`, `*.pdf`, `competitor-*`, `AGENT-BRIEF-*`, `run-state`, `C11_`, `surface:`, `workspace:`, `/Users/`.

ACs: — (backs gates 3 and 16; M-50 produces `ac-coverage.json`)
Hours: 6 (3 + 3)
Workflow: inline-full
Shared files: `scripts/checks/*` — additive; the `package.json` entries already exist (registered by M-05a+M-06).
Deps: none listed in the plan's cross-cutting table
Audit that keys off this ticket: A-1 runs `check:repo` twice at the push — over the assembled orphan history, then over the pushed remote.
Plan: filled in by delegator's plan phase
