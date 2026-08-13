# Plan Review: MRQ-80 — Recovery: fix an address and actually resend

Reviewed against `github/main` @ `75b871d9` (the commit the plan claims, and the current
tip of `github/main`). Source read: `src/jobs/cascade/decisions.ts`,
`src/routes/submissions-bulk.routes.ts`, `src/routes/speakers.routes.ts`,
`src/lib/delivery-health.ts`, `src/jobs/mail/consumer.ts`, `src/jobs/mail/outbox.ts`,
`migrations/0001_init.sql`, `src/ui/health/DeliveryHealthPage.tsx`,
`src/ui/submissions/SubmissionRecordPage.tsx`.

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The plan diagnoses the defect correctly and makes one genuinely important call — refusing
to delete the `settled.status = 'sent'` clause, which would turn every bulk-notify run into
a mass re-spam. But it covers roughly half the ticket: it silently drops the organizer-set
"not received" mark (AC2) and forbids the migration the ticket explicitly budgets ("at most
one nullable column"), and it says nothing about the three ACs that constrain *how* the
resend behaves — the send cap (AC3), double-click idempotency (AC4), and demo mode (AC5).
The idempotency gap is the sharp one: the very `retryKey` pattern the plan points a builder
at is designed to mint a *fresh* key per call, which is the direct opposite of AC4.

## 3. Issues

**[CRITICAL] Scope + Non-goals — the "not received" mark is dropped, and the plan bans the migration the ticket budgets**

The ticket's WHAT IT DOES has three bullets; bullet 2 is *"An organizer-set 'not received'
mark on the record… At most one nullable column,"* and AC2 tests exactly that behaviour.
The plan's "Scope — three things" contains no such item, and its Acceptance section does not
mention it. Worse, "Non-goals" states **"Do not add a migration. If you believe you need
one, you have probably wandered into MRQ-79's territory."** A builder following this plan
literally cannot satisfy AC2: there is no existing state anywhere in the schema that can
carry an organizer's assertion that a message did not arrive (`git grep -i "not received"`
across `src/` and `migrations/` at `75b871d9` returns nothing), and `outbox.status` has no
value that means "a human told us this bounced."

The MRQ-79 boundary argument does not actually cover this. MRQ-79 owns *provider-reported*
inbound state (`delivered` / `bounced_hard` / `bounced_soft` / `complained`, written by the
Resend webhook). An organizer-set mark is a different fact with a different writer — it is
precisely the case the ticket says "no provider will ever report." The two can coexist as
separate nullable columns without either owning the other's schema.

**Recommendation:** Restore the mark to scope and name it concretely — e.g.
`ALTER TABLE outbox ADD COLUMN marked_not_received_at INTEGER;` in its own migration file
(the repo already tolerates parallel numeric prefixes — there are three `0009_*` and three
`0010_*` files), plus the endpoint that sets it and the `OwedFact`/`OwedState` derivation
that puts the row back on the ledger. Say explicitly that this column is *not* the MRQ-79
delivery-state column and must not be named as if it were. If the operator instead wants
AC2 deferred to a follow-up ticket, that is a board decision — the plan cannot make it
silently by omission.

**[CRITICAL] Scope §2 / Acceptance — AC4 (idempotent under double-click) is unaddressed, and the referenced pattern guarantees the opposite**

The ticket says to mint a fresh idempotency key "so a NEW outbox row is created even when
the prior row is 'sent'," and AC4 says "Idempotent under double-click — one action, one
message." Those pull in opposite directions and the plan does not reconcile them.

Concretely, at `decisions.ts:551`:

```ts
const retryKey = await sha256Hex(`${templateKey}:${candidate.decision_id}:${newUlid(now)}`);
```

The ULID is fresh on every invocation, and `uq_outbox_idempotency_key`
(`migrations/0001_init.sql:791`) is the only dedupe in the system — `enqueueTrigger`
short-circuits solely on that key. So two clicks 200 ms apart produce two distinct keys,
two outbox rows, and two emails to the speaker. A disabled button in the UI is not a fix;
the endpoint is the contract, and the retry tool exists precisely for the moment an anxious
organizer is clicking things.

**Recommendation:** Have the plan choose and state a mechanism. Two workable shapes:
(a) derive the key from stable inputs the second click shares —
`sha256(templateKey:decisionId:toEmail:<action-token>)`, where the token is supplied by the
client (a ULID minted when the dialog opens) or by the record's current
`people.updated_at`; or (b) guard before enqueue: refuse (409, or return the existing
outbox id) when a `queued` outbox row already exists for this decision. Whichever is
chosen, require a test that calls the endpoint twice and asserts exactly one new outbox row.

**[MAJOR] Scope §3 — the named surface cannot host an action; the actionable surface is the record page**

The plan says *"`src/lib/delivery-health.ts` is the existing surface — extend it, do not add
a parallel page."* That module is explicitly pure: its header states *"Everything here is
pure: facts in, organizer sentences out… this module imports no binding."* It derives
`OwedMessage` rows with an `href`; it cannot own a button, a fetch, or a mutation. The SQL
that feeds it lives in `src/routes/health-surface.routes.ts`, and the page is
`src/ui/health/DeliveryHealthPage.tsx`.

The screen's own copy already points elsewhere: *"Open the record and send the decision
again once the reason no longer applies"* (`delivery-health.ts:326`) and *"send it again
from the record"* (`:336`). The record is `src/ui/submissions/SubmissionRecordPage.tsx`. So
the surface work is: an action on the record page (which is where the email edit belongs
too), and — if the row is to become actionable in place — a control on `DeliveryHealthPage`
that links to or invokes it. Pointing a builder at the pure derivation module will cost them
a wrong turn or, worse, produce a binding import into a module whose testability depends on
not having one.

