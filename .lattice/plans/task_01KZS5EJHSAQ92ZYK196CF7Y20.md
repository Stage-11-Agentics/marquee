# MRQ-79: Inbound Resend webhook — know whether a message actually arrived

A successful send tells us the mail provider ACCEPTED a message, not that it
arrived. Bounces are asynchronous and reach us only over a provider webhook we
do not receive, so today a hard-bounced acceptance sits at status='sent' with
error IS NULL, forever. This is the ticket that closes that.

Landed already (2f0e426, on MRQ-74): a classifier over the send-failure text we
DO store, and an honesty pass so no screen claims "delivered". This ticket adds
the missing signal underneath it.

WHAT IT DOES
- POST /api/v1/webhooks/resend — public, unauthenticated by grant, verified by
  signature instead. Svix headers (svix-id, svix-timestamp, svix-signature),
  HMAC-SHA256 against a whsec_ secret in a new binding. Reuse the crypto.subtle
  HMAC already in src/lib/r2/rate-limit.ts:24.
- Join data.email_id -> outbox.provider_message_id. Store structured delivery
  state: delivered / bounced_hard / bounced_soft / complained, plus bounce_type
  (Permanent|Transient|Undetermined), bounce_subtype (NoEmail, MailboxFull,
  Suppressed, MessageTooLarge, ContentRejected, AttachmentRejected, General)
  and delivered_at. Migration required.
- Handle at-least-once and OUT-OF-ORDER delivery: Resend does not guarantee
  order, so order by the event's own created_at, never by arrival. Retries fire
  at 5s/5m/30m/2h/5h/10h.

ACCEPTANCE CRITERIA
1. A hard bounce moves the outbox row off 'sent' and puts the speaker on the
   delivery-health ledger with a named address to fix.
2. A soft bounce reads as "still trying, we will tell you if it stops" and does
   NOT alarm.
3. notifyExistingDecisions (src/jobs/cascade/decisions.ts:441) stops treating
   status='sent' as "this speaker was told" — today it refuses to resend such a
   row, which is exactly the stranded-speaker case.
4. An unsigned or badly-signed request is rejected; a replayed one is idempotent.
5. Self-hoster degradation is explicit: a different mail provider or none leaves
   delivery state 'unknown' and the UI says "your mail provider does not report
   delivery". It must never imply green. This repo ships open source and is
   self-hosted by other conferences.

CARRY THIS FIX WITH IT
src/jobs/mail/consumer.ts:237 stamps providerIds[index] ?? providerIds[0] ??
"batch:..." on batch rows. A wrong provider id would join a bounce event to the
WRONG speaker, so it must be fixed as part of this work, not before it.

DEPENDS ON (operator, not agent): a live public HTTPS deployment, plus a webhook
configured in the Resend dashboard. Webhooks are included on the free tier
(100/day, 3000/mo, 30-day retention) — no upgrade needed.

WHEN DONE: an organizer opening delivery health can tell the difference between
a speaker who was told, a speaker whose message is still in flight, and a
speaker who will never hear from you unless a person fixes their address.
