# Marquee

Marquee is a conference operating system. Use its API or CLI as the source of truth for program work; keep each action explicit and inspect the returned state.

## Authentication

Use a scoped API token as a bearer credential. Set `MARQUEE_URL` and `MARQUEE_TOKEN`, or pass `--url` and `--token` on every command. Add `--json` when another tool will consume the result; successful JSON mode writes exactly one JSON value to stdout.

The command registry is:

- `node cli/marquee.mjs setup claim-link`
- `node cli/marquee.mjs setup health`
- `node cli/marquee.mjs setup instance`
- `node cli/marquee.mjs event create --set name=<name> --set starts_on=<date> --set ends_on=<date> --set timezone=<tz> [--from <event-id>] [--copy <sets>]`
- `node cli/marquee.mjs event list`
- `node cli/marquee.mjs forms create <event-id> --set name=<name> --set slug=<slug> --set kind=abstract`
- `node cli/marquee.mjs forms list <event-id>`
- `node cli/marquee.mjs evaluation plan <event-id> --set name=<name>`
- `node cli/marquee.mjs organizers list`
- `node cli/marquee.mjs organizers invite`
- `node cli/marquee.mjs event seed`
- `node cli/marquee.mjs event show <event-id>`
- `node cli/marquee.mjs event set <event-id> --set <key=value>`
- `node cli/marquee.mjs tracks list <event-id>`
- `node cli/marquee.mjs tracks add <event-id> --set name=<name> --set color=<hex>`
- `node cli/marquee.mjs tracks remove <event-id> <track-id>`
- `node cli/marquee.mjs formats list <event-id>`
- `node cli/marquee.mjs formats add <event-id> --set name=<name> --set default_duration_min=<n>`
- `node cli/marquee.mjs formats remove <event-id> <format-id>`
- `node cli/marquee.mjs submissions list <event-id>`
- `node cli/marquee.mjs submissions show <event-id> <submission-id>`
- `node cli/marquee.mjs submissions accept <event-id> --filter <key=value>`
- `node cli/marquee.mjs submissions reject <event-id> --filter <key=value>`
- `node cli/marquee.mjs submissions schedule <event-id> <submission-id> --set starts_at=<ms> --set duration_min=<n> --set room_id=<id>`
- `node cli/marquee.mjs submissions publish <event-id> <submission-id>`
- `node cli/marquee.mjs tasks list <event-id> --overdue`
- `node cli/marquee.mjs files list <event-id> --state <name>`
- `node cli/marquee.mjs remind <event-id> --filter <key=value> (--template <key> | --subject <s> --body <b>)`
- `node cli/marquee.mjs diagnose`
- `node cli/marquee.mjs logs --tail`
- `node cli/marquee.mjs agenda export <event-id>`
- `node cli/marquee.mjs agenda place <event-id> --set submission_id=<id> --set starts_at=<ms> --set room_id=<id>`
- `node cli/marquee.mjs agenda move <event-id> <item-id> --set starts_at=<ms>`
- `node cli/marquee.mjs agenda remove <event-id> <item-id>`
- `node cli/marquee.mjs search <event-id> --query <text>`

## Set up a new instance

This chapter is for a fresh deployment: an empty Cloudflare account and a cloned repository. If `MARQUEE_URL` and `MARQUEE_TOKEN` already work, skip to Seed. Setup is conversational — three questions belong to the operator, so ask them before acting rather than guessing: which domain, whether to seed the demo conference alongside, and whether a Resend API key exists yet.

Preconditions: Node 22.18+, `wrangler` authenticated against the operator's Cloudflare account, Workers Paid enabled. Confirm Workers Paid by creating a paid-only resource, not by reading an API that may lie about it.

1. Create the resources and record their IDs in `wrangler.jsonc`: one D1 database, one R2 media bucket, one KV namespace, four queues. The exact commands are in the README under *Deploy to Cloudflare*; that sequence is the contract, follow it rather than improvising.
2. Store the secrets with `wrangler secret put`: the Turnstile pair, the R2 signing keys, and the upload secrets. If the operator has no Resend key yet, say so and continue — the instance reports mail as not configured honestly, and warns before intake opens. Never block setup on mail.
3. Build, migrate, optionally seed, deploy, then verify:

```sh
npx vite build
CI=1 npx wrangler d1 migrations apply DB --remote
npm run seed -- --remote        # only if the operator wants the demo alongside
npx wrangler deploy
node cli/marquee.mjs setup health --url "$MARQUEE_URL" --json
```

`setup health` names the build SHA the deployment is serving; confirm it matches what you shipped. It needs no credential, which is what makes it the first thing you can ask a fresh instance.

4. Print the claim link and hand it to the human:

```sh
node cli/marquee.mjs setup claim-link --url "$MARQUEE_URL" --json
```

The response contains a one-time claim URL; you may append `?name=…&email=…` prefill from the operator's git config. **Never open the claim link yourself. Ownership must land on a person, not on an agent.** Tell the operator to open it in a browser; a used link is inert, and re-running this command is the recovery path for a locked-out instance, forever.

