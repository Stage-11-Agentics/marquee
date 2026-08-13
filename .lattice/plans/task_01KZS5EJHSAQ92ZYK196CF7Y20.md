# MRQ-79 — Inbound Resend webhook: know whether a message actually arrived

Plan authored 2026-08-12 by `agent:board-reconciler` for a `gpt-5.6-luna` builder.
Verified against `github/main` @ `75b871d9`.

## Confirmed absent on main

No inbound provider webhook exists. There is no `POST /api/v1/webhooks/resend`
route, no Svix signature verification, and no structured delivery state. Grepping
`src/` for inbound-webhook patterns returns only unrelated hits.

**Do not be misled by `WEBHOOK_DELIVERY_STATUSES` in `src/db/schema.ts` or the
`webhook_endpoints` / `webhook_deliveries` tables in
`migrations/0005_task_cancellation_webhooks.sql`.** Those are Marquee's own
**outbound** webhooks — a different feature, owned by a sibling agent on
`mrq-128-webhooks-surface`. Yours is **inbound**, from Resend. Do not touch those
tables or that vocabulary.

`src/lib/mail-failure.ts:8` states the gap plainly: `outbox.error` never holds a
bounce because the provider webhook is not received. You are closing that.

## Scope

**1. The endpoint.** `POST /api/v1/webhooks/resend` — public by grant,
unauthenticated, verified by **signature instead**. Svix headers (`svix-id`,
`svix-timestamp`, `svix-signature`), HMAC-SHA256 against a `whsec_` secret in a new
binding. Reuse the `crypto.subtle` HMAC already in `src/lib/r2/rate-limit.ts:24` —
do not hand-roll a second one. Reject on bad signature; reject on a stale
timestamp.

**2. The join.** `data.email_id` → `outbox.provider_message_id`
(`src/db/schema.ts:354` — the column already exists). Unmatched ids must be
absorbed quietly, not 500.

**3. The state.** Store structured delivery state: `delivered` / `bounced_hard` /
`bounced_soft` / `complained`, plus `bounce_type` (`Permanent` | `Transient` |
`Undetermined`), `bounce_subtype` (`NoEmail`, `MailboxFull`, `Suppressed`,
`MessageTooLarge`, `ContentRejected`, `AttachmentRejected`, `General`) and
`delivered_at`.

**4. Migration — use `0013`.** Do not guess. `github/main` today carries duplicate
numbers already (**two** `0009`, **three** `0010`, **two** `0011`) and tops out at
`0012_people_annotations.sql`. Take `0013_inbound_delivery_state.sql`. Re-check the
merged tree at the moment you write it in case another agent lands one first.

**5. Ordering — the trap.** Resend does **not** guarantee order and delivers
at-least-once. Order by the **event's own `created_at`**, never by arrival time,
and make repeated delivery of the same event idempotent. Provider retries fire at
5s / 5m / 30m / 2h / 5h / 10h, so the same event *will* arrive twice in normal
operation. A later-arriving older event must not overwrite a newer state.

**6. Surface the truth.** `src/lib/delivery-health.ts` already carries a
`WebhookFacts` interface (line 138) and a comment at line 195 naming this exact
missing signal. Wire real state into it so the health screen stops inferring.

## Non-goals

- **Do not build the resend/recovery action.** That is MRQ-80, live right now on
  `mrq-80-resend-recovery`. It owns `notifyExistingDecisions` in
  `src/jobs/cascade/decisions.ts` and the delivery-health resend affordance.
- Do not touch `webhook_endpoints` / `webhook_deliveries` (MRQ-128's ground).
- Do not add provider dashboard configuration steps to the build; document them.

## Sibling boundary

Three agents are live. **You own** the inbound route, the signature verification,
and migration `0013`. MRQ-80 owns the recovery action; MRQ-128 owns outbound
webhook CRUD. If you find yourself editing `decisions.ts` or
`webhook_endpoints`, stop — you have crossed a line.

## Acceptance

- A signed Resend event updates the matching outbox row's delivery state; an
  unsigned or badly-signed one is rejected.
- Replaying the same event twice is idempotent; an out-of-order older event does
  not clobber newer state.
- Delivery health reflects real bounce state rather than inference.
- Tests cover signature accept/reject, the join, idempotency, and out-of-order.
- `npm run pr-gate` green before the PR.
