FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-16-portal" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-16** (BUILDPLAN **M-15** — the speaker portal; walkthrough step 6). Actor: `agent:delegator-mrq-16`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-16-portal`, branch `mrq-16-portal`, cut clean off `forgejo/master` (`b50f067`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-16 --json` → `.data.id`) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. **Headless reviews are suspended** — self-review inline, attach a standard-shape review naming your exact HEAD.

**Push `mrq-16-portal` to Forgejo as soon as it has its first commit**, and after every meaningful commit after that. Do not wait for the PR. **Write your plan to the plan file early and in rough form** rather than holding it in context — a compaction mid-planning loses the whole window.

## The ownership boundary is the point of this ticket

Read `lattice show MRQ-16 --json` in full. Its own words: *"Three tickets writing `src/ui/portal/*` against one AC is exactly the failure §7 exists to prevent, and an AC owned by everyone is owned by no one when `trace:ac` asks who covers it."*

**You render slots. You do not fill them.**
- **You do NOT own AC-235/236** — you render the decision-feedback slot that MRQ-33/M-52 fills.
- **Role confirm/decline is M-42's** (AC-152–154) — do not duplicate it here, not even in prose.
- Do not claim their IDs in test names.

**Your ACs: AC-43 – AC-52, AC-237, AC-240**, plus **AC-233 (Speaker Handbook) which is cuttable if named** — it is the one cut-line criterion sitting on a Tier A story, so if you cut it, say so explicitly in your PR body so gate 19 can name it.

## Scope

Status hero with a concrete wave and slot; a task list where acknowledge / form / file tasks **open and validate their actual payload surface** (not placeholder buttons); profile and headshot edit; organizer-controlled talk title/description edit with history; handbook pages.

File surface: `src/routes/portal.routes.ts`, `src/ui/portal/*`.

## What you inherit — build on it, do not reinvent

- **MRQ-3** — auth, magic links, sessions, and the speaker membership. A speaker reaches the portal through a real session, not a guessable URL. **This is a public-facing authenticated surface: prove the guardrail.** A speaker must see only their own tasks, submissions, and profile. Assert **both** the status code **and** the absence of another speaker's data in the body — a status-only assertion passes while the leak ships. I hand-review this at merge.
- **MRQ-13 (merged)** — the form builder and `src/lib/form-conditions.ts`. Your form-kind tasks render through **`isFieldApplicable()`**; a hidden conditional field is neither shown nor required. Never hardcode an alternate form, and never write a second evaluator — add to `form-conditions.ts` if you need more, and say so in your PR body.
- **MRQ-14** — uploads: presign, verify, serve. Your headshot and file tasks use that path rather than a new one.
- **MRQ-12** — mail and the demo-safe outbox. **Exactly two `always_live` write sites exist and you are not a third.**
- **MRQ-62 (merged)** — venue geography. If you surface a location, it renders **"Room · Building"** (AC-252). **Building `access_note` is operator-facing and stays off any public surface** (AC-253) — note that MRQ-64 owns the portal *location card* that deliberately shows arrival instructions to the confirmed speaker, so leave that slot to it rather than inventing one.

## Craft — this is a real person's first impression

`PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. **Elements never jump** — a task moving to done must not resize the list; reserve space, fixed-width buttons, "—" instead of removed rows, tabular numerals. Honest empty, loading, and error states. **AC-240 is real-ugly data** — long diacritic names, titles that truncate. The organizer's noun in UI copy is **"conference"** (the wire API keeps `/api/v1/events/...` deliberately — SPEC Amendment 13). A speaker who has finished everything should see that clearly, not an empty list.

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-16.json`**. `trace:ac` blocks merge on uncovered `auto` ACs. After any rebase run `npm ci` before trusting a red test — never `npm install --no-save`. JSON route modules are named `*.routes.ts`; verify your paths reach the generated manifest and OpenAPI document before opening the PR (`check:api` fails a route that bypasses it).

Before the PR: `npm run pr-gate -- --ticket MRQ-16`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
