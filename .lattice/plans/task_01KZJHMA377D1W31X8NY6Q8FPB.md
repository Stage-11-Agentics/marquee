# MRQ-29: Quick search

BUILDPLAN: M-28 — Tier B rank 5 (US-67), Wave 2 (§5)

Scope (verbatim): affordance on every admin route, `/` and ⌘K with no navigation, one labelled result list across submissions/speakers/sessions/forms, fuzzy on name and title, <200 ms.

AC-101 iterates **every** admin route in the route manifest — the affordance must be in M-05a's shell, not bolted onto individual screens.

ACs: AC-101 – AC-104
Hours: 4
Workflow: inline-full
Shared files: the search affordance lives in the shell topbar (M-05a's `src/ui/shell/*`) — additive only; do not restyle the shell.
Deps: M-10
Speed: AC-103 is an AC-sourced budget — keystroke → results painted p95 ≤ 200 ms over ≥10 queries including misspellings.

## Approach

1. Add a `GET /api/v1/events/{eventId}/search?q=` route in a new `*.routes.ts` module so the generated API manifest and OpenAPI document discover it automatically. Reuse `requireSubmissionRead` for event/role authorization, restrict explicit form admins to their assigned forms, and query only records linked to the requested event. Return one bounded `data` list whose results carry a stable type label (`Abstract`, `Session`, `Speaker`, or `Form`), id, title, supporting line, and canonical admin href.
2. Add a small pure search helper for the prototype’s NFD/diacritic folding, punctuation normalization, substring matching, and ordered-subsequence fuzzy matching. Rank exact/prefix/substring matches ahead of subsequences, then sort deterministically and cap the response. Query the event’s submissions, participating people, and forms in parallel; do not add a migration because `search_blob` and the event indexes already exist.
3. Build the overlay inside `src/ui/shell/*` and mount it once from `AppShell`, alongside the existing topbar. The topbar button, `/`, and ⌘K all open the same controlled overlay; opening and typing never calls `navigate`, and selecting a result is the only navigation path. Keep the existing shell CSS unchanged and add only scoped quick-search styles. Use an abortable request per query, fixed result-space/loading/empty/error states, an accessible dialog/listbox, focus restoration, Escape/backdrop close, and keyboard result buttons. Form results use `/forms?form=<id>` and the existing FormsPage will honor that query; speaker results use the canonical `/onboarding?person=<id>` target reserved by the route table.
4. Replace MRQ-23’s AC-103 placeholder API timing sample with the real Playwright flow: open the shell, send `/`, type each of the ten existing terms (including misspellings), wait for the result host to report the final query painted, close, and record keystroke-to-painted timings. Keep the existing `global-search-painted` budget id and 200ms classifier so an acceptance breach fails `check:speed`.

## Files and ownership

- `src/api/search.ts` — shared result types and labels.
- `src/lib/quick-search.ts` — pure normalization, fuzzy scoring, ordering, and limit helpers.
- `src/routes/search.routes.ts` — event-scoped authenticated search route; its filename must remain `*.routes.ts` for `_manifest.ts`/`check:api` parity.
- `src/ui/shell/QuickSearch.tsx`, `src/ui/shell/quick-search.css`, `src/ui/shell/AppShell.tsx`, `src/ui/shell/Topbar.tsx`, `src/ui/shell/OverlayHosts.tsx` — one shell-mounted overlay, keyboard/focus lifecycle, and additive scoped styling.
- `src/ui/forms/FormsPage.tsx` — consume the optional `form` query only to select the returned form record.
- `scripts/checks/speed.ts` — real browser paint measurement for AC-103.
- `tests/integration/api/search.AC-101-104.test.ts` — Worker/API positive and authorization/leakage controls.
- `tests/node/quick-search.AC-101-104.test.mjs` — shell wiring, matcher, and speed-harness contracts that do not need a Worker.
- `tests/ac-claims/MRQ-29.json` — own AC-101 through AC-104.

## Verification

- Before implementation: baseline `npm test` is green (39 files, 204 tests, 21.09s; the clean install has already run after rebasing onto `forgejo/master` at `62b8748`).
- After implementation: run the focused API and Node tests, `npm test`, `npm run check:api`, `npm run trace:ac -- --scope all`, and `npm run check:speed`. The speed report must be `status: pass`, contain 10 search samples including misspellings, and show `global-search-painted` as an acceptance pass; do not relabel an API response timing as browser paint.
- Run `npm run pr-gate -- --ticket MRQ-29` before opening the PR and preserve its complete result in the Lattice completion comment.
- For live validation, run the local Wrangler flow in `in_validation`: authenticate the organizer, open at least dashboard/submissions/forms/settings routes, verify the shell remains on the same path after `/` and ⌘K, type a misspelled query, select an Abstract/Session/Form result, and record the observed URL and visible result labels. Reviewer and speaker portal shells remain separate by their signed non-admin contracts; AC-101 applies to the admin route table mounted by `AppShell`.

## Acceptance mapping

- AC-101: one `QuickSearch` mount in the shared admin shell, route-table-wide static contract, `/` and ⌘K with no route mutation, dialog focus/close behavior.
- AC-102: authenticated API and rendered list contain Abstract, Session, Speaker, and Form results in the same labelled list.
- AC-103: the shipped speed harness measures 10 real keystroke-to-painted queries and gates p95 at 200ms.
- AC-104: normalized partial/misspelled name/title matches and result hrefs open the corresponding record; unauthorized/cross-event responses assert both status and absence of ids/titles, with an authorized positive control.

## Risks and non-goals

- No contract documents or AC IDs will be edited. If the current route table’s `/onboarding?person=` target lacks the later chase-board screen, the result will still use that canonical route rather than pulling another module into MRQ-29; this is a handoff dependency, not a second board implementation.
- No individual admin screen will receive search code, no shell restyling will be done, and no API route will bypass the generated manifest.

## Plan review

After this plan is committed and pushed, run the required single plan review. Triage every finding here under an authoritative `## Plan-Review Cycle K Resolutions (AUTHORITATIVE)` block before moving to implementation.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Speaker landing handoff — accept/document:** keep the contract-correct `/onboarding?person=<id>` href and assert it in the API test. Before validation, check MRQ-24; if its chase board is merged, include a live Speaker selection. If it remains unmerged, record in the validation/completion evidence that the canonical href is shipped while the target screen is a documented MRQ-24 handoff, not silently claim a live Speaker record landing.
- **Speed terms — accept/amend:** audit the seed data while implementing and use at least two genuine misspellings of seeded names or titles in the ten-or-more browser samples, alongside a no-match and diacritic probe. Reuse one of those misspellings in the AC-104 fixture and assert that it returns the seeded result.
- **AC-101 route coverage — accept/amend:** the Node contract test will import/read the frontend route table and enumerate its entries, filter only admin routes mounted by `AppShell` (exclude `external` portal/event-site entries and utility/API-doc routes that do not render an admin screen), and assert the single shared QuickSearch mount covers every remaining route. The exclusion is explicit because those rows use separate/non-admin contracts.
- **Debounce — accept/amend:** do not debounce input; issue an abortable request for each non-empty query and ignore stale responses. The speed harness starts timing immediately after the final keystroke for each term and waits for the result host to paint that exact query.
