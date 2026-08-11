# Marquee

Marquee is an open-source conference program workspace: CFP, review,
acceptance, speaker onboarding, agenda, and public publishing in one loop.

The foundation is Cloudflare Workers. D1 is the source of truth; R2 handles
uploads, KV handles cache, and Queues keep mail, mirror, and operations work
off the request path. The API is a first-class product surface, generated from
the same route definitions that serve the application. It is usable from a
browser, `curl`, or another program without reverse-engineering the UI.

## Marquee never phones home

You are running a conference, which means you are holding other people's data.
So this is stated here, in the first thing anyone reads, and not only in a doc
nobody opens:

**Marquee sends nothing to anyone.** There is no vendor SDK, no error-tracking
DSN, no analytics script, and no telemetry endpoint that is not your own
deployment. When a browser hits an error it posts a capped report to *your*
Worker, which writes one log line and returns — no table, no migration, nothing
kept.

**A speaker's email address cannot be logged**, because the log builder has no
field for it. Logs are built from an allowlist, not scrubbed by a denylist:
routes are recorded as templates, never as raw URLs, and there is no field
anywhere for a request body, a cookie, an `Authorization` header, or an address.

[`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) lists every event and every
field, and gives you three off switches. Every error surface also shows a short
reference code that greps straight to the log line behind it — the support
handshake is one paste, not a screen-sharing session.

## Status: local now, hosted after account setup

The local application runs today with Wrangler dev and Miniflare. The recipe
below builds the Worker, creates a fresh local D1, applies every migration,
seeds the deterministic demo data, starts the real Worker, and checks both its
health endpoint and a non-zero submissions response.

The hosted path is documented separately because it needs a real Cloudflare
account on Workers Paid, R2 entitlement, created D1/KV/R2/Queues resources,
production secrets, and a domain. Deploying to a real Cloudflare account is not
covered in this checkout. The `REPLACE_ME-*` and `replace-me-*` values in
`wrangler.jsonc` are a deliberate stop sign: do not deploy them.

## API and integration surface

The API bonus is concrete in a local or hosted instance. `/api/docs` is a
self-contained API & CLI reference linked from the application sidebar; it
reads `/api/openapi.json`, generated from the same route definitions that the
Worker serves. Use the versioned `/api/v1/...` paths from a browser, `curl`, or
CLI code.

Organization program leads and owners can issue named bearer tokens with
explicit permission scopes (`program:read`, `program:write`, `review:write`,
`speaker:write`, `agenda:write`, `comms:send`, and `mirror:write`). A token may
also be restricted to one or more conferences. Its secret is shown once,
metadata never exposes the stored hash, and revocation takes effect on the
next bearer request; effective authority never exceeds the issuer's
membership.

Signed outbound webhook endpoints are defined in the API contract, but
delivery is deferred: this checkout does not send webhook deliveries yet.

## Clean local checkout

Requirements: Node.js 22.18 or newer and npm. Use `npm ci`, not `npm install`,
so the lockfile is the dependency contract.

### 1. Install the checkout

```sh
npm ci
cp .dev.vars.example .dev.vars
```

`.dev.vars` is ignored and local-only. The example contains Cloudflare's
published always-pass Turnstile pair and fake local R2 signing values. Never
copy those values into a hosted Worker.

### 2. Build the Worker and prepare local D1

```sh
npx vite build
CI=1 npx wrangler d1 migrations apply DB --local --persist-to .wrangler/marquee-local
npm run seed -- --persist-to .wrangler/marquee-local
```

The build emits `dist/marquee/wrangler.json`, which is the local config used by
the next command. The seed is deterministic and idempotent; it creates the
synthetic AIE NYC sample, not real attendee or speaker data.

### 3. Start the local Worker for development

Keep this command running in one terminal:

```sh
npx wrangler dev \
  --config dist/marquee/wrangler.json \
  --local \
  --persist-to .wrangler/marquee-local \
  --local-protocol http \
  --port 8787
```

Wrangler dev is local-only here. It is not evidence that a production
Cloudflare account, paid-plan CPU limit, custom domain, R2 origin, or real
secret is configured.

### 4. Verify health and seeded data

In a second terminal, while the Worker is running:

```sh
curl -fsS http://127.0.0.1:8787/health
curl -fsS -c /tmp/marquee-local-cookies.txt \
  -H 'content-type: application/json' \
  --data '{"role":"organizer"}' \
  http://127.0.0.1:8787/api/v1/auth/demo
curl -fsS -b /tmp/marquee-local-cookies.txt \
  'http://127.0.0.1:8787/api/v1/events/evt_aie-ny-2026/submissions?per_page=1&page=1' \
  | grep -Eq '"total"[[:space:]]*:[[:space:]]*[1-9][0-9]*'
```

The first response is `{"service":"marquee","status":"ok",...}` and also names
the build it is serving, so a bug report is never ambiguous about the version.
The second
uses the seeded organizer persona. The third proves that the authenticated
list contains more than zero records; it is not a test against a hard-coded
HTML count.

### 5. One-shot clean-checkout smoke

For a no-human-input local proof, run this after `npx vite build`. It uses a
temporary persistence directory, waits for the Worker itself, checks health,
logs into the seeded demo, checks a non-zero list, and cleans up the Worker and
state when it exits:

```sh
set -eu
state_dir="$(mktemp -d)"
worker_pid=""
cleanup() {
  if test -n "$worker_pid"; then kill "$worker_pid" 2>/dev/null || true; fi
  rm -rf "$state_dir"
}
trap cleanup EXIT INT TERM

CI=1 npx wrangler d1 migrations apply DB --local --persist-to "$state_dir"
npm run seed -- --persist-to "$state_dir"
npx wrangler dev \
  --config dist/marquee/wrangler.json \
  --local \
  --persist-to "$state_dir" \
  --local-protocol http \
  --port 8787 >"$state_dir/wrangler.log" 2>&1 &
worker_pid="$!"

ready=""
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
curl -fsS -c "$state_dir/cookies.txt" \
  -H 'content-type: application/json' \
  --data '{"role":"organizer"}' \
  http://127.0.0.1:8787/api/v1/auth/demo >/dev/null
curl -fsS -b "$state_dir/cookies.txt" \
  'http://127.0.0.1:8787/api/v1/events/evt_aie-ny-2026/submissions?per_page=1&page=1' \
  | grep -Eq '"total"[[:space:]]*:[[:space:]]*[1-9][0-9]*'
```

## Deploy to Cloudflare

This is the production sequence once the account work is complete. It cannot
work against a fresh checkout until the placeholders in `wrangler.jsonc` have
been replaced with resources in your Cloudflare account. Keep the account ID
in the environment; do not commit it.

1. Authenticate and confirm the account preconditions.

   ```sh
   export CLOUDFLARE_ACCOUNT_ID="your-account-id"
   npx wrangler login
   ```

   Workers Paid is required for the production CPU budget. Confirm R2 is
   enabled and choose a domain for the Worker and its separate media origin.
   A Cloudflare API token supplied by CI is a precondition for the clean
   `check:readme` deploy; it is never a repository file.

2. Create the bindings and put their returned IDs/names into `wrangler.jsonc`.

   ```sh
   npx wrangler d1 create marquee-db
   npx wrangler r2 bucket create marquee-media
   npx wrangler kv namespace create CACHE
   npx wrangler queues create marquee-mail-queue
   npx wrangler queues create marquee-mirror-queue
   npx wrangler queues create marquee-operations-queue
   npx wrangler queues create marquee-webhook-queue
   ```

   The config expects one D1 database, one R2 media bucket, one KV namespace,
   and four queues. Update the database ID/name, bucket names, KV ID, queue
   names, account variables, and custom-domain routes before deploying.

3. Store production secrets through Wrangler.

   ```sh
   npx wrangler secret put TURNSTILE_SITE_KEY
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler secret put UPLOAD_TOKEN_SECRET
   npx wrangler secret put UPLOAD_RATE_LIMIT_SECRET
   ```

   Enter values from your secret manager when Wrangler prompts. Do not use
   `.dev.vars`, the published Turnstile test pair, or the fake R2 values for a
   hosted deployment.

4. Apply the schema, seed the remote D1, deploy, and check the public health
   endpoint.

   ```sh
   npx vite build
   CI=1 npx wrangler d1 migrations apply DB --remote
   npm run seed -- --remote
   npx wrangler deploy
   curl -fsS https://your-domain.example/health
   ```

   A successful deploy is not the same as a seeded deploy: migrations create
   tables, while `npm run seed -- --remote` creates the deterministic sample.
   Replace `your-domain.example` with the custom domain you configured. The
   application redirects non-loopback HTTP requests to HTTPS.

## Demo login and turning it off

One-click demo login is a `demo_mode`-only affordance. The route is
`POST /api/v1/auth/demo`; it creates a session only when an event has
`demo_mode = 1` and a matching demo persona exists. On an ordinary self-hosted
instance, turn it off explicitly after seeding:

```sh
npx wrangler d1 execute DB --remote \
  --command "UPDATE events SET demo_mode = 0;" \
  --yes
```

With demo mode off, the route returns `403` with the `demo_disabled` error and
sets no `mq_session` cookie. Do not hide a demo button and assume that is
enough; disabling the event flag is the production control. For a local
instance, use the same command with `--local --persist-to <your-state-dir>`.

## Empty installs and seeded installs

An empty database is a supported starting state. Apply migrations without
running the seed to inspect it: the landing page says that no demo conference
is configured, and application screens keep their empty state and next action
rather than inventing records. Run the seed when you want the populated demo
path above. A production owner should create their own organization and
conference data rather than treating the sample as their source of truth.

## Sessionize import

Sessionize import is built in. Upload the two CSVs from an export, inspect the
write-free mapping preview, persist any column choices, and run the import for
the selected conference:

```text
fixtures/sessionize/sessions.csv
fixtures/sessionize/speakers.csv
```

The preview and run cover sessions, speakers, relationships, evaluation scores,
canonical and raw statuses, headshots, and closed custom fields. Re-running the
same export is idempotent: existing rows are skipped or updated rather than
duplicated. The batch undo reverses the import's own rows from durable
snapshots, retains its manifest for audit, and leaves seeded data untouched.

The column mapping is verified against the bundled fixture above, but that
fixture has not yet been checked against a real Sessionize export. Before a
production import, compare the export's column names and status vocabulary with
the preview. This is a CSV import path, not a live Sessionize connection.

## Extension points and code map

The project keeps one obvious seam for each rule. If you add a feature, extend
the existing seam and its tests before introducing a second implementation.

| Concern | Source of truth | What an extension should do |
| --- | --- | --- |
| Conditional form fields | [`src/lib/form-conditions.ts`](src/lib/form-conditions.ts) | Use the shared evaluator for visibility, applicability, and missing-field projection. |
| Acceptance decisions | [`src/jobs/cascade/decisions.ts`](src/jobs/cascade/decisions.ts) | Route single and bulk decisions through the one decision writer and its cascade. |
| Outbound mail | [`src/jobs/mail/outbox.ts`](src/jobs/mail/outbox.ts) | Enqueue a demo-safe outbox row; the consumer is the only sender. There are exactly two `always_live` write sites, both explicit exceptions for the public-form confirmation and smoke harness. |
| API registration | [`src/routes/_manifest.ts`](src/routes/_manifest.ts) | Add a `*.routes.ts` module. The Vite glob updates the manifest and OpenAPI surface; do not hand-edit an import list. |
| Venue movement | [`src/lib/venue-geometry.ts`](src/lib/venue-geometry.ts) | Reuse the pure haversine/walking/transit helper and keep unpinned buildings honest. |
| Calendar delivery | [`src/jobs/calendar/ics.ts`](src/jobs/calendar/ics.ts) | Extend the ICS path for calendar clients. Calendar OAuth write is a documented extension point, not a built feature. |
| Observability | [`src/lib/observability/log.ts`](src/lib/observability/log.ts) | Add an event and its declared fields to the allowlist. A hosted error tracker is a one-function seam in the sink and in `browserSend`; gate it on a DSN so a deployment without one still talks to nobody. See [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md). |
| Data integrations | D1-backed API and import boundaries | A registration-platform sync and an Airtable mirror are extension points. D1 remains the source of truth; Airtable is a deliberate asynchronous mirror, not a source-of-truth system. Neither integration should be placed on a page read path. |

The three named integrations are intentionally honest: registration-platform
sync, Airtable mirror, and calendar OAuth are extension points, not silently
claimed features. The API, route manifest, pure condition/geometry helpers,
decision writer, and demo-safe outbox are the seams that exist now.

## Contributing

1. Start from a fresh branch and read the surrounding module before changing a
   shared seam.
2. Keep public data synthetic or reserved for documentation. Never commit
   `.dev.vars`, credentials, tokens, account IDs, or private exports.
3. Install from the lockfile and run the fast checks before opening a change:

   ```sh
   npm ci
   npm test
   ```

   `check:repo` is a publish-assembly check: run it against the explicit clean
   checkout and ref that you intend to publish, rather than an arbitrary
   working history.

4. Run the checks relevant to your change before opening a pull request. The
   public checks cover API parity, seed reachability, design contracts, and the
   hermetic test suite. A green local suite is not proof of a real Cloudflare
   deployment.
5. In the pull request, say what was observed locally, what needs a real
   account, and which follow-up is deliberately left as an extension point.

## Useful commands

```sh
npm test
npm run check:api
npm run check:seed
npm run check:design

# When something is wrong: the verdict, then the line behind the reference code.
node cli/marquee.mjs diagnose --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --bundle
node cli/marquee.mjs logs --tail --request-id 8f2a4c
```

The full test harness is intentionally hermetic: it does not contact a
deployed Worker, Resend, Airtable, R2, or a real inbox. Use the local smoke
above for Wrangler dev and reserve real-provider claims for a configured
Cloudflare account.
