# Marquee

Marquee is a conference operating system. Use its API or CLI as the source of truth for program work; keep each action explicit and inspect the returned state.

## Authentication

Use a scoped API token as a bearer credential. Set `MARQUEE_URL` and `MARQUEE_TOKEN`, or pass `--url` and `--token` on every command. Add `--json` when another tool will consume the result; successful JSON mode writes exactly one JSON value to stdout.

The command registry is:

- `node cli/marquee.mjs event seed`
- `node cli/marquee.mjs event show <event-id>`
- `node cli/marquee.mjs submissions list <event-id>`
- `node cli/marquee.mjs submissions show <event-id> <submission-id>`
- `node cli/marquee.mjs submissions accept <event-id> --filter <key=value>`
- `node cli/marquee.mjs submissions reject <event-id> --filter <key=value>`
- `node cli/marquee.mjs tasks list <event-id> --overdue`
- `node cli/marquee.mjs remind <event-id> --filter <key=value> (--template <key> | --subject <s> --body <b>)`
- `node cli/marquee.mjs diagnose`
- `node cli/marquee.mjs logs --tail`
- `node cli/marquee.mjs agenda export <event-id>`

## Seed

Ensure a seeded conference is available before a walkthrough. If the token already identifies the seeded conference, the command returns it without changing data; otherwise it waits for the reset to finish and returns the event ID.

```sh
node cli/marquee.mjs event seed --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

Use the returned `event_id` for later commands. `event show` reads the conference, formats, and tracks.

## Triage

The review queue is made of Abstracts and Sessions. Filter on the server, read a record when context is needed, then make an explicit bulk decision.

```sh
node cli/marquee.mjs submissions list "$EVENT_ID" --filter status=submitted --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs submissions show "$EVENT_ID" "$SUBMISSION_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs submissions accept "$EVENT_ID" --filter status=submitted --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

Use `reject` with the same selector when a Session or Abstract should not advance. A filter is resolved by Marquee; the CLI never turns a paginated page into a guessed ID set.

## Chase

Use the Task board to find incomplete speaker work, then send either a stored reminder template or caller-composed text.

```sh
node cli/marquee.mjs tasks list "$EVENT_ID" --overdue --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs remind "$EVENT_ID" --filter task_state=open --template task_overdue --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs remind "$EVENT_ID" --filter task_state=open --subject "One detail for your Session" --body "Please complete the open Task in the Portal." --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

An empty exact selection is a deliberate no-op. Keep recipient selectors narrow and verify the queued count in the response.

## Agenda

Export the Agenda as JSON or CSV. Scheduling is an API operation against an accepted Session and requires a room and start time.

```sh
node cli/marquee.mjs agenda export "$EVENT_ID" --format csv --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN"
# POST /api/v1/events/{eventId}/submissions/{submissionId}/schedule
curl -fsS -X POST "$MARQUEE_URL/api/v1/events/$EVENT_ID/submissions/$SUBMISSION_ID/schedule" \
  -H "Authorization: Bearer $MARQUEE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"starts_at":1760000000000,"duration_min":30,"room_id":"ROOM_ID"}'
```

Scheduling changes the working Agenda; check the returned Session before moving on.

## Publish

Publish only after the Session is accepted and scheduled. Publishing is also API-only and returns the updated Session record.

```sh
# POST /api/v1/events/{eventId}/submissions/{submissionId}/publish
curl -fsS -X POST "$MARQUEE_URL/api/v1/events/$EVENT_ID/submissions/$SUBMISSION_ID/publish" \
  -H "Authorization: Bearer $MARQUEE_TOKEN" \
  -H "Accept: application/json"
```

## Diagnose

When something is wrong, start with the verdict and then read the line behind it. `diagnose` probes every binding — database, cache, media, queues, scheduled work — and answers ok or degraded with per-probe timings and the running build.

```sh
node cli/marquee.mjs diagnose --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs diagnose --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --bundle
```

Every error surface shows a short reference code. It is a prefix of the correlation id on the server's own log lines, so the code an organizer read off the screen is the filter that finds them.

```sh
node cli/marquee.mjs logs --tail --request-id 8f2a4c
node cli/marquee.mjs logs --tail --level error
node cli/marquee.mjs logs --tail --event api_error
```

Logs are structured, one JSON object per event, built from a field allowlist: they carry route templates, opaque IDs, statuses and timings, and never request bodies, query strings, credentials, or mail addresses. `GET /health` is the cheap liveness probe and names the running build.

The product vocabulary is deliberate: Abstract, Session, Evaluation plan, Committee, Portal, Task, and Agenda. Use those nouns when describing work to another operator or agent.
