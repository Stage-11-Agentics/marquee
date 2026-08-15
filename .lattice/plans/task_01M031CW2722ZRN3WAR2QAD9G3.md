# MRQ-221: Connect Airtable: the on switch, the settings screen, and the connection rows

Make the Airtable mirror reachable. MRQ-217 shipped the outbound machinery correctly and **unreachably**; this ticket is its on switch and its door.

## The finding you are fixing

MRQ-217's D1 triggers fire only when `mirror_state` holds a row for that table with a non-empty `airtable_table_id`. The drain resolves the same field per table and skips when absent. **The only `INSERT INTO mirror_state` in the entire tree is the reset sentinel (`mirrorSuppressionStatements`), which writes `airtable_table_id: NULL`.** So setting `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` as Wrangler secrets changes nothing — no trigger fires, no outbox row is ever created, and the mirror cannot be switched on by any path the product ships.

Every MRQ-217 test passes because it does `INSERT INTO mirror_state` as a fixture (`tests/integration/mirror-outbound.MRQ-217.test.ts:52`). The machinery is proven against a configured state the product cannot produce. **AC-310 is written specifically to make that impossible to repeat: it forbids a `mirror_state` fixture and requires the connect flow itself to be what turns the mirror on.**

## Contract

- **`SPEC.md` Amendment 25** — read it first; it is the whole design (the `mirror_credentials` table, the §4.2 routes, §5.15 the screen, and the discovery surfaces).
- **`sequence/USER_STORIES.md` Amendment 25** — US-92, AC-308 – AC-313.
- **`EVALUATION.md` §2.8** — the verification rows. **Note AC-228 moved into this band**; the Settings → Airtable screen is yours, not MRQ-218's.
- `SPEC.md` §3.9 for the mechanics you are switching on.

## Scope

1. **`mirror_credentials`** (new migration) — encrypted token at rest under a Worker secret, fingerprint, base id, set-at, last-verified. `mirrorConfig` resolves the token from this row instead of `env.AIRTABLE_API_KEY`. **The plaintext leaves the table only into the transport** — never a response body, a log line, an error, or a telemetry event.
2. **Connect** — `POST /api/v1/mirror/connect` verifies token + base against Airtable's schema read **before** persisting anything, returns the base's tables; `POST /api/v1/mirror/mapping` maps the three mirrored tables and **writes `mirror_state.airtable_table_id`**. That write is the on switch.
3. **Status and disconnect** — `GET /api/v1/mirror/status`, `POST /api/v1/mirror/disconnect`. Disconnect is the **one and only** caller of `clearMirrorOutbox`, which today is exported and deliberately called from nowhere. Read the comment on it before you touch it: a review of MRQ-217 found it being called whenever config was absent, which silently destroyed the pending feed every time a credential was transiently missing. **Absent config stays inert. Do not reintroduce an implicit clear.**
4. **`/settings/airtable`** — the route `SITEMAP.md:138,246` has always drawn and no build has installed. Unconfigured it is the connect screen; configured it is AC-228's status screen. Register it in `src/ui/shell/route-table.ts` (utility group) and **amend `tests/unit/route-table.test.ts:124`**, which currently asserts the route is undefined under a comment saying "The Airtable mirror was cancelled" — no longer true. **Leave the `/evaluation/ai` half of that test alone**; the AI first pass really is unbuilt and the test's principle is correct.
5. **Two things the MRQ-217 review earned, both in SPEC §5.15.** The outbox depth must distinguish *queued* from *stuck at the retry cap* (`MAX_MIRROR_ATTEMPTS` = 5) — the health surface already computes both, so the figure exists. And the screen must state that delivery is **traffic-assisted**: request dispatch is the fast path, the hourly mail cron the idle backstop. An organizer reading "within 60 seconds" on an idle deployment is owed the condition.
6. **Discovery (AC-311).** Add Airtable to the Server panel's connection rows (`src/ui/setup/ServerPanel.tsx` — its own lead copy is "What this Marquee is connected to, and whether each piece is working", and it lists four rows that do not include the mirror). Give System health's existing `Airtable sync` row (`src/lib/delivery-health.ts:744`) the `href` its comment correctly withheld while there was nowhere to send anyone — read that comment, it explains itself.

## Build hermetic

Every criterion is provable against MRQ-217's fake transport. There is no Airtable base and you are not blocked by that (SPEC Amendment 24). Reuse `src/jobs/mirror/`'s transport interface — **do not add a second one** — and respect the import boundary: `scripts/checks/check-mirror-imports.mjs` fails any import of the Airtable client outside `src/jobs/mirror/*`, so your route handlers call into a job module rather than importing the transport.

## Do not

- Do not widen the mirrored table set beyond `submissions`, `speaker_tasks`, `people`.
- Do not build the inbound webhook, allowlist, or keepalive — MRQ-218.
- Do not write the agent-facing docs or CLI verbs — MRQ-220 (it depends on your API).
- Do not edit contract docs or mint AC IDs. Divergence → implement, keep moving, flag on the ticket.
