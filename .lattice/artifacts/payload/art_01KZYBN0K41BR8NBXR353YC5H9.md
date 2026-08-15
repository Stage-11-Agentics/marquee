# Plan Review: MRQ-165

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

I reviewed the plan against `src/lib/sessionize-import.ts`, `src/lib/speaker-membership.ts`, `src/lib/roster-source.ts`, and `sequence/submission/SUBMISSION-NOTES.md`. The root-cause analysis is accurate — `importSpeaker` in `sessionize-import.ts` does insert bare `people` rows without ever calling `speakerMembershipStatement`, and `SPEAKER_ROSTER_PERSON_SOURCE` in `roster-source.ts` confirms the roster is exactly the union the plan describes. The secondary ABS-14 doc task is also accurate and correctly located. The plan fails, however, because the FIX SHAPE's explicit scoping ("created AND updated speaker rows") leaves a real gap uncovered by its own acceptance criteria — a repeat speaker imported into a *second* event will often be marked `skipped` and silently get no membership for the new event, reproducing the exact bug being fixed. The plan is also thin as an implementation plan: it is a verbatim copy of the task description with no file-by-file breakdown, no test-file naming, and no design for the undo-snapshot extension it gestures at.

### 3. Issues

```
**[CRITICAL] FIX SHAPE — "created AND updated" excludes the "skipped" case that reproduces the same bug for a second event**
importSpeaker() (src/lib/sessionize-import.ts:460-531) computes outcome as
"created" only when no matching person row exists at all (by email, then by
name, org-scoped — not event-scoped); if a person already exists in `people`
(e.g. imported or added for a *different* event) and the CSV row's
name/email/title/company/bio are unchanged, outcome is "skipped" even though
that person has never been a member of *this* event. The plan's FIX SHAPE
calls the bridge only "for created AND updated speaker rows," so a returning
speaker who is being imported into a new conference for the first time — a
completely ordinary case for an org running multiple events — would go
through the same failure mode as Dana Kowalski: the CSV wizard reports
"skipped" (looks successful/idempotent), the person exists org-wide, but no
`memberships` row is written for this event, and they never appear on this
event's roster. This is not a hypothetical edge case; it's the second most
common import scenario after "brand new person," and the plan's own
acceptance criteria don't test it (AC1 only checks a "new person" fixture, AC3
only checks re-running the *same* import for idempotency, not importing an
existing-elsewhere person into a new event).
**Recommendation:** Change the FIX SHAPE to call `speakerMembershipStatement`
for every speaker row the import successfully resolves to a person (created,
updated, *and* skipped) — the call is already idempotent via
`ON CONFLICT DO NOTHING`, so there is no cost to calling it unconditionally.
Add an acceptance criterion / test fixture: import a person who already
exists in `people` (matched by email) with unchanged data, into an event they
are not yet a member of, and assert they land on that event's roster.
```

```
**[MAJOR] Undo path — snapshot design for "membership the import itself created" is unspecified**
The plan says "extend the import undo path so a membership the import itself
created is removed on undo — and only such a membership (snapshot or
attribute accordingly...)" but does not say how. The current `ImportSnapshot`
("before") captured for speaker rows (sessionize-import.ts:475-478) has no
membership field, and `restoreSnapshot` (sessionize-import.ts:804-822) has no
membership handling at all — it restores `people`/`attachments` fields only.
Given the fix above (write memberships for created/updated/skipped alike), the
undo logic must distinguish three cases per row: (a) person + membership both
created by this import row → delete membership, allow person cleanup; (b)
person pre-existed but had no membership for this event, membership was
created by this row → delete only the membership, keep the person; (c) person
and membership both pre-existed (e.g. organizer hand-added them, or an
earlier import already bridged them) → touch nothing. Case (b) is exactly the
gap identified above and is the case most likely to be gotten wrong if the
plan is implemented literally ("only such a membership" needs a concrete
"did a membership exist before this row ran" snapshot, not an outcome-based
heuristic, since outcome is `skipped` in exactly the case that matters).
**Recommendation:** Before implementation, decide and write down the
snapshot shape: capture whether a `memberships` row existed for
(event_id, person_id, role='speaker') at the top of `importSpeaker`, store it
in the `before` snapshot (new field, e.g. `membershipExisted: boolean`), and
have `restoreSnapshot`/`undoSessionizeImport` delete the membership row iff
`membershipExisted === false`. Also confirm ordering: `cleanupImportedPerson`
(sessionize-import.ts:790-802) already treats a nonzero `memberships` count as
a reason to keep the person, so the membership delete must happen *before*
that check runs for the row's snapshot restore to have any effect — the plan
notes this ordering concern but the actual undo loop (line 919 onward,
sessions before speakers by `ORDER BY CASE ... row_index DESC`) should be
re-checked to confirm speaker rows are still processed after any session rows
that reference the same person.
```

