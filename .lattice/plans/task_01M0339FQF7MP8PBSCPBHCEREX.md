# MRQ-223: Airtable finisher: connect, inbound, the settings door, and the agent surface

Finish the Airtable mirror. MRQ-217 shipped the outbound machinery; this ticket makes it reachable, makes it two-way, and makes it discoverable by a human and by an agent. It absorbs the whole remaining Airtable scope — the cancelled MRQ-218 (inbound), MRQ-221 (connect + screen), and MRQ-222 (agent-native) — because one agent holding the whole picture beats three handoffs across the same six files.

## Read first, in this order

1. **`SPEC.md` §3.9** — the mirror's binding mechanics, unchanged since it was written.
2. **`SPEC.md` Amendment 24** — why this was cut once and rebuilt hermetic. **You have no Airtable base and you are not blocked by that.** Everything here is provable against the fake transport MRQ-217 built.
3. **`SPEC.md` Amendment 25** — the connect flow, `mirror_credentials`, the §4.2 routes, §5.15 the screen, and the discovery surfaces. This is the newest and most specific contract; on conflict with older text it wins.
4. **`sequence/USER_STORIES.md`** US-72 (AC-225 – AC-229) and US-92 (AC-308 – AC-313).
5. **`EVALUATION.md`** §2.3's mirror rows and §2.8.

## The finding that sets the order

MRQ-217's triggers fire only when `mirror_state` holds a row for that table with a non-empty `airtable_table_id`. The drain resolves the same field per table. **The only `INSERT INTO mirror_state` in the tree is the reset sentinel, which writes NULL.** So the mirror cannot currently be switched on by any path the product ships, and every MRQ-217 test passes only because it inserts `mirror_state` as a fixture (`tests/integration/mirror-outbound.MRQ-217.test.ts:52`).

**Build the on switch first.** Inbound needs a connected base to register a webhook against, and the docs need an API to describe. **AC-310 forbids a `mirror_state` fixture** — it must be your connect flow that turns the mirror on, which is the assertion MRQ-217's suite could not make about itself.

## Phase 1 — the on switch (AC-308, AC-309, AC-310, AC-313)

- **`mirror_credentials`** (new migration): token encrypted at rest under a Worker secret, plus fingerprint, base id, set-at, set-by, last-verified, last-error. `mirrorConfig` resolves the token from this row instead of `env.AIRTABLE_API_KEY`. **The plaintext leaves the table only into the transport** — never a response body, a log line, an error, or a telemetry event. A read returns the fingerprint and set-at, nothing else.
- **`POST /api/v1/mirror/connect`** verifies token + base against Airtable's schema read **before persisting anything**; a rejected credential stores nothing and names which of the two failed. Returns the base's tables.
- **`POST /api/v1/mirror/mapping`** maps the three mirrored tables and writes `mirror_state.airtable_table_id`. **This write is the on switch.**
- **`GET /api/v1/mirror/status`** (read scope, never returns the token) and **`POST /api/v1/mirror/disconnect`** (`mirror:write`).
- **Disconnect is the one and only caller of `clearMirrorOutbox`.** That helper is exported and deliberately called from nowhere. Read the comment on it: a review of MRQ-217 found it being invoked whenever config was absent, which silently destroyed the pending feed every time a credential was transiently missing. **Absent config stays inert. Do not reintroduce an implicit clear.**

## Phase 2 — inbound (AC-226, AC-227, AC-229)

- **`POST /mirror/webhook`** — unauthenticated but signature-checked. Airtable's POST is a **ping carrying no data**; verify the MAC, then call list-payloads with the stored cursor. **It spends the same 5 req/s base budget as the drain — take the shared `MirrorTokenBucket` that `processMirrorQueue` already threads, do not construct a second one.** (MRQ-217's review found exactly that bug: two independent buckets against one base, up to 8 req/s against a 5 req/s ceiling, with the ≤4 req/s evidence passing the whole time.)
- **The inbound allowlist, per SPEC §3.9 verbatim** — `submissions`: `status`, `primary_track_id`, `tracks`, `format_id`, `vendor_affiliation`; `speaker_tasks`: `status`; `people`: `title`, `company`. Everything else is display-only and overwritten on the next outbound pass. **An edit touching one allowlisted and one non-allowlisted field applies the first and drops the second — never partially applied (AC-226).** Write that test.
- **An inbound status change DOES NOT run the acceptance cascade.** Highest-stakes rule here, and §3.9 says why: `PHILOSOPHY.md` 2 makes the status change *be* the notification, so cascading on inbound means an ops person's spreadsheet drag mass-mails hundreds of speakers — the blast radius guardrail G3 exists to contain. Set the status and `last_write_source='airtable'` and stop.
- **Make the "changed in Airtable" path true.** `src/routes/submissions.queries.ts:443-452` already renders that notification state with the detail string *"The Airtable mirror is currently cut; this is a theoretical legacy path."* Replace it with the truth and wire the one-click **"run onboarding cascade"** for a program lead. The built-in **Decided · not notified** view (AC-268/269) already lists these records and already names `Changed in Airtable` as one of its three reasons.
- **Echo suppression, inbound side (AC-227).** MRQ-217 left you a constraint in this ticket's lineage: the outbound INSERT triggers deliberately do **not** filter `last_write_source`, because §3.9's inbound is update-only. If you add any inbound insert path it must stamp `last_write_source='airtable'` or add an insert-side guard, or the trigger enqueues the row straight back outbound. Test sustained two-way editing, not one round trip — a loop that takes three bounces to establish passes a single-round-trip test.
- **The keepalive cron.** `wrangler.jsonc:121` already registers `"15 4 * * *"  // Daily Airtable webhook keepalive` and the `scheduled` handler falls through to `no_handler` for it. Add the branch: re-register before Airtable's 7-day expiry **and refresh `local_row_count` + `remote_row_count` on the same pass**. **Do not fold outbound dispatch into it** — that already lives on the hourly mail branch as the idle backstop.

