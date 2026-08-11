# Plan Review: MRQ-78 — API tokens screen unreachable (org-scope membership never created)

Reviewer: Claude (plan review, cycle 2)
Base examined: working tree at `ba22fb3`

## 1. Verdict

**FAIL (plan-level)**

The ruling, the root-cause analysis, and the blast-radius reasoning are all correct — I
re-derived them independently against the code. The plan fails on two points, both of which
are amendments to plan *text* rather than a change of approach: the test strategy reproduces
the exact escape hatch that let this bug ship, and the plan's own recorded baseline says the
gate it commits to turning green is already red, with no stated path out.

## 2. Summary

Reviewed the MRQ-78 plan (path (a): seed the missing org-scoped `owner` row, leave
`requireTokenAdmin` untouched) against `src/routes/tokens.routes.ts`, `scripts/seed/evaluations.ts`,
`src/lib/reset-demo/demo-fixture.ts`, `src/lib/auth/scope-resolution.ts`,
`migrations/0001_init.sql`, and the existing test suite. The decision is the right one and the
plan is unusually disciplined about not moving seeded volumes. The key concern is that the
proposed tests all authenticate a **hand-authored** org-scoped owner — which is precisely how
this defect survived to a manual sweep — so the standing guard the ticket demands is weaker
than it looks.

## 3. Issues

**[MAJOR] Implementation §3–4 — The proposed tests repeat the exact escape hatch that produced this bug**

`tests/integration/api/tokens.AC-242.test.ts` **already exists**, already covers all three
`/api/v1/org/tokens` routes, and already passes today. It passes because at lines 115–117 it
hand-inserts its own principal:

```sql
INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
VALUES ('mem_tokens_owner', ?, NULL, ?, 'owner', ?, ?), ...
```

That `NULL` is a principal the seed cannot produce. Full route coverage plus a synthetic
fixture is the mechanism that let a dead screen ship — and the plan never mentions this file.

Step 3 then proposes a *second* Worker test built on the legacy `demoFixtureRows`, which step 2
patches with a *third* hand-authored org-scoped owner. After this plan lands, still nothing
exercises a token route as a principal that came out of the shipped seed. Step 4's Node guard
is the only shipped-seed coverage, and it *restates* the predicate (`org match && event_id === null
&& roleRank(role) >= roleRank("program_lead")`) in test code — a mirror that drifts silently the
day someone edits `requireTokenAdmin`. The ticket's standing requirement is that "the failure mode
that produced this must not survive"; a mirrored predicate over static rows is the weakest form
of that guard.

The cheap fix exists and costs almost nothing: `tests/integration/reset-demo.test.ts:271` already
calls `reseedDemo(env.DB, NOW, env.MEDIA)`, applying the **full shipped seed** inside the Worker
test environment.

**Recommendation:** amend the plan to (1) extend the existing `tokens.AC-242` test rather than
author a parallel file, and (2) add one route-level assertion pinned to the shipped seed — in or
beside the reset-demo test, `createSession` for `STAFF_PERSON_ID` then `GET /api/v1/org/tokens`
expecting 200 (and reasserting it after the idempotent second reseed). Marginal runtime ≈ zero,
since that fixture is already loaded. Additionally, have the Node guard **import** `roleRank`
from `src/lib/auth/scope-resolution.ts` instead of restating the ranking, so a rank change breaks
the guard instead of bypassing it.

---

**[MAJOR] Baseline observed §3 / Verification §2 — The plan commits to a green gate its own baseline says is unreachable, with no escalation path**

The plan records `npm test` timing out at 39.091s. `scripts/checks/run-test.mjs:7` sets
`HARD_LIMIT_MS = 29_000` against a 30s budget, so the fast suite is **red at baseline** and
`pr-gate` cannot come back green. Verification bullet 2 nonetheless requires
`npm run pr-gate -- --ticket MRQ-78` to pass, and the cycle-1 resolutions say only "a post-change
timeout remains a release blocker; do not hide it." Neither says what the delegator actually does
when it hits that wall — which means the implementer discovers a hard stop at the last gate,
after all the work, with no sanctioned move.

**Recommendation:** state the contingency explicitly: if the post-change gate is red *only* via
the pre-existing timeout, record both baseline and post-change timings as evidence, escalate to
the orchestrator, and do **not** silently proceed to `pr_open` or trim the ticket's verification
to compensate. Pair this with a hard constraint that MRQ-78's new tests add no measurable suite
time — which is a second reason to extend existing fixtures (issue 1) rather than stand up a new
full-seed Worker test.

---

**[MINOR] Implementation §1 — Seed primary-key collision is unnamed**

