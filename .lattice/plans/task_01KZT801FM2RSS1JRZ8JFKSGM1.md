# MRQ-104 — Close the CLI parity gap

Evidence: `sequence/research/cli-parity.md`. Branch: `mrq-104-cli-parity` off `github/main` @ `2969956`.

## The shape of the work

This is **not API work.** Every gap is a dispatch branch over an endpoint that already
answers, already authenticates by bearer token, already validates, already returns JSON.
No routes, no schemas, no auth. Three files carry almost all of the diff:
`cli/registry.mjs`, `cli/marquee.mjs`, `cli/client.mjs`.

## Design decisions

**1. `--set key=value` is the one body convention.** Repeatable, allowlisted per command
against the route's own zod schema. One parser serves every write command, the keys are
literally the API's field names, and adding a field to a route never needs a CLI change.
Values coerce through `JSON.parse` — `30` → number, `null` → null, `true` → boolean,
`Workshop` (parse fails) → string. A string that looks numeric is escaped as
`--set name='"2026"'`. Documented in each command's help.

**2. Replace `eventIdFrom`'s derived predicate with an explicit registry flag.** The
current expression —
`path.at(-1) === "show" || path[0] !== "event" || path[0] === "tasks" || ...` — resolves
to "true for everything except `event *`, plus `event show`". A new `event set` command
would silently fail to resolve an event ID. An explicit `event: true` per registry entry
is honest and removes the latent bug rather than extending it.

**3. `agenda move` / `agenda remove` read their own ETag.** These are the only two
`if-match` routes in the product. `GET /agenda` already returns `sessions[].etag`, so the
CLI reads the snapshot, finds the item, and sends `If-Match` — no separate HEAD, no
user-supplied tag. A `--if-match` escape hatch stays available for scripted callers who
already hold one. Stale tag → the API's 409 surfaces as-is.

## Commands added

| Command | Operation | Loop step |
|---|---|---|
| `event set <id> --set k=v` | `updateEventSettings` | 2 |
| `tracks list/add/remove` | `listEventTracks`, `createEventTrack`, `deleteEventTrack` | 2 |
| `formats list/add/remove` | `listEventFormats`, `createEventFormat`, `deleteEventFormat` | 2 |
| `search <id> --query <text>` | `searchEvent` | — (resolves names to IDs) |
| `submissions schedule <id> <sub> --set …` | `scheduleSubmission` | 9 |
| `submissions publish <id> <sub>` | `publishSubmission` | 11 |
| `agenda place <id> --set …` | `placeAgendaItem` | 10 |
| `agenda move <id> <item> --set …` | `updateAgendaItem` (If-Match) | 10 |
| `agenda remove <id> <item>` | `removeAgendaItem` (If-Match) | 10 |

Plus `"bin": {"marquee": "cli/marquee.mjs"}` so AC-141's `marquee --help` is literal.

## Out of scope

Form-field CRUD, venue geometry, portal verbs, Sessionize imports, saved views, embeds,
task templates, tokens. Legitimately visual or one-time; the API is the right level and a
CLI verb would be worse than `curl`. **No generated OpenAPI passthrough** — 133 machine
verbs would be worse than 20 hand-written ones.

`check:skill-agent` (gate 12) stays MRQ-44's. This ticket makes AC-145 reachable without
`curl`; it does not build the isolated agent runner that proves it.

## Verification

1. `node cli/generate-skill.mjs` — SKILL.md regenerates with zero `curl` blocks.
2. `node cli/generate-skill.mjs --check` — clean.
3. Extend `tests/node/cli.AC-138-141-250.test.mjs`: every new command against the stub
   API, asserting bearer auth, one JSON value on stdout, correct method/path/body, and
   **an If-Match round trip including a real 409**.
4. `npm test` green inside the 45s budget.
5. `npm run check:api` still passes — `cli/api-registry.json` must not drift (no API
   change, so its hash is untouched; this is the guard that proves it).
6. AC-141: `--help` for every leaf command exits 0 and matches `renderHelp`.

## Risk

Low. Additive only — no existing command's behavior changes except `eventIdFrom`'s
predicate, which is covered by the existing AC-138 test for all ten current commands.
