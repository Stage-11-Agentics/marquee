# Code Review: MRQ-79 — inbound Resend webhook, delivery truth

Reviewed at worktree `Marquee-worktrees/mrq-79-inbound-resend-webhook` @ `4f421f71`,
cross-checked against PR #129 head `61e36506` (same three MRQ-79 commits rebased onto
newer main — MRQ-79 file content is byte-identical, and the finding below reproduces at
both). The prompt's inline diff was truncated at 5,000 of 80,818 lines (mostly `.lattice`
noise), so this review was performed against the actual branch: the three commits
`e965165c` / `e4ad3cd7` / `4f421f71`, verified by running the tests in the worktree.

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the implementation is genuinely good — the signature
verification, the ordering/idempotency UPDATE, and the batch provider-id carry-fix are
all correct and well-tested. But the suite is red: the new route file trips the
pre-existing AC-250 conformance guard (`tests/node/comms.AC-250.test.mjs`), so
`npm test` — and therefore `npm run pr-gate` and CI — fail on this branch. The plan's
own acceptance line ("`npm run pr-gate` green before the PR") is not met. One focused
fix clears it; everything else found is minor.

## 2. Summary

The change adds `POST /api/v1/webhooks/resend` with Svix HMAC verification over the
exact raw body, migration `0014` adding structured delivery state to `outbox`, an
atomic event-clock-ordered idempotent apply, delivery truth wired through the
delivery-health derivation and screen, and the mandated `consumer.ts` fix so a short
batch response can never stamp a neighbor's provider id. All 23 new MRQ-79 tests pass
and the vitest suite is green; the single failure is the AC-250 node conformance test,
which flags `src/routes/resend-webhook.routes.ts` because its import of
`../lib/resend-webhook` matches the test's `/resend/i` import guard.

## 3. Issues

**[CRITICAL] tests/node/comms.AC-250.test.mjs:59 — the new route fails the "no production module imports a Resend client" guard, so the suite and gate are red**

