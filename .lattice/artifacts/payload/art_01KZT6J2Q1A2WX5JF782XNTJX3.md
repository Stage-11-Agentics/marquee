# Code Review: MRQ-98 — submissions list stability, speed, search, saved views

Reviewed at `mrq-98-submissions-ux` @ `0b979de` (2 commits on top of `github/main` `2543206`).
PR: https://github.com/Stage-11-Agentics/marquee/pull/56

**Scope note on the diff supplied with this prompt.** The diff in the review packet was
computed against a base that predates the MRQ-97 merge (`#51`), so it shows the grouped
`STATUS_OPTIONS`, `accepted_any`, "Ready to place", and `.status-filter` CSS as if this
ticket wrote them. It did not. The branch's own two commits touch exactly six files:

```
src/ui/shell/router.ts                             |  13 ++-
src/ui/submissions/SubmissionsPage.tsx             | 127 ++++++++++++++---
src/ui/submissions/list-request.ts                 |  26 +++
src/ui/submissions/submissions.css                 |  41 +++-
tests/ac-claims/MRQ-98.json                        |   6 +
tests/unit/submissions-list-request.MRQ-98.test.ts |  38 ++++
```

The MRQ-97 ownership boundary is respected: `submissions.queries.ts`, `STATUS_OPTIONS`,
and the status `<select>` markup/styling are untouched by this branch. Review below is
against the branch's real diff.

**Independently verified:** `npm test` → 106/106 pass, `elapsedMs 27420`, budget 45000,
`overBudget: false`, `hermetic: true`.

---

## 1. Verdict

**FAIL (implementation-level)**

The approach is right and the diff is tight — but the new refresh state machine has a
reachable path that leaves the page permanently stuck in its "Refreshing…" state
(`aria-busy="true"` forever), on the very surface this ticket exists to stabilize. Both
findings below are small, local fixes; the plan needs no revision.

## 2. Summary

Reviewed the stale-while-revalidate rework of `SubmissionsPage`, the new pure
`list-request.ts` helpers, the router `replace` mode, the toolbar/skeleton/saved-view CSS,
and the added unit tests. Quality is generally high: the diff is small, honors the
MRQ-97 boundary, extends the file's existing space-reservation idiom rather than inventing
a mechanism, and adds no cache layer or state library as the operator required. The key
finding is that the "skip an equivalent request" guard returns early *before* clearing
the in-flight indicators, so toggling a filter off while its request is in flight leaves
`refreshing` (and `aria-busy`) latched on until some later request happens to commit.

## 3. Issues

```
**[MAJOR] src/ui/submissions/SubmissionsPage.tsx:472 — Returning to the last-committed query mid-flight latches the page into "Refreshing…" forever**
```
The load effect sets `refreshing = true` and a measured `tableFrameMinHeight` at request
start (lines 478-481), but the equal-key skip at line 472 returns before touching any of
that state:

```ts
const forceReload = lastReloadKeyRef.current !== reloadKey;
lastReloadKeyRef.current = reloadKey;
if (!forceReload && lastCommittedRequestKeyRef.current === requestKey) return;   // ← 472
```

Concrete failure: page is settled on `/submissions` (committed key K1) → operator picks a
status filter (K2) → effect sets `refreshing = true`, request in flight → operator picks
"All statuses" again before it lands. Preact runs the previous effect's cleanup
(`controller.abort()`), then the new effect, which sees `lastCommittedRequestKeyRef ===
K1` and returns at line 472. The aborted K2 request's `.catch` is correctly rejected by
`isCurrentSubmissionsRequest` (signal aborted), so it updates nothing either. Nothing else
in the file writes `setRefreshing(false)` — grep confirms the only writers are lines 480,
484, 501 and 509, all inside the fetch path. Result: `.table-card` keeps
`aria-busy="true"` and the reserved band keeps reading "Refreshing submissions…"
indefinitely, and the inline `min-height` stays pinned on `.submissions-table-wrap`, until
the operator happens to trigger a request that actually commits. Toggling a filter on and
off is exactly the interaction this ticket is about, and the stuck banner reads as "the
list is still loading" on a list that has finished.

