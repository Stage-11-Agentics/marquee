# Plan Review: MRQ-160

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The submitted "Plan" is a verbatim copy of the Task Description — confirmed against
`.lattice/plans/task_01KZWDHXAMWTT8QJ8G9CK8VBXT.md` on disk, which is byte-for-byte
identical to the task text. It restates the bug and the acceptance criteria but proposes
no approach: no ordering decision, no API/response-shape change, no UI treatment for the
multi-event case, and no test design. Beyond the absence of a plan, the codebase carries
two facts a real plan would have to reckon with and doesn't: SPEC.md explicitly lists
"multi-event UI (modeled, not built)" as out of scope for this build, which sits in
tension with AC2's "reach each of them" requirement; and the confirmation-page link this
whole fix hangs on (`portal_url`) is only emitted when the event is in `demo_mode`, which
the reference test (`submitter-portal.MRQ-150.test.ts`) already had to special-case.

## 3. Issues

```
**[CRITICAL] Whole document — There is no plan**
The "Plan" section is identical, word for word, to the "Task Description" section
(compare lines 14–30 to 33–51 of this review's input, and independently confirmed by
reading .lattice/plans/task_01KZWDHXAMWTT8QJ8G9CK8VBXT.md directly). It contains zero
implementation content: no decision on what the new ORDER BY (or resolution logic)
should be, no design for how the submitter seat surfaces multiple events, no response
schema change, no UI component change, no test outline. A plan that only restates the
ticket gives an implementer nothing to build from and gives this review nothing to
evaluate against the Feasibility, Architectural Concerns, or Risk Identification
checklist categories — there is no proposed approach to check for feasibility or risk.
**Recommendation:** Return to `in_planning`. The plan must state, at minimum: (a) the
exact resolution logic replacing `ORDER BY e.starts_on ASC` in `findSubmitterEvent`
(see issue below — "latest starts_on" is not obviously equivalent to "the event just
submitted to"), (b) the `GET /api/v1/me/portal` response shape change needed to expose
"other events exist" to the client, (c) the UI treatment for the submitter seat when
multiple events are present, and (d) the specific new/changed test(s) and what they seed.
```

```
**[CRITICAL] AC2 / Architectural Concerns — "reach each of them" may conflict with a
standing SPEC ruling**
SPEC.md §8 (Non-goals) lists "multi-event UI (modeled, not built)" as **deliberately
out of scope for this build** (`EVALUATION.md` §5, ratified 2026-08-08). Separately,
SPEC.md §10 Amendment 15 rules the submitter-seat fix to be "one honest empty state
rather than a state-model change" — a deliberately narrow scope decision, not a
green light for a general switcher. AC2 asks for something that reads like a
lightweight version of the thing that was ruled out of scope: a way for the submitter
seat to "reach" other events holding their submissions. The existing app-wide
`EventSwitcher` (src/ui/shell/EventSwitcher.tsx, used in the organizer `Sidebar`) is
the wrong model to reuse here — it's staff chrome built on `memberships`-based event
context, not a read-only, single-purpose portal for a person who may hold no
membership at all. A plan is needed that either (a) proposes a scoped, portal-only
affordance (e.g., a static list of links to each event's portal snapshot, no
app-wide event-context switch) and argues why that doesn't reopen the "multi-event
UI" non-goal, or (b) flags this as a SPEC amendment that needs sign-off before
building. Neither option is discussed.
**Recommendation:** Add an explicit design decision to the plan: what exactly renders
when a submitter holds submissions in two events (a links list on the current seat,
a banner, a query-param switch — pick one), and a one-line note reconciling it against
SPEC.md §8's "multi-event UI... out of scope" line so a reviewer doesn't have to
independently discover the tension mid-implementation.
```

