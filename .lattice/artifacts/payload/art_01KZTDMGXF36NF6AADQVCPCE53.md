# Plan Review: MRQ-107 — Reviewer provisioning end to end

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

## 2. Summary

Reviewed the MRQ-107 plan against the ticket description, spec §T-A of `sequence/eval-response-tickets.md`, and the actual code. Every ground-truth claim in the plan was independently verified and held: the persona query at `auth.routes.ts:98-105` has no `ORDER BY`; `DEMO_ROLE_TO_MEMBERSHIP` sits at `auth.routes.ts:319` with only organizer/speaker; `addCommitteeReviewer` (`evaluation.routes.ts:555-587`) 404s without a pre-existing reviewer membership; the seed places 100 committee-assigned `reviewer_person_id = NULL` submissions on the program committee; `STAFF_PERSON_ID` holds owner+program_lead+reviewer (the trap, `scripts/seed/evaluations.ts:49-51`); the four unique indexes cited all exist at the stated lines in `migrations/0001_init.sql`; the `requestMagicLink` demo-mode on-screen-link precedent is exactly as described; and `LANDING_SCRIPT` is role-generic, so the third door needs no script change. The plan builds in the ticket's mandated order, respects the non-goals (`seat.tsx` untouched — confirmed it already ranks staff/reviewer/speaker correctly), and its self-review cycle already resolved the four hardest correctness traps. Remaining concerns are minor implementation details, listed below so the implementer hits them with eyes open.

## 3. Issues

**[MINOR] Tests — `auth-demo.test.ts` legacy fixture contains no reviewer persona and no staff-trap person**
The planned regression tests extend `tests/integration/auth-demo.test.ts`, but that suite seeds the legacy `evt_demo` fixture (`demoFixtureRows`), which has exactly two people: an owner and a speaker. There is no reviewer persona and no multi-role staffer, so the headline trap test ("`role:"reviewer"` never resolves to a person holding a staff role, even when that person also holds `reviewer`") cannot run against the fixture as-is — it would 403 with `demo_persona_missing` and prove nothing about the exclusion.
**Recommendation:** In the new tests, seed the trap explicitly: insert one person holding owner+reviewer (mirroring `STAFF_PERSON_ID`) and one pure-reviewer person into the test DB alongside the fixture, then assert the door picks the pure reviewer. This is a few inline INSERTs, not a fixture redesign.

**[MINOR] Section 1 (relax `addCommitteeReviewer`) — resolve the person via `people.org_id`, not a memberships join**
The plan says "look the person up by org membership in the event's org." If implemented as a join through `memberships`, a person with zero memberships (e.g., created directly in `people`) still cannot be direct-added, even though the route now mints the reviewer membership itself — the chicken-and-egg just moves one table over. The `people` table carries `org_id` directly.
**Recommendation:** Resolve `body.person_id` with `SELECT id FROM people WHERE id = ? AND org_id = (event's org_id)` and proceed from there.

**[MINOR] Section 1 (person resolution) — email normalization and re-invite update semantics unstated**
`uq_people_org_email` is on raw `people(org_id, email)`; `requestMagicLink` lowercases before lookup, implying stored emails are lowercase by convention, not by constraint. The plan matches on `lower(email)` but should also *insert* the lowercased form, or a mixed-case invite creates a row `requestMagicLink` can never find. Separately, the plan doesn't state what happens to `name`/`title`/`company` when re-inviting an existing person with different values — silently keeping the old values is a reasonable choice, but the idempotency test should pin whichever behavior is chosen.
**Recommendation:** Insert `lower(trim(email))`; state (and test) that re-invite does not overwrite existing person fields — or does, but pick one explicitly.

**[MINOR] Section 1 (batch) — the membership `INSERT … WHERE NOT EXISTS` must match the partial index key exactly**
`uq_memberships_event` is partial (`WHERE event_id IS NOT NULL`) over `(org_id, event_id, person_id, role)`, and the insert needs `org_id` (see the seed's `membership()` helper). The NOT-EXISTS guard must probe the same four-column key with `event_id = ?` (not NULL-tolerant matching), or a staffer who already holds an *org-wide* role could produce a semantically-duplicate or constraint-violating row.
**Recommendation:** Guard with `WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = ? AND event_id = ? AND person_id = ? AND role = 'reviewer')` — event-scoped only, mirroring the index predicate. The plan's resolution 1 already commits to the pattern; this just pins the key.

**[MINOR] Tests — the ABS-05 subset assertion depends on seed track distribution**
The queue-scoping test ("contains exactly the committee-assigned submissions that intersect their tracks — and not the ones outside them") is only meaningful if the 100 committee-assigned submissions actually span multiple tracks, so a one-track scope yields a strict, non-empty subset. This is almost certainly true of the seed but is asserted nowhere in the plan.
**Recommendation:** Have the test derive the expected set from `submission_tracks` at runtime rather than hardcoding counts, and assert both non-empty and strictly-smaller-than-total so a seed change fails loudly instead of vacuously passing.

## 4. Positive Observations

- **The ground-truth section is real, not decorative.** Every file:line claim I checked against the working tree was accurate — including subtle ones like the committee-inheritance branch in `assignedSubmissionIds`, the `authorizeReviewerQueueScope` track∩assignment intersection, and the observation that the existing persona query is *already* nondeterministic for speaker. This is planning done from the code, not from the ticket.
- **The self-review cycle caught the four traps that would actually bite:** race-safe idempotent inserts under the real unique indexes (with the correct rejection of check-then-insert), DELETE+INSERT scope replacement matching `replaceReviewerScopes`, minting the magic link outside the batch with the failure mode reasoned through, and the staff-exclusion carve-out that keeps `role:"organizer"` from excluding the owner it's looking for. Each resolution is correct.
- **Build order preserved and justified.** The plan not only follows the ticket's load-bearing order but restates *why* the landing door ships last (converting `cannot_judge` into `fail` otherwise) — the reasoning survives into implementation rather than being cargo-culted.
- **No second credential path.** Reusing `mintMagicLink` + `renderMagicLinkLoginMail` + `enqueueAuthMail` + the `demo_mode === 1` on-screen precedent is exactly the reuse the spec demands, and routing the mail through the outbox keeps `/communications` as evidence.
- **Scope discipline.** `seat.tsx` untouched, T-B/T-C's `EvaluationPage.tsx` regions respected, ≥1 track responsibility required with a stated product rationale (an unscoped reviewer is silently unassignable), and the honest-labelling rule applied to the invite UI copy. The requirement that scopes be *replaced* on re-invite so "the stated responsibilities are true after the call" shows the philosophy binding real decisions.
- **Validation plan is a real smoke pass as the invited reviewer** — matching §T-A's AC that the smoke-pass happen as the invitee, not the seeded organizer, and explicitly checking that no organizer navigation is exposed (the CFP-10 fail condition).
