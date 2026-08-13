# Code Review: MRQ-102 — split speaker follow-ups from system health

Reviewed at `mrq-102-health-split` @ `0fb1946` (worktree
`/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-102-health-split`).
Verified by reading the diff plus the surrounding shell/route/bootstrap code,
inspecting the three attached screenshots, and running the suite, the gate, and
the design-contract check.

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the derivation split is genuinely well done. Three
delivered behaviours do not match the acceptance criteria: System health is not
reachable from the sidebar at all (AC-1), the new headline link renders with no
visible affordance (AC-4), and the page re-derives the speaker summary client
side without one of its inputs, producing a false sentence on the happy path.

## 2. Summary

The refactor of `summarize()` into `summarizeSpeakerFollowups` /
`summarizeSystemHealth` is the right shape: neither function can see the other
domain's facts, so AC-2 and AC-3 are structurally guaranteed rather than
policed by a priority chain, and the owed-speaker leak inside `emailCapability`
was removed at its source. Live proof for AC-4's hard constraint is good — the
headline says 610 and the destination view header says "610 decisions need
attention".

The failures are on the surface, not in the derivations. `System health` was
placed in the `utility` sidebar group, which `Sidebar.tsx` never renders (on
this branch and on `github/main`), so the page has no sidebar entry —
`artifacts/mrq-102-system-health.png` shows the gap directly. The headline link
sets `text-decoration-color/thickness/offset` but never `text-decoration-line`,
against a global `a { text-decoration: none }`, so it paints as ordinary text.
And `DeliveryHealthPage` recomputes the summary it was already handed, dropping
`sent_last_7_days`.

Suite 25.3s (budget 45s), gate 47.8s (budget 120s), `check:design` clean — all
inside budget, all passing.

## 3. Issues

**[CRITICAL] src/ui/shell/route-table.ts:37 — System health is not reachable from the sidebar (AC-1 unmet)**
The route is declared `group: "utility", sidebar: true`, but `Sidebar.tsx:12-16`
renders only `routesFor("home")`, `routesFor("pipeline")` and
`routesFor("modules")`; `routesFor("utility")` is rendered nowhere, on this
branch or on `github/main`. `artifacts/mrq-102-system-health.png` confirms it:
the sidebar ends at "Speaker follow-ups", and while standing *on* System health
no navigation item is active. The page's only entry point is the header link on
Speaker follow-ups, so a reader who arrives by URL, or who wants it from any
other screen, cannot get there. AC-1 requires both routes reachable from the
sidebar in their stated groups.
The ticket's ownership list forbade touching `Sidebar.tsx` because PR #53 was
open; #53 has since merged (`e1a461c`), so that block is gone.
**Fix:** render the utility group in the sidebar — `routesFor("utility")`
already filters to `sidebar: true`, so only System health appears. Add it below
Modules with its own `nav-label` (e.g. "System"), and extend the label contract
in `tests/unit/route-table.test.ts` to cover the new group. If touching
`Sidebar.tsx` is still off-limits, the alternative is to move System health into
`modules` and say in the PR that the ticket's group assignment could not be
honoured — but the sidebar route is the one that actually satisfies AC-1.

**[MAJOR] src/ui/health/DeliveryHealthPage.tsx:303-307 — the page states "0 messages sent in the last seven days" on a clean conference**
`summarizeSpeakerFollowups(snapshot.owed_total, snapshot.owed_urgent,
snapshot.quota.waiting, snapshot.quota)` omits the fifth argument, so
`sentLast7Days` falls back to its `0` default
(`src/lib/delivery-health.ts:858`). The snapshot does not carry
`sent_last_7_days`, so the client cannot supply it. With `owed_total === 0`,
quota clear and nothing waiting — the state a well-run conference sits in, and
the state the demo reaches once the ledger is worked — the verdict card reads
"Everyone who has been decided has been told. **0** messages sent in the last
seven days." while the API's own `summary` field carries the true count. A
status screen stating a number it did not read is exactly what this surface
exists to prevent.
**Fix:** in `speaker-followups` mode render `snapshot.summary` directly —
`deriveDeliveryHealth` (`src/lib/delivery-health.ts:928`) already computes it
with `facts.outbox.sent_last_7_days`, so the client-side re-derivation is both
lossy and redundant. Keep the client-side call only for `system-health`, which
has no server-side counterpart.

**[MAJOR] src/ui/health/health.css:33 — the headline "link" has no visible affordance (AC-4 half unmet)**
`.health-summary-link` sets `text-decoration-color`, `-thickness` and
`text-underline-offset`, but never `text-decoration-line`, and
`src/styles/tokens.css:62` globally sets `a { color: inherit; text-decoration:
none; }`. Nothing paints. `artifacts/mrq-102-speaker-followups.png` shows "610
speakers have not heard from you." rendered identically to plain text — same
colour, no underline, no cue. The ticket asked for the headline *itself* to
become the affordance, replacing a detail line that was standing in for a link;
as shipped, the affordance is still absent and only hover reveals it.
**Fix:**
```css
.health-summary-link { color: inherit; text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 2px; text-underline-offset: 3px; }
.health-summary-link:hover { color: var(--accent-dark); }
.health-summary-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
```