**Recommendation:** Rewrite §3 to name the real files: action on `SubmissionRecordPage.tsx`,
new route in `submission-decisions.routes.ts` (or a new `submission-resend.routes.ts`
alongside the existing per-record route files), derivation changes in `delivery-health.ts`
kept pure, SQL in `health-surface.routes.ts`. State whether the health row gets an inline
control or just keeps its `href`.

**[MAJOR] Acceptance — three of the ticket's five ACs are missing from the plan's acceptance**

The ticket lists five ACs; the plan's Acceptance covers roughly AC1 and adds a bulk-notify
regression check. Missing:

- **AC1's teeth** — "verified end to end, not just at the endpoint." The plan's version stops
  at "the speaker receives it" with tests only at the resend/bulk/edit level. The repo has
  `npm run e2e` (Playwright) and a real Worker under `npx vite dev`; the plan should say
  which one carries the end-to-end proof, and that the proof includes the consumer actually
  processing the queued row.
- **AC3 (100-send cap / never bypass the outbox)** — worth stating because `DAILY_SEND_LIMIT`
  is *derived and reported only* (`delivery-health.ts:25`, `deriveQuota` at `:413`); nothing
  in `jobs/mail/consumer.ts` enforces it. So AC3 is really a structural constraint: the
  resend must go through `enqueueTrigger` + `enqueueMailMessage` like everything else, never
  a direct provider call. Easy to satisfy, easy to violate if unstated.
- **AC5 (demo mode still holds mail back)** — not incidental here. At `75b871d9` the exclusion
  clause the plan quotes has a second arm: a `suppressed` row with
  `suppressed_reason = 'demo_mode_not_allowlisted'` on a `demo_mode = 1` event *also* blocks
  re-notification. A per-record resend that bypasses that filter will re-enqueue in demo
  mode; the consumer's `shouldSuppress` will suppress it again (`consumer.ts:163`), which is
  probably correct — but the plan must say so, and should say what the organizer is told
  (`demoMailWouldBeSuppressed` is exported precisely so a route can tell the truth at the
  moment they act).

**Recommendation:** Replace the plan's Acceptance section with the ticket's five ACs, each
with the check that proves it, and add the demo-mode decision as an explicit design note.

**[MAJOR] Scope §1 — "use the existing edit path" without naming it, and without its failure mode**

The path exists: `PATCH /api/v1/events/{eventId}/speakers/{personId}`
(`src/routes/speakers.routes.ts:318`), which updates `people.email` and already enforces
case-insensitive uniqueness across the org, throwing `422 unprocessable` when another person
holds the address. That 422 is a live case for this feature — the bounced speaker's correct
address may already sit on a duplicate person row created by an earlier import. A plan that
says only "if an edit path already exists, use it" leaves the builder to discover both the
route and the 422, and leaves the UI behaviour on collision undefined.

**Recommendation:** Name the route and its schema, state that the record page must surface
the 422 as an organizer sentence (not a raw error), and decide — or explicitly defer — what
happens when the corrected address belongs to an existing person.

**[MINOR] Whole plan — no audit trail specified**

Every comparable organizer mutation in this codebase writes an audit row (`writeAudit` in
`decisions.ts`, `speakers.routes.ts`, `people.routes.ts`). A deliberate resend and a
"not received" mark are both exactly the kind of human assertion an organizer will later
need to reconstruct ("who said this bounced, and when?"). The plan doesn't mention audit.

**Recommendation:** Require `writeAudit` entries for both new actions, with action names in
the existing style.

**[MINOR] Header — state the base branch explicitly**

The plan says "Verified against `github/main` @ `75b871d9`," which checks out. But the
primary checkout's local `main` is at `2aa398a0` and is **not** a descendant of `75b871d9` —
its `decisions.ts` still has the older, pre-cursor, pre-demo-mode-carve-out version of the
exclusion clause. A builder who branches from the local checkout's `main` will be working
against different SQL than the plan quotes.

**Recommendation:** Add one line: branch from `github/main` (`git fetch github && git
worktree add ../Marquee-worktrees/mrq-80-… github/main`), not from whatever the primary
checkout has locally.

**[MINOR] Scope §2 — the mechanism for "bypass the filter for one record" is left open**

`notifyExistingDecisions` now carries batch semantics (`NOTIFY_DECISIONS_BATCH_SIZE = 200`,
`cursor`, `remaining`, `next_cursor`). "Add a deliberate, per-record resend" could mean
threading a `force` flag through that function — which touches the bulk path the plan
forbids changing — or a separate, narrower function. Left unstated, a builder may pick the
one the plan's own non-goal prohibits.

**Recommendation:** Say which. A separate function that loads one decision by id, skips the
settled-outbox filter, and shares `enqueueDecisionMail` is the smaller blast radius and
leaves the bulk query byte-for-byte unchanged.

## 4. Positive Observations

- **The defect is verified, not asserted.** The quoted SQL matches `75b871d9` exactly,
  including the demo-mode arm — the plan author actually read the tree they cite.
- **The single best call in the plan is the refusal.** "Do not delete the
  `settled.status = 'sent'` clause — removing it would be a mass-email incident" is exactly
  right, and it is the trap a builder reading only the ticket's opening paragraph would walk
  straight into. That one paragraph justifies the plan's existence.
- **The MRQ-79 boundary is drawn with a live sibling in mind**, names the branch, and gives
  a rule for what to do if MRQ-79 lands first (don't rebase; stand alone). Boundary-setting
  against concurrent agents is the failure mode this fleet actually has, and the plan takes
  it seriously — the boundary is just drawn one column too wide.
- **"If an edit path already exists, use it; do not build a second one"** and "extend it, do
  not add a parallel page" are the right instincts for a codebase this dense, even where the
  specific target is misidentified.