`scripts/seed/evaluations.ts:24-33` derives the PK as ``seedId("mem", `${personId}-${role}`)``,
and `run()` already calls `membership(ctx, STAFF_PERSON_ID, "owner")`. Adding the org-scoped owner
through that helper produces a **duplicate primary key** with the existing event-scoped owner row.
The plan says "with a deterministic ID" without naming the collision.

**Recommendation:** name the key in the plan — e.g. ``seedId("mem", `${STAFF_PERSON_ID}-owner-org`)`` —
and note that the helper needs an `eventId` parameter (defaulting to `EVENT_ID`) or a separate
call site, since it hardcodes `event_id: EVENT_ID`.

---

**[MINOR] Implementation §4 — "the reset test's expected membership count" is ambiguous, and one of the two must not move**

`tests/integration/reset-demo.test.ts` has two membership counts:
`SEED_COUNTS.memberships: 159` (line 70) and `UNRELATED_COUNTS.memberships: 1` (line 84). Only the
first goes to 160. The second is the foreign-tenant isolation guard — bumping it would quietly
weaken the assertion that reset touches only the canonical demo organization.

**Recommendation:** name both in the plan: `SEED_COUNTS.memberships` 159 → 160;
`UNRELATED_COUNTS.memberships` unchanged at 1.

---

**[MINOR] Implementation §2 — The legacy-fixture edit fixes nothing user-facing and may become unnecessary**

`src/lib/reset-demo/demo-fixture.ts:45` documents `demoFixtureRows` as a "Small fixture for
auth/API contract tests; never a production reset source," and the plan correctly confirms
production reset flows through `shippedDemoFixtureRows`. So step 2's only justification is that
step 3's new test consumes it. If the route proof is repinned to the shipped seed per issue 1,
step 2 may be droppable — and if it is kept, it is a test fixture change, not a fix.

**Recommendation:** state the dependency ("step 2 exists solely to back step 3's contract test")
so a reviewer does not read it as part of the user-facing repair, and drop it if step 3 no longer
needs it.

---

**[MINOR] Verification §3 — The real-artifact smoke omits the negative scope check**

The ticket requires the minted token "authenticates **and respects its scope**." The plan's browser
scope covers issue → call → revoke → confirm-stops, but never calls something *outside* the token's
grant or restricted conference. Since the plan already specifies a conference-restricted token, the
negative case is one extra request.

**Recommendation:** add one refused call with the same bearer — an endpoint outside its granted
permissions, or the same endpoint scoped to a conference the token does not hold — and capture the
refusal in the validation evidence.

---

**[MINOR] Decision §2 — "byte-for-byte unchanged" is imprecise, and the blast-radius claim deserves its evidence in the PR**

The `memberships` table demonstrably changes (159 → 160), so the claim reads as overstated. The
underlying argument is nonetheless correct, and I verified it: the seed declares exactly one event
(`scripts/seed/event.ts:82`), and every other consumer of the table filters on `role = 'speaker'`
or `membership.event_id = ?` — `src/routes/onboarding.queries.ts:390,558`,
`src/routes/comms.routes.ts:474,650`, `src/lib/reviewer-scope.ts:54`. An `event_id IS NULL` owner
row is therefore inert everywhere except `requireTokenAdmin` and `roleForEvent`, and since STAFF
already holds event-scoped `owner` on the only event, `roleForEvent` returns the same answer.

**Recommendation:** restate as "no submission, status, or volume outside `memberships` changes; the
single added row is inert to every non-token consumer," and carry the file:line list into the PR
body — that is the argument that MRQ-76's pipeline counts are safe.

## 4. Positive Observations

- **The ruling is correct and correctly argued.** Path (a) is the right call: the schema's
  `CHECK (role <> 'reviewer' OR event_id IS NOT NULL)` (`migrations/0001_init.sql:158`) makes an
  org-scoped `owner` legal today, and the demo organizer genuinely is the org owner in the
  product's fiction. Declining path (b) also correctly disposes of the cross-event escalation
  branch rather than half-implementing its narrowing.
- **Excellent parallel-run discipline.** The plan reads the MRQ-76 collision risk precisely and
  makes seed-volume preservation an explicit revert-triggering invariant, not a hope.
- **The reset-divergence trap is caught.** The plan correctly identifies that production reset
  consumes `shippedDemoFixtureRows` and therefore inherits the seed row automatically — exactly
  the MRQ-72 lesson, applied without being told the mechanism.
- **The baseline section is honest.** Recording the pre-existing 39s timeout *before* implementing,
  so a post-change failure can be distinguished from a pre-existing one, is the right instinct —
  it is only the missing contingency (issue 2) that turns it into a gap.
- **Scope boundaries are stated as prohibitions, not intentions.** The explicit non-scope list
  names files and reasons, which makes it reviewable rather than aspirational.