**[MAJOR] src/ui/shell/route-table.ts:37 — `external: false` contradicts how the route actually boots, and turns the AC-1 fix into a dead end**
`src/ui/app.tsx:35` mounts `DeliveryHealthShell` on `pathname ===
"/delivery-health"` only; AppShell has no branch for `system-health`. Declaring
the route `external: false` therefore asserts something untrue — that it lives
in the admin SPA — and it puts the row into `adminRouteTable` via
`isAdminRoute` (`route-table.ts:48-52`). The consequence is latent only because
nothing currently renders the utility group: `Sidebar.tsx:5` calls
`event.preventDefault()` and pushes client-side for any non-external row, so the
moment the sidebar renders utility (the fix for the critical issue above), a
click from any admin screen pushState's to `/delivery-health?view=system`
without a document load and AppShell falls through to the generic empty state —
"System health is ready for its module" (`AppShell.tsx:168-169`). That is the
dead end the walkthrough rubric forbids, and the ticket explicitly said to
preserve real browser navigation "for both pages".
**Fix:** set `external: true`, update the expectation at
`tests/unit/route-table.test.ts:15`, and add `"system-health"` to the two sorted
external-id lists at `tests/node/quick-search.AC-101-104.test.mjs:23,25`. Those
two lines are outside the ticket's stated ownership but are health-route shape
assertions; call the one-line change out in the PR body.

**[MAJOR] src/lib/delivery-health.ts:860-869 — a red quota alarm can sit under a green verdict**
When `owedTotal > 0 && owedUrgent === 0` the function returns level `"ok"` and
returns early, so the quota branches never run. A conference with five
in-flight owed messages and "Today's send allowance is used up." (level
`alarm`) renders a green-bordered verdict card reading "5 speakers have not
heard from you." directly above a red quota card. The page's own top line then
disagrees with the page. This is new: the previous chain reached the quota
alarm whenever the urgent count was zero.
**Fix:** derive the level from both facts rather than returning early, e.g.
`level: owedUrgent > 0 || quota.level === "alarm" ? "alarm" : quota.level ===
"warn" ? "warn" : "ok"`, keeping the owed headline. Add a case to the MRQ-102
test for owed-but-not-urgent plus a spent allowance.

**[MINOR] src/lib/delivery-health.ts:863 — the headline now counts the whole owed set, not the urgent set the ticket described**
AC-4 phrases the count as "the urgent set it counts"; the implementation counts
`owed_total` and links to `/submissions?status=not_notified`. That is defensible
— the binding constraint is that count and destination agree, and they do: the
`NOTIFICATION_GAP_PREDICATE` (`src/routes/submissions.queries.ts:328-330`) is
the same predicate as `OWED_FROM` (`src/routes/health-surface.routes.ts:158`),
and the screenshots show 610 → 610 live. It also fixes a latent skew, since
`owed_urgent` is only counted over the 2,000-row scan while `owed_total` counts
everything. But it changes the number the operator sees versus the one he
pointed at.
**Fix:** no code change needed; state the deviation and its reasoning
explicitly in the PR body so the operator can confirm the number he asked to be
clickable is the one now shown.

**[MINOR] src/ui/health/DeliveryHealthShell.tsx:40-41 — mode selection is exact query-string equality**
`matchRoute` matches `route.path === pathname + search`
(`route-table.ts:60`), so `/delivery-health?view=system&anything=1`, or any
reordering, silently falls back to Speaker follow-ups while the URL says
otherwise. Nothing produces such a URL today, but a query param appended by
anything (a campaign tag, a future filter) flips the page identity without a
signal.
**Fix:** read the mode from the parameter rather than the whole string —
`new URLSearchParams(window.location.search).get("view") === "system"` — and
keep `matchRoute` for the label only.

**[MINOR] src/ui/health/health.css:59,61 + src/lib/delivery-health.ts:419 — the added quota sentence outgrows its reserved height**
`sourceNote` adds ~120 characters to every quota `detail`, while
`.health-quota-line { min-height: 38px }` (≈2 lines at 12px/1.55) is unchanged
from the shorter copy it was measured against. The longest variant — the
shortfall alarm plus the tail plus the note, ~250 characters — wraps to three
lines at the widths in the screenshot and more below 1000px, so the card grows
when the level flips under a reader on a 10s refresh. That is precisely the
"elements never jump" rule. Separately, `.health-loading-card { min-height: 0 }`
cancels nothing (`.card` and `.health-quota` set no `min-height`) and is dead.
**Fix:** raise the reserved `min-height` to the measured height of the longest
variant (or give the source note its own fixed line under the bar), and delete
the `.health-loading-card` rule.

