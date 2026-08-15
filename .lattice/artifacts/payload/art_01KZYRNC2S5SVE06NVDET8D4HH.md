# Plan Review: MRQ-175

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The plan (which is a verbatim restatement of the task description, with no
implementation-level decomposition) proposes blocking bulk-queue on unknown
merge tokens. That directly contradicts a pre-registered, currently-passing
acceptance criterion — AC-261 in `EVALUATION.md`, backed by a live test
(`tests/integration/api/role-confirmation-feedback.AC-152-154-235-236.test.ts`,
the `AC-261` test at line 366) that asserts an unknown field
(`{{session.not_a_field}}`) is accepted and queued with `202`. The plan does
not mention AC-261, does not propose a reconciliation, and as written would
either fail its own regression test's sibling or silently break AC-261. It
also names only one of two bulk-send routes, and assumes a "known merge-field
set" exists as a reusable single source of truth when in fact the palette and
the runtime merge-data vocabulary already disagree.

## 3. Issues

**[CRITICAL] Acceptance criterion #1 ("queue is refused") — contradicts pre-registered AC-261 and its passing test**
`EVALUATION.md` AC-261 reads: *"test + e2e: all five place merge fields
resolve per recipient in the preview and in the rendered outbox body,
byte-identical; ... **an unknown field is left intact rather than blanked**."*
The test enforcing this,
`tests/integration/api/role-confirmation-feedback.AC-152-154-235-236.test.ts:366-394`,
posts a body containing `{{session.not_a_field}}` to
`POST /api/v1/events/:id/comms/send` and asserts `status === 202` — i.e. the
unknown-token send is accepted, not refused. MRQ-175's own acceptance
criterion #1 ("Queueing a bulk message whose body contains `{{portal.link}}`
is refused") is the opposite behavior for the same input shape. Implementing
the plan as written breaks a currently-green, pre-registered AC; leaving
AC-261's test unchanged means the branch cannot be green. This is exactly the
kind of conflict a plan review exists to catch before code is written.
**Recommendation:** Before implementation, get an explicit ruling: either (a)
AC-261 is amended (with the operator's sign-off, since it's pre-registered)
to scope "unknown field left intact" to the *preview* only, with queueing now
gated separately, and the AC-261 test updated to expect a block on send; or
(b) MRQ-175's scope is narrowed to warn-at-compose/queue without hard-blocking
the send, preserving AC-261 as written. The task description is explicit that
blocking bulk queue *is* the point of the ticket ("Blocking here is the point
of the ticket"), so (a) looks like the intended direction — but the plan must
say so and describe the AC-261 test update, not leave it undiscovered.

**[MAJOR] "What to build" §4 — second bulk-send route (`org-comms.routes.ts`) is not mentioned**
`sendOrgMail` in `src/routes/org-comms.routes.ts:136-203` is a second,
independent bulk-queue path (org-scoped mail, not event-scoped) that calls
the same `enqueueBulkReminder` → outbox → `enqueueMailMessage` pipeline as
`comms.routes.ts:sendComms`. The plan's item 4 covers "ad-hoc and stored
templates" through the renderer, but never identifies that there are *two
route handlers* that each need the queue-time guard inserted — only
`comms.routes.ts` is implied by the task's `/communications` framing. If the
validator is wired into `sendComms` alone, `sendOrgMail` ships the exact same
defect the ticket is about, unpatched.
**Recommendation:** Add `src/routes/org-comms.routes.ts` (the `sendOrgMail`
handler, immediately before its own `enqueueBulkReminder` call) to the list of
files to modify, and add an acceptance criterion or test covering the org
bulk-send path specifically.

**[MAJOR] "What to build" §1 — "the known merge-field set" is assumed to be a single existing source; it is not**
The plan says to compare extracted tokens "against the known merge-field
set — the same set the MERGE FIELDS palette renders, read from one place, not
a second hardcoded list that can drift from the palette." In the current
codebase these are already two different lists that disagree:
- Palette: `src/ui/comms/CommsScreen.tsx:84-95`, `MERGE_FIELDS` — 10 entries.
- Runtime vocabulary actually rendered: `src/jobs/mail/merge-data.ts:43-68`
  `mergeDataForRecipient` — 14 keys, plus 5 more in
  `mergeDataForReviewerReminder` (`:70-78`).

Keys `mergeDataForRecipient` can supply but the palette never lists:
`speaker.name`, `speaker.email`, `session.title`, `task.due_date`. A validator
seeded from the palette as-is would reject these as "unknown" even though
they render correctly today — a false positive that would block legitimate
sends. The plan's instruction to "read from one place" is the right design
goal, but that place doesn't exist yet; creating it is real, unscoped work
(a shared constant/module both the Workers-side routes and the client
`.tsx` component can import, or a runtime-derived set), not a rename.
**Recommendation:** Name this as an explicit step: reconcile
`MERGE_FIELDS` (`CommsScreen.tsx`) and `mergeDataForRecipient` /
`mergeDataForReviewerReminder` into one exported source of truth (e.g. a
plain array in or near `merge-data.ts`, imported by both the palette and the
new validator), and decide whether reviewer-reminder fields are in scope for
the `/communications` compose validator or a separate concern.

**[MINOR] Constraints — worktree branch name is internally inconsistent**
The "Constraints" section at the top of the task description (used for the
actual work) specifies
`git worktree add ../Marquee-worktrees/mrq-175-merge-token -b mrq-175-merge-token main`,
but the "### Plan" body pasted further down repeats the *entire* task
verbatim except this one constraint now reads
`git worktree add ../Marquee-worktrees/mrq-173-merge-token -b mrq-173-merge-token main`
— a different ticket number. This is very likely a copy-paste artifact from
a template plan (MRQ-173) that wasn't fully updated for MRQ-175, and is worth
flagging precisely because it's the kind of low-attention diff that produces
a wrongly-named worktree/branch.
**Recommendation:** Confirm the worktree/branch name is `mrq-175-merge-token`
before the implementer runs the command.

**[MINOR] "What to build" §2 — palette-derived message assumes a resolved list**
Item 2 requires the refusal message to read like *"Available fields are
listed under MERGE FIELDS"* — reasonable copy, but only correct once issue
above (unified field source) is resolved and the palette itself is updated to
include the four missing keys found in `merge-data.ts`. If the palette is
left as-is (10 fields) while the validator uses the fuller 14/19-key runtime
set, the error message points the operator at a palette that doesn't list
all valid fields, defeating the "fix it without hunting" goal.
**Recommendation:** Make palette-completeness (adding the missing four keys)
an explicit sub-step, not an implied side effect of "read from one place."

## 4. Positive Observations

- The plan correctly identifies and preserves the deliberate, load-bearing
  behavior of `mergeTemplate`'s null-value passthrough, quoting the source
  comment directly — this is exactly the kind of "don't fix what isn't
  broken" discipline that prevents a defect fix from regressing a documented
  design choice.
- The distinction it draws between "known field, no value for this
  recipient" (correct passthrough) versus "field name that can never
  resolve" (the actual defect) is precise and gives an implementer a clean
  test to apply token-by-token.
- Requiring the same check for `renderAdHocMail` and stored templates (item
  4) correctly anticipates that this codebase deliberately shares one
  renderer for both paths (confirmed: `render.ts:54-70`, both call the same
  `mergeTemplate`) — asking for a second, path-specific validator would have
  been the more obviously wrong shortcut, and the plan avoids it.
- Item 6 ("elements never jump") reflects the project's UI convention
  correctly — `CommsScreen.tsx`/`comms.css` already has a reserved-space
  idiom (`.reserved-copy { min-height: 118px }`, `.inline-error { min-height:
  40px }`) that a new warning banner should follow, and the plan's framing
  (reserve space, don't shift the textarea) is aligned with that pattern
  even without naming it.
- The acceptance criteria are concrete and testable ("fails on `main`, passes
  on the branch"), and the plan correctly separates "known field, null value"
  from "unknown field" as two criteria that must both hold — the risk of
  conflating them (and accidentally suppressing the designed null-passthrough
  warning) is real and the plan guards against it explicitly.
