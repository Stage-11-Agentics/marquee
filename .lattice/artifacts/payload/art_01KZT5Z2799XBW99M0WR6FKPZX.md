# Code Review: MRQ-99 — remove shell dead end and clarify decision copy

Branch `mrq-99-shell-copy` (HEAD `44ea8ef`, two commits) · PR [#53](https://github.com/Stage-11-Agentics/marquee/pull/53)

## 1. Verdict

**PASS** — the implementation meets every acceptance criterion, and the two claims
that could have been wrong (the geometry of the switcher→link change, and the
accuracy of the new decision-email promise) both check out against the code and
the captured screenshots. The findings below are all minor: dead overlay code left
behind in `AppShell`, a sibling dialog still speaking engineer, and an incomplete
`(optional)` sweep that the plan pre-declared out of scope.

## 2. Summary

Reviewed the full branch diff (Sidebar link, `unavailable` seam removal across both
shells, record decision copy, `(optional)` convention on three surfaces, one new
contract test), plus the surrounding code the copy makes promises about: the
decision writer (`src/jobs/cascade/decisions.ts`), the seeded mail templates, and
the sidebar CSS. I ran `npm test` myself — 109 node tests + the vitest suites, all
green, 27.5s against the 45s budget — and `tsc -p tsconfig.client.json --noEmit`
clean. The key finding is not a defect in what shipped but in what was left: with
the last `unavailable(...)` call site gone, `OverlayHost` / `OverlayState` and
`AppShell`'s `overlay` state are now unreachable dead code, and only one of the two
shells was cleaned up.

## 3. Issues

**[MINOR] src/ui/shell/AppShell.tsx:7,44,51,175 — the overlay host is now dead code, and the sweep stopped halfway**

`DeliveryHealthShell` removed its `OverlayState`/`OverlayHost` wiring in the follow-up
commit; `AppShell` kept its own. But nothing in `src/` sets a non-null `OverlayState`
anymore — `setOverlay` survives only inside `closeOverlay`, so `<OverlayHost
state={overlay} …/>` can never render, and `OverlayHost` and `OverlayState` in
`OverlayHosts.tsx:4,38` have no live consumer at all. The "Not installed / its owning
module has not landed yet" markup the ticket set out to kill is still sitting in the
tree, one `setOverlay` call away from coming back. Two shells that had identical
wiring now differ for no reason, which is exactly the kind of seam the next agent
re-introduces by copying the wrong one.
**Fix:** drop `overlay`, `closeOverlay`, the `<OverlayHost>` render, and the
`OverlayHost`/`OverlayState` import from `AppShell`; delete `OverlayHost` and
`OverlayState` from `OverlayHosts.tsx`, keeping `useDialogLifecycle` (used by
`QuickSearch.tsx:6`) and `ToastHost`. Then extend
`tests/node/mrq-99-organizer-copy.test.mjs` with
`assert.doesNotMatch(appShell, /OverlayHost/)` so the seam cannot quietly return.

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:620 — the bulk dialog now reads in two voices**

The label on line 621 was rewritten to `Feedback for the speakers (optional)`, but the
sentence directly above it still says *"The same normalized feedback is saved on each
decision row and rendered through the standard conference email"* / *"the feedback is
saved on each decision row, and no message is queued."* That is verbatim the schema-speak
the ticket calls a defect, and it is now the only engineer-voiced decision copy left in
the product — sitting one line above an organizer-voiced label. Scoping the diff to the
single label was the right call under the MRQ-98 ownership boundary, but the PR body does
not name the leftover, so it reads as finished.
**Fix:** either take the `<p>` too (it is dialog prose, not list/search/saved-view
behavior, so it is arguably outside MRQ-98's stated surface) with a Lattice note for the
rebase, or file a one-line follow-up and say so in the PR: the bulk dialog's explanatory
sentence still needs the MRQ-99 read.

**[MINOR] src/ui/forms/FormsPage.tsx:152, src/ui/portal/PortalPage.tsx:604 — the `(optional)` convention is not swept, and the convention is not written down**

The ticket asked for the treatment to be consistent "everywhere a field is marked
optional" and for the PR to state the convention settled on. `FormsPage.tsx:152` still
carries `Pattern · optional regular expression` — the exact `· optional` punctuation
this ticket exists to remove — and `PortalPage.tsx:604` still uses the leading form,
`Optional note to the program team`. (`EvaluationPage.tsx:297`'s "Edit optional
scorecard" is a heading, not a field label, and is fine.) The plan pre-declared this
narrow scope and the AC names only three surfaces, so this does not fail acceptance —
but the PR body describes the change without ever stating the rule, so the next agent
has nothing to follow.
**Fix:** state the convention explicitly in the PR — *field labels read
`Label (optional)`; the qualifier follows the noun in parentheses and never as a `·`
suffix* — and list the two remaining sites as known, deliberate leftovers.

**[MINOR] tests/node/mrq-99-organizer-copy.test.mjs:12-35 — the tests assert source text, not behavior**

Every assertion is a regex against raw `.tsx` source, including the literal attribute
order in `/<a class="event-switcher" href="\/dashboard"/`. This follows repo prior art
(`tests/node/reset-demo-ui.test.mjs:19` does the same), so it is idiomatic here — but it
pins formatting rather than behavior: swapping the attribute order or polishing a
sentence turns into a red suite that reads like a real defect, and nothing verifies the
thing the AC actually cares about (the conference name resolves to `/dashboard`, no
overlay is reachable). The browser run covered that once; it is not repeatable.
**Fix:** `preact-render-to-string` is already a dependency and already used by
`tests/unit/agenda-track-board.AC-78-81.test.ts`. Render `<Sidebar>` and assert
`a.event-switcher[href="/dashboard"]` appears in the output and that no `Not installed`
string can be produced; keep the prose assertions but match a short distinguishing
phrase rather than the full sentence.

**[NIT] PR #53 — the screenshots are in Lattice, not in the PR**

The AC says "screenshots in the PR"; the PR body says they were "attached to MRQ-99
validation artifacts". I verified the artifacts exist and show the correct state
(`art_01KZT5HZQRGNTA0TKQQB2Q618C` — sidebar conference block intact, waitlist dialog with
the new copy and the `Waitlist` CTA; plus three more covering the reviewer surface and
exact-head runs), so the evidence is real. But the collaborator who works through GitHub
cannot see any of it.
**Fix:** `gh pr comment 53 --repo Stage-11-Agentics/marquee` with the images uploaded, or
at minimum name the artifact ids in the PR body.

## 4. Positive Observations

- **The link is prototype-faithful, not just operator-satisfying.** The binding
  prototype already renders this element as an anchor —
  `prototypes/pipeline/index.html:543`, `prototypes/skins/skin-a.html:305` both use
  `<a class="event-switcher">`. The change moves the build *toward* the prototype it is
  supposed to reproduce one-to-one, which is a better outcome than the ticket asked for.
- **"Elements never jump" holds, and holds for a real reason.** `.sidebar` is
  `display: flex; flex-direction: column` (`components.css:2`), so the anchor is
  blockified as a flex item and keeps `width: calc(100% - 8px)`, the padding, border,
  radius and `margin: 0 4px 18px` from `components.css:6`. No `display` was added and
  none was needed. The captured screenshot confirms the block renders identically, and
  the anchor is a strict improvement on the button: cmd-click and middle-click now open
  the dashboard in a new tab.
- **The copy promises were verified against the writer, not assumed.** I traced them
  independently and they are true: `decisions.ts:854` and `:982` skip the mail branch
  when `target.status === "waitlisted"`, and `templates.ts:56,61` embed
  `{{decision.feedback}}` in both the acceptance and rejection bodies. So "the speaker
  will see the same words in the decision email" is accurate for accept/reject, "a
  waitlist does not send a message" is accurate for maybe, and renaming the CTA from
  "Waitlist and notify" to "Waitlist" fixes a button that was actively lying to
  organizers — a real defect nobody had filed.
- **The sweep is genuinely complete.** Zero `unavailable(...)` call sites remain in
  `src/`; the remaining grep hits are unrelated status/error vocabulary ("Settings
  unavailable", `provider_unavailable`). The "Not installed" overlay is unreachable from
  anywhere, not just the sidebar — which over-delivers on the AC.
- **Diff discipline under the ownership boundary was exact.** `SubmissionsPage.tsx` is
  touched on precisely one line (621), as instructed, so the MRQ-98 rebase is trivial.
- **Budgets respected.** My own run: suite green at 27.5s / 45s, `tsc` clean, no new
  dependencies, no deploy.