5. Wait. When the human has claimed the instance, they hand you a scoped token (Marquee offers to mint one at claim). Export it as `MARQUEE_TOKEN` and verify it with a read before writing anything.

6. Provision the conference through the API, confirming each returned state:

```sh
node cli/marquee.mjs event create --set name="…" --set starts_on=2027-04-14 --set ends_on=2027-04-15 --set timezone=America/New_York --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs tracks add "$EVENT_ID" --set name=Platform --set color=#3B82F6 --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs formats add "$EVENT_ID" --set name=Talk --set default_duration_min=30 --set min_duration_min=20 --set max_duration_min=45 --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs forms create "$EVENT_ID" --set name="Call for speakers" --set slug=cfp --set kind=abstract --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs evaluation plan "$EVENT_ID" --set name="Program committee" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

Sane defaults are already set — one speaker minimum, format durations prefilled. Change only what the operator asked for. `setup instance` reports mail, uploads, spam protection, and domain, each derived from what is really configured; read it before you report anything about this deployment.

7. **Stop before intake.** Do not publish the call for speakers. Report what you did, the instance status rows (mail included), and where the last step lives: opening intake is the operator's click, from the dashboard, with the consequences on screen.

## Next year's conference

Most conferences are serial: the next one is the last one with new dates. `event list` names every conference this credential can read, and `event create --from` carries the structure across — never the people or their records.

```sh
node cli/marquee.mjs event list --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs event create --set name="AI Engineer NYC 2027" --set starts_on=2027-10-18 --set ends_on=2027-10-20 --set timezone=America/New_York --from "$EVENT_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs event create --set name="AI Engineer Code 2027" --set starts_on=2027-03-02 --set ends_on=2027-03-03 --set timezone=America/New_York --from "$EVENT_ID" --copy formats,tracks,forms --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

`--from` alone carries formats, tracks, CFP forms, task templates, email templates, and the evaluation plan's structure; `--copy` narrows that to the sets you name. Venues are never carried unless you ask for them. The response's `copied` object is the receipt — read it rather than assuming, because two sets are conditional: CFP forms cannot travel without the formats and tracks their dropdowns are bound to, and form-kind task templates cannot travel without their forms. Asking for the illegal combination is refused with a sentence naming what is missing.

What never travels: submissions, speakers' conference data, reviews and scores, the agenda, decision waves, uploads, messages, committees, and the audit log. People are organization-scoped, so a returning speaker is already the same person — there is nothing to copy. Copied forms arrive **closed** with no dates, and the copied evaluation plan arrives as a **draft**: opening intake and opening review are decisions, not side effects of creating a record.

Every command that reads or writes conference data takes an event ID, so once the new conference exists it is addressed exactly like the old one.

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

## Configure

A conference carries its own name, dates, timezone, and venue, and the tracks and formats every later surface inherits. Read `event show` first: it returns the formats and tracks with their IDs, which scheduling needs.

```sh
node cli/marquee.mjs event set "$EVENT_ID" --set name="AI Engineer NYC 2026" --set timezone=America/New_York --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs tracks add "$EVENT_ID" --set name=Agents --set color=#3B82F6 --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs formats add "$EVENT_ID" --set name="Lightning" --set default_duration_min=10 --set min_duration_min=5 --set max_duration_min=10 --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

`--set` values parse as JSON when they can, so `10` is a number and `null` is null. Quote to force a string: `--set name='"2026"'`.

## Agenda

Placing a Session needs a room ID and a start time in epoch milliseconds. `agenda export` returns the rooms, the placed sessions, and the unscheduled pool; `search` turns a talk's name into its ID.

```sh
node cli/marquee.mjs search "$EVENT_ID" --query "retrieval" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs agenda export "$EVENT_ID" --format csv --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN"
node cli/marquee.mjs submissions schedule "$EVENT_ID" "$SUBMISSION_ID" --set starts_at=1760000000000 --set duration_min=30 --set room_id="$ROOM_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

Moving or unplacing an item is guarded by that item's version, so two agents cannot silently overwrite each other. The CLI reads the current ETag from the Agenda and sends it; a stale version fails with a conflict rather than clobbering the other write.

```sh
node cli/marquee.mjs agenda place "$EVENT_ID" --set submission_id="$SUBMISSION_ID" --set starts_at=1760000000000 --set room_id="$ROOM_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs agenda move "$EVENT_ID" "$ITEM_ID" --set starts_at=1760003600000 --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs agenda remove "$EVENT_ID" "$ITEM_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

Scheduling changes the working Agenda; check the returned Session before moving on.

## Publish

Publish only after the Session is accepted and scheduled — publishing an unscheduled Session is refused.

```sh
node cli/marquee.mjs submissions publish "$EVENT_ID" "$SUBMISSION_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
```

The published Session appears on the public program and in the embeddable agenda and speaker widgets.

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
