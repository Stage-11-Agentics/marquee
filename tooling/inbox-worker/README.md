# Marquee inbox worker

This is a deliberately separate Cloudflare Worker and D1 database for
delivery oracles. The product Worker does not receive inbound mail and its D1
database never stores these messages. The email handler records only the
delivery envelope (`from`, `to`), the routing-provided subject, the receipt
timestamp, and the original RFC-822 body. It does not parse, forward, or
publish mail.

The included Wrangler configuration uses the `inbox.marquee.stage11.dev`
subdomain and a catch-all Email Routing address. Cloudflare Email Routing can
be enabled for a subdomain from the zone's Email Routing settings; DNS and
routing changes must be completed by an operator with access to that zone.
Each oracle run must generate a fresh localpart; never reuse a smoke address
after a delivery failure because providers may suppress that recipient.

## Self-hosting

1. Create or select a Cloudflare zone, then enable Email Routing for a
   subdomain such as `inbox.example.com`.
2. Create the dedicated database and replace `database_id` in
   `wrangler.jsonc`:

   ```sh
   npx wrangler d1 create marquee-inbox
   ```

3. Apply the migration and deploy the Worker:

   ```sh
   npx wrangler d1 migrations apply DB --remote --config tooling/inbox-worker/wrangler.jsonc
   npx wrangler deploy --config tooling/inbox-worker/wrangler.jsonc
   ```

   The top-level `addresses` entry creates the catch-all routing rule when the
   account and zone are ready. No repository secret is required by this
   Worker. Wrangler authentication, zone setup, and Email Routing enablement
   are operator actions.

4. Keep the D1 database private. The smoke scripts query it through Wrangler;
   there is intentionally no public mailbox-read endpoint.

For local development, use `npx wrangler dev --local
--config tooling/inbox-worker/wrangler.jsonc`. Cloudflare's local email
endpoint accepts a raw RFC-5322 message at `/cdn-cgi/handler/email`; the D1
local database can then be inspected with Wrangler. The product dev server
and this Worker are separate processes and separate data stores.

The catch-all would also observe RSVP replies if an ORGANIZER address is ever
routed into it. Reply classification is intentionally out of scope for this
worker; retaining the raw message leaves that future oracle possible without
making inbound mail part of product state.
