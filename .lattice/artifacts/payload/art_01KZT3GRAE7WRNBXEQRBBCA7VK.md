# Plan Review: MRQ-98 — submissions list stability, speed, search, saved views

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

I reviewed the MRQ-98 plan against the ticket, the live source (`src/ui/submissions/SubmissionsPage.tsx`, `src/ui/submissions/submissions.css`, `src/ui/shell/router.ts`, `src/ui/shell/QuickSearch.tsx`), the test harness under `tests/`, and the actual git topology of the worktrees. The plan has the right instincts — correct ownership boundary, correct stretch-goal sequencing, no new caching layer, flex-based widening rather than a hardcoded width — but it rests on three factual errors about the current tree, each independently verifiable and each large enough to derail the pass.

The three: (a) the `mrq-98-submissions-ux` branch is based on a commit that is **not in `main`**, so the PR would carry an unrelated commit and be missing four; (b) the "existing reserved-body discipline" the plan proposes to *keep* does not exist — the table reserves 430px against a 50-row body of ~2,900px, which is the shake itself; (c) the plan promises behavioral regression tests (cancellation, out-of-order responses, focus/caret, toolbar sizing) that **cannot be written in this repo's harness** — every UI test in `tests/node/` is a regex over the `.tsx` source text, there is no DOM renderer, and `tests/e2e/` does not exist.

## 3. Issues

---

**[CRITICAL] "Scope and base" — the MRQ-98 branch is not based on `main`, and the PR would carry someone else's commit**

The plan says: *"Use a separate `mrq-98-submissions-ux` worktree based on its current committed tip so the eventual MRQ-97 rebase stays small."* That worktree already exists and is based exactly as described — and the result is the opposite of a tight diff:

```
$ git worktree list | grep mrq-9[78]
.../Marquee-worktrees/mrq-97-accepted-filter    9b59c97 [mrq-97-accepted-filter]
.../Marquee-worktrees/mrq-98-submissions-ux     9b59c97 [mrq-98-submissions-ux]

$ git merge-base --is-ancestor 9b59c97 main   → NO

$ git log --oneline main..mrq-98-submissions-ux
9b59c97 Publish policy: the development record ships, third-party sources do not
        (scripts/checks/repo-policy.mjs | tests/node/check-repo.test.mjs)

$ git log --oneline mrq-98-submissions-ux..main
ce67ead Board: MRQ-98 and MRQ-99 from the operator's live-site feedback pass
ce07f22 CLAUDE.md: the primary checkout is the board's home, not a workspace
f24e6e2 Commit the live Lattice board: the primary checkout is the board's home
9e1636c A bot gate on the demo conference is a gate against our own grader (#42)
```

