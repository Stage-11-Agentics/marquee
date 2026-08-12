# Plan Review: MRQ-98

## 1. Verdict

**PASS**

The plan is sound enough to implement. The issues below are refinements and
risks to carry into implementation, not gaps that require a return to
`in_planning`. Two of them (#2 and #4) would, if left as written, cost the
ticket an acceptance criterion — address them during the build.

## 2. Summary

Reviewed the MRQ-98 plan against `SubmissionsPage.tsx`, `submissions.css`,
`router.ts`, `QuickSearch.tsx`, `submissions.queries.ts`, and the check/gate
scripts. The plan is unusually well-grounded: its factual claims about the
current code check out (the 430px table floor, the 300px state row, the
append-on-save path, the 180ms public-agenda debounce), it correctly refuses a
permanent 50-row reservation, and it diagnoses the saved-view complaint before
redesigning anything. The main concern is that all of its speed work is
client-side while a measurable share of the latency is on the server, in the
file this ticket does not own — plus one step that risks replacing the
operator's jump with a larger one.

## 3. Issues

**[MAJOR] Baseline / Implementation 2 — no latency attribution, and the server cost is out of bounds**
Every list request runs uncached `PRAGMA table_info` probes before the data
query: `hasColumns` at `src/routes/submissions.queries.ts:473-477`, awaited at
`:603` (`hasSpeakerTaskCancellationColumn`) and `:615` (buildings). Worse, the
drafts view (`listDraftsNeedingAttention`, `:566-596`) selects **every**
matching row with no `LIMIT`, hydrates draft metadata for all of them, filters
in JS, and only then slices the page — so the task's "make sure the 50-row page
really is the query's limit end to end" is **already false** for
`status=draft`. All of that lives in `submissions.queries.ts`, which MRQ-97
owns. The plan asserts "Preserve the endpoint's 50-row page contract" without
noticing the contract does not hold, and stakes the acceptance criterion
"measured improvement in ... actual load time" on client-side continuity alone.
If server TTFB dominates, stale-while-revalidate improves *perceived* time and
the actual number will not move.
**Recommendation:** Split the before/after measurement into server TTFB and
client render, not one wall-clock figure. If TTFB dominates, say so plainly in
the PR (perceived improvement, actual unchanged, with the numbers) and file the
drafts-view full scan and the per-request PRAGMA probes as a follow-up ticket
or a Lattice comment on MRQ-97 — do not repeat the "50 rows end to end" claim
as verified.

**[MAJOR] Implementation 3 — a 50-row cold skeleton trades one jump for a bigger one**
Today's cold frame is a 300px state row (`submissions.css:92`) inside a 430px
floor (`:56`). Fifty skeleton rows at the `td` rhythm is roughly 2,900px, so a
cold load of a filtered URL that resolves to 3 rows collapses ~2,400px on
commit — a larger shift than the one being fixed, on this ticket's own metric.
The plan guards the *settled* state against over-reservation but not the
in-flight one.
**Recommendation:** Size the cold skeleton to the visible frame — roughly a
viewport's worth, ~8–10 rows — and keep the 430px floor. Growth past the fold
shifts nothing the operator can see (the only element below the wrap is
`.submissions-pagination`), and short filtered results no longer collapse.
Where a previous envelope exists, prefer its row count over any constant.

**[MAJOR] Implementation 4 vs 5 — the one-row chip frame hides the view just saved**
`saveCurrentView` appends the new view to the end of the list
(`SubmissionsPage.tsx:335`) and `.saved-view-chips` currently wraps
(`submissions.css:10`). Step 4 converts that to "a fixed one-row/scrolling
frame," which puts a newly saved chip off the right edge — reproducing
complaint #6 through the fix for complaint #1. Step 5's inline confirmation
names the view but does not make it reachable without a horizontal scroll the
operator has no reason to attempt.
**Recommendation:** On successful save, scroll the new chip into view (or
insert it first), and make "the newly saved chip is visible without scrolling"
an explicit browser-automation check at 1280px with 6+ saved views. Also verify
the fixed frame against the ≤1000px rules that set `flex-wrap: wrap` and
`align-items: flex-start` on the strip (`submissions.css:102-103`).

**[MAJOR] Implementation 1/2 — the canonical key is built but never spent**
Step 1 defines a canonical request key; steps 2–7 only ever use the
`AbortController` + sequence id. Nothing in the plan skips a redundant
round-trip, which is task §2's second bullet. The gap is real in this code: the
load effect keys on the raw `search` string
(`SubmissionsPage.tsx:420`), while `applyView` rebuilds the query in its own
fixed key order (`:310-316`) — so applying a view over an equivalent but
differently-ordered URL refetches identical results.
**Recommendation:** State explicitly that the effect compares the canonical key
against the last *committed* key and skips the fetch when equal, with
`reloadKey` still forcing a refetch after mutations, and unit-test the skip
alongside the order-independence test already planned.

**[MINOR] Implementation 2 — this app already ships a keep-last-good pattern; reuse it**
`DashboardPage.tsx` holds `{ snapshot, loadedAt, error, consecutiveFailures }`
(`:15-23`, `:158`, `:192`, `:218-221`) and renders `StaleBand` / `ErrorBanner`
from `src/ui/shell/ErrorSurface.tsx`. The plan describes the same shape as a
new "fixed-height inline update/error message" without naming the precedent —
against a ticket whose instruction is to extend existing discipline rather than
invent a mechanism.
**Recommendation:** Reuse `StaleBand`/`ErrorBanner` (checking their rendered
height against elements-never-jump), or state why the submissions frame needs
its own. Either way, name the precedent so the two screens do not drift.

**[MINOR] Implementation 7 — the URL→draft sync will eat keystrokes**
`useEffect(() => setSearchDraft(q), [q])` (`SubmissionsPage.tsx:388`) rewrites
the input from the URL. With a 180ms debounce, a debounced navigation commits
`q="abc"` while the operator has already typed "abcd" — the input reverts and
the caret moves. That is precisely "dropped keystrokes" in the acceptance list.
The plan flags the hazard ("avoid writing URL state back over a focused input")
but names no mechanism. Related: `replace: true` skips `scrollTo(0, 0)`, so
with stale rows retained and a shorter result committing, a scrolled-down
viewport can land past the end of the new list.
**Recommendation:** Guard that effect concretely — skip while the search input
holds focus, or apply only when `q` differs from the value this component last
pushed — and test by typing a fast multi-character string, not one keystroke.
Check scroll position after a filter narrows the list while scrolled down.

**[MINOR] Implementation 4 — the notification status band is not an async shift**
`notifiedQueue` derives synchronously from the URL (`:238`), so the
`{notifiedQueue && …}` band at `:557` never appears or disappears during a
load. Making it unconditional buys a permanent ~18px empty band
(`submissions.css:6`) on every submissions view against no observed jump.
**Recommendation:** Drop this sub-step unless a recording shows a shift, and
keep the other two in step 4 — the saved-view chips and the header copy are
genuinely async and do move the card.

**[MINOR] Implementation 6 — `flex-shrink: 0` on the control labels grazes MRQ-97**
The non-search toolbar labels wrap MRQ-97's status `<select>`, and
`.submissions-toolbar label:not(.search-field)` is already redefined at ≤760px
(`submissions.css:114`). The plan promises not to touch status styling, then
adds a property to the element that contains it.
**Recommendation:** Scope the rule to exclude the status label, or record in a
Lattice comment that a layout-only property is being applied to the shared
label — the ticket asks for coordination before any change lands over that
line. Also re-verify the ≤1000px and ≤760px branches after widening
`.search-field`'s `min-width: min(330px, 35vw)` (`:36`, `:106`, `:113`).

**[MINOR] Verification — no `tests/ac-claims/MRQ-98.json`**
`pr-gate.mjs:19` runs `trace:ac --scope=merged --ticket=MRQ-98`, and
`trace-ac.mjs:36-39` emits a `missing-current-ticket-manifest` warning when no
claim file names the ticket. It is a warning, not a gate failure, but every
merged ticket in `tests/ac-claims/` carries one.
**Recommendation:** Add the manifest, or note in the PR why this ticket has no
AC claim.

**[MINOR] Implementation 2 — `initialEnvelope` is dead in the current tree**
No caller passes it: `AppShell.tsx:150` renders
`<SubmissionsPage search navigate />`, and no test in `tests/` references the
prop. Preserving the seam is harmless, but it protects nothing, so browser
automation really is the only behavioral proof this page has.
**Recommendation:** No plan change — just do not count the seam as coverage
when deciding how much automation to run.

## 4. Positive Observations

- **The diagnosis is grounded in the actual code, not inferred.** The 430px
  wrap floor, the 300px state row, the existing reserved-space placeholders,
  the append-on-save path at `:335`, and the 180ms interval (verified at
  `PublicAgendaPage.tsx:123`) are all cited correctly. That is rarer than it
  should be and it made this review cheap.
- **Step 3 refuses the obvious wrong answer.** "Do not impose a permanent
  50-row blank area on short filtered results" is exactly the trap a
  reserve-the-space ticket invites, and the plan names it before falling in.
- **Step 5 diagnoses before redesigning**, reaches the right conclusion
  (affordance, not persistence), and explicitly declines to build a second
  saved-views UI — which is what the ticket asked for.
- **The measurement plan is falsifiable.** `PerformanceObserver` over
  `layout-shift` with `hadRecentInput` excluded, plus a recording, is proof;
  reading the CSS is not, and the plan says so.
- **Honest reporting is pre-committed** — "a passed-but-over-budget baseline or
  gate is reported as such, not relabeled" is the right posture with the fleet
  contending for this machine.
- **The MRQ-97 boundary is respected and the rebase is planned**, including the
  `npm ci` + exact-head re-run afterward.
- **Stretch-goal ordering matches the ticket**: progressive search is last and
  explicitly droppable.