```
**[MAJOR] AC1 / Feasibility — the confirmation link this AC depends on is demo-mode-only
today**
`src/routes/public-form.routes.ts:793-798` only mints and attaches `portal_url` to the
confirmation state when `event.demo_mode === 1`; outside demo mode the confirmation
page never renders "Track your submission" at all (`src/ui/public/form/PublicForm.tsx:605`).
The reference test the plan cites, `tests/integration/api/submitter-portal.MRQ-150.test.ts`,
seeds `demo_mode: 1` specifically because "that is what makes the confirmation page
offer the portal link at all" (its own comment, line ~42). AC1 says "opens the
confirmation link and lands on the conference they submitted to" — if that link
doesn't exist for a real (non-demo) production event, the AC as stated may only be
verifiable in demo mode, which would be worth saying explicitly rather than leaving
implicit. The plan doesn't mention `demo_mode` at all, so it's unclear whether this
gap is understood, in scope, or being carried forward unexamined.
**Recommendation:** Plan should state whether AC1 is intentionally scoped to the
demo-mode confirmation flow (matching the MRQ-150 precedent) or whether this ticket
also needs to widen when `portal_url` is populated. If the former, say so and cite
the precedent; if the latter, that's materially more scope than the task description
implies and needs its own line item.
```

```
**[MAJOR] AC3 / Feasibility — "the FUTURE one" is not obviously the same as "latest
starts_on"**
The task's own diagnosis says the fix should resolve "the conference they just
submitted to," not simply "the latest-starting conference." Those are different
things whenever a person has participations in more than one *future* event (e.g.,
confirmed speaker at an event three months out, plus a submission just made to an
event next month) — naive `ORDER BY e.starts_on DESC` would pick the wrong one of
two futures, same class of bug as the one being fixed. A correct resolver more
plausibly needs to prefer the event tied to the specific submission/participation
that triggered the current session (e.g., via the `requestedEventId` the query
param and confirmation-link token already thread through `findSubmitterEvent`),
falling back to some ordering only when no specific event is signaled. None of this
reasoning appears in the plan, which is exactly the kind of resolver-behavior
decision AC3 demands be "explicit... not an accident of ORDER BY."
**Recommendation:** Plan must specify the actual resolution rule precisel, not just
"fix the ordering" — including what happens when the session/link doesn't carry a
specific event and there's more than one future participation.
```

```
**[MINOR] Files list — a cited line number has already drifted**
The plan (copying the task) cites `src/ui/portal/PortalPage.tsx:891` for the
`requestJson("/api/v1/me/portal")` call; on current `main` that call is at line 962
(confirmed by grep). PR #160 (merged same day, "Tell submitters the truth about
drafts and decisions") touched this same file after the task was filed. Not
independently blocking, but reinforces that this plan was never re-derived from the
current tree — a real plan pass would have caught the drift.
**Recommendation:** Re-verify all cited line numbers against current `main` before
implementation starts, and note in the plan that this is a live-edited file other
agents are also touching.
```

```
**[MINOR] Acceptance Criteria Coverage — no test-file decision made**
AC4 asks for coverage "built on the real public-form path the way
tests/integration/api/submitter-portal.MRQ-150.test.ts is." A real plan should name
whether this is a new file (e.g. `submitter-portal.MRQ-160.test.ts`) or an addition
to the existing one, and should note the `demo_mode: 1` seeding requirement carried
over from that file (see the demo-mode issue above) plus what a second event fixture
needs (a second `events` row, a second `forms`/submission tied to it, and asserting
the resolver picks the right one under `requestedEventId` absent and present).
**Recommendation:** Add this as an explicit plan step, not left to the implementer
to rediscover the MRQ-150 file's conventions from scratch.
```

## 4. Positive Observations

The task description itself (which the plan merely echoes) is well-grounded: it cites
precise file:line locations, correctly traces the bug to a real, reproducible `ORDER BY`
defect, connects it to the shipped multi-event shape (MRQ-129) so it isn't theoretical,
and explicitly provenances itself against the MRQ-150 post-merge review with clean
disambiguation of what's already shipped in #158/#160 versus what remains. The
acceptance criteria are concrete and testable in principle (AC1 and AC4 especially).
None of that is a plan, but it is a strong brief for one — the gap is entirely that no
planning pass turned it into a proposed approach.