**[MINOR] src/ui/health/DeliveryHealthPage.tsx:146-166 — the follow-ups skeleton is not the loaded shape (AC-7)**
`FollowupsSkeleton`'s ledger card uses a 4-column row template against the
loaded 5-column one (`health.css:79,95`) and omits the reasons strip (46px),
the column head (32px) and the foot line (38px) that the loaded card renders
(`DeliveryHealthPage.tsx:232-241`). The card therefore changes both height and
column geometry on load. It is the last card, so nothing above it moves — the
capability list on System health keeps its fixed eight rows correctly — but the
follow-ups page does not hold the property the AC asks for.
**Fix:** mirror the loaded chrome in the skeleton: a reasons-strip placeholder,
the real `health-owed-head` row, a foot line, and the same five-column
template.

**[MINOR] tests — the UI half of AC-1, AC-4 and AC-7 is untested**
The new tests cover the derivations well but nothing asserts that the page
wires `mode` to the two panel sets, that the headline renders as an anchor to
`owed_href`, or that the loading state keeps its shape. The repo already has
the idiomatic vehicle for this (`tests/node/*.test.mjs` source-shape
assertions, e.g. `quick-search.AC-101-104.test.mjs`). Related: the AC-2 test's
`expect(summary.headline).not.toContain("storage")`
(`tests/unit/delivery-health.MRQ-102.test.ts:42`) passes for any capability
headline that happens to omit that word — the real guarantee is that the
function has no capability parameter at all, which the type signature already
enforces.
**Fix:** add a node source-shape test asserting the two-mode branch, the
`health-summary-link` anchor bound to `snapshot.owed_href`, and the sidebar
group placement; drop or replace the string-absence assertion.

**[MINOR] src/lib/delivery-health.ts:892-893 — System health leads with "unknown" and a mismatched detail**
The unknown branch pairs a generic headline with the *first* unknown
capability's detail, which reads on screen as "The system has not reported
every check yet." over "Deadline reminders has not checked in since the last
deploy." — two different levels of specificity, and a pre-existing subject/verb
slip in the borrowed sentence. It also means a freshly deployed install whose
cron has not yet reported shows UNKNOWN as the loudest line on the page, which
is what `artifacts/mrq-102-system-health.png` captures on an otherwise
all-green board.
**Fix:** name the unreported check in the headline (e.g. `${unknown.label} has
not reported yet.`), or rank unknown below ok so a board that is otherwise
clear says so.

**[MINOR] src/routes/health-surface.routes.ts:83,468 — the API description no longer matches what `summary` means**
`DeliveryHealthSnapshot.summary` is now the speaker-follow-ups verdict
exclusively, but the endpoint description still sells the field as the blended
"is my conference fine?" answer, and the schema comment says nothing. The
comment added at `src/lib/delivery-health.ts:209-213` says it is "kept for API
compatibility" — the shape is compatible, the meaning is not. No consumer other
than the page reads it, so this is documentation only.
**Fix:** one line in the route description saying `summary` answers the speaker
side, and that capability rows carry the system side.

**[INFO] branch state — the ticket's rebase-and-PR step is outstanding**
`HEAD` is 1 behind `github/main` (MRQ-101 `64039e1` merged after this work) and
2 ahead; no PR exists for `mrq-102-health-split`. The ticket requires rebasing
onto `github/main` immediately before opening the PR and re-running the suite
and gate at that exact head, plus a comment on MRQ-74 (not an edit to its
plan).

## 4. Positive Observations

- **The split is structural, not procedural.** `summarizeSpeakerFollowups` and
  `summarizeSystemHealth` take disjoint inputs, so AC-2 and AC-3 hold by
  signature — an infrastructure alarm cannot reach the people page because the
  function is never handed one. That is a much stronger guarantee than
  reordering a priority chain, and it is what makes the adversarial tests
  cheap.
- **The leak was fixed at its source.** Deleting the `owedAlarms` branch from
  `emailCapability` matters more than the summary split: that branch was how
  owed speakers were smuggled into a capability row, and it would have
  re-crossed the domains on the system page no matter how the summaries were
  derived. The replacement copy ("Those messages never left the connected mail
  account…") correctly stops pointing at a ledger that is no longer on that
  page.
- **AC-4's hard constraint was actually verified, not asserted.** The count and
  the destination agree because they share a predicate, and the screenshots
  prove it end to end at 610. The `owed_total` framing also removes a real
  skew, since `owed_urgent` is bounded by the 2,000-row scan and `owed_total`
  is not.
- **Quota copy is complete and tested across every branch.** All four
  `deriveQuota` verdicts carry the source note, and the AC-5 test loops over
  the ok / warn / alarm shapes rather than checking one.
- **MRQ-74's tests were adapted, not deleted.** Rewriting two assertions to go
  through `summarizeSystemHealth` preserves the original contracts ("unreachable
  storage is the loudest thing on the screen") under the new decomposition.
- **The contract guards were updated deliberately.** Both the design-contract
  label list and the route-table test were changed in the same commit as the
  labels, which is what those guards exist for; `check:design` passes and the
  suite (25.3s) and gate (47.8s) are comfortably inside budget.
- **Verification evidence was produced as asked** — three real screenshots of
  both pages and the link destination, committed with the work.