**Fix:** clear the in-flight surface in the skip branch before returning:
```ts
if (!forceReload && lastCommittedRequestKeyRef.current === requestKey) {
  setRefreshing(false);
  setRefreshError("");
  setTableFrameMinHeight(null);
  return;
}
```

```
**[MAJOR] src/ui/submissions/SubmissionsPage.tsx:446-453 — the debounce timer fires with stale `params`, silently reverting a filter changed within 180ms of the last keystroke**
```
```ts
useEffect(() => {
  if (searchDraft.trim() === q) return;
  const timer = window.setTimeout(() => {
    localSearchNavigationRef.current = searchDraft.trim();
    updateQuery({ q: searchDraft.trim(), page: 1 }, { replace: true });
  }, 180);
  return () => window.clearTimeout(timer);
}, [searchDraft, q]);
```
`updateQuery` builds its target from `params`, which is derived from the `search` prop —
but `search` is not a dependency, and a status/track/sort/page/saved-view navigation
changes `search` without changing either `searchDraft` or `q`. So the pending timer is
neither cleared nor re-armed, and when it fires it navigates to a URL rebuilt from the
*pre-change* params, dropping the filter the operator just applied. Because the navigation
uses `replace: true`, it leaves no history entry either — the filter simply un-applies
itself ~180ms later with no trace. Same path undoes an `applyView` click made inside the
window. The window is narrow (180ms after the last keystroke), which makes it rare but
also makes it the kind of defect that gets reported as "the filter randomly doesn't
stick" and is very hard to reproduce deliberately.

**Fix:** hold the live navigation inputs in a ref rather than the effect closure — e.g.
`const searchRef = useRef(search); searchRef.current = search;` and build the timer's
target from `new URLSearchParams(searchRef.current)`; or keep `updateQuery` in a ref
updated every render. Adding `search` to the deps also fixes it, at the cost of re-arming
the debounce on unrelated navigations (acceptable, since those refetch anyway).

```
**[MINOR] src/ui/submissions/SubmissionsPage.tsx:355-363 — the saved-view confirmation is never cleared**
```
`applyView` sets `activeViewId` and navigates but does not reset `viewMessage`, and no
other path clears it. After saving, `Saved view "X" is ready above the filters.` stays
under the strip while the operator switches views, changes filters, and pages through
results — the plan called for clearing success/error messages "deliberately around later
operations". It is a reserved-height band so nothing jumps, but the copy goes stale and
starts describing a state that no longer exists (it will still say "ready" after that
view has been left).

**Fix:** `setViewMessage("")` in `applyView`, or clear it in the existing `queryIdentity`
effect alongside the bulk-message resets.

```
**[MINOR] src/ui/submissions/SubmissionsPage.tsx:263 — `searchInputRef` is dead code**
```
Declared and attached to the input at line 685, never read. Focus/caret preservation is
actually achieved by `localSearchNavigationRef` + not resetting `searchDraft`, which is
the better mechanism. The unused ref invites a future reader to think there is imperative
focus management here.

**Fix:** delete the ref and its `ref=` attribute.

```
**[MINOR] src/ui/submissions/SubmissionsPage.tsx:478-481 — `tableFrameMinHeight` does not appear to do anything**
```
On a warm request the old rows stay mounted for the whole flight, so
`.submissions-table-wrap` never changes height before commit; the measured value is
therefore equal to the height the element already has, and it is cleared in the same
batched update as the new envelope. It costs a forced layout read
(`getBoundingClientRect`) on every filter change plus a piece of state — and it is one of
the values left stranded by finding #1.

**Fix:** either drop it and rely on the retained rows (which is what actually holds the
frame), or add a one-line comment naming the case it protects, so the next reader can
tell whether it is load-bearing.

