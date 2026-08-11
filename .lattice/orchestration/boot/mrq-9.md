FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-9-submissions" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-9** (BUILDPLAN **M-08** — first loop screen: the submissions list; inline-full, ~4h). Actor: `agent:delegator-mrq-9`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-9-submissions`, branch `mrq-9-submissions`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path, uuid from `lattice show MRQ-9 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless plan-review and code-review are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

## You are the first screen a judge actually drives

Scope from `lattice show MRQ-9 --json`: a server-side filtered, sorted, paginated list at 50/page over the seed, with type/status/track filters. ACs: **AC-23, part of AC-66**, and the foundation for **AC-240, AC-247–249**.

Everything you need is already merged, so build on it rather than reinventing:

- **MRQ-8 (`c4e34037`)** — the API core: the generated route manifest (glob-based, never hand-edited), the error envelope, the **list contract** (`page/per_page/q/sort/filters` → `{data, page, per_page, total}`), the pagination helper, the bulk selector type, and the `json_each` chunking helper. **Use the list contract as-is; do not invent a second pagination shape.** `check:api` asserts registry/OpenAPI parity and will fail you for a route that bypasses the manifest.
- **MRQ-6** — design tokens (Flight Deck), the admin shell, and the check harness. The prototype at `prototypes/pipeline-v1.1/index.html` is the **binding visual contract**; reproduce it, don't redesign it. Monospaced tabular figures for every count.
- **MRQ-2** — the full D1 schema. **MRQ-4** — the seeded 60-session accepted core.

## Craft rules that apply directly here

`PHILOSOPHY.md` and `DESIGN.md` bind: **elements never jump** (reserve space, fixed-width toggles, "—" instead of removed rows), one obvious primary action, honest empty/loading/error states, and **real-ugly data always** — long diacritic names, truncating titles, 1,000-row lists. **Speed is a graded feature (R7):** this list is the screen most likely to feel slow, so measure it. AC-sourced speed budgets fail; the seven client-signed objectives warn only.

The organizer's noun in UI copy is **"conference"**, not "event" (rename `9e8b425`). The wire API keeps `/api/v1/events/...` — that is deliberate, see **SPEC Amendment 13**.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-9.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. Validate for real — drive the running list with the c11 embedded browser (load the `c11-browser` skill) or curl the endpoints against `wrangler dev`, and attach that evidence with `--role validation`.

Before the PR: `npm run pr-gate -- --ticket MRQ-9`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
