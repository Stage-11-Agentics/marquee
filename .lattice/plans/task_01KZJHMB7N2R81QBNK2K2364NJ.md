# MRQ-41: Empty-state pass and craft sweep

BUILDPLAN: M-48 + M-49 — cross-cutting (§5), run alongside, not after · MERGED at mint (3 h + 3 h = 6 h; both are one sweep over every route with no dependencies, and doing them in one pass is how the sweep stays coherent)

**M-48 — Empty-state pass** (3 h)
Scope (verbatim): every route renders an empty-state component naming the next action on a fresh install (AC-161).

**M-49 — Craft sweep** (3 h)
Scope (verbatim): elements never jump (reserved space, fixed-width toggles, `—` over removed rows, tabular numerals), one primary action per screen, textual state markers everywhere colour is used.
This is the house UI rule stated as a ticket: toggling a control must never shift another element. Textual state markers matter to a dozen ACs that say "text, not colour alone" (AC-23, AC-42, AC-49, AC-120, and the agenda's AC-81).

ACs: AC-161 (M-48) · M-49 carries no AC of its own but underwrites every "not colour alone" assertion and felt checkpoint C3
Hours: 6 (3 + 3)
Workflow: inline-full
Shared files: touches every module's own styles — **never `src/styles/tokens.css`** (M-05a owns it; token changes go through the orchestrator).
Deps: none listed in the plan's cross-cutting table (runs alongside; in practice it sweeps whatever has landed)
Audit that keys off this ticket: A-2 (PROTOTYPE-badge sweep), after M-49
Plan: filled in by delegator's plan phase

## MRQ-41 implementation plan

### Contract and constraints

- Deliver M-48 (fresh-install empty states with a concrete next action) and M-49 (craft sweep) across the shipped admin, reviewer, speaker-portal, public, embed, and fallback route surfaces.
- Preserve the signed Flight Deck language: organizer vocabulary uses “conference”, empty/loading/error states are deliberate, and each screen has one obvious primary action.
- Apply craft changes in the owning component/style modules only. Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, `sequence/USER_STORIES.md`, or `src/styles/tokens.css`; do not restructure shared API/job seams or rename shared modules.
- Treat this as a visual/runtime task: source checks are supporting evidence, while a populated and empty route walkthrough plus built output are required validation.

### AC ownership seam

The ticket description names AC-161, but `tests/ac-claims/MRQ-40.json` already owns AC-161. MRQ-41 will not create a duplicate owner. Its claim manifest will use `owns: []`, `exercises: ["AC-161"]`, and an explicit note naming MRQ-40 as the owner while this ticket supplies the UI sweep. If the orchestrator reassigns ownership, update the manifest only with that direction; do not alter MRQ-40's file opportunistically.

### Route and state inventory

1. Establish the concrete route map from `src/ui/shell/AppShell.tsx`, `src/ui/shell/route-table.ts`, public route entrypoints, `src/ui/review/ReviewerPage.tsx`, `src/ui/portal/PortalPage.tsx`, and `src/ui/embeds/EmbedPage.tsx`.
2. For every collection/list branch, record its populated, empty, loading, and error rendering. Empty branches must name what is absent in conference language and expose the next action (or a clear reset/back action when the empty state is filter-driven).
3. Include the shared fallback for routes whose module is not installed: it must remain honest and provide a single return-to-home action rather than a dead-end card.

### Implementation sequence

1. **Shared primitives and shell stability.** Extend the shared `EmptyState` contract so its action area has a stable slot even when no action is present, expose an accessible heading/status relationship, and give shared buttons, chips, switches, counts, and page-head actions final-size/reserved geometry. Keep `Switch` keyboard/text semantics intact; visible state must not depend on color alone.
2. **Admin surfaces.** Sweep submissions and record/editor flows, dashboard, program board, onboarding/chase, evaluation, review, agenda, communications, forms, import, conference settings, venues, API tokens, quick search, and fallback utility routes. Add or correct deliberate empty actions, `—` values for removed/unset rows, fixed-width busy labels, and tabular numerals without changing the underlying data/API contracts.
3. **Public and participant surfaces.** Sweep the public CFP/form errors and empty collections, public agenda, embeds, reviewer queue, and speaker portal. Keep remedial copy actionable and avoid exposing internal field names, status codes, ticket IDs, or implementation vocabulary.
4. **Craft details.** In each owning CSS module, reserve space for conditional badges/chips/counts/validation messages, prevent label changes from moving neighboring controls, preserve long/diacritic titles without hiding their distinguishing text, and pair color-coded states with text/ARIA. Do not centralize a token change in `tokens.css`.

### Evidence and tests

- Add `tests/ac-claims/MRQ-41.json` with the ownership note above and exercise AC-161 from the new focused test.
- Add a focused `tests/node` contract test named with `AC-161` that inventories the route entrypoints/fallback and asserts every empty-install path has a rendered empty component plus an actionable link/button; include positive controls so the check cannot pass vacuously.
- Run the focused node tests, `npm test`, `npm run check:design`, and `npm run pr-gate -- --ticket MRQ-41` from this worktree. Keep the default suite hermetic and within the repository budget.
- Build the app and perform a cold populated/empty walkthrough of every route family using the c11 embedded browser when available. Record route/state coverage and any runtime console or layout findings as validation evidence; do not claim visual proof from static source alone.
- Self-review the final diff for contract-file/token edits, duplicate AC ownership, public-repo hygiene, dead-end empty states, status-by-color-only UI, and uncontrolled label/height shifts. Attach a PASS review artifact against the final HEAD before opening the PR.

### Phase stop / handoff

After this plan is committed and pushed as the first commit: move MRQ-41 to `planned`, then `in_progress`; implement in small commits; move through `review` and `in_validation` with review and validation evidence; run the mandatory gate; push; open the Forgejo PR against `master`; attach the PR reference; bump only to terminal `pr_open`; and send the final one-line state to the Orchestrator at workspace:9 / surface:60.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Accepted and fixed — `src/ui/comms/CommsScreen.tsx` empty-vs-outage copy.** A failed templates/outbox read must not fall through to fresh-install empty copy; the implementation will keep the panels neutral while the shared error banner offers Retry.
- **Accepted as non-blocking — `src/ui/agenda/AgendaPage.tsx` internal navigation.** The fresh agenda action currently uses a full-page navigation because the page has no SPA `navigate` prop. Threading that prop would be a structural shell change; the action is functional and remains outside this surgical sweep.
- **Accepted as supporting-test limitation — `tests/node/empty-state.AC-161.test.mjs` marker locality.** The inventory test is intentionally a cheap contract check; it does not replace the rendered route walkthrough, which is the authoritative validation for branch-local placement and layout.

## Reset 2026-08-11 by agent:delegator-mrq-41

## Reset 2026-08-11 by agent:delegator-mrq-41
