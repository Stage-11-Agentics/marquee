# Review PR #199 — MRQ-171, the reviewer seat's home

Repo root: `/Users/atin/Projects/Stage11/deployments/Marquee`. Read its `CLAUDE.md` first — binding.
**Read-only review.** Do not edit the branch, do not merge, do not mutate the Lattice board.

```
gh pr view 199 --repo Stage-11-Agentics/marquee
gh pr diff 199 --repo Stage-11-Agentics/marquee
lattice show MRQ-171
```

A merge captain (surface:125) is sequencing every open Marquee PR to green tonight. Your
verdict is the review gate on this one. Be quick but do not be shallow — a wrong "looks
good" here costs more than twenty minutes of your time.

## What it is

`/reviewer` was the queue: "Enter as reviewer" dropped a human onto submission #1 with the
scorecard open, and "Exit queue" was `history.back()`, which from a fresh tab goes nowhere.
The PR splits the seat: `/reviewer` becomes a home (assignment · responsibility · your
reviews · your profile), `/reviewer/queue` becomes the lean working surface. Two operator
amendments ride along: the brand mark navigates to your seat's home, and the theme control
— which existed only in the admin Topbar and on the landing page — is extracted into one
shared `ThemeSwitch` and placed on both reviewer surfaces.

~495 insertions / 129 deletions across 20 files.

## Read the ticket's contract, then check the diff against it

MRQ-171's description carries 11 acceptance criteria and an explicit "do not" list. Do not
take the PR body's word on any of them. Specifically verify:

- **No new endpoints.** The ticket says reuse `PATCH /api/v1/me/profile` (already
  `auth: { kind: "authenticated" }`, not speaker-gated) rather than minting a reviewer
  profile route. Confirm no second profile/queue/identity path appeared.
- **Exactly one theme switcher implementation** now exists. There were two before
  (`Topbar.tsx` and `landing.route.tsx`); the point of the extraction was to stop at one,
  not reach three. Count them yourself.
- **The admin Topbar's behaviour is unchanged.** `Topbar.tsx` lost 53 lines to the
  extraction. Confirm the select, the swyxy dark word, and its `chromeFor(theme).darkToggle`
  gate all still behave exactly as before for the organizer.
- **No duplicated Completed list** left on the queue, and no organizer chrome on either
  reviewer page.
- **No aggregate score distribution** shown to the reviewer. It was excluded deliberately —
  showing a reviewer how the committee is voting nudges their next vote.

## The five things most likely to be wrong

1. **The `role-home.ts` leaf.** Commit `1ce7319f` fixed a real self-inflicted CI failure:
   `ReviewerPage.tsx` imported `ROLE_HOME` from `signin-destination.ts`, which imports
   `isSafeRedirectTarget` from `magic-links.ts`, which references `D1Database` — dragging
   Workers types into the client compilation, which `tsconfig.client.json` deliberately
   excludes. The fix extracts a 6-line browser-safe leaf. **Verify the boundary actually
   holds now**: does any client-reachable import still pull server-only types across? Walk
   the import graph from `src/ui/**` rather than trusting that one typecheck passes.
2. **Route rename fallout.** `/reviewer` → `/reviewer/queue` touches `route-table.ts`,
   `AppShell.tsx` (which special-cases `/reviewer` twice as a non-admin shell),
   `signin-destination.ts`, `signin.route.tsx`, `landing.route.tsx`, `seat.tsx`,
   `check-routes.mjs`, `speed.ts`, `docs/ROUTES.md`, `SITEMAP.md`, and three hardcoded
   links in `public/submission/index.html`. Also `evaluation.routes.ts:954`, where the
   committee-invite magic link mints `redirectTo: "/reviewer"`. **Find the one they
   missed.** Grep for `/reviewer` across the whole repo yourself.
3. **`scripts/checks/speed.ts` (+3 lines).** It used to load `/reviewer` and wait for
   `[data-reviewer-surface]`. If it now times the lighter home page instead of the queue,
   the speed number silently improves while the surface that actually hurts a reviewer goes
   unmeasured. The ticket told them to decide this deliberately. Check which they picked and
   whether it is the honest choice.
4. **Portal collision.** They touched `src/ui/portal/PortalPage.tsx` (6 lines) and
   `src/routes/portal.routes.ts` (21) after being told to stay out of `src/ui/portal/*`.
   Sharing the profile export rather than forking it appears correct and within the
   ticket's "reuse, do not fork" instruction — confirm that reading, and confirm the change
   is genuinely export-shape only with no behaviour change for a speaker. **PR #193 lands
   in `PortalPage.tsx` first and carries ~527 lines there**, so flag anything that will
   conflict semantically rather than just textually.
5. **The optimistic-update path.** Saving a recommendation builds an optimistic
   `DetailReview` client-side and moves the item into `completed`. That list now lives on a
   different page. Check that the home's "Your reviews" reflects a just-saved review
   correctly after navigation, and that a *failed* save still cannot erase an in-progress
   scorecard (the existing code is careful about this — confirm the split did not break it).

## Anonymity is the one that must not break

Blind review is a correctness property, not a feature. `round.anonymized` drives redaction
of speaker name, email, company and bio. The home page renders a completed-reviews list
that did not exist on a separate surface before. **Confirm no submitter identity leaks
through it** — not through a title, not through an API payload the home fetches, not
through the profile block. Check the reviewer-scope authorization still gates the home's
new data (`src/lib/reviewer-scope.ts`); `review.routes.ts` grew 110 lines and now returns
profile, committee membership, round close date and counts.

## Trust nothing this PR asserts about its own gate

The author already stated one falsehood in this ticket: it called the `D1Database`
typecheck failure "pre-existing client tsconfig errors." It was not — clean `main` at
`0592591d` runs `npx tsc -p tsconfig.client.json --noEmit` at exit 0, and the branch
introduced it. That was caught, corrected, and the record fixed, and the author's work is
otherwise careful — but it means claims in the PR body are evidence to check, not facts.

`fast-gate` is running on `d0e40ea2`. Read the finished run rather than the PR body's
summary of it. Note that the earlier failure died *at the typecheck step* and never reached
the tests, so this is the first CI run that says anything at all about the suite.

## Your output

A verdict the merge captain can act on, in this shape:

- **APPROVE / APPROVE WITH NITS / BLOCK**, stated in the first line.
- Blocking issues, each with file:line and why it is blocking.
- Non-blocking observations worth fixing later.
- Explicitly: does anything here make PR #193's `PortalPage.tsx` rebase harder?
- What you verified by running or reading, versus what you took on trust.

Post it as a review comment on the PR (`gh pr review 199 --comment --body-file …` — do
**not** use `--approve`, the human gate owns that), add it as a Lattice comment on MRQ-171,
then report the same verdict back to `surface:91` ("Reviewer home design") and stop.
