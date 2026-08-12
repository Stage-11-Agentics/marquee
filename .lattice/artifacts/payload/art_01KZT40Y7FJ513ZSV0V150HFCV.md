# Plan Review: MRQ-98

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the MRQ-98 plan against the live source (`src/ui/submissions/SubmissionsPage.tsx`,
`src/ui/submissions/submissions.css`, `src/ui/shell/router.ts`, `scripts/checks/speed-budgets.mjs`,
and the node/integration tests that read these files). The plan is unusually well-scoped —
it respects the MRQ-97 ownership boundary precisely, it is honest that `check:speed` cannot
prove the transition improved, and it caught several real hazards (chip wrap, the shared
`.submissions-toolbar input, select` rule, writing URL state back over a focused input).

The blocking concern is the mechanism chosen for the ticket's primary acceptance criterion.
The fixed **50 × 58px** frame in step 3 rests on a row height that is a floor, not the actual
height — real rows render 85–100px — so the skeleton→content transition it is meant to
eliminate will still shift, and the same reservation held after load strands the pagination
footer and empty state behind ~3,000px of blank space on short results. Two smaller
correctness gaps compound it: the canonical request key as described will swallow
pagination, and the debounced-search mechanism in step 7 (`replaceState` + "the router's
`popstate` signal") cannot fire a re-render in this router.

## 3. Issues

**[CRITICAL] Implementation §3 — the 50 × 58px skeleton is not the height of 50 real rows, so the first-load shift survives**

`submissions.css:59` sets `.submissions-table td { height: 58px }`. In table layout that is a
floor, not a fixed height, and the title cell blows straight through it: `.table-title` is a
2-line clamp at `min-height: 2.55em` (~29px), plus one `.row-meta` line for `id · origin`
(~16px with margin), plus a second `.row-meta` when `item.submitter` exists, plus a
`.slot-row` chip when the record is scheduled (`SubmissionsPage.tsx:163-170`), plus 16px of
`td` padding. A scheduled row with a submitter lands near 100px; a bare draft lands near 58px.
Rows are therefore **variable-height and content-dependent**.

A 50-row skeleton at 2,900px hands off to real content at roughly 4,000–5,000px. That is a
~1,500px growth at the exact moment the ticket says to record and prove zero shift — the
plan would ship the defect it is measuring. It also means the "reserve the same 50-row body
height after load" number in the same step is wrong on its own terms: it does not describe
the height of the thing it is reserving for.

**Recommendation:** stop predicting content height. Two mechanisms, each exact:
- **Warm transitions** (the operator's actual complaint — *"when I click all submissions… it
  shrinks a little and the whole thing shakes"*): step 2's stale-while-revalidate already
  fixes this completely by never unmounting the old rows. Nothing is reserved because
  nothing is removed. If a belt-and-braces pin is wanted, read
  `wrap.getBoundingClientRect().height` at request start, apply it as an inline `min-height`
  for the in-flight window, and release it when the new envelope commits.
- **Cold load** (nothing on screen): build the skeleton rows from the *same cell markup* as a
  real row — a clamped title block, two meta lines — so the height matches by construction
  rather than by a hardcoded constant. Even then the skeleton row count should be
  `min(50, …)` and the honest framing is "the frame does not collapse," not "the pixel count
  is identical."

---

**[MAJOR] Implementation §3 — holding the 50-row reservation *after* load strands the footer and the empty state**

`.submissions-table-wrap` has `min-height: 430px` and `overflow: auto` with no max-height
(`submissions.css:56`), so the wrap grows to content and the page scrolls. Reserving a
50-row body height permanently means a filtered view returning 3 records — or the
`status=draft` queue, or any search that matches a handful — renders those rows and then
~2,800px of empty space before `.submissions-pagination` (`SubmissionsPage.tsx:629`). The
Previous/Next controls and the record count go offscreen. Worse, the empty-state row
(`SubmissionsPage.tsx:621`) and its next-action button — the thing AC-161 exists to
guarantee is reachable — sit inside a 300px `.state-row` floating in a 2,900px void.

The plan's "Judgment calls" section anticipates the objection and accepts quiet space, but
it weighs it against *"a 2,500px collapse/re-expansion"* — a collapse that step 2 has
already eliminated. Once rows are never dropped, the post-load reservation buys nothing and
costs the footer.

**Recommendation:** drop the post-load reservation entirely. Keep the existing 430px floor
(or a modest one), let the body take its natural height once real content has committed, and
confine all reservation to the in-flight window. A height change caused by *new data
arriving in response to the operator's own filter* is not the jump the rule forbids; a
height change caused by *the same data being thrown away and re-fetched* is.

---

**[MAJOR] Implementation §1 — the canonical request key must be derived from the outgoing query, or pagination breaks**

Step 1 defines "a canonical submissions request key" and step 2 skips refetch for
"equivalent query changes." The component's existing `queryIdentity`
(`SubmissionsPage.tsx:236`) deliberately **excludes `page`** — it exists to reset selection
on filter change, not to identify a request. If the new key is modeled on it, or on any
hand-listed subset of params, clicking Next/Previous produces an "equivalent" key and the
page silently never advances. The same hazard applies to any param the plan's list omits:
the effect today forwards the *entire* `URLSearchParams` to the API
(`SubmissionsPage.tsx:400-403`), so anything in the URL is part of the request.

**Recommendation:** state explicitly that the key is the **canonicalized outgoing request
URL** — take the same `URLSearchParams` the fetch uses, set `per_page=50`, sort the entries,
serialize. That is order-independent (the stated goal), complete by construction, and cannot
drift from what is actually sent. Add a unit test asserting `?page=2` and `?page=3` produce
different keys, alongside the order-independence test the plan already promises.

---

**[MAJOR] Implementation §7 — `history.replaceState` fires no `popstate`, so debounced search would update the URL and never refetch**

The plan specifies "Debounced URL updates use `history.replaceState` plus the router's
`popstate` signal rather than `pushState`/`scrollTo(0, 0)`." `useBrowserRouter`
(`src/ui/shell/router.ts:12-27`) re-reads location in exactly two places: the `popstate`
listener, and `navigate()`'s explicit `setLocation`. `replaceState` dispatches no event — it
is a silent history mutation. So the URL would change, `location.search` would not, the
`search` prop handed to `<SubmissionsPage>` at `AppShell.tsx:150` would not, and the fetch
effect would never re-run. Typing would appear to do nothing until the operator hit Search.

The avoidance of `pushState`/`scrollTo(0, 0)` is the right instinct — `navigate()` does both
(`router.ts:22-24`), which would mean one back-stack entry per typing pause and a scroll to
top mid-keystroke. But the fix requires a real mechanism, and both candidates put
`src/ui/shell/router.ts` in the diff — a file the plan's scope section does not list.

**Recommendation:** name the mechanism and the file. Preferred: add a replace-mode variant to
the router — `navigate(target, { replace: true })` calling `history.replaceState` and then
`setLocation(readLocation())`, skipping `scrollTo`. It is ~3 lines, keeps one navigation
authority, and serves any future caller. (Synthesizing `window.dispatchEvent(new
PopStateEvent("popstate"))` also works and touches no shared file, but it is a lie to every
other listener and should be the fallback, not the plan.) Either way, add
`src/ui/shell/router.ts` to the declared scope, and confirm with MRQ-97 that it is untouched
territory. Step 7 remains correctly flagged as the droppable stretch goal.

---

**[MINOR] Implementation §2 — the `initialEnvelope` SSR/test seam is not mentioned in a rewrite of the effect it guards**

`SubmissionsPage.tsx:397-398` opens the fetch effect with `if (initialEnvelope) return;`, and
`:201` seeds state from it. It is the documented deterministic SSR/test seam (`:29`). The plan
rewrites this effect end-to-end — abort controller, sequence id, canonical key, SWR commit —
without naming the seam once. A refactor that drops the guard turns a seeded render into a
live fetch.

**Recommendation:** add one line to step 2 stating the `initialEnvelope` early-return and the
seeded initial state are preserved verbatim, and that the sequence/abort machinery is not
engaged when it is present.

---

**[MINOR] Implementation §5 — the ticket asked for a diagnosis first; the plan records a remedy without the finding**

MRQ-98 §6 is explicit: *"Diagnose before redesigning: confirm a newly saved view actually
appears in the strip immediately (if it does not, that is a bug and it is the real answer
here)."* The plan goes straight to labeling and confirmation copy. For the record, the code
says the optimistic path is sound — `saveCurrentView` inserts into `views` and sets
`activeViewId` on success (`SubmissionsPage.tsx:335-336`), and the views effect does not
refetch on save (its deps are `[eventId, draftQueue, notifiedQueue, reloadKey]`, `:267`), so
nothing clobbers the new chip. The affordance reading is therefore the right one — but the
plan should say so, because "we checked and it is not a bug" is a different artifact from
"we assumed."

**Recommendation:** state the diagnosis and its evidence in the plan (and later the PR), so
the reviewer can tell the affordance fix was chosen over a data fix rather than instead of
investigating one.

---

**[MINOR] Implementation §2 — disabling selection inputs during refresh costs focus and reads as latency**

Step 2 proposes to "disable selection inputs during refresh." Disabling a focused checkbox
moves focus to `<body>`, which is a keyboard-navigation regression, and with step 7's
debounce this would flicker on every typing pause — the opposite of *"it should not feel like
it is loading at all."* The staleness hazard it guards against is already handled: the
selection-reset effect keys on `queryIdentity` (`:389-395`) and fires when the URL changes,
i.e. before the response, so no stale id survives into a bulk action. The bulk selector for
"all matching" travels as a filter, not ids (`:484-492`), so it is unaffected either way.

**Recommendation:** drop the disable. Keep the existing `queryIdentity` reset as the single
authority, as step 2's own last sentence already proposes.

---

**[MINOR] Implementation §2 — under SWR, the error path must keep Retry reachable**

Today an error replaces the table body with a `.state-row.error` carrying a **Retry** button
(`SubmissionsPage.tsx:620`). Step 2 replaces the blanking behavior with "a fixed-height inline
update/error message" over retained rows. If that message is the `.saved-view-message`-style
text-only strip, the retry affordance disappears in exactly the case where the operator is
looking at data they now know is stale.

**Recommendation:** specify that the stale-plus-error state keeps a retry control (the
existing `setReloadKey` bump) inside the inline message, and that the full-body error row is
retained for the cold-error case where there are no rows to keep.

---

**[MINOR] Implementation §6 — growing `.search-field` in a nowrap flex row shrinks the sibling selects, including MRQ-97's**

`.submissions-toolbar` is `display: flex` with no `flex-wrap` (`submissions.css:33`), and the
sibling `<label>`s wrapping the status/type/track selects are default `flex: 0 1 auto` — they
*can* shrink. Giving `.search-field` a grow factor therefore risks moving the truncation
complaint from the search box onto the status select, whose longest option is
`"Decided · not notified"` (`SubmissionsPage.tsx:68`) — precisely MRQ-97's surface. Note also
that `.toolbar-spacer` is a shared class used by `.saved-view-strip` (`:568`) and
`.selection-bar` (`:595`), and that `.submissions-toolbar .toolbar-spacer` is already
`display: none` below 1000px (`submissions.css:107`), so the widening has to be verified in
both regimes.

**Recommendation:** scope every rule to `.submissions-toolbar .toolbar-spacer` /
`.submissions-toolbar .search-field` (never the bare class), and add
`.submissions-toolbar label:not(.search-field) { flex-shrink: 0 }` so growth comes out of the
spacer rather than out of the selects. That is a layout rule on the toolbar, not a style
change to the status control, so it stays inside MRQ-98's ownership — but call it out in the
Lattice comment to MRQ-97 anyway, since it changes how their select is sized.

---

**[MINOR] Implementation §6 — "no flicker" for the placeholder needs its argument stated**

The ticket asks that the placeholder not change width as the count arrives. The plan's
pre-load `Search submissions…` → post-load `Search 1,002 submissions…` does swap visible
text. This is almost certainly fine — `.search-field` is sized by
`min-width: min(330px, 35vw)` plus flex, and the input is `width: 100%` inside it
(`submissions.css:36-37`), so the *field* geometry is independent of the placeholder string —
but the plan asserts the outcome without the reason.

**Recommendation:** one sentence in step 6 noting the field is flex/min-width sized so the
placeholder string cannot influence layout, and that the browser-automation pass captures the
toolbar geometry before and after the first envelope to prove it.

---

**[MINOR] Scope — the binding prototype still carries the hardcoded string**

`prototypes/pipeline-v1.1/index.html:2250` contains
`placeholder="Search 1,000 submissions…"`, and `DESIGN.md` binds the build to reproduce the
prototype one-to-one. MRQ-98 §4 deliberately overrides that, which is correct — but the
divergence should be recorded rather than left for the next agent to "fix" back.
(`scripts/checks/verify-design-contract.mjs` asserts tokens, shell geometry, and route labels
only — it does not read this string, so nothing goes red either way.)

**Recommendation:** note the intentional prototype divergence in the PR body, one line.

## 4. Positive Observations

- **The ownership boundary is honored precisely.** The plan names `submissions.queries.ts`,
  `STATUS_OPTIONS`, the status `<select>`, and the shared
  `.submissions-toolbar input, select` rule (`submissions.css:34`) as off-limits, and picks
  CSS selectors that route around them. That is the difference between a cheap rebase on
  MRQ-97 and a painful one.
- **It refuses to overclaim its measurements.** The plan states that `check:speed` results are
  "regression guards, not proof that the UI transition itself improved" — and it is right for
  a reason it did not even need to spell out: `submissions-filter-sort`
  (`scripts/checks/speed.ts:283-288`) is a full Playwright page navigation resolving on the
  `.submissions-page` selector, which paints before the table loads. It would not move if the
  transition got twice as fast. Reaching instead for `PerformanceObserver({ type:
  "layout-shift" })` plus time-to-first-new-row is the correct instrument, and insisting on a
  recording because "still frames alone cannot prove no shift" is exactly the ticket's ask.
- **Several real hazards caught unprompted:** `.saved-view-chips` is `flex-wrap: wrap`
  (`submissions.css:10`) and genuinely can grow the strip when counts resolve; the
  `useEffect(() => setSearchDraft(q), [q])` write-back (`SubmissionsPage.tsx:388`) genuinely
  would eat keystrokes under a debounce; `navigate()` genuinely does `pushState` +
  `scrollTo(0, 0)`. The step-7 mechanism is wrong, but the problem inventory that produced it
  is right.
- **Good discipline on the stretch goal.** Step 7 is gated behind the continuity work and
  carries an explicit deferral path, matching the ticket's "drop this if it puts them at
  risk."
- **The "Judgment calls" section is the right habit** — surfacing the fixed-reservation
  tradeoff for challenge is exactly why it is reviewable at all. The finding above is a
  disagreement with the call, made possible by the plan having stated it.
