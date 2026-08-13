# MRQ-159: Inbound Resend delivery webhook is unregistered and unsigned

Marquee verifies inbound Resend delivery webhooks correctly and receives none of them, because no
webhook endpoint has ever been registered on the Resend account. The signing secret currently on the
Worker is a random placeholder set to unblock a deploy.

## What is already true (do not rebuild this)

- `src/routes/resend-webhook.routes.ts` serves `POST /api/v1/webhooks/resend`, public + rate-limited.
- `src/lib/inbound-delivery.ts` `verifySvixSignature()` implements Svix correctly: HMAC over
  `${svix-id}.${svix-timestamp}.${raw body}`, freshness tolerance, raw body signed before parse,
  missing `svix-id` rejected as unauthenticated.
- `parseResendDeliveryEvent()` handles exactly four event types: `email.delivered`, `email.bounced`,
  `email.complained`, `email.delivery_delayed`. Everything else returns null and is acked with no effect.
- `applyResendDeliveryEvent()` joins by `provider_message_id`, applies in provider event order, and is
  replay-safe on event id.
- Migration `0014_inbound_delivery_state.sql` IS applied to production D1 (verified 2026-08-12).
- `RESEND_WEBHOOK_SECRET` is declared at `wrangler.jsonc:162` in `secrets.required`.

The code is complete. This ticket is configuration, not implementation.

## Evidence of the gap

    GET https://api.resend.com/webhooks  ->  200
    {"object":"list","has_more":false,"data":[]}

Zero endpoints. No events are being sent to anyone.

## Actions to take

Credentials: `RESEND_API_KEY` (full access) is in
`/Users/atin/Projects/Stage11/code/platform/.credentials/.env`. Service guide:
`/Users/atin/Projects/Stage11/code/platform/resend.md`. Never print a key into a transcript,
a commit, a PR, or this board -- Marquee's repo is destined to be public.

1. Register the endpoint via `POST https://api.resend.com/webhooks`:
   - endpoint URL: `https://marquee.stage11.dev/api/v1/webhooks/resend`
   - events: `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`
   Subscribe to those four only; the parser ignores the rest, so extra subscriptions are pure noise.
   Confirm the exact request field names against Resend's current API rather than assuming
   `endpoint_url`/`events` -- a wrong body fails loudly, which is fine, but do not guess twice.
   THE SIGNING SECRET IS RETURNED ONCE, AT CREATION. Capture it in that same step or you will be
   deleting the endpoint and making a new one to get it.

2. Set it on the Worker, replacing the placeholder:
       npx wrangler secret put RESEND_WEBHOOK_SECRET
   Takes effect immediately. No deploy, no downtime. Run it from a deploy shell with
   `CLOUDFLARE_API_TOKEN="$MARQUEE_CLOUDFLARE_API_TOKEN"` exported, per DEPLOY.md.

3. Verify end to end, not by status code. Send one real email through the app and confirm the
   matching `outbox` row moves `delivery_state` from `'unknown'` to `'delivered'`. A 200 from the
   endpoint proves reachability only -- it returns 200 for unmatched and unsupported events by design.
   State plainly if you could not get a real send through; do not infer success from a signature check.

## Decision the operator should see before step 1

Resend webhooks are ACCOUNT-level, not domain-level. This endpoint will receive delivery events for
every email the Stage 11 Resend account sends, including other projects'. Marquee handles that safely
already (unknown `provider_message_id` is acknowledged without disclosure), so nothing breaks -- but it
means Marquee's endpoint observes other projects' message ids. Worth deciding rather than discovering.
If that is unacceptable, the alternative is a scoped endpoint per project, which Resend may or may not
support at the domain level -- check before promising it.

## Done means

Endpoint registered, real signing secret on the Worker, and one real send observed flipping an outbox
row to `delivered`. Then file what you learned in `code/platform/resend.md` -- it has no webhook
section, and the next project will hit this same wall.
