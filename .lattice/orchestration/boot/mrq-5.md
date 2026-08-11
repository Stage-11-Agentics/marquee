FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-5-seed-pool" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-5** (BUILDPLAN **M-04b** — seed generator: pool, evaluation, deliberate ugliness; inline-full, ~5h). Actor: `agent:delegator-mrq-5`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-5-seed-pool`, branch `mrq-5-seed-pool`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path, uuid from `lattice show MRQ-5 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless `lattice plan-review` and `code-review` are suspended** — self-review inline and attach a standard-shape review naming your exact HEAD.

## Read your ticket's HANDOFF comment first

`lattice show MRQ-5` carries a comment from the orchestrator with requirements that are **not optional**. Summarised, and expanded with the operator's ruling since:

**This ticket carries adversarial finding B-3, which is BLOCKING.** Without it, walkthrough **step 8 (evaluate) has no reachable entry** and `check:seed` fails its ">= 20 unreviewed" assertion. Concretely you must seed:

1. **A reviewer membership for the demo organizer** — the demo organizer must be able to reach the evaluation queue at all.
2. **`reviewer_track_scopes` covering every track** — a reviewer scoped to nothing sees an empty queue, which is indistinguishable from a broken product.
3. **Round-1 assignments across ~40 unreviewed submissions** — enough that `check:seed`'s ≥20-unreviewed assertion passes with margin.
4. **`memberships` generally, including the speaker membership SPEC §3.2 grants.** MRQ-4 shipped the spine without any membership rows, so a seeded speaker currently has no authority and the portal path is dead on arrival.

## What you inherit and must not break

MRQ-4's seed spine is merged (`c64a9ba`): event, taxonomy, venue, and the 60-session real accepted core, plus `SEED-DATA.md`. Build on it; extend, do not rewrite. Its delegator fixed a defect worth knowing — `contentSessions()` had filtered on the capture's unreliable `type` field, seeding "Workshop Afternoon Break" as an accepted abstract and yielding 72 speakers instead of 75. **Do not reintroduce a `type`-based filter.**

Scope from `lattice show MRQ-5 --json`. ACs: **AC-3, AC-234, AC-245, AC-246, AC-249.** Seed spec is `SPEC.md` §6 — including the status mix, the deliberate ugliness (long diacritic names, truncating titles, a speaker on 3 submissions, a 4-person panel, an overdue task set, at least two visible double-bookings), and the **hard public-repo prohibitions**: no real email addresses (`firstname.lastname@example.com` only), no real headshots (deterministic initials-on-colour SVG, no external requests), real names only on the real accepted core.

## Evidence required

Copy MRQ-4's shipped pattern exactly: an **AC-tagged test** under `tests/` whose name carries its `AC-nnn`, plus **`tests/ac-claims/MRQ-5.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. Validate against live D1, not just unit tests.

Before the PR: `npm run pr-gate -- --ticket MRQ-5`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
