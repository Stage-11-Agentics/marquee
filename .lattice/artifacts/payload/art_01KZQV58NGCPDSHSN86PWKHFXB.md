# Code Review: MRQ-29 — Quick search

## 1. Verdict

**PASS** — Implementation is correct, matches the plan (including all four Plan-Review Cycle 1 resolutions, one with a documented minor deviation), and meets AC-101 – AC-104. Only minor findings below; none warrant returning the task to rework.

**Scope note:** the review diff was generated against a stale base and includes work already merged to master from other tickets (MRQ-21 conflicts/agenda UI, MRQ-70 vitest split / pr-gate budget / run-test parallelism, MRQ-34 `.lattice` artifacts, `SubmissionParticipationRole` in `src/api/submissions.ts`). I confirmed those files already exist on master (`vitest.node.config.ts`, `src/lib/conflicts.ts` at commits 829b02d / b3672e3) and excluded them from judgment. The MRQ-29 surface reviewed: `src/api/search.ts`, `src/lib/quick-search.ts`, `src/routes/search.routes.ts`, `src/ui/shell/{QuickSearch.tsx,quick-search.css,AppShell.tsx,Topbar.tsx,OverlayHosts.tsx,route-table.ts}`, `src/ui/forms/FormsPage.tsx`, `scripts/checks/speed.ts`, both test files, and `tests/ac-claims/MRQ-29.json`.

## 2. Summary

Reviewed the event-scoped quick-search feature: a manifest-discovered `GET /api/v1/events/{eventId}/search` route with fuzzy ranking, a single shell-mounted overlay wired to `/`, ⌘K, and the topbar trigger, and a real Playwright keystroke-to-painted AC-103 speed harness replacing the prior API-timing placeholder. Quality is high: the authorization scoping exactly mirrors `canReadSubmissionSurface` semantics (verified against `src/lib/auth/program-access.ts` and the role hierarchy in `scope-resolution.ts`), stale-response handling is airtight, and the leakage tests assert both status and content absence with positive controls. Findings are limited to minor UI-affordance, test-brittleness, and process notes.

## 3. Issues

**[MINOR] src/ui/shell/QuickSearch.tsx:141 (result `<kbd>{index + 1}</kbd>`) — Numbered shortcut hints that do nothing**
Each result row renders a `<kbd>` badge showing `1`, `2`, `3`… which reads as a digit-key shortcut, but no keydown handler binds digits (or arrow keys) — the only keyboard path to a result is Tab through the focus trap. A `role="listbox"`/`role="option"` structure without arrow-key navigation or `aria-activedescendant` is also non-idiomatic ARIA. This is a craft/a11y polish item, not an AC breach (AC-101/104 only require open, type, select).
**Fix:** Either wire digit keys (and ideally ArrowUp/ArrowDown + Enter) to select results, or drop the numbered `<kbd>` column so the UI promises nothing it doesn't do.

**[MINOR] src/ui/shell/QuickSearch.tsx:41-49 — One-frame stale flash on reopen**
State reset (`setQuery("")`, `setResults([])`) runs in a `useEffect` keyed on `[open]`, which fires *after* the first paint of the reopened overlay. Reopening after a previous search can flash the prior query/results for one frame before clearing.
**Fix:** Reset state in the close path (before `open` flips true again) or use `useLayoutEffect` for the reset.

**[MINOR] src/routes/search.routes.ts:58-72 — `eventScope`/`formScope` naming undersells what they do**
`eventScope` does not scope by event (the `s.event_id = ?` predicate does); it applies the form-admin restriction to submissions via `s.form_id`. The name invites a future reader to assume event scoping lives there.
**Fix:** Rename to `submissionAdminScope`/`formAdminScope` (or similar) when the file is next touched; no behavior change needed.