```
**[MAJOR] Plan lacks a file-level implementation breakdown and test plan**
The "Plan" section submitted for review is a verbatim copy of the Task
Description (compare lines 13-35 to 40-61 in the prompt) — it restates
symptom/root-cause/fix-shape/acceptance/constraints but does not translate
them into a plan: no enumerated file list, no named test file, no note on
whether existing tests (e.g.
`tests/integration/api/sessionize-import.AC-110-113.test.ts`) need updating
vs. a new `sessionize-import.MRQ-165.test.ts`, and no mention of the REST
route test required by AC4 (portal sign-in). "Does the plan identify which
files will be created or modified?" and "Are the criteria testable and
verifiable?" (per the review checklist) are only answerable by inference from
the task description, not from anything the plan itself adds.
**Recommendation:** Before implementation, add a short concrete section:
files to touch (`src/lib/sessionize-import.ts`,
`sequence/submission/SUBMISSION-NOTES.md`), the new/extended test file name,
and one line per acceptance criterion naming the test that proves it (AC1→
roster count test, AC2→undo test, AC3→idempotency test, AC4→portal sign-in
route test).
```

```
**[MINOR] AC4's "at least one route-level test" is under-specified**
AC4 says an import-created speaker must "reach the speaker portal... at least
one route-level test proves it," but doesn't say what "reach" means at the
route level (sign-in succeeds and returns 200/a portal payload? a specific
seat-resolution function returns the right seat?). Given `signin-destination.ts`
and `demo-seat.ts` both touch `memberships`, there's more than one place this
could be tested, and the plan doesn't pick one.
**Recommendation:** Name the specific route/test target, e.g. "a test that
signs in as the imported speaker's email and asserts the response resolves a
speaker seat for the target event" — matching whatever `signin-destination.ts`
exposes for existing speaker sign-in tests.
```

### 4. Positive Observations

- The root-cause analysis is genuinely accurate and well-sourced: `speaker-membership.ts`'s docstring, `roster-source.ts`'s `SPEAKER_ROSTER_PERSON_SOURCE`, and `sessionize-import.ts`'s `importSpeaker` were all checked against the plan's claims and match exactly, including the "exactly two callers today" claim and the `ON CONFLICT DO NOTHING` idempotency rationale.
- Correctly identifies that the fix is a single, narrow call-site addition rather than a schema change or a new abstraction — appropriately scoped to the existing bridge pattern instead of inventing a parallel mechanism.
- The undo constraint ("only such a membership") shows real awareness that a naive "delete all memberships for this person on undo" would be wrong (would strip pre-existing/hand-added memberships) — the instinct is right even though the mechanism isn't spelled out (see Issues).
- The grouped secondary doc task is well-scoped and its target location and surrounding rules were verified against the live file (`sequence/submission/SUBMISSION-NOTES.md`) and the actual "Add Agent evaluator" / agent-score-annotation UI (`EvaluationPage.tsx`, `SubmissionsPage.tsx`) — every claim in the ABS-14 paragraph checks out against current code.
- Acceptance criteria are concrete and testable as far as they go (specific endpoint, specific idempotency constraint `uq_memberships_event`, red-before/green-after discipline) — the gap is coverage, not testability.
