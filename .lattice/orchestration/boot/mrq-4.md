FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-4-seed" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-4** (BUILDPLAN **M-04a** — seed generator, spine; fast-track, ~2h). Actor: `agent:delegator-mrq-4`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-4-seed`, branch `mrq-4-seed`, cut clean off `forgejo/master`.

Fast-track arc, run inline: claim → plan (write it to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md`, absolute path) → implement → self-review → validate → PR → `pr_open`. **No headless plan-review or code-review** — both suspended this run.

**Scope:** the seed spine only — exactly what MRQ-9's submissions list needs. `lattice show MRQ-4 --json` has the verbatim text. AC: **AC-8**, plus the seed-side foundation for **AC-252**. MRQ-5 (M-04b) builds the full pool, evaluation state, and deliberate ugliness on top of your spine, so define the generator's structure well and leave clean extension points.

**Sources and rules:**
- Seed spec is `SPEC.md` §6. Source data is `sequence/research/sources/aie-summit-2025-program.json` (real 2025 program).
- Buildings are the **Sheraton-coherent trio** per SPEC §6 and Amendment 11 — Sheraton New York Times Square, the Workshop Annex, and Online. Not the 2025 venue's buildings.
- The generator is **idempotent and re-runnable** (`npm run seed`).
- **Hard prohibitions — this repo goes public:** no real email addresses (generate `firstname.lastname@example.com`), no real headshots (deterministic initials-on-colour SVG, no external requests), real names only on the real accepted core, no phone/passport/travel data.

**You own a flagged shared file** and sit near the critical chain — keep your diff tight and do not refactor beyond your scope.

Before the PR: `npm run pr-gate -- --ticket MRQ-4`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at workspace:9 surface:60.
