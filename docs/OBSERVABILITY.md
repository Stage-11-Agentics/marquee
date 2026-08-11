# Observability

You are running a conference. That means you are holding other people's
data — names, addresses, biographies, the talk somebody was afraid to submit.
This document says exactly what Marquee records when something goes wrong, what
it will never record, where it goes, and how to switch it off.

Read the short version first:

- **Every failure produces one structured line, correlated by a request id.**
  The reference code on the error banner is a prefix of that id, so six
  characters read aloud over the phone are a `grep` that finds the line.
- **Nothing is sent to a third party. Ever.** There is no vendor SDK, no DSN,
  no analytics script, no beacon to anyone's servers but yours.
- **A speaker's email address cannot be logged**, because the log builder has
  no field for it. Not "is redacted" — has no field for it.
- **Nothing from the browser is stored.** Client error reports are logged and
  discarded. There is no table and no migration.

## What is recorded

Each event is one JSON object on a single line, written to your Worker's own
logs. Every line carries a timestamp, a level, an event name, a schema version,
the build SHA, and — when the event belongs to a request — the correlation id.

| Event | When | Notable fields |
| --- | --- | --- |
| `http_request` | Every completed API request | method, route template, status, `duration_ms`, `d1_queries`, `d1_ms`, principal kind, event id |
| `api_error` | Every API failure | route template, status, stable error code, whether it was expected, message, stack (unexpected failures only) |
| `queue_message` / `queue_error` | Each queue message consumed | queue, message type, outcome, job id, duration |
| `cron_run` / `cron_error` | Each scheduled run | cron expression, outcome, duration |
| `client_error` | A browser error, via the beacon | kind, message, stack, route template, build, ephemeral session id, occurrence count |
| `web_vital` | LCP / INP / TTFB, via the same beacon | metric, value, rating, route template |
| `diagnostics` | Each deep probe | verdict, duration, failing probes |
| `worker_error` | A failure outside a request, queue or cron | source, error name, message, stack |

## What is deliberately never recorded

The rule is an **allowlist**, not a redaction pass. Every event name declares the
exact fields it may carry, and the builder copies only those; anything else a
caller passes is dropped on the floor. This is a structural guarantee rather
than a discipline — a future contributor who has never read this document
cannot widen what gets recorded without adding a field, and adding a field is
the moment the question "could this ever hold something a speaker told us in
confidence?" gets asked.

Consequently there is no field, and therefore no possibility, for:

- **Request or response bodies.** Not truncated, not sampled. Absent.
- **Raw URLs or query strings.** Routes are recorded as templates —
  `/api/v1/events/{eventId}/dashboard` — because a raw URL is an exfiltration
  channel for whatever free text a caller put in a query parameter.
- **Cookies, session tokens, `Authorization` headers, or API tokens.**
- **Email addresses, names, biographies, or any submission content.**
- **IP addresses.** The principal is recorded as a *kind* — `anonymous`,
  `session`, `token` — never as a person.

Opaque identifiers (event ids, submission ids, request ids) *are* recorded.
They carry no personal content and they are what makes a failure followable.

Two fields — `message` and `stack` — are free text, because an exception
message can quote anything the code was holding at the time. Those are
additionally scrubbed for address-shaped and credential-shaped runs before
anything is emitted. The allowlist is the guarantee; the scrub is the seatbelt
on top of it. Every line is capped at roughly 4KB, and stacks at their top
twelve frames.

## Where it goes

To your Worker's logs, in your Cloudflare account, and nowhere else.

The browser beacon at `POST /api/v1/telemetry/client-errors` posts to *your*
deployment. Its handler writes one log line and returns. There is no database
write, no forwarding, and no external request anywhere in the path. If you want
to verify that claim rather than take it, the whole path is
`src/ui/shell/error-reporting.ts` and `src/routes/telemetry.routes.ts`, and it
is short on purpose.

## Reading the logs