The guard walks every `src/` module and asserts no import declaration whose module
specifier matches `/resend/i` exists (`providerImports` must equal `[]`). The new
route's `import { … } from "../lib/resend-webhook"` matches, so `node --test
tests/node/comms.AC-250.test.mjs` fails:

```
AssertionError: no production module imports a Resend client
+ [ 'src/routes/resend-webhook.routes.ts' ]
- []
```

`npm test` exits non-zero on this (verified in the worktree; note the runner still
prints "OVER BUDGET … Tests passed" prose while emitting `"status": "fail"` — do not
be misled by that line). CI's `npm test` step and the pr-gate will fail identically.

**Fix:** The guard's intent is provider isolation — no module besides the mail
consumer talks to the Resend *SDK/API*. A relative import of Marquee's own inbound
webhook lib is not that. Narrow the guard to bare package specifiers so it keeps its
teeth without false-positives on our own honestly-named modules, e.g. in
`comms.AC-250.test.mjs` only push when the specifier is not relative:

```js
if (
  ts.isImportDeclaration(node) &&
  ts.isStringLiteral(node.moduleSpecifier) &&
  !node.moduleSpecifier.text.startsWith(".") &&
  node.moduleSpecifier.text.match(/resend/i) !== null
) {
  providerImports.push(module.path);
}
```

The neighboring `providerEndpointRefs` assertion (only `src/jobs/mail/consumer.ts`
references `api.resend.com`) already covers the raw-endpoint case and still passes.
Renaming `src/lib/resend-webhook.ts` to dodge the regex would also work but makes the
name less honest; adjusting the guard to what it actually means is the better fix.
After fixing, run the full `npm test` (not a piped/filtered invocation) and confirm
the emitted JSON says `"status": "pass"` or `"pass-over-budget"`.

**[MINOR] src/lib/delivery-health.ts:657-663 (and 947-953) — "Your mail provider does not report delivery" fires even when the provider demonstrably does report**

The `unknown > 0` branch prints the AC5 self-hoster headline whenever *any*
sent/failed row has `delivery_state = 'unknown'`. Two cases make that claim false:
(1) the minutes-wide window right after a send, before the delivered event arrives,
on a fully configured deployment; and (2) permanently, for rows sent *before* the
webhook was configured — those stay `unknown` forever, so a deployment that adds the
webhook mid-conference (exactly the AIE NYC path) never reaches the green state and
keeps telling the organizer their provider doesn't report, while delivered events are
visibly landing. It errs in the safe direction (never implies green), but it is the
wrong sentence on the exact honesty axis this ticket exists for.

**Fix:** Distinguish "provider has never reported" from "signals pending". Cheapest
version with the facts already present: when `delivered + bounced_hard + bounced_soft
+ complained > 0`, render the unknown count as in-flight ("N messages have no arrival
signal yet") instead of the does-not-report headline, reserving the AC5 sentence for
the zero-signals case. A sharper version threads `Boolean(env.RESEND_WEBHOOK_SECRET)`
into `DeliveryHealthFacts` as a `delivery_reporting_configured` fact. Either is a
small, testable change to `emailCapability` and `summarizeSpeakerFollowups`.

**[MINOR] src/routes/resend-webhook.routes.ts + src/jobs/mail/consumer.ts — a delivery event that races the `markSent` commit is acknowledged and lost forever**

The webhook joins on `provider_message_id`, which is stamped by `markSent` *after*
`provider.sendBatch` returns. An event arriving in that gap (Resend suppression
bounces can fire near-instantly) finds no row, is absorbed quietly per the plan, and
returns 200 — so Resend never retries it, and the row sits at `unknown` permanently.
The plan said "absorbed quietly, not 500," which this honors; the trade-off just
deserves eyes. A retryable non-2xx (e.g. 404) for unmatched ids would let the 5s retry
land after the commit, at the cost of six bounded retries for genuinely-foreign ids.
Acceptable as shipped; consider it for the follow-up.

**[MINOR] src/routes/resend-webhook.routes.ts:53-54 — unreachable re-check of `svix-id`**

`verifySvixSignature` already fails when `headers.id` is null, so the later
`if (!eventId) throw ApiError.unauthenticated(…)` can only be reached by a header
that is all whitespace — which would then have failed signature verification anyway
(the signed content includes the raw header). Harmless, but it reads as a second
authentication step when it is dead code. **Fix:** hoist the id read above the verify
call and pass the same value to both, dropping the second throw.

**[MINOR] src/routes/health-surface.routes.ts:336 — hard-bounced calendar invites now count as invite *send* failures**

The webhook flips a hard-bounced sent row to `status='failed'`; the invite query
(`ics_uid IS NOT NULL AND status='failed'`) counts it in `invite_sends_failed`, whose
capability copy attributes failures to send/configuration problems. A bounced invite
did fail to reach its recipient, so this is mis-worded rather than wrong, and the row
also surfaces correctly on the owed ledger. **Fix (optional, small):** mirror the
outbox-facts pattern and add `AND COALESCE(delivery_state,'unknown') = 'unknown'`, or
leave it and let the owed ledger carry the bounce story.

## 4. Positive Observations

- **The signature verification is careful in exactly the ways Svix demands.** The raw
  body is read before any parsing (`context.req.raw.text()`), the header timestamp is
  signed *verbatim* rather than re-serialized (the dedicated `4f421f71` commit — a
  subtle bug class most first implementations hit), multiple space-delimited `v1,`
  candidates are each tried, comparison goes through `crypto.subtle.verify` (constant
  time), and freshness is enforced in both directions with a 5-minute tolerance. The
  HMAC is genuinely reused from `rate-limit.ts` as the plan directed, extended to a
  clean `hmacSha256`/`verifyHmacSha256` seam rather than duplicated.
- **Ordering and idempotency live in one atomic guarded UPDATE.** Event `created_at`
  is the cursor, the event id is a deterministic tie-break, and a replay is a no-op by
  the same WHERE clause — no read-modify-write race under concurrent webhook
  deliveries. The status CASE is smart: a hard bounce moves `sent → failed` while
  `error IS NULL` keeps synthetic webhook-failures distinguishable from real send
  failures, so a newer superseding event can restore `sent` without ever resurrecting
  a genuine send failure.
- **The migration slot was re-checked against moved reality.** The plan said `0013`;
  main took `0013_agent_evaluator_seats.sql` in the interim; the builder took `0014`,
  said so in the commit message, and registered it in the test applier — exactly the
  "re-check at the moment you write it" the plan asked for.
- **The carry-fix landed properly, not minimally.** `providerIds[index] ?? providerIds[0]`
  became "real id or NULL, never a neighbor's," `markSent` resets all delivery columns
  on re-send, and the integration test proves the second row of a short batch response
  stays `provider_message_id = NULL, delivery_state = 'unknown'`.
- **Test coverage hits every acceptance criterion at the right level:** signature
  accept/reject/stale/malformed at the lib layer; hard-bounce alarm copy, soft-bounce
  calm copy, complaint vocabulary hygiene (`not.toMatch(/complain|spam|webhook/i)`),
  and never-green unknowns at the derivation layer; and the full signed round-trip —
  join, replay idempotency, out-of-order protection, undisclosed unmatched ids —
  through `SELF.fetch` at the route layer.
- **Sibling boundaries were respected:** no touches to `decisions.ts`,
  `webhook_endpoints`, or `webhook_deliveries`; the outbound-webhook facts query was
  extended alongside, not rewritten. `readOutbox`'s failed count was narrowed so a
  provider bounce is never miscounted as "never left the building."
- **Open-source hygiene:** the secret exists only as a Wrangler secret and a
  commented `.dev.vars.example` line; README and GETTING-STARTED document the
  dashboard steps (per the plan's non-goal) and state the self-hosted degradation
  plainly.

One out-of-scope note for the board rather than this ticket: `scripts/checks/run-test.mjs`
prints "OVER BUDGET … **Tests passed**; the suite is slow" whenever the budget is
exceeded, even when the run *failed* (it did here, `"status": "fail"`, exit non-zero).
That prose actively misled this review until the exit code was checked. Worth a
one-line fix ticket: only print "Tests passed" when `exitCode === 0`.
