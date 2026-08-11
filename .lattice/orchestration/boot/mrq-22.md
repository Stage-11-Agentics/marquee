FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-22-public-site" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-22** (BUILDPLAN **M-20 + M-21** — public conference site, permalinks, and embeds; ~9h). Actor: `agent:delegator-mrq-22`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-22-public-site`, branch `mrq-22-public-site`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-22 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

## You own the only surface a stranger sees

Read the full scope with `lattice show MRQ-22 --json`. ACs: **AC-83 – AC-90, AC-240, AC-252, AC-253.**

**The leak rule is the one that matters.** Published-only, with **no URL-guess leakage** — an unpublished session must not be reachable by guessing its permalink, and a scheduled-but-unpublished session is a distinct state from a published one, not a hidden one. Prove it the way the merged guardrails do: assert **both** the status code **and** the absence of the thing — no unpublished title, abstract, or ID anywhere in the response body. A status-only assertion passes while the leak ships. I hand-review this one myself.

## Amendment 14 just landed — build against the merged reality, not the old SPEC prose

MRQ-62 merged (master `d16523c`): buildings now carry real `lat`/`lng`, `access_minutes`, and `access_note`. Consequences you own:

- Public session pages render **"Room · Building"** (AC-252). The helper already exists — use it, do not re-derive the label.
- **AV capabilities and room notes stay OFF public surfaces** (AC-253). Those are operator-facing. Leaking "Photo ID required at the main entrance" onto a public agenda is the same class of defect as leaking an unpublished session.
- The seed's venues are Sheraton New York Times Square, New York Marriott Marquis, and Online (unpinned). Prototype **v1.9** is the current binding design contract — it was reconciled to this set today. Do not build against the older 2025 building set if you see it referenced anywhere.

## Build on what is merged

- **MRQ-8** — API core, generated route manifest (glob over `*.routes.ts`), error envelope, list contract. **MRQ-60/61** — auth wired into the runtime; the public surface is the *unauthenticated* path, so be deliberate about which routes skip the credential resolver and say why in your PR body.
- **MRQ-6** — Flight Deck tokens and the check harness. **MRQ-7** — the public landing page already ships; match its treatment rather than inventing a second public visual language.

## Craft and speed

`PHILOSOPHY.md` and `DESIGN.md` bind. **Elements never jump** — day/track/search controls must not reflow the agenda as they filter; reserve space, fixed-width toggles, "—" instead of removed rows. Honest empty and loading states. **375 px is a real target, not a nice-to-have.**

**Speed is a graded feature (R7) and this surface has hard budgets:** cold load **<1 s** (AC-85), embeds **<60 s** freshness with **KV TTL 30 s plus an explicit purge on publish** so the budget has headroom (AC-89). Measure, don't assume. AC-sourced budgets fail the run.

Embeds: config screen → copyable snippet + live preview; agenda and speaker-gallery embeds filterable by track and status, responsive, configured colors.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-22.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. Route modules are named `*.routes.ts` (or `*.route.tsx` as the plan's file surface specifies) — whatever you choose, verify the generated manifest and OpenAPI document actually contain your paths before you open the PR. `check:api` fails a route that bypasses the manifest, and routing around it has bitten two prior tickets.

Before the PR: `npm run pr-gate -- --ticket MRQ-22`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