## Phase 3 — the door (AC-228, AC-311)

- **`/settings/airtable`** — the route `SITEMAP.md:138,246` has always drawn and no build has installed. Unconfigured it is the connect screen; configured it is AC-228's status screen: base link, both row counts rendered **"as of `last_sync_at`"**, last sync, outbox depth, Sync now, live log, webhook-expiry warning (AC-229), disconnect. Register it in `src/ui/shell/route-table.ts` (utility group).
- **Amend `tests/unit/route-table.test.ts:124`**, which asserts the route is undefined under a comment reading "The Airtable mirror was cancelled" — no longer true. **Leave the `/evaluation/ai` half alone**; that module really is unbuilt and the test's principle is right.
- **Two things the MRQ-217 review earned** (SPEC §5.15): the outbox depth must distinguish *queued* from *stuck at the retry cap* (`MAX_MIRROR_ATTEMPTS` = 5) — a depth number that silently includes dead rows is a worse lie than a larger honest one, and `delivery-health.ts` already computes both. And the screen must say delivery is **traffic-assisted**: request dispatch is the fast path, the hourly cron the idle backstop. An organizer reading "within 60 seconds" on an idle deployment is owed the condition.
- **Discovery (AC-311).** Add Airtable to the Server panel's connection rows (`src/ui/setup/ServerPanel.tsx` — its lead copy is literally *"What this Marquee is connected to, and whether each piece is working"* and it lists four rows that do not include the mirror). Give System health's existing `Airtable sync` row (`src/lib/delivery-health.ts:744`) the `href` its comment correctly withheld while there was nowhere to send anyone — read that comment, it explains itself.

## Phase 4 — agent-native (AC-312, AC-313)

- **`SKILL.md`** gains an Airtable chapter: what the mirror is, what it is not (D1 stays the source of truth; Airtable is never read on a request path), connect, status, disconnect. `SKILL.md` is **generated** — follow the generation path, do not hand-edit the artifact (AC-307 set this precedent).
- **`docs/GETTING-STARTED.md`** gains the same flow in the organizer's language, as an **optional** step. A Marquee with no Airtable is a complete Marquee and the chapter must not read as though something is missing without it.
- **CLI verbs** for connect / status / disconnect that **call the API** — no second code path (AC-307's rule for `event delete`).
- **AC-312's real assertion**: an agent completes connect → verify → map → confirm a change reaching the fake provider, **with no screen opened**. That is a test, not a doc claim.
- The `mirror:write` scope already exists and already appears in the API-token picker (`src/ui/settings/ApiTokensPage.tsx:16`), where it has been offering a scope for a feature with no other surface. This phase is what makes that entry mean something.

## Build hermetic

Every criterion above is provable against MRQ-217's fake transport. `npm test` must not acquire a network dependency (`EVALUATION.md` §1.2). Reuse `src/jobs/mirror/`'s transport interface — **do not add a second one** — and respect the boundary: `scripts/checks/check-mirror-imports.mjs` fails any import of the Airtable client outside `src/jobs/mirror/*`, so route handlers call into a job module rather than importing the transport.

## Do not

- Do not widen the mirrored table set beyond `submissions`, `speaker_tasks`, `people`. That needs a SPEC amendment, not a build decision.
- Do not read Airtable on any request path (G4).
- Do not run the acceptance cascade on inbound.
- Do not edit contract docs (`SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `sequence/USER_STORIES.md`, `DESIGN.md`) and do not mint AC IDs. Divergence → implement the correct thing, keep moving, flag it in one line on this ticket.

## Done means

`npm run pr-gate` honest and green **including `trace:ac`** — test titles take `AC-nnn · ` or `CONTRACT · ` and nothing else (`scripts/checks/trace-ac-core.mjs:45`); `MRQ-223 · ` will fail the gate. PR open via `gh pr create --repo Stage-11-Agentics/marquee --base main`, ticket through `review`/`in_validation` with evidence, then report. Commit and push your plan before any code, and push after every meaningful commit.
