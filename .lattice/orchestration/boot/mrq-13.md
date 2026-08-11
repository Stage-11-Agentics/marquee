FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-13-forms" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-13** (BUILDPLAN **M-12** — form builder, catalog, and condition evaluator; ~10h, the longest single ticket in the plan). Actor: `agent:delegator-mrq-13`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-13-forms`, branch `mrq-13-forms`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-13 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

## You own a contract three later tickets inherit

Read the full scope with `lattice show MRQ-13 --json`. Two things make this ticket load-bearing rather than merely large:

1. **`src/lib/form-conditions.ts` is created here and added to, never rewritten, by MRQ-15, MRQ-33/34, and later comms work** (SPEC §7 shared-helper rule). Design `isFieldApplicable()` and the `form_fields.condition` schema shape as a contract others extend — not as something convenient for the builder screen alone. Name the shape in your PR body.
2. **A hidden field is neither required nor persisted — enforce that on the server, not only in the client.** Client-side show/hide that the API still validates against is a guaranteed bug the moment MRQ-15 puts the form on a public surface. Prove both halves with tests: a submission omitting a hidden-conditional field succeeds, and a value sent for a hidden field is not written.

ACs: **AC-17 – AC-21, AC-24, AC-27 – AC-33, AC-132, AC-133, AC-234.** MRQ-15 exercises AC-132/AC-133 on the public surface but **you own those IDs for `trace:ac`**.

## Build on what is merged

- **MRQ-8** — the API core: generated route manifest (glob over `*.routes.ts`, never hand-edited), error envelope, list contract (`page/per_page/q/sort/filters` → `{data, page, per_page, total}`), pagination helper. Use the list contract as-is for the form catalog; do not invent a second pagination shape. `check:api` fails any route that bypasses the manifest.
- **MRQ-60/61** — auth is now wired into the API runtime. Form authoring is admin-scoped; resolve the principal through the credential resolver rather than inventing a new path.
- **MRQ-6** — Flight Deck tokens, admin shell, check harness. **MRQ-14** — uploads (presign/verify/serve), which your file-type field builds on rather than reimplements.

## Craft rules that apply directly here

`PHILOSOPHY.md` and `DESIGN.md` bind. **Elements never jump** — the live preview sits beside the editor and must not reflow the editor as fields are added; reserve space, fixed-width toggles, "—" instead of removed rows. The **immutable post-open target** is a real constraint, not a warning: once a form is open, the target cannot change, and the UI should make that legible rather than failing at save. The organizer's noun in UI copy is **"conference"**, not "event" — the wire API keeps `/api/v1/events/...` deliberately (SPEC Amendment 13).

Seeded baseline must visibly include: title/abstract/outcome/format/multi-track, primary speaker profile/headshot, co-speaker, supporting file, and the **conditional vendor field** — that last one is the evaluator's demo.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-13.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. Route modules are named `*.routes.ts`.

Before the PR: `npm run pr-gate -- --ticket MRQ-13`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
