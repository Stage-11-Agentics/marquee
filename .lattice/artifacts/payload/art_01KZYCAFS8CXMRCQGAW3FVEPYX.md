# Code Review: MRQ-162

## 1. Verdict

**FAIL (implementation-level)**

## 2. Summary

Reviewed the actual PR (#177, `mrq-160-162-submitter-seat`, commit `d238ef6b`), not the prompt's supplied diff — that diff was truncated Lattice board noise (5000 lines of `.lattice/artifacts/*` JSON/MD, no application code) and never showed the real change. Pulled the true diff with `gh pr diff 177` instead. The PR bundles MRQ-160 (multi-event submitter seat) with MRQ-162 (honest accepted-state copy) as one commit.

MRQ-162's literal acceptance criteria are met: `submitterOutcomeDetail("accepted")` now returns a record-backed sentence, the forward "speaker portal" promise is gone from that branch, and a new unit test (`CONTRACT · MRQ-162`) locks it in. But the fix is incomplete against the defect the ticket itself describes: the identical false promise — "This page becomes your speaker portal... tasks... arrive here" — still exists verbatim at `PortalPage.tsx:926`, in the "what happens next" list shown to every submitter whose submission is `submitted` or `in_review`. That is the *default* status for an unreviewed submission, not the rare accepted-without-membership case this PR fixed. No test exercises this branch's copy, so it isn't caught.

## 3. Issues

**[MAJOR] src/ui/portal/PortalPage.tsx:926 — The exact promise this ticket exists to remove is still live, and reaches more people than the branch that was fixed**
The `isAwaitingReview` step list (shown for `status === "submitted"` or `"in_review"`, i.e. the default pre-decision state) contains:
```
<li><strong>If it is accepted.</strong><span>This page becomes your speaker portal — your tasks, profile, headshot, and session time all arrive here.</span></li>
```
This is line-for-line the same false promise the ticket describes for the accepted branch, unreachable for the same structural reason: acceptance only creates a `memberships` row (and thus a speaker seat) for `speaker`/`co_speaker` participations (`src/lib/speaker-membership.ts:87`); a submitter-only participant accepted later will land right back on this same submitter seat and never see tasks, headshot fields, or a session. Unlike the branch that was fixed, this one is shown to *every* submitter awaiting a decision — the common case, not the rare one the ticket's severity note carves out. The ticket's own framing ("the same defect class MRQ-150 exists to close: the portal saying something the record cannot support") applies here without qualification, and this line predates the PR (confirmed present on `main` unchanged), so the fix stopped one line short of closing the defect it names.
No test covers this: the default `submission()` test fixture is `status: "submitted"` (`tests/unit/submitter-portal.MRQ-150.test.ts:19`), which renders this exact string, and nothing asserts against it — only the new accepted-state test checks for absence of "speaker portal".
**Fix:** Replace the "If it is accepted" step with record-backed language, e.g. "If it is accepted, the program team will follow up with next steps for the abstract" — no forward claim about this page becoming anything — and add a test asserting the awaiting-review render does not contain "speaker portal" (mirroring the new MRQ-162 test), the same way the accepted branch is now locked.

**[MINOR] src/ui/portal/PortalPage.tsx:891, :925 — Accepted state now shows the identical sentence twice**
`heroCopy` for the accepted, non-draft/waitlisted/awaiting-review branch resolves to `submitterOutcomeCopy(lead.status)`, and the "Submission update" panel below renders `submitterOutcomeDetail(lead.status)`. Both now return the exact same string ("The program team accepted this abstract for the conference.") for `status === "accepted"`, whereas before the fix they were two different sentences by design (a short outcome line plus a separate detail line). The page will now visibly repeat one sentence twice in the accepted state, which reads as a copy bug even though each occurrence is individually true.
**Fix:** Not a correctness defect worth blocking on, but worth a one-line follow-up — give `submitterOutcomeDetail("accepted")` a second sentence that adds information (e.g. restating that no further action is needed) rather than repeating `submitterOutcomeCopy`.

## 4. Positive Observations

- The core MRQ-162 fix is correct and precisely scoped: `submitterOutcomeDetail("accepted")` states only what the record supports, and the new test (`tests/unit/submitter-portal.MRQ-150.test.ts:114`) pins the absence of "speaker portal", "tasks", and "session details" — exactly AC3's ask.
- AC2 (decide copy vs. membership bridge, say so before writing either) is handled well: the PR description states the product decision plainly and gives the actual reason (submitter-only participants are deliberately left without a membership per the MRQ-150 contract, so a bridge would change role semantics the record doesn't support).
- The bundled MRQ-160 event-switcher work is solid: `findSubmitterEvent`/`findSubmitterEvents` stay person+org scoped (no cross-tenant leak), the new `starts_on DESC` ordering is explained with a comment instead of left implicit, and the new two-conference integration test (`CONTRACT · MRQ-160`) actually walks both real public-form submissions and asserts neither leaks into the other's snapshot.
- `isSafeRedirectTarget` still holds for the new `redirectTo: /portal?eventId=...` (starts with `/`, not `//`), so the query-string carry-through doesn't introduce an open redirect.
- Good test hygiene per the PR body: new assertions were confirmed red against pre-fix code before the change, not just green after.