A PR from this branch against `main` will show the publish-policy change to `scripts/checks/repo-policy.mjs` and `tests/node/check-repo.test.mjs` as part of MRQ-98's diff, and the branch is four commits behind — including the commit that mints MRQ-98 on the board. This directly violates the ticket's *"Keep your diff tight so that is cheap"* and the AC *"PR open against `Stage-11-Agentics/marquee` `main`."* The stated rationale (basing on MRQ-97's tip makes the rebase small) does not hold either: `9b59c97` is not MRQ-97 work — it is an unmerged publish-policy commit that both branches happen to sit on.

**Recommendation:** Rebase the branch onto `main` before writing any code: `git -C ../Marquee-worktrees/mrq-98-submissions-ux rebase --onto github/main 9b59c97`. Verify `git log --oneline main..mrq-98-submissions-ux` is empty before the first commit and again before opening the PR. State in the plan that the base is `github/main`, and that the MRQ-97 rebase happens *after* MRQ-97 merges, not by pre-branching from it.

---

**[CRITICAL] Approach step 6 — the promised regression tests cannot be written in this harness**

Step 6 commits to *"focused regression coverage for query continuity/cancellation/deduplication, dynamic placeholder and toolbar sizing, progressive search ordering/focus, and saved-view confirmation/reachability."* None of that is expressible in the current test infrastructure:

- Every UI test for this page is a **source-text regex**. `tests/node/views-ui.AC-134-248.test.mjs:6` does `readFileSync(".../SubmissionsPage.tsx")` and then `assert.match(submissionsPage, /disabled=\{column === "title"\}/)`. Same pattern in `empty-state.AC-161.test.mjs`, `venue-disclosure.AC-263.test.mjs`, `decided-not-notified.AC-268-269.test.mjs`.
- There is no DOM renderer anywhere: no `jsdom`/`happy-dom` (`vitest.node.config.ts:10` sets `environment: "node"`), no `@testing-library`, no `preact/test-utils`, and no test file calls `render(`.
- `tests/e2e/` **does not exist**, though `playwright.config.ts:4` points `testDir` at it. `npm run e2e` has no specs, and would additionally need `MARQUEE_E2E_URL` and a running server.
- The one seam that would let a test drive the component — `initialEnvelope` — **disables fetching entirely** (`SubmissionsPage.tsx:398`, `if (initialEnvelope) return;`), so it cannot exercise cancellation, dedup, or response ordering by construction.

A regex test asserting `/AbortController/` appears in the file is not coverage of out-of-order response handling; it is coverage of the word "AbortController".

**Recommendation:** Decide the testing strategy in the plan, explicitly, before implementing. The cheapest option that actually tests behavior: extract the pure logic into a module — e.g. `src/ui/submissions/list-request.ts` exporting `requestKey(params)` (canonicalization for dedup) and a small `latestOnly`/sequence-guard helper — and unit-test those under `tests/unit/` with real assertions, leaving only wiring in the `.tsx`. Keep the source-regex tests for the wiring (that is the house style), but do not describe them as behavioral coverage. If you want a real end-to-end proof of no-jump and no-blank-gap, that is the browser validation in step 7 — say so, and do not double-count it as a suite test.

---

**[CRITICAL] Approach step 2 — "keep the existing reserved-body discipline" describes a mechanism that does not exist**

The plan says: *"Keep the table card's existing reserved-body discipline for the 50-row page."* There is no such discipline. What exists is:

- `submissions.css:56` — `.submissions-table-wrap { min-height: 430px; }`
- `submissions.css:92` — `.state-row td { height: 300px; }`
- `submissions.css:59` — `.submissions-table td { height: 58px; }`

50 rows × 58px ≈ **2,900px** of body against a **430px** floor. The reserved placeholders the ticket points at (`"Selection space reserved"`, `"Export status space reserved"`, `"Bulk action status space reserved"` — lines 556, 595, 597) reserve the *status strips*, not the table body. So the collapse from ~2,900px to 430px **is** the operator's "it shrinks just a little bit and the whole thing shakes." A plan that proposes to preserve this is proposing to preserve the defect.

Worse, the plan's actual fix — preserving the last envelope — is explicitly scoped to non-initial requests ("Keep the last successful rows visible during **every non-initial request**"). On first load there is no previous envelope, so the 430px→2,900px snap survives untouched. The operator's complaint *"whenever it loads everything appears at once"* covers exactly that path.

**Recommendation:** Rewrite step 2 to say what is actually being built. Two things, named separately: (1) **stale-while-revalidate** for subsequent queries — keep `state.envelope` and add an `isRefreshing` flag rather than replacing the state with `{kind:"loading"}` at `SubmissionsPage.tsx:402`; (2) a **first-load skeleton** that renders N placeholder rows at the real `58px` row height so the initial paint lands at approximately the final height. Pick N from the page's own signal (`per_page`, capped by viewport) and state the number in the plan.

---

**[MAJOR] Approach step 2 / Judgment calls — the height tension is never named, so the fix is under-specified**

Preserving stale rows does not eliminate the shift; it relocates it. Switching from a 50-row result to a 7-row result still collapses the body by ~2,500px at the moment the new envelope commits. Conversely, reserving a fixed 50-row height leaves a large empty box under small result sets. This is the central design decision of complaint #1 and the plan does not acknowledge it exists, so the implementer will discover it mid-pass and improvise.

**Recommendation:** State the rule in the plan. A defensible one: reserve the body at `max(incoming rows, min(previous rows, per_page)) × 58px` only for the duration of the in-flight transition, then release to natural height once the new rows are painted — so the *transition* never jumps, and settled content is honest about its size. Whatever rule you pick, write it down and put it in the PR description, because it is the thing a reviewer must judge.

---

**[MAJOR] Approach step 7 — screenshots cannot verify the primary acceptance criterion**

The AC is explicit: *"no visible layout shift — verify by recording the transition, **not by reasoning about the CSS**."* Step 7 offers *"capture screenshot(s) and record measured layout/latency observations."* Two still frames of a stable start and a stable end are exactly compatible with a violent shift in between; this is the failure mode the AC was written to forbid.

**Recommendation:** Add a layout-shift instrument to the plan. In the browser, a `PerformanceObserver({ type: "layout-shift", buffered: true })` accumulating `entry.value` for non-`hadRecentInput` entries across a view switch gives a single before/after number that is falsifiable and pasteable into the PR. Pair it with an actual screen recording of one view switch. Target: cumulative shift ≈ 0 for the switch.

---

**[MAJOR] Approach step 2 — the saved-view strip has its own fetch and is not covered by envelope preservation**

The plan promises *"the toolbar, saved-view strip, and row area retain their geometry"*, but the only mechanism it proposes is preserving the **list** envelope. The saved-view strip is fed by a **separate** request (`SubmissionsPage.tsx:244–267`) with its own `viewsLoading` window, and `.saved-view-chips` is `flex-wrap: wrap` (`submissions.css:10`) inside a `min-height: 52px` strip. When views arrive and the chips wrap to a second line, the strip grows and pushes the toolbar and the entire table down — a shift the list-envelope fix does nothing about.

Two more independent shifters on the exact interaction the operator complained about ("when I click on like different one view"):

- `SubmissionsPage.tsx:557` — `{notifiedQueue && <div class="notify-message" …>}` mounts and unmounts an 18px-plus-margin element when switching to/from "Decided · not notified". It is a *reserved* element that is itself conditionally present, which defeats the reservation.
- `SubmissionsPage.tsx:550–553` — the `PageHeader` copy swaps between `"Loading the conference submission register…"` and a much longer sentence; at narrower widths that is a wrap-count change above everything else on the page. (Envelope preservation does fix this one — worth saying so.)

**Recommendation:** Add these three to step 2 by name. Reserve the saved-view strip's height for its worst realistic chip count (or render skeleton chips during `viewsLoading`); render the `notify-message` div unconditionally and toggle only its `visible` class, matching the pattern already used by `export-message` at line 556.

---

**[MAJOR] Approach step 3 — search-as-you-type collides with the router in three specific ways the plan does not name**

The plan says *"preserve the existing submit button, focus, and caret"* but does not identify the mechanisms that will break them. All three are in the current code:

1. `src/ui/shell/router.ts:22–24` — `navigate` does `window.history.pushState(...)` **and** `window.scrollTo(0, 0)`. A debounced search that routes through `updateQuery` (`SubmissionsPage.tsx:294–301`) will push one history entry per typing pause — the back button becomes a per-keystroke undo — and will scroll the operator to the top of the page mid-sentence.
2. `SubmissionsPage.tsx:388` — `useEffect(() => setSearchDraft(q), [q])` re-seeds the input from the URL every time `q` changes. Once typing drives `q`, this effect fires against the live input and is the most likely source of caret jumps and dropped characters.
3. `SubmissionsPage.tsx:389–395` — the selection-reset effect keys on `queryIdentity`, which includes `q`. Search-as-you-type will therefore clear the operator's selection on every debounce tick. That is a genuine data-loss-shaped regression for someone who selected rows and then refined the filter.

**Recommendation:** Specify in the plan: use `history.replaceState` (not `pushState`) for debounce-driven query updates and suppress the `scrollTo`; guard the line-388 effect so it does not write back while the field has focus; and decide explicitly whether typing should clear selection (it probably should not — restrict the reset to non-`q` filter changes, or to committed searches only). Also name `src/ui/shell/QuickSearch.tsx:55–92` as the pattern to reuse — it already implements AbortController + session id + a `paintedQuery` guard against out-of-order responses, which is precisely the mechanism step 3 needs.

---

**[MAJOR] Approach step 4 — "the real count" is ambiguous, and the two readings give different numbers**

`envelope.total` is the **filtered** total, not the conference total. The operator saw **1,002**, which is the unfiltered figure. Under a status filter the placeholder would read "Search 12 submissions…". The AC says the placeholder must *"match the summary line"* — the summary at line 552 uses `envelope.total`, so filtered is defensible — but the plan says only *"the list envelope's real `total`"* without registering that there is a choice. Note also that the placeholder is only visible when the field is empty (hence `q` is empty), so in practice the count reflects the non-search filters.

**Recommendation:** State the decision in the plan and the PR: placeholder uses `envelope.total` (the same number as the summary line), which means it moves with the non-search filters by design. Also state the pre-load string — an honest, non-numeric placeholder such as `"Search submissions…"` avoids inventing a number, and pairing it with a reserved field width satisfies "no jump" without a fake count.

---

**[MAJOR] Ownership boundary — the MRQ-97 line runs through the same JSX element and the same CSS rule**

The plan restates the boundary correctly but treats it as if the two areas were separable files. They are not:

- `STATUS_OPTIONS` is **inside** `SubmissionsPage.tsx` (lines 54–69), not in a separate module.
- The status `<select>` (line 587) is a direct sibling of the search field (line 586) inside the same `<form class="submissions-toolbar">` that MRQ-98 must re-flex.
- `submissions.css:34` is a **shared** rule: `.submissions-toolbar input, .submissions-toolbar select { … height: 32px; … }`. Any change there touches MRQ-97's control.
- The responsive blocks at `submissions.css:105–107` and `113–115` govern the search field and the selects together.

A collision at rebase is close to certain unless the diff is deliberately shaped to avoid it.

**Recommendation:** Add an explicit constraint to the plan: **additive, `.search-field`-scoped CSS only** — new rules for `.search-field` and `.submissions-toolbar .toolbar-spacer`, no edits to the shared `.submissions-toolbar input, .submissions-toolbar select` rule and no edits to `.status-col`/`.status-chip`. On the widening itself: the real constraint is that `.search-field` is `flex: 0 1 auto` with `min-width: min(330px, 35vw)` while `.toolbar-spacer` is `flex: 1` (line 39) and takes all the slack. Give the search field the grow factor and let the spacer be the thing that yields — that is a one-line change confined to rules MRQ-97 does not own.

---

**[MINOR] Approach step 2 — dedup must not swallow the `reloadKey` refetch**

The fetch effect keys on `[eventId, search, reloadKey, initialEnvelope]` (line 420). `reloadKey` is bumped after bulk actions and notify (lines 518, 536) specifically to re-read a list whose contents changed server-side while the query string stayed identical. A naive "skip an identical last-completed query" check will suppress exactly that refetch and leave stale rows after a bulk decision.

**Recommendation:** State that the dedup key covers the query parameters only, and that a `reloadKey` change always forces a round-trip regardless of key equality.

---

**[MINOR] Approach step 2 — stale rows interact with selection and track state**

With rows preserved across a query change, `togglePage` (line 428) will build a selection from **stale** ids, and `knownTracks` (line 408) accumulates monotonically so the track filter can offer options absent from the current result. Neither is fatal, but "select all visible" writing ids that are about to be replaced is a real correctness wrinkle.

**Recommendation:** Note in the plan that the header checkbox and row checkboxes are disabled (or the selection cleared) while a refresh is in flight, and that the existing `queryIdentity` reset stays the authority on selection lifetime.

---

**[MINOR] Approach step 7 — `check:speed` does not measure the thing this ticket fixes**

`scripts/checks/speed.ts:279–288` measures `submissions-first-interactive` and `submissions-filter-sort` by `loadPage(page, url, "/submissions", ".submissions-page")` — i.e. time until the **page container** selector exists, not until rows are painted. Eliminating the blank gap may barely move that number, and a skeleton that renders sooner could improve it without improving anything the operator perceives. The AC asks for *"measured improvement in perceived and actual load time"*; this instrument measures neither cleanly.

**Recommendation:** Keep `npm run check:speed` as the regression guard (prove you did not make it worse), but add a purpose-built measurement for the claim: time from filter change to first painted row, and the cumulative layout-shift number from the instrument above. Say in the plan which number substantiates which AC.

---

**[MINOR] Approach step 3 — the cited 180ms precedent is a different mechanism**

The 180ms figure comes from `src/ui/public/agenda/PublicAgendaPage.tsx:123`, inside `PUBLIC_AGENDA_SCRIPT` — a vanilla-JS listener that calls `form.requestSubmit()` on a server-rendered public page, i.e. a full navigation. It is a fine number to borrow; it is not a mechanism to reuse. The in-app precedent is `QuickSearch.tsx`, which debounces not at all and relies on abort + `paintedQuery` ordering.

**Recommendation:** Cite `QuickSearch.tsx` as the mechanism and the public agenda only as the source of the interval, so the implementer does not go looking for a shared debounce helper that does not exist.

---

**[MINOR] Approach step 1 — "record the baseline timing and any existing failures in Lattice" has no stated instrument**

Baseline timing of what, measured how? Without fixing the instrument in step 1, the before/after numbers required by the AC will not be comparable.

**Recommendation:** Name the exact three measurements in step 1 and re-run the identical procedure in step 7: (a) `npm run check:speed` `submissions-first-interactive` / `submissions-filter-sort` p95, (b) time-to-first-row on a view switch, (c) cumulative layout-shift across a view switch.

## 4. Positive Observations

- **The ownership boundary is respected and restated in the plan's own words**, including the correct decision to leave `submissions.queries.ts` and the status control alone and to expect a rebase on MRQ-97. That is the right posture for concurrent work on one file, and it is stated up front rather than discovered.
- **The stretch-goal sequencing is correct.** Step 3 is explicitly gated behind the continuity work and carries a written fallback ("leave the button path intact and document the stretch-goal decision rather than weakening the primary fixes"), which matches the ticket's *"land 1, 2 and 4 first; drop this if it puts them at risk."*
- **The operator's anti-over-architecture constraint is honored.** No cache layer, no state library, no prefetch framework — the plan reaches for stale-while-revalidate, abort, and dedup, which are the cheap high-yield moves the ticket actually asked for.
- **Step 4 correctly refuses a hardcoded width** for the search field and reaches for flex allocation and minimum sizing, verified at real widths. That is the right diagnosis of a `min-width: min(330px, 35vw)` problem.
- **Step 5 honors "diagnose before redesigning"** on saved views and explicitly forbids a second saved-views UI, restricting the change to labeling, grouping, and confirmation. Good discipline against the most tempting scope creep in the ticket.
- **The judgment-calls section is genuinely useful** — writing down "a loading signal may annotate the stable frame, but it must not replace or hide usable rows" gives a reviewer something falsifiable to check. More plans should carry that section.
