# Code Review: MRQ-41 — Empty-state pass and craft sweep

**Reviewed HEAD:** `cfae31b717b14be810d20921e7d40d9de82f67ea` (branch `mrq-41-craft`, 3 commits over base `beadf6c`)

**Note on review inputs:** the diff embedded in the review prompt was 52,909 lines, truncated at 5,000 — and every visible line was `.lattice/` artifact bookkeeping swept in by a stale diff base, with zero implementation code shown. This review was therefore performed against the actual worktree: `git diff beadf6c..cfae31b -- . ':!.lattice'` (33 files, +153/−50). Future review dispatches for this run should exclude `.lattice/` from the diff or narrow `--base`, or reviewers will be grading bookkeeping noise.

## 1. Verdict

**PASS**

## 2. Summary

Reviewed the full MRQ-41 implementation: a fresh-install empty-state pass across all admin, reviewer, portal, public, and embed surfaces (M-48) plus the craft sweep — reserved geometry, tabular numerals, `—`/textual placeholders, filter-driven vs. truly-empty copy split, and one-primary-per-screen discipline (M-49). The work is disciplined, scoped exactly to owning component/style modules (no `tokens.css`, no contract docs), and independently verified green: the focused AC-161 test, the full hermetic suite (58 node checks + Vitest, 13.7s), `check:design`, `tsc --noEmit`, and `npm run pr-gate -- --ticket MRQ-41` all pass at this exact HEAD. Three minor findings below; none block.

## 3. Issues

**[MINOR] src/ui/comms/CommsScreen.tsx:180,198 — Failed load renders "empty" copy as if the state were known**
When the templates/outbox fetch rejects, `.finally()` clears `templatesLoading`/`messagesLoading`, so the panels fall through to "No conference templates yet…" and "No messages queued yet…" with their calls to action — beneath the inline error banner. The panel copy asserts an empty catalog the system never actually read; the Flight Deck rule is honest states, and an outage is not an empty state.
**Fix:** Gate the empty copy on `!error` — when `error` is set, keep the panels in a neutral "Communications is unavailable" placeholder (or render nothing beyond the banner) rather than the fresh-install copy.

**[MINOR] src/ui/agenda/AgendaPage.tsx:621 — Full page reload for an internal navigation**
The agenda's fresh-install empty action uses `window.location.assign("/submissions?status=accepted")`, while every comparable surface (dashboard, board, onboarding) threads the SPA `navigate`. This works, but it's a full document reload on a route transition in a project where speed is a graded feature (R7) and the only such inconsistency introduced by this diff. Root cause: `AgendaPage` doesn't receive a `navigate` prop.
**Fix:** Thread `navigate` into `AgendaPage` from the shell (as `ProgramBoardPage` does) and use it for this action. Fine to fold into a later ticket touching the agenda.

**[MINOR] tests/node/empty-state.AC-161.test.mjs:747–761 — Marker assertions are looser than the test names claim**
The inventory test asserts each marker string appears *somewhere in the file*, not that it renders inside the empty branch — e.g. "+ Add format" in `EventSettings.tsx` matches the always-visible header button, not the new `settings-list-empty` block (which itself ships no action, relying on that adjacent header button). And the "positive control" test only proves a regex fails against a hardcoded string; it exercises none of the inventory logic, so it doesn't guard the first test against drift (though that test can't pass vacuously anyway — the surface list is hardcoded and `readFile` throws on a missing path). Acceptable as cheap supporting evidence — the plan correctly routes visual proof to the runtime walkthrough — but the safety net is thinner than the test names suggest.
**Fix:** No rework required for this ticket. If hardening later: assert the marker within the empty-branch construct (e.g. require it in the same expression as the `length === 0` / `length ?` guard), and drop or replace the positive-control test with one that feeds a doctored surface through the real assertion.

## 4. Positive Observations

- **The shared `EmptyState` stable-slot change is the right primitive.** Always rendering `<div class="empty-state-action">` with `min-height: 30px` means an action appearing or disappearing never moves the heading/copy above it — the house "elements never jump" rule implemented once, at the component, not per-callsite. The added `class` passthrough is used tastefully (`program-board-empty-state` flattens the card-in-card chrome via a correctly-scoped `.program-board-card-shell >` selector — verified the class exists).
- **Filter-empty vs. truly-empty is distinguished everywhere it matters** — board, agenda list, onboarding, public agenda, both embed kinds — with different copy *and* different actions (Clear filters vs. the constructive next step). The embed/public fallback links were verified safe: `/agenda` with no event query resolves via `findLiveEvent`'s no-slug fallback.
- **One-primary-per-screen was actually swept, not just added to.** FormsPage's catalog EmptyState button was *demoted* from primary because the PageHeader already carries the primary "+ New form"; DashboardPage conditionally demotes "Work the pipeline →" exactly when the empty-program `EmptyState` takes over the primary "+ Add session". That's the discipline reading in both directions.
- **Title truncation moved from `nowrap` ellipsis to two-line clamps with reserved min-heights** (board cards, submissions table, portal talk/hero headings, `overflow-wrap: anywhere`) — preserves distinguishing text for long/diacritic titles while keeping row heights constant, both explicit plan goals.
- **AC ownership seam handled exactly as planned:** `tests/ac-claims/MRQ-41.json` uses `owns: []` / `exercises: ["AC-161"]` with an explicit note deferring to MRQ-40 (confirmed MRQ-40 owns AC-161) — no duplicate-owner conflict, and the merged AC trace in the pr-gate passes.
- **Scope hygiene is clean:** shared `src/styles/components.css` touched only for the EmptyState slot (not `tokens.css`), no contract documents edited, and the "MRQ-8 list contract" internal ticket vocabulary was scrubbed from user-facing copy — a small catch squarely in the plan's "no implementation vocabulary" item.
- **Venues gained a real dependency affordance:** "+ Add room" disables until a building exists, and the room empty copy explains why — an empty state that teaches the order of operations.

One handoff note for the validation stage: the plan's required cold populated/empty browser walkthrough is not yet evidenced in the Lattice store (only plan-review artifacts reference MRQ-41 so far). All command-line gates were independently re-run and pass at this HEAD; the runtime walkthrough remains the validation phase's checkpoint, per the plan's own sequencing.
