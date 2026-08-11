# MRQ-80: Recovery — let an organizer fix an address and actually resend

The delivery-health screen tells an organizer to "send the decision again". The
system will not do it. This ticket makes that sentence true.

THE DEFECT
notifyExistingDecisions (src/jobs/cascade/decisions.ts:441), behind
POST /api/v1/events/{eventId}/submissions/not-notified/notify, excludes any
submission that already has an outbox row at status='sent':

  AND NOT EXISTS (SELECT 1 FROM outbox sent WHERE ... sent.status = 'sent' ...)

Since a send is marked 'sent' the moment the provider accepts it, a speaker
whose acceptance hard-bounced is both invisible to the health screen AND refused
by the retry tool. The one failure this product exists to prevent — a speaker
never learning they were accepted — is fully reachable today.

WHY THIS IS SEPARATE FROM MRQ-79
Detection and recovery have different costs and different dependencies. MRQ-79
needs a deployment and a provider dashboard step. This needs neither, and it
covers the case no provider will ever report: the speaker emails you saying they
never got it. Recovery is useful without classification; classification is
nearly useless without recovery.

WHAT IT DOES
- A per-record action: "This did not reach them — fix the address and send
  again." It mints a fresh idempotency key (the retryKey pattern at
  decisions.ts:504 already does this) so a NEW outbox row is created even when
  the prior row is 'sent'.
- An organizer-set "not received" mark on the record, so a message a human knows
  bounced lands on the delivery-health ledger without waiting for any provider
  to tell us. At most one nullable column.
- Health-screen rows that are actionable rather than advisory.

ACCEPTANCE CRITERIA
1. Editing a speaker's email and choosing send again produces a new outbox row
   and a real send — verified end to end, not just at the endpoint.
2. Marking "not received" puts the speaker back on the ledger with the decision
   intact and no duplicate decision written.
3. The daily 100-send cap is respected: recovery sends queue like any other and
   never bypass the outbox.
4. Idempotent under double-click — one action, one message.
5. Demo mode still holds the mail back exactly as configured.

WHEN DONE: there is no stuck case an organizer cannot get out of, whether or not
anything ever told us the message failed.
