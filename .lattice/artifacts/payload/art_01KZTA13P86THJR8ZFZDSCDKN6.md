# Code Review: MRQ-102 — split speaker follow-ups from system health

Reviewed at `b4528a4` ("close health route review gaps") on branch `mrq-102-health-split`, against the ticket, plan, and AC-1…AC-7. The presented diff is the gap-closing commit on top of the base split (`2239a`); the review verified the whole branch state, not just the diff hunks.

## 1. Verdict

**PASS**

## 2. Summary

The split is real and correctly scoped: two derivations that cannot see each other's facts (`summarizeSpeakerFollowups` takes only owed/quota inputs, `summarizeSystemHealth` takes only capability rows), two sidebar destinations in the right groups, both handed a real browser navigation, and a linked headline whose count structurally agrees with its destination (the health surface's `OWED_FROM` predicate and the submissions page's `NOTIFICATION_GAP_PREDICATE` are the same condition with the same prefer-`sent` outbox join). The gap-closing commit fixes three genuine review findings — the system-health route dead-ending as a client-side push (`external: false → true`), a quota alarm being invisible in the follow-ups level while speakers were in flight, and a 5-row loading skeleton that didn't match the loaded ledger shape. Everything verified below is green; the remaining issues are minor.

**Verified directly, not assumed:**

- `npm test`: 122/122 pass, 29.3s against the 45s budget, hermetic.
- `npm run pr-gate -- --ticket=MRQ-102`: **pass**, 42.9s against the 120s budget. (One earlier gate run failed on `public-form.AC-25-…` rate-limiting — see issue 4; it passes in isolation and on the gate re-run, and touches nothing this ticket owns.)
- The three attached screenshots (`artifacts/mrq-102-*.png`) show: the follow-ups page with the underlined "610 speakers have not heard from you." headline and the quota copy naming the connected email configuration and Resend; the destination page titled "Decided · not notified" reporting **610** — the counts agree; and System health in the new sidebar "System" group with the eight fixed capability rows and the improved unknown headline naming the specific check ("The Scheduled jobs check has not reported yet.").
- `?view=system` mode detection via `URLSearchParams` is robust to extra query params, and `matchRoute("/delivery-health?view=system")` resolves via the exact-string branch of `matchRoute` (route-table.ts:60), so the forced match is sound.
- `verify-design-contract.mjs` carries both new labels; the route-table contract test asserts them; AC-titled tests exist for every criterion (`trace:ac` shape respected).
- AC-per-AC: AC-1 through AC-7 all hold. The one interpretive note is AC-4's "urgent rows it counted": the headline counts `owed_total` and lands on the full not-notified set (610 → 610), which is the count-and-destination-agree property the ticket actually demands; the destination is the full submissions list, not a capped ledger, so no cap notice is needed there.

## 3. Issues

**[minor] src/ui/shell/Sidebar.tsx:50 — Touches a MUST-NOT-TOUCH file; justified, but the PR must say so**
The ticket forbids touching `Sidebar.tsx` because of open PR #53. PR #53 has since merged (`e1a461c` is in this branch's base), and the sidebar never rendered the `utility` group at all, so AC-1 ("reachable from the sidebar") is unsatisfiable without this two-line addition. The deviation is correct — but it is a deviation from the written ownership list, made after the constraint's stated reason expired.
**Fix:** No code change. State explicitly in the PR description that Sidebar.tsx was touched, why the #53 constraint no longer applies, and that the change is confined to rendering the utility group.

**[minor] src/lib/delivery-health.ts:867-869 — A quota-caused alarm carries a detail line that contradicts it**
When `owedTotal > 0`, `owedUrgent === 0`, and `quota.level === "alarm"`, the new level logic correctly raises the summary to `alarm`, but the detail still reads "These messages are still in flight or held on purpose" — reassuring words under an Act-now mark, with the actual cause (the spent allowance) visible only in the quota card below. The summary's level and its words disagree.
**Fix:** When the alarm comes from quota alone, branch the detail to name it, e.g. append or substitute "Today's send allowance will not carry them — see the allowance below." Keep it within the reserved `min-height` so nothing jumps.

**[minor] src/ui/health/DeliveryHealthPage.tsx:166 — 50-row skeleton reflows on small or clear conferences**
The skeleton now renders `OWED_LEDGER_LIMIT` (50) rows. On the demo conference (610 owed, ledger full) load is pixel-stable, which is the case the ticket's screenshots grade. But a conference with few or zero owed rows loads a ~3,000px skeleton that collapses to a handful of rows or the one-line "Nobody is waiting" message — a large jump under the elements-never-jump rule. A variable-length list can't be perfectly reserved, and matching the full case is a defensible choice; recording it as a known trade-off is enough for this ticket.
**Fix (optional, follow-up):** Remember the last-known `owed_shown` (e.g. sessionStorage) and size the skeleton to it, falling back to 50.

**[minor] tests/integration/api/public-form.AC-25-42-155-157-231-234.test.ts:349 — Pre-existing flaky rate-limit test surfaces under gate contention**
The first full gate run failed only this test (`expect(rateLimited).toBe(true)`); it passes alone and passed on the gate re-run. Not caused by this diff and outside this ticket's ownership, but it violates "a red suite must mean a real defect."
**Fix:** Nothing in this PR. File it for quarantine or deterministic clock control under its owning ticket.

Process notes, not defects: the branch is not yet rebased onto the current `github/main` tip (three new commits — MRQ-100 seed, docs; none touch owned files, clean rebase expected) and no PR is open yet — both are steps the plan explicitly sequences for immediately before PR-open. The MRQ-74 supersession comment should also be confirmed done at handoff.

## 4. Positive Observations

- **The separation is enforced by signatures, not discipline.** `summarizeSpeakerFollowups` and `summarizeSystemHealth` cannot receive the other domain's facts, so AC-2/AC-3 hold by construction; the adversarial tests then check it anyway.
- **One derivation for the linked count.** The page now renders the server-computed `snapshot.summary` instead of re-deriving client-side, removing a class of drift between the headline and the API — and the count-parity claim rests on two SQL predicates that are verifiably the same condition, including the subtle prefer-`sent` outbox pick that stops a failed retry from resurrecting a delivered decision.
- **The `external: false → true` fix closed a real dead end** — a client-side push to `/delivery-health?view=system` inside AppShell would have landed on the "ready for its module" empty state — and the quick-search contract test was updated deliberately rather than loosened.
- **The unknown-capability headline naming the specific check** ("The Scheduled jobs check has not reported yet.") is a genuine copy improvement over the generic sentence, visible in the screenshot.
- **Small craft touches done right:** explicit `text-decoration: underline` plus a `:focus-visible` outline on the headline link (keyboard affordance), skeleton rows matching the loaded five-column grid exactly, and the quota line's reserved height doubled to fit the new provenance sentence without reflow.
- **Verification was real:** committed browser proof with a count that matches across pages, and honest recording of the gate-budget story.
