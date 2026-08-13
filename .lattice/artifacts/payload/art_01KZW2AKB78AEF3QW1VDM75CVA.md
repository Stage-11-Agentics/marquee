# Code Review: MRQ-154 — "V2-5: submitting a proposal gives you a seat that shows it"

Branch `v2-5-submitter-seat` @ `fd1660c7` · PR #142 · reviewed against `github/main` @ `acc19c8a`.

> **Note on the supplied diff.** The diff embedded in the review prompt was 86,660 lines
> and truncated at 5,000 — it was computed against a stale base and mostly replays
> already-merged work (MRQ-150/#136 among others). I reviewed the real delta,
> `git diff acc19c8a..HEAD`: **5 files, +189 / −1**, listed below. Nothing in this review
> rests on the truncated diff.
>
> ```
> src/ui/portal/PortalPage.tsx                        |   1 +
> src/ui/public/form/PublicForm.tsx                   |   2 +-
> tests/integration/api/submitter-seat.MRQ-154.test.ts| 121 +
> tests/node/submitter-seat.MRQ-154.test.mjs          |  12 +
> tests/unit/submitter-seat.MRQ-154.test.ts           |  54 +
> ```

## 1. Verdict

**FAIL (implementation-level)**

The approach is right and the code is minimal and correct in behavior. It fails on the one
thing the plan reserved for last and the implementer explicitly did not do: the ticket's
headline string does not fit the fixed-width slot it renders into, and the plan's step 4
(real browser walkthrough) was recorded as *not run* ("Required c11 browser walkthrough
remains pending… no browser result is being claimed", lattice comment `ev_01KZW1YGBAVM8Y5CRQ1K3Z8BP8`).
The visual defect is exactly the class of thing that step exists to catch. It is a one-line
CSS fix; the ticket should come back only long enough to make it and to prove the screen.

## 2. Summary

Reviewed the two-line production delta (a `submitted` status label in the submitter portal,
and a "This link is your sign-in." sentence on the CFP confirmation) plus three new
CONTRACT test files. The logic is right, the scope discipline is exemplary — no widening of
the submitter query, no new account machinery, no reviewer/organizer change — and the
independent integration test is the strongest artifact here: it proves cross-submitter
isolation *and* asserts zero speaker memberships, which is the non-goal stated as SQL.
The key finding is presentational: `Submitted · awaiting review` renders into a 104px
fixed grid column as two uppercase mono lines with an orphaned `·` dangling at the end of
line one.

**Verification I ran myself** (worktree, this machine):

| Check | Result |
|---|---|
| `npm test` | **pass** — 142 files / 947 tests, 192 node tests, 33.2s |
| `npm run pr-gate` | **pass** — suite 38.9s (budget 45s), gate 43.9s (budget 120s), `overBudget: false` |
| Branch state | up to date with `github/main`; PR #142 `MERGEABLE`, CI `fast-gate` in progress |
| Portal row rendering | measured in headless Chromium against the real `tokens.css` + `portal.css` — see Issue 1 |

(The implementer's comment reported the hermetic suite as pass-*over*-budget at 54.4s under
load 7.79/73.59/121.22. On a quiet machine it is 38.9s. That was machine load, not a defect —
consistent with the CLAUDE.md guidance to check load before believing a time-only failure.)

## 3. Issues

**[MAJOR] src/ui/portal/PortalPage.tsx:788 (with src/ui/portal/portal.css:220,225) — the new status label does not fit its column and breaks across two lines with an orphaned separator**

`.portal-submitted-row` is `grid-template-columns: minmax(0, 1fr) 104px` and
`.portal-submitted-status` is `text-transform: uppercase; font: 600 10px/1 var(--mono);
letter-spacing: .08em`. That slot was authored for a one-word status. `Submitted · awaiting
review` is 27 characters — ~187px uppercase-mono — so it wraps.

Measured in headless Chromium with the repo's real `src/styles/tokens.css` +
`src/ui/portal/portal.css`, at a 560px panel:

| label | width | height | lines |
|---|---|---|---|
| `Submitted · awaiting review` (this change) | 104px | **20px** | **2** |
| `Accepted` (existing) | 104px | 10px | 1 |

Rendered, it reads `SUBMITTED ·` / `AWAITING REVIEW` — the middot orphaned at a line end.
The row's `min-height: 60px` absorbs it, so nothing overflows or shifts, but against
DESIGN.md's craft rules ("reserve space for swapped text; fixed-width toggles") and the
Flight Deck register (micro-label status chips that "scan in one pass"), a two-line ragged
chip with a dangling separator sitting beside single-line `ACCEPTED` chips is the wrong
result. This is also the screen a CFP-05 judge looks at, so it is the ticket's own shop window.

**Fix:** pick one and re-measure. Both verified rendering clean in the same harness:

- *Widen and pin.* `.portal-submitted-row { grid-template-columns: minmax(0, 1fr) 196px; }`
  and `.portal-submitted-status { white-space: nowrap; }` → one line, no overflow. Costs
  ~92px of title column; the title already ellipsizes, but check a 375px viewport, since
  `.portal-submitted-row` has no rule in either `@media` block (820px / 580px) today.
- *Two deliberate lines.* Render the label as two spans (`Submitted` / `awaiting review`)
  with `display: grid; gap: 3px; line-height: 1.1` on the status element → 104px × 25px, no
  orphaned `·`, no layout cost. Safer at narrow widths; keeps the brief's words while
  dropping only the separator glyph.

The measurement harness is ~25 lines of Playwright against the two real CSS files (Playwright
is already a dev dependency) — worth keeping as a node test if the fixed-width chip is going
to carry variable copy.

---

**[MINOR] tests/node/submitter-seat.MRQ-154.test.mjs:9 — the confirmation contract asserts on source text, not on rendered output**

The test `readFile`s `PublicForm.tsx` and regex-matches `/This link is your sign-in/`. That
passes whether or not the sentence ever reaches a screen — and it *is* conditional
(`{state.confirmation.portal_url && …}`), so the interesting failure mode (the branch never
renders) is precisely the one this test cannot see. Source-grep `.mjs` tests are an
established convention in `tests/node/`, so this is not off-pattern; it is under-powered for
this particular claim.

**Fix:** add a case to `tests/unit/submitter-seat.MRQ-154.test.ts` that renders `PublicForm`
with a `submitted` state carrying a non-null `confirmation.portal_url` and asserts both the
sentence and the link, mirroring how the portal contract is tested one file over. Keep the
node test or drop it; the render test is the one that means something.

---

**[MINOR] src/routes/public-form.routes.ts:794–798 — the seat handoff only exists for `demo_mode = 1` events, so CFP-05 is closed in demo mode only**

`portalUrl` is minted only when `event.demo_mode === 1`. For a real conference,
`confirmation.portal_url` is `null`, so both the "Track your submission →" link and this
ticket's new "This link is your sign-in." sentence never render — a real submitter still
leaves the confirmation with no route to the seat this ticket built. The gate is MRQ-150's
and this ticket's non-goals correctly forbid reimplementing it, so this is not rework here;
it is a scope fact the board should hold explicitly rather than inherit silently, because
MRQ-154 is the ticket that claims to close CFP-05.

**Fix:** no code change in this PR. File a follow-up (or a note on MRQ-150) for minting the
portal link on non-demo events, and state in the PR description that CFP-05 is satisfied on
demo events, which is what the eval harness exercises.

---

**[MINOR] src/routes/public-form.routes.ts:762–763 — the confirmation *email* still points only at the resume URL and says nothing about signing in**

The on-page confirmation now says the magic link is the account; the email that outlives the
page links `confirmationUrl` (the resume link) with the text "Review your conference
abstract", and carries no portal link and no sign-in framing. The durable copy of the
confirmation therefore doesn't carry the ticket's claim.

Not a correctness bug — I verified the seat is genuinely durable without it: a submitter
holds no membership, but `findPersonForSignin` (auth.routes.ts:440) resolves them by email,
`pickOutboxEventId` (lib/auth/signin-destination.ts:70) falls back to the org's newest event,
and `roleHome([])` returns `/portal`, so `/signin?next=/portal` does land them back on the
seat, exactly as the portal's own copy promises. The email is a copy gap, not a dead end.

**Fix:** optional in this PR — add the sign-in sentence to the confirmation email's text/html
when a portal link exists, or leave it to the follow-up in the previous issue.

---

**[MINOR] src/ui/portal/PortalPage.tsx:787 vs src/routes/portal.routes.ts:242 — two vocabularies for one status**

`submitterStatusLabel` (client) now returns `Submitted · awaiting review` for `submitted`,
while the server's `statusLabel` — which feeds the *speaker* portal's `status_label` and
`StatusHero` — still returns `Submitted`, as do `api/board.ts:28`,
`dashboard.routes.ts:62` and `SubmissionsPage.tsx:71`. A person who holds a speaker seat
from a prior decision and submits a new abstract sees the short form; a first-time submitter
sees the long one. The brief prescribed the exact long string, so this is not a deviation —
but note it is *new* vocabulary rather than "the vocabulary the decision flow already uses"
(`grep -rn "awaiting review" src` returns only this line).

**Fix:** none required for this ticket. If the long form is meant to be the vocabulary, it
belongs in one helper both seats read; if it is submitter-specific reassurance, a one-line
comment on `submitterStatusLabel` saying so would keep the next reader from "fixing" the
divergence.

## 4. Positive Observations

- **Scope discipline under a live dependency.** Two production lines, both exactly the
  delta the brief asked for, layered on #136 after its merge with no edits to files that
  ticket owned. The pre-merge checkpoint commit (`488acbfc`) that intentionally landed
  failing contracts, then passed *unmodified* after the rebase, is the right way to prove
  a contract was written independently of the implementation it grades.
- **The integration test is the real artifact.** `submitter-seat.MRQ-154.test.ts` walks the
  whole chain live — public form POST → 201 → magic-link exchange → 302 + cookie →
  `/api/v1/me/portal` — for two different submitters, then asserts each sees exactly one
  submission, that the *other* submitter's title appears nowhere in the serialized payload
  (`expect(JSON.stringify(...)).not.toContain(secondTitle)` — a leak check that survives
  future field additions), and that `COUNT(*) FROM memberships WHERE role = 'speaker'` is
  zero. That last assertion turns the ticket's "NO new account machinery" non-goal into a
  test, which is unusual and good.
- **The regression guard was not forgotten.** The unit test pins accepted/rejected headline
  and chip treatment alongside the new submitted copy, so the special-case cannot quietly
  grow to cover statuses it was never meant to touch.
- **The `submitted`-only special case is the smallest correct change** — the existing
  `split("_")` title-casing still handles `in_review`, `waitlisted`, `withdrawn`, `draft`
  unchanged, and `submitterHeadline` already carried per-status prose, so the fallback path
  is genuinely untouched.
- **Honest evidence.** The implementer recorded that the c11 browser walkthrough could not
  run (UI RPCs timing out at 10s) and explicitly declined to claim a browser result rather
  than papering over it. That honesty is what let this review go straight to the screen and
  find the one thing that matters.
