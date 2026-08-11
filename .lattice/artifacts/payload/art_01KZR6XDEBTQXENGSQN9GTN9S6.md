# Code Review: MRQ-39 — Mobile reviewer pass (M-44), M-47 cut

**Reviewed:** branch `mrq-39-mobile` at `2599b83` (3 commits on `3556b4f`, the current master tip).

> Note on the prompt diff: the diff embedded in this prompt was generated against a stale base — most of its content (`.lattice/**` bookkeeping, LICENSE, SPEC.md, `scripts/checks/*`, assemble-public/check-repo/trace-ac tests, `tests/ac-claims/MRQ-42.json`) is already-merged MRQ-42/MRQ-44 work, not this ticket. I verified the actual branch delta directly in the worktree: **4 files, +91/−34** — `src/ui/review/ReviewerPage.tsx`, `src/ui/review/review.css`, `tests/ac-claims/MRQ-39.json`, `tests/unit/reviewer-surface.AC-61-158-159.test.ts`. This review covers that real delta.

## 1. Verdict

**PASS**

## 2. Summary

The implementation delivers exactly what the plan committed to and nothing it forbade: a module-local mobile pass over the reviewer surface (stable feedback slot, 44–48px touch targets, `100dvh` detail sheet with safe-area insets, a systematic `min-width: 0` / `overflow-wrap: anywhere` overflow sweep), plus test-hook data attributes, an extended source-contract test, and an honest `owns: []` claims manifest that names the M-47/US-32/AC-167–169 cut. I independently ran everything: the focused reviewer-surface suite passes (2 tests), the full default suite passes hermetically in **16.8s** (30s budget), and `npm run pr-gate -- --ticket MRQ-39` passes in **19.6s** (45s budget). No API, route, auth, shell, or identity changes; no AI surface, flag, or stub exists anywhere in the delta — the cut is genuinely clean, satisfying the spirit of AC-169 by absence. Three minor findings, none blocking.

## 3. Issues

**[MINOR] src/ui/review/ReviewerPage.tsx:369 — Dismissing an error can resurface a stale success notice**
The new feedback slot renders `error ? <alert> : notice ? <status> : <placeholder>`. Error paths (`load`, `saveNext`, `saveComparison`) never clear `notice`, so a sequence like *save succeeds → later request fails → reviewer dismisses the error* re-reveals the old "Approve saved · next submission ready" notice, which no longer describes current state. (Before this change both rendered simultaneously, so the staleness existed but was at least visible-and-dismissable at the moment it went stale; the new precedence rendering hides it and replays it later.)
**Fix:** Clear the notice whenever an error is set (or at the top of each action alongside `setError(null)`, also `setNotice(null)`).

**[MINOR] src/ui/review/ReviewerPage.tsx:367 — `aria-live="polite"` wrapper around `role="alert"`/`role="status"` children risks double announcement**
The slot section carries `aria-live="polite"` while its children carry `role="alert"` (implicit assertive live region) and `role="status"` (implicit polite live region). Some screen-reader/browser combinations will announce insertions twice, and the polite wrapper contradicts the alert's assertive semantics.
**Fix:** Drop `aria-live` from the section and let the existing `role="alert"`/`role="status"` children own announcement (they already did this correctly pre-change), or keep the wrapper live region and demote the children to plain `<div>`s. Either way, one live region per message.

**[MINOR] src/ui/review/review.css:22 — Desktop feedback slot reserves no space, so alerts still shift desktop layout**
`.reviewer-feedback-placeholder` is `min-height: 0` outside the 600px media query, so on desktop an appearing alert still pushes the responsibility strip and queue down — the "elements never jump" reservation only holds at phone width. This is scope-consistent (the ticket is the mobile pass, and desktop behavior is no worse than before — the old `-5px` margin hack is actually gone), but the machinery to fix desktop is now one declaration away.
**Fix (optional, could ride a later ticket):** Give the placeholder/slot a desktop `min-height` matching the one-line alert height, mirroring the mobile 44px + 14px = 58px arithmetic.

Also noted, below issue-threshold: the new CSS regexes in the test (`/\.decision-button \{ min-height: 48px;/` etc.) pin exact property order and brace formatting. The file's alphabetical-property convention makes this stable today, but any formatter pass will false-fail them; the plain-substring assertions used elsewhere in the same test are more durable.

## 4. Positive Observations

- **The delta is exactly as declared.** Module-local under `src/ui/review/*` plus its own tests and manifest — no shell, route, API, or identity touch. `SubmissionDetail.identity` remains unread (asserted by the new `not.toMatch(/detail\.identity/)` guard, with positive controls in the same test proving the source loaded), and the blind-review seams (queue index as return point, save/advance endpoint semantics, MRQ-50 null-identity invariant) are all preserved untouched.
- **The stable-layout arithmetic is actually done, not gestured at.** Mobile slot `min-height: 58px` = alert `min-height: 44px` + `margin-bottom: 14px`, so placeholder↔alert swaps are pixel-neutral; `.review-shortcuts` gets a reserved height; save buttons keep fixed slots in both scorecard and comparison modes. This honors both the plan and the operator's "elements never jump" ruling with real numbers.
- **The overflow sweep is systematic, not whack-a-mole.** `min-width: 0` is threaded down the full flex/grid ancestor chain (frame → heading/meta/layout/board → card rows → detail head/actions) with `overflow-wrap: anywhere` on every free-text terminal (abstract, chips, titles, alert copy, file names) and `overflow-x: clip` as the backstop — the correct CSS mechanics for the "no horizontal overflow at 375px" contract.
- **Genuinely mobile-literate details:** `100dvh` (not `vh`) on the detail sheet, `env(safe-area-inset-bottom)` on both the surface and the sheet's action bar, `-webkit-overflow-scrolling: touch`, a 44px close target, and the file-row chip re-gridded rather than clipped.
- **A real defect fixed in passing, in scope:** the "Exit queue" button existed on the base with class `reviewer-exit` and *zero* CSS — a raw unstyled HTML button in the Flight Deck topline. It now matches the `.reviewer-refresh` idiom on desktop and becomes a full-width 44px target on mobile. Verified against base `3556b4f`.
- **The cut is honest and complete.** No AI flag, route, stub, or partial surface anywhere in the delta; the claims manifest names M-47/US-32/AC-167–AC-169 as cut with `owns: []` and correctly leaves AC-158/159 ownership with MRQ-18, matching the `trace-ac-core.mjs` owns/exercises convention.
- **Speed discipline held:** full hermetic suite 16.8s, PR gate 19.6s — both comfortably inside budget, independently re-run for this review.
