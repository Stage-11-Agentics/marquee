# MRQ-80 — Recovery: let an organizer fix an address and actually resend

Plan authored 2026-08-12 by `agent:board-reconciler` for a `gpt-5.6-luna` builder.
Verified against `github/main` @ `75b871d9`.

## The defect, confirmed in source

`src/jobs/cascade/decisions.ts`, in `notifyExistingDecisions` (behind
`POST /api/v1/events/{eventId}/submissions/not-notified/notify`), excludes any
submission that already has a settled outbox row:

```sql
AND NOT EXISTS (
  SELECT 1
  FROM outbox settled
  JOIN events settled_event ON settled_event.id = settled.event_id
  WHERE settled.event_id = decision.event_id
    AND (settled.id = decision.outbox_id OR settled.entity_id = decision.id)
    AND (
      settled.status = 'sent'
      OR (...)
```

A send is marked `sent` the moment the provider **accepts** it. So a speaker whose
acceptance hard-bounced is both invisible to the delivery-health screen and refused
by the retry tool. This is the one failure the product exists to prevent.

## Scope — three things, in this order

**1. Make the address editable.** An organizer must be able to correct a speaker's
email address on the person/speaker record. If an edit path already exists, use it;
do not build a second one.

**2. Make resend possible for an already-`sent` decision.** The fix is *not* to
delete the `settled.status = 'sent'` clause — that clause is what stops the bulk
notify tool from re-spamming every accepted speaker on every run, and removing it
would be a mass-email incident. Instead add a **deliberate, per-record resend**:
an explicit organizer action against one submission's decision that bypasses the
not-yet-notified filter because a human asked for it by name. Bulk behaviour is
unchanged.

**3. Surface it where the organizer already looks.** The delivery-health screen
tells them to "send the decision again"; that sentence must become true from that
screen. `src/lib/delivery-health.ts` is the existing surface — extend it, do not
add a parallel page.

## Non-goals — do not do these

- **Do not implement the inbound Resend webhook.** That is MRQ-79, a sibling agent
  is building it right now on `mrq-79-inbound-resend-webhook`, and it owns the
  bounce-classification schema.
- **Do not add a migration.** If you believe you need one, you have probably
  wandered into MRQ-79's territory — stop and re-read the boundary below.
- Do not change bulk-notify semantics for the not-yet-notified path.

## The MRQ-79 boundary (read this — you have a live sibling)

MRQ-79 owns: any new table or column for inbound delivery state
(`delivered` / `bounced_hard` / `bounced_soft` / `complained`), the
`POST /api/v1/webhooks/resend` route, and Svix signature verification.

**You own:** the resend action, the address edit, and the delivery-health surfacing.
You must work only from state that exists on `main` today. If MRQ-79 lands first,
do not rebase onto it — your work must stand alone, exactly as this ticket's own
"WHY THIS IS SEPARATE FROM MRQ-79" section argues: recovery is useful without
classification, and it covers the case no provider will ever report (the speaker
emails you saying they never got it).

## Acceptance

- An organizer can correct a speaker's email address and trigger a resend of a
  decision that already shows `sent`, and the speaker receives it.
- Bulk notify still refuses to re-send to already-notified speakers.
- Tests cover: resend succeeds on a `sent` decision; bulk notify still excludes it;
  the address edit persists.
- `npm run pr-gate` green before the PR.