```sh
# The verdict first: is anything broken, and where?
node cli/marquee.mjs diagnose --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json

# Then the line behind the reference code the organizer read off the screen.
node cli/marquee.mjs logs --tail --request-id 8f2a4c

# Or everything at error level, or one event name.
node cli/marquee.mjs logs --tail --level error
node cli/marquee.mjs logs --tail --event api_error
```

`GET /health` is a cheap liveness probe that touches no binding and names the
running build. `GET /api/v1/telemetry/diagnostics` is the deep probe — database,
cache, media, queue bindings, migration version, cron heartbeats — and requires
a credential, because it costs real work.

A cron that never fires used to leave no trace at all. Every successful
scheduled run now stamps a heartbeat, and the diagnostics probe reports any
trigger that is overdue against its own schedule. Silence means the trigger did
not fire, not that nobody looked.

## Turning it off

Three switches, from the largest to the smallest:

1. **All Worker logging off.** Set `"enabled": false` in the `observability`
   block of `wrangler.jsonc` and redeploy. Nothing is written at all.
2. **The browser beacon off.** Set the `CLIENT_TELEMETRY` variable to `0`. The
   endpoint then records nothing regardless of what any browser sends, so you
   do not have to trust that every client honoured the setting. A page can also
   set `window.__MARQUEE_TELEMETRY__ = false` to stop sending in the first
   place.
3. **Quieter, not off.** Set `LOG_LEVEL` to `warn` or `error` to keep failures
   and drop the routine request lines; `silent` stops every line without
   touching the platform-level switch. The default is `info`. Both this and
   `CLIENT_TELEMETRY` are declared in `wrangler.jsonc` so the levers are
   visible rather than folklore.

## What this costs

Workers Logs bills by the line, so the only number you need is how many lines
Marquee writes, and that number is easy to state exactly: **one per API request,
plus one per failure, plus one per queue message, cron run and browser report.**
Nothing else writes a line. It is configured unsampled
(`head_sampling_rate: 1`) because a conference is not a firehose and sampling
would hide the one request an organizer is actually asking about.

That makes your bill a multiplication you can do rather than an estimate you
have to trust: requests per day × 1, against the per-line price and included
allowance on your own Workers plan. Check the current numbers on Cloudflare's
pricing page — they change, and this document would go stale claiming
otherwise. During a busy CFP week a mid-size conference is dominated by
organizers working the pipeline in the admin app, not by public traffic.

Two levers if the volume is more than you want. `LOG_LEVEL=warn` drops the
routine `http_request` lines and keeps every failure, which is the right trade
for a large event: errors are worth keeping whole. `head_sampling_rate` below 1
samples everything indiscriminately, including the failure you are looking for,
so reach for the level first.

## Performance

`duration_ms` on every request line gives live p50/p95 per route without any
extra instrumentation. `d1_queries` and `d1_ms` are the N+1 detector: duration
tells you a request was slow, and the query count usually tells you why. The
same numbers are returned in the `Server-Timing` response header, so they show
up in a browser's own network panel.

Web Vitals (LCP, INP, TTFB) arrive through the same beacon, reported once when
the page is hidden, because that is the only point at which they are final.

## Extension points

**Sentry, or any hosted error tracker**, is deliberately not integrated. If you
want one, the seam is `browserSend` in `src/ui/shell/error-reporting.ts` for the
client and the logger's sink in `src/lib/observability/log.ts` for the server —
both are one function. Gate it on a DSN so a deployment without one keeps the
current behaviour of talking to nobody.

**Product analytics** — PostHog and its neighbours — is rejected on principle
rather than deferred. This is an open-source tool that holds speaker data; a
default that ships behavioural tracking of conference organizers is not a
default worth having.

**Joining the audit log to the request id** is the one gap left open. The audit
log answers "who did this"; the request log answers "what broke". Joining them
in a single query needs a `request_id` column on `audit_log`, and a schema
migration was out of scope for the work that built this layer. Until then, the
correlation is by actor and timestamp, which is a manual join rather than a
query.
