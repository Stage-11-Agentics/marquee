# Plan Review: MRQ-176

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The investigative groundwork is solid — the `createSpeaker` trace (`speakers.routes.ts:238`, `:324-331`) is accurate, and Part 2's diagnosis (the FILES panel summary line contradicts its own visible groups) checks out against `SpeakerFilesPanel.tsx`. But the submitted "### Plan" is a near-verbatim copy of the task description rather than an independent plan, and that copy carries a concrete, checkable defect: its own embedded Constraints section names the wrong ticket's branch (`mrq-174-roster-truth` instead of `mrq-176-roster-truth`), contradicting the correct branch name given earlier in the same prompt. One of the plan's own investigative hypotheses is also already settled by the current code and should be dropped before the implementer burns time on it.

## 3. Issues

```
**[CRITICAL] Plan → Constraints (embedded in "### Plan") — wrong ticket's branch name**
The Context's top-level Constraints (before "### Plan") correctly instruct:
  git worktree add ../Marquee-worktrees/mrq-176-roster-truth -b mrq-176-roster-truth main
But the Constraints subsection *inside* the submitted Plan text itself says:
  git worktree add ../Marquee-worktrees/mrq-174-roster-truth -b mrq-174-roster-truth main
This is ticket MRQ-176, not MRQ-174. The mismatch is strong evidence the plan was
copy-pasted from a different ticket's plan (or task description) and not adapted for
this one. An implementer who reads the Plan section as the authoritative instruction
(which is what a "Plan" document is for) will create a worktree/branch named for the
wrong ticket, which then shows up in the PR branch name and confuses tracking against
MRQ-176's board entry.
**Recommendation:** Fix the branch/worktree name inside the Plan's own Constraints to
match `mrq-176-roster-truth`, and diff the rest of the embedded Constraints block
against the top-level one to confirm nothing else was carried over from MRQ-174 by
mistake.
```

```
**[MAJOR] Plan body — the "### Plan" is a duplicate of the task description, not a plan**
Every section under "### Plan" (Part 1, Part 2, Acceptance, even "What I checked, so
you do not repeat it") reproduces the Task Description word-for-word. Nothing in it is
specific to *how* the implementer will proceed: no ordering of the investigative steps
in Part 1 ("look at roster-source.ts first vs. speaker-membership.ts first"), no
statement of which file(s) are expected to actually change, and no note on how Part 1
and Part 2 will be sequenced or whether they land in one commit or two. As written, a
reviewer cannot tell this plan apart from the ticket it was generated from, which
defeats the purpose of a planning gate: there is no additional judgment call visible to
critique.
**Recommendation:** Add a short "Approach" paragraph per part stating the concrete
first move (e.g. "confirm SPEAKER_ROSTER_PERSON_SOURCE returns the row for a freshly
inserted membership via a scratch query before touching any code; if it does, the bug
is upstream of the source definition, most likely in how the roster read is
cached/fetched") and name the file(s) expected to change.
```

```
**[MINOR] Part 1, "What I checked" bullet 3 — hypothesis already refuted by current code**
"The counts and the list may not read the same source... if any of them has its own
query, that divergence is the bug" is presented as something to confirm. It's already
false: `listSpeakers` (`src/routes/speakers.queries.ts:332-371`) computes `counts` by
filtering the exact same `rows` array that backs the table, and `rows` comes from one
call to `rosterRows` → `buildPeopleQuery` scoped by `SPEAKER_ROSTER_PERSON_SOURCE`.
Header, tabs, and table rows cannot disagree by construction today — there is one
query, not several. Leaving this hypothesis in the plan risks the implementer
re-deriving this (cheap, but not free) or, worse, treating "sources match" as evidence
the bug is fixed when it isn't.
**Recommendation:** Strike this bullet or replace it with the actual next question:
since counts/rows/tabs already share one source, why did a full reload still show
`All 509` unchanged? Point at request-level caching (fetch dedupe, stale response) or
a frontend read that isn't actually re-fetching on reload, since same-source-divergence
is ruled out.
```

```
**[MINOR] Part 1, "What I checked" bullet 2 — conflict-target scope not accounted for**
"Check what happens when a row for that (event, person) already exists with a
different role — `DO NOTHING` would leave no `speaker` row" doesn't match the schema
as documented: `speaker-membership.ts:17` and `uq_memberships_event` both state the
unique index is `(org_id, event_id, person_id, role)` — role is part of the conflict
target. A pre-existing row with a *different* role would not collide with a new
`role='speaker'` insert, so `ON CONFLICT DO NOTHING` would not suppress it. This
hypothesis is likely a dead end too, for the same reason as bullet 3.
**Recommendation:** Either drop this line or narrow it to same-role races (e.g. a
double-submit), which is the only case the constraint actually guards.
```

## 4. Positive Observations

- The `createSpeaker` trace in "What I checked" is accurate and verified against the
  live code (`speakers.routes.ts:238`, unconditional `speakerMembershipStatement` push
  at `:324-331` with `invitedAt` tied to `body.invited`) — this saves the implementer
  from re-deriving it.
- Part 2's diagnosis holds up: `SpeakerFilesPanel.tsx` already renders headshot and
  task-upload groups separately and correctly; the contradiction is confined to the
  single summary sentence at the top, so the acceptance criterion ("never state a
  received-count its own visible contents contradict") is a tight, low-risk fix.
- Acceptance criteria for Part 1 are concrete and testable, and AC4's demand for a
  route-level regression test (not a unit test of the membership helper) matches this
  repo's existing convention (`tests/integration/api/speakers-roster.MRQ-111.test.ts`,
  `speaker-files.MRQ-138.test.ts`), so the requested test shape is realistic to write.
- Constraints correctly guard against the two things most likely to go wrong at this
  moment: no migration without the operator, and no deploy while the eval round and
  `.deploy-freeze` are active.
- Grouping the two defects into one ticket is justified on its own terms (same
  discipline — a count contradicting the page's own contents — not shared code) rather
  than forced together for convenience.
