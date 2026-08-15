# Plan Review: MRQ-208 — attendee schedule rounds 2+3

Reviewer: plan-review agent (Claude) · 2026-08-14
Verified against the working tree at the primary checkout (`main`, de189c0e lineage).

## 1. Verdict

**PASS** — Implementation can proceed. The issues below are refinements to fold in
during the build (one edge case deserves a decision before the claim flow is coded),
not gaps that require re-planning.

## 2. Summary

Reviewed the MRQ-208 plan against the ticket contract, the design doc (§7 rulings), and
the actual codebase. The plan is exceptionally well grounded: every checkable factual
claim it makes is true (rooms already carry `capacity INTEGER NOT NULL CHECK (capacity >= 0)`
at `migrations/0001_init.sql`; next migration slot is 0017; `schema-verify.mjs` asserts
exactly 53 tables today so 53 → 56 is right for three new tables; `PublicationPanel`,
`AgentBrief`, `personReferences` in `org-imports.routes.ts`, `X-Schedule-Write-Key`,
`event_settings`, the Turnstile lib, and the KV limiter pattern all exist as described).
All nine deliverables and every binding constraint map to concrete work. The one thing
the plan does not pin down is multi-claim semantics — the same email verifying claims on
two schedule codes — which interacts badly with the unlink promise and should be decided
before D4 is written.

## 3. Issues

**[MAJOR] D4 / D1 — Same email claiming two codes is undefined, and unlink's promise depends on it**
`event_attendances` is unique on `(person_id, event_id, source)`, so one claim-sourced
attendance row per person per event — but `schedule_claims` is keyed by code, so nothing
stops the same email verifying claims on two codes (phone schedule + laptop schedule is a
plausible real flow). Which `schedule_code` does the single attendance row hold? And on
unlink of one code, the plan deletes "the claim-sourced attendance row" — which either
breaks the other code's still-verified claim, or, if skipped, makes the confirmation copy
("your email and picks are removed from the organizers' records") false while the other
claim row still links their email.
**Recommendation:** Decide the invariant now. Two clean options: (a) one active claim per
email per event — a second verify re-points the attendance row's `schedule_code` and
supersedes the first claim; or (b) unlink deletes the attendance row and person only when
no *other* verified claim references that person at the event. Either way, add the
two-codes-one-email case to the integration test alongside the existing three unlink rules.

**[MINOR] Architecture decision 1 — Event-scoped setting deviates from the ticket's "org-level" wording**
The deviation is well reasoned (no org-settings table exists; the governed surface and
thresholded data are both event-scoped) and the design doc never says "org-level" — it says
"public-display setting with threshold" and "the public-counts setting beside it," which is
scope-neutral. So the plan is probably reading intent correctly. But the ticket is the
signed contract, and a PR-description callout arrives late in the loop.
**Recommendation:** Post the deviation as a Lattice comment on MRQ-208 when work starts,
not only in the PR, so the operator can veto before the migration ships.

**[MINOR] D2 — Legacy NULL-`device_hash` schedules misattribute and double-count until they re-sync**
Every `public_schedules` row created before this ships has NULL `device_hash`, including
web-created ones. The demand aggregate counts them in the "no-hash" half, so a device with
a pre-existing synced code contributes twice (its old code + its new beacons) until its next
PUT self-heals the hash onto the row — and the stats row's "via agents" gauge will read
legacy web codes as agent traffic. The mechanism self-heals, but the validation gate says
gauges must reconcile.
**Recommendation:** Cover the legacy-row case in the demand-math unit tests, and make sure
the "gauges reconcile" validation is run against post-sync state (or the reconciliation
definition explicitly tolerates the transitional double-count).

**[MINOR] D4 — Claim token lifecycle unstated (expiry, single-use, scanner prefetch)**
The plan hashes the token (good) but never says whether verification is single-use or
whether a pending token expires. The retention ruling covers codes and feeds, not claim
tokens; an indefinitely-valid verification link sitting in an inbox is a small but real
surface. Relatedly, JS-executing mail scanners can trigger the client-driven verify before
the human opens the link — harmless here since the request was write-key-authorized, but
worth knowing when validating "first open = verification."
**Recommendation:** State the semantics in the plan of record: token invalidated on verify,
resend mints a fresh token invalidating the old, and either an expiry or an explicit ruling
that pending tokens persist.

**[MINOR] Architecture decision 2 — "capacity = 0 means unknown" is an invented semantic; verify seed data**
The ticket anticipated a nullable capacity column; the real column is `NOT NULL CHECK (>= 0)`,
so the plan maps 0 → unknown/em-dash. Reasonable — but only if no seeded or demo room uses 0
as a genuine value, and `src/lib/venues.ts` happily accepts 0 today.
**Recommendation:** One-line check of the demo-event seed before relying on it; document the
0-means-unknown convention where the demand bar computes the ratio.

**[MINOR] Validation — Dev mail-capture mechanism unnamed**
The ticket's gate says "dev: capture the mail/log" for the verification link; the plan's
validation section exercises the flow but doesn't say how the link is extracted locally
with `ATTENDEE_CLAIM_MAIL` in play.
**Recommendation:** Name the mechanism up front (e.g., the composed mail is logged/returned
by a dev-only sink when the flag is off or no Resend key is present) so the browser-automation
pass isn't improvising it at gate time.

## 4. Positive Observations

- **The plan is verified, not asserted.** Its riskiest factual claims — existing capacity
  column, table count 53, migration slot 0017, the `personReferences` inventory, the
  `PublicationPanel` anchor for the demand panel — are all true in the tree. This is what
  a plan cut from an actual read of the code looks like, and it removes the most common
  class of plan failure outright.
- **Deviations are explicit and argued.** Both departures from the ticket's letter
  (event-scoped setting; beacon limiter ceilings instead of a literal 30/hr/IP) come with
  the reasoning and a commitment to call them out. The NAT argument for the beacon limiter
  is exactly right — 30/hr/IP on a per-star control would blackhole a conference room.
- **The claim design closes real holes.** Write-key-authorized claim requests kill the
  open-mailer risk; the server composing the sync URL (never accepting one) is the correct
  hardening; the fragment-preserving client-driven verify is the only design that works
  without the server learning the key, and it reuses round-1's `#k=` stripping.
- **Single code path for the round-4 privacy rulings.** Keying claim state and speaker pins
  off write-key presence in the existing GET means the shared read-only link is clean by
  construction, not by a second filtered path — the cheapest way to make the ruling hold
  forever.
- **Derived pins, honest flag-off state, reserved chip slots, and the reference-inventory
  lift to `src/lib/person-references.ts`** all respect the binding craft rules and the CRM
  doctrine without inventing parallel structures.
- Tests and validation map one-to-one onto the ticket's gate list, and the suite-baseline
  capture before first change respects the 45s/120s budget discipline.
