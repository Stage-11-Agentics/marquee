FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-75-widgets" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd via c11 send to workspace:9 surface:177 — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. **Remote is `github`, base branch `main`; Forgejo is retired — never reference it.** Your ticket: **MRQ-75** (public widgets: sessions + CFP embed kinds, speaker layouts, and the protected re-band; ~5h). Actor: `agent:delegator-mrq-75`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-75-widgets`, branch `mrq-75-widgets`, cut clean off `github/main @ 030a3a7`. Run `npm ci` before trusting any test result.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path, uuid from `lattice show MRQ-75 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Commit and push your PLAN as your first commit, before any code. Self-review inline; attach a standard-shape review naming your exact HEAD.

## Why this ticket exists

A collaborator flagged that the competition rubric weights **Public Widgets as a joint-heaviest area** while embeds sat in the cuttable band. Client ruling 2026-08-11: protect and widen. You are turning the two shipped embed kinds into four widget families and folding the contract to match.

## Scope

`lattice show MRQ-75 --json` carries the full description — it is your scope of record. Summary:

1. **AC-273** — new `sessions` embed kind: flat published-session list (title, track, time), filterable by track/status exactly like the agenda kind, same KV cache/purge path.
2. **AC-274** — `layout=cards|list` on the `speakers` kind, chosen in the dialog, carried in the snippet URL; both layouts responsive per AC-90.
3. **AC-217 + AC-218** (US-16, promoted to live in-scope) — new `cfp` embed kind: form deadline, formats, link to the public form; flips to its closed state automatically, no republish.
4. **Mechanical contract folds in the same PR**: SPEC Amendment 18 (§5.12 formats + params, `embeds.kind` enum widened, AC-87–90 noted protected), EVALUATION (+4 `auto` rows, header counts +4, §6 risk row 2 closed as resolved-built, amendment note), BUILDPLAN (next free amendment number, one ~5h milestone, dep M-21/MRQ-22). **Do not touch AC-270–AC-272 — reserved.**

## Binding design contract

`prototypes/pipeline-v1.1/index.html` **v1.10** — open it, go to the public agenda (Conference site → `Get embed code`), and reproduce the dialog one-to-one: four-format segment (Agenda | Sessions | Speakers | Call for speakers, equal flex widths), Track select + Layout segment always present (inapplicable ones **disable, never disappear** — elements never jump), snippet URL carrying `track`/`layout` query params, per-format live preview. `DESIGN.md` and `PHILOSOPHY.md` bind as always.

**Prototype and `sequence/USER_STORIES.md` are already updated (Amendment 18) — treat both as read-only inputs. Do not re-edit them.**

## Build on what's merged

MRQ-22 shipped `src/routes/embed.route.tsx` + `src/ui/embeds/EmbedPage.tsx` with kinds `agenda|speakers`, the KV 30s TTL + purge-on-publish path, and the config page. Extend that surface; do not fork a second embed pipeline. Embed routes stay **anonymous-only** (never read `mq_session`, never vary by identity — SPEC §5.12; asserted under A-5).

## Evidence required

AC-tagged tests under `tests/` naming AC-217, AC-218, AC-273, AC-274, plus `tests/ac-claims/MRQ-75.json`. `trace:ac` blocks merge on uncovered `auto` ACs. Validate for real — drive the running embeds with the c11 embedded browser (load the `c11-browser` skill) against `wrangler dev`, including: sessions kind filtered by track, speakers in both layouts at 375px and 1440px, and the cfp kind in open and closed states (flip the form close date to prove AC-218). Attach that evidence with `--role validation`.

Before the PR: `npm run pr-gate -- --ticket MRQ-75`, paste the result into your completion comment. Then push, open the PR (`gh pr create --repo Stage-11-Agentics/marquee --base main`), bump `pr_open`, and c11-send your completion summary to **workspace:9 surface:177** (Gap Investigation — surface:60 is retired).
