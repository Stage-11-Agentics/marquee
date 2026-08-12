# MRQ-98: Submissions list jumps on every view switch, feels slow, and its search placeholder states a count that is not true

The submissions list — the organizer's main working surface — jumps when it loads,
makes you wait, and prints a count that is not true. Operator feedback from the live
site, 2026-08-11/12. Five related complaints, one page, one PR.

## 1. The page shakes on every view switch

*"when I click on like different one view — like when I click all submissions, when
it's loading, it shrinks just a little bit and the whole thing shakes, and then
whenever it loads everything appears at once."*

The table card carries `aria-busy` while loading (`SubmissionsPage.tsx:558`) but the
layout does not hold its shape: rows vanish, the card collapses toward its empty
height, then 50 rows snap back in. This violates the standing **elements never jump**
rule — interactive elements stay fixed across state changes; reserve the space.

Hold the frame across the whole load. The row area keeps its height, the toolbar and
saved-view strip do not move, and content arrives without a reflow. The page has an
established habit of reserving space for exactly this reason — see the
`"Selection space reserved"`, `"Export status space reserved"`, and
`"Bulk action status space reserved"` placeholders already in the file. Extend that
discipline to the table body rather than inventing a new mechanism.

## 2. It should not feel like it is loading at all

*"let's make it so that we do not need to have any latency on loading. It should be
lightning fast if we can. Now let's not go over the top and don't over architect
things."*

Take the operator's constraint seriously: **no new caching layer, no state library,
no speculative prefetch framework.** Speed here is mostly about not throwing away
what you already have. Cheap, high-yield moves, roughly in order:

- Keep the previous result rendered while the next one is in flight, instead of
  dropping to an empty state. Most "latency" the operator feels is the blank gap.
- Do not refetch what has not changed — switching a view that resolves to the same
  query should not round-trip.
- Make sure the 50-row page really is the query's limit end to end, and that filter
  changes cancel superseded requests rather than racing them.

Measure before and after and put the numbers in the PR. `npm run check:speed` exists;
use it if it fits. **Speed is a graded feature (R7)** — a slow list is a defect.

## 3. Search as you type

*"Can we have progressive search happen as you type if we do it elegantly. Again,
maybe this is a stretch goal."*

Treated as in scope but lowest priority — **land 1, 2 and 4 first; drop this if it
puts them at risk.** Debounce (the public agenda already uses 180ms for the same
purpose), cancel superseded requests, never let an older response overwrite a newer
one, and keep focus and caret position stable. If typing makes the page jump, it is
worse than the button. The existing submit button stays for keyboard/no-JS users.

## 4. The search placeholder states a number that is not true

`SubmissionsPage.tsx:586` hardcodes `placeholder="Search 1,000 submissions…"` while
the summary line 34 lines above reports the real `envelope.total` — which the operator
saw as **1,002**. A literal baked in at build time will drift from reality forever.
Use the real count, and handle the pre-load case without flicker (**elements never
jump** applies to the placeholder too — do not let it change width as the count arrives).

## 5. The search field is too small

*"the font on Search abstracts, speakers etc. in the text bar cuts off too early,
then that search bar could be bigger."*

The placeholder truncates before it finishes. Give the field room to show its full
placeholder at the page's normal widths — this is the primary control on the primary
screen and it is currently the narrowest thing in the toolbar. Check the toolbar's
flex behavior in `src/ui/submissions/*.css` rather than hardcoding a width, and verify
at a few realistic window sizes.

## 6. Saved views: how do you get back to one?

*"for the save current view, how do you go back to those saved views"*

They do exist — the `saved-view-strip` chips at `SubmissionsPage.tsx:559-573`, above
the toolbar. The operator saved a view and could not find their way back to it, so
**the feature works and the affordance does not communicate.** Diagnose before
redesigning: confirm a newly saved view actually appears in the strip immediately
(if it does not, that is a bug and it is the real answer here). If it does appear,
the problem is that "Save current view" gives no feedback and the strip does not read
as the place saved views live. Make the save confirm itself and make the strip
legible as a destination. Do not build a second saved-views UI.

## Ownership boundary — read this

**MRQ-97** is concurrently rewriting the status vocabulary on this same page.

- **You do not own:** `src/routes/submissions.queries.ts`, the `STATUS_OPTIONS`
  constant, or the status `<select>` and its styling. Leave them exactly as you find
  them; if your work forces a change there, coordinate in a Lattice comment first.
- **You own:** the loading/skeleton behavior, the table frame, the search field, the
  placeholder count, the saved-view strip, and toolbar layout.
- Expect to rebase on MRQ-97. Keep your diff tight so that is cheap.

## Constraints

- Flight Deck aesthetic per `DESIGN.md`; reuse existing classes and tokens.
- **Elements never jump** is the through-line of this entire ticket.
- Work in your own git worktree. **Never** branch, stash, or clean in the primary
  checkout — see `CLAUDE.md`, "The primary checkout is the Lattice board's home".
- No auto-deploy: validate locally, do not run `wrangler deploy`. See `DEPLOY.md`.
- Suite budget 45s, gate budget 120s.

## Acceptance

- Switching between views and filters produces **no visible layout shift** — verify
  by recording the transition, not by reasoning about the CSS.
- The list keeps showing content while the next query is in flight; no blank gap.
- Measured improvement in perceived and actual load time, numbers in the PR.
- The search placeholder shows the real record count and matches the summary line.
- The search field shows its full placeholder without truncation at normal widths.
- Saving a view visibly confirms, and the saved view is reachable afterward.
- If search-as-you-type ships: no dropped keystrokes, no out-of-order results, no
  focus loss, no jump.
- Validated locally with browser automation, screenshots/recording in the PR.
- `npm test` green within budget; PR open against `Stage-11-Agentics/marquee` `main`.