**[MINOR] tests/node/quick-search.AC-101-104.test.mjs — Contract asserted by source-regex; `adminRouteTable` export is dead code**
The AC-101 contract test parses `route-table.ts` with a line-oriented regex and asserts source patterns (including matching the literal comment string `final keystroke` in `speed.ts`). The regex parse is guarded by `routeRows.length >= 20`, which mitigates silent row-drops, and importing the TS module from `node:test` without a loader is genuinely awkward — so the approach is defensible. But the newly exported `adminRouteTable`/`isAdminRoute` (src/ui/shell/route-table.ts:44-48) are consumed by nothing at runtime and only regex-detected by the test, and `assert.equal(admin.length, routeRows.length - external.length - 2)` recomputes both sides from the same parse, verifying little beyond reviewer/api-docs being non-external.
**Fix:** Either have a consumer use `adminRouteTable` (e.g., future per-route smoke coverage) or drop the export and keep `isAdminRoute` documentation in the test; consider asserting the specific admin route ids expected rather than a derived count.

**[MINOR] tests/integration/api/search.AC-101-104.test.ts:135-158 — Plan-resolution deviation on misspelling reuse, worth an explicit note in completion evidence**
Cycle-1 resolution 2 says to reuse one of the browser-sample misspellings (`Casy`, `Dhinkran`, `retrieval systms`) in the AC-104 fixture. The Worker test instead builds its own fixture and asserts `sgnal` → "Signal…" results. The spirit is met (a genuine misspelling with a positive assertion against seeded data; the speed-harness misspellings were separately verified against the demo seed — `Casey`, `Dhinakaran`, `retrieval systems` all present), but the letter is not.
**Fix:** No code change required; record the substitution rationale in the Lattice completion comment so the resolution trail stays honest.

**[INFO] Review-diff hygiene** — Regenerate review diffs from the merge-base against current master. Roughly half this diff (all `.lattice/` artifacts, MRQ-21/70 code) is already-merged work, which inflates review cost and risks misattributed findings.

## 4. Positive Observations

- **Authorization scoping is exactly right, not approximately right.** `scopedPersonId = session && !authHasRole(auth, "ops", eventId) ? personId : null` (search.routes.ts:173) precisely complements `canReadSubmissionSurface`: the only principals who pass `requireSubmissionRead` without ops-or-above are sessions holding a `form_admins` assignment, so the scoped SQL clause restricts exactly the population it should — no silent empty-result class exists. Authorization runs before the cache, and scoped sessions deliberately bypass the cache so form-assignment changes take effect immediately (with a comment explaining why).
- **Leakage tests are non-vacuous by construction.** Every negative assertion (401, 403, form-admin restriction) checks both status and the absence of the secret id *and* title in the raw body, and each is paired with a positive control proving the query would have matched — AC-104's stated standard, actually met.
- **Stale-response handling is belt-and-braces.** Eager abort on input, per-effect `AbortController` with cleanup abort, and `controller.signal.aborted` guards in both `.then` and `.catch` — no out-of-order paint is possible, matching the no-debounce resolution.
- **The AC-103 harness is honest.** The old API-timing placeholder is fully removed (including its "not a browser paint claim" caveat), the timer starts before the final keystroke and ends only when `data-search-painted-query` equals the exact term with `data-search-state="ready"`, navigation is asserted unchanged per term, and the seeded misspellings (`Casy`, `Dhinkran`, `retrieval systms`) were verified to match real seed data via the subsequence matcher. The existing `global-search-painted` acceptance budget (200 ms p95 in `speed-budgets.mjs`) gates it without relabeling.
- **Deterministic ranking with a full tiebreak chain** (score → type order → title → id → input index) and a pure, dependency-free matcher module that the prototype contract (NFD fold, punctuation strip, ordered subsequence) maps onto cleanly.
- **Shell changes are genuinely additive.** `Topbar` gains only a data attribute and `aria-haspopup`; all new styling is namespaced `quick-search-*`; the overlay reuses the existing `useDialogLifecycle` (focus trap, Escape, body-scroll lock, focus restoration) rather than reinventing it; the `/portal` / `/reviewer` keyboard exclusion matches their early-return non-admin rendering in `AppShell`.
- **Route conventions respected:** `search.routes.ts` exports `apiRoutes` under the plural `*.routes.ts` glob so `_manifest.ts`/`check:api` discover it with zero manifest edits, and the `FormsPage` `?form=` consumption validates the id against the loaded catalog before selecting it.