```
**[MINOR] src/ui/submissions/submissions.css:118 — the chip strip is now horizontally scrollable at every width, on the affordance the ticket says the operator could not find**
```
`.saved-view-chips { flex-wrap: nowrap; max-height: 34px; overflow-x: auto; }` keeps the
card from being resized by a growing view list — good — but it hides every chip past the
strip's width behind a scroll container. On macOS (the operator's platform) overlay
scrollbars are invisible at rest and `scrollbar-width: thin` is ignored by WebKit, so
there is no visual cue that more views exist. The `scrollIntoView` on save covers the
just-saved chip, but complaint #6 was "how do I get *back* to those saved views" on a
later visit, which this arrangement makes slightly harder rather than easier. Relatedly,
the plan's item 5 said the strip should visibly read "Saved views"; the eyebrow at
`SubmissionsPage.tsx:656` still reads `Views` (only the `aria-label` says "Saved
conference views").

**Fix:** cheapest credible improvements — set the eyebrow copy to `Saved views`, and
either allow two wrapped rows with a `max-height` (still bounded, still no card resize) or
add an edge fade / `→` affordance when the strip overflows.

```
**[MINOR] tests/unit/submissions-list-request.MRQ-98.test.ts — coverage stops at the pure helpers**
```
The three tests are good, but they cover query construction and the sequence predicate —
neither of the behaviors this ticket is actually about (retain-stale-rows, the
equal-key skip, the debounce/navigation ordering, the placeholder count). That is why
findings #1 and #2 are invisible to the suite: the state machine lives inline in a
component the repo has no way to render in tests. `tests/ac-claims/MRQ-98.json` declares
`owns: []` / `exercises: []`, so the gate traces nothing here either.

**Fix:** lift the request-lifecycle decision into `list-request.ts` as a pure reducer
(`nextListState(current, event)`) and unit-test the A→B→A path directly; or, at minimum,
add a `tests/node/*.test.mjs` source assertion in the repo's existing style pinning that
the skip branch resets the refresh flags.

```
**[MINOR] src/ui/submissions/submissions.css:117-135 — duplicated media-query blocks**
```
The file now carries two `@media (max-width: 1000px)` and two `@media (max-width: 760px)`
blocks. The new rules win by specificity so behavior is correct, but responsive behavior
for the toolbar and strip is now split across two places in the file, and the next person
tuning a breakpoint has to find both.

**Fix:** fold the new declarations into the existing breakpoint blocks.

**Note (not an issue):** the 9-row cold skeleton hardcodes `height: 58px` per `td`, so a
real first row that renders taller or shorter still produces a residual shift on cold
load. The plan called this out and accepted it; the acceptance criterion is about
view/filter switching, which is handled by row retention. Flagging only so it is a known
quantity rather than a surprise.

## 4. Positive Observations

- **The diff is genuinely tight and the ownership boundary held.** Six files, +224/−27,
  and MRQ-97's status vocabulary came through the rebase untouched — exactly what the
  ticket asked for, and it made this review cheap.
- **`list-request.ts` is the right extraction.** Small, pure, no imports, and it kills the
  "does the page size actually reach the API" question by construction — `SUBMISSIONS_PAGE_SIZE`
  now feeds both the request and the header copy, so the summary line can no longer drift
  from the real limit the way the placeholder did.
- **Two independent staleness guards.** A monotonic request id *and* the abort signal,
  checked in both `.then` and `.catch`. Either alone would be adequate for the common
  case; both together mean an abort-ignoring transport still cannot commit an out-of-order
  response.
- **Speed was addressed by not throwing work away, exactly as the operator asked.** Stale
  rows retained, equal-key requests skipped, no cache layer, no state library, no prefetch
  framework. The restraint here is the correct read of the constraint.
- **The reservation idiom was extended rather than replaced.** `submissions-refresh-message`
  follows the same transparent-text/`min-height`/`.visible` pattern as the existing export,
  notify, and bulk bands, and the `page-head p { min-height: 2.7em }` addition closes a
  jump the ticket did not even name.
- **`replace: true` in the router is scoped correctly** — it updates router state and skips
  `scrollTo(0, 0)`, so debounced typing neither floods the back stack nor yanks the page to
  the top, and the option is additive so no existing caller changes behavior.
- **The PR body is evidence, not assertion** — real numbers (table top held at y=409,
  non-input CLS 0, caret `[9,9]`, `Search 261 submissions…` under a filter), the forced-4s
  slow-request methodology, and an honest note that the embedded browser cannot record
  video plus an out-of-scope `check:speed` regression left reported rather than quietly
  fixed.
