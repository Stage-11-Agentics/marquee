# MRQ-218: Airtable mirror — inbound: signed webhook, allowlist, keepalive, and Settings → Airtable

Build the inbound half of the Airtable two-way mirror (Airtable -> D1), the keepalive that stops it dying silently, and the Settings screen that makes the whole thing visible. **Depends on MRQ-217** (outbound), which establishes the injected-transport client and the import boundary this ticket reuses.

SPEC §3.9 is the binding contract, reinstated by SPEC Amendment 24 (2026-08-15). Build HERMETIC: the whole inbound loop is exercised against the fake transport MRQ-217 introduces. Do not wait on a real Airtable base — one is not in hand and that is a precondition for `check:mirror`, not for this code.

## Scope

1. **`POST /mirror/webhook` — unauthenticated but signature-checked.** Airtable's webhook POST is a **ping and carries no data**. The handler verifies the MAC, then calls list-payloads with the cursor stored in `mirror_state.cursor` and applies what comes back. The payload pull spends the same 5 req/s base budget as the outbound drain — share one token bucket, do not open a second.
2. **`GET /mirror/status` and `POST /mirror/sync`** (SPEC §4.2). Note the naming trap already recorded in §4.2: `POST /mirror/webhook` is Airtable **inbound** and has nothing to do with the outbound signed webhooks at `/webhooks/*`, which are a different, shipped feature.
3. **The inbound allowlist, per table — SPEC §3.9, verbatim:**
   | Table | Inbound-writable |
   |---|---|
   | `submissions` | `status`, `primary_track_id`, `tracks` (names, comma-joined), `format_id`, `vendor_affiliation` |
   | `speaker_tasks` | `status` |
   | `people` | `title`, `company` |
   Everything else in Airtable is display-only and is overwritten on the next outbound pass. **An edit to a non-allowlisted field is ignored and logged — never partially applied (AC-226).** "Partially applied" is the failure mode to write a test against: an update touching one allowlisted and one non-allowlisted field must apply the first and drop the second, atomically and loudly.
4. **An inbound status change DOES NOT run the acceptance cascade.** This is the highest-stakes rule in the ticket and SPEC §3.9 spells out why: `PHILOSOPHY.md` 2 makes the status change *be* the notification, so cascading on inbound means an ops person's spreadsheet drag can mass-mail hundreds of speakers — the same blast radius guardrail G3 exists to contain. An inbound write sets the status and `last_write_source='airtable'` and **stops**: no mail queued, no task sets assigned, no invites offered.
5. **Make the "changed in Airtable" path true.** It is already built and currently lies: `src/routes/submissions.queries.ts:443-452` renders the `changed_in_airtable` notification state with the detail string *"The Airtable mirror is currently cut; this is a theoretical legacy path."* Replace that with the real sentence, and wire the one-click **"run onboarding cascade"** action a program lead uses to run deliberately what inbound deliberately skipped. The built-in **Decided · not notified** view (AC-268/AC-269) already lists these records and already names `Changed in Airtable` as one of its three reasons — this ticket is what stops that being hypothetical.
6. **The keepalive cron.** `wrangler.jsonc:121` already registers `"15 4 * * *"  // Daily Airtable webhook keepalive` and `src/index.ts:267-297`'s `scheduled` handler currently falls through to `outcome = "no_handler"` for it. Add the handler: it re-registers before Airtable's **7-day webhook expiry** (deadline trap 7) **and refreshes `local_row_count` + `remote_row_count` on the same pass**, so the counts are never staler than 24h without a drain.
7. **`/settings/airtable` — the screen (AC-228, AC-229).** Connected-base link, **both** row counts rendered explicitly **"as of `last_sync_at`"** rather than as live figures (they are not live; saying so is the point), last successful sync, outbox depth, **Sync now**, live log, and the **webhook-expiry warning surfaced before it can cause silent data loss**. Model it on the shipped `/settings/webhooks` (`src/ui/settings/WebhooksPage.tsx`) — same shape, same Flight Deck treatment. Register the route in `src/ui/shell/route-table.ts` in the `utility` group.
8. **`tests/unit/route-table.test.ts:122-130` must be amended.** It currently asserts `matchRoute("/settings/airtable")` is `undefined`, under the comment *"the table installs no route for a module this product does not have"*. The module now exists, so that half of the test inverts. **Leave the `/evaluation/ai` half alone** — the AI first pass is still unbuilt, and the test's principle (an installed route claims a module exists) is correct and worth keeping.
9. **Update the README's extension-points table** (`README.md:392`), which currently names the Airtable mirror as an extension point rather than a shipped feature. Change it in the same PR that makes the sentence false. **Do not touch the D1-is-source-of-truth positioning** — SPEC Amendment 4's trade is unchanged and still true.

## Acceptance criteria
- **AC-226** An Airtable edit to an allowlisted field applies to the local record within one webhook cycle; edits to non-allowlisted fields are ignored and logged, never partially applied.
- **AC-227** Echo suppression holds: a write that originated from the mirror does not bounce back and re-trigger the opposite direction, and no record enters a sync loop **under sustained two-way editing**. Test the sustained case, not one round trip — a loop that takes three bounces to establish passes a single-round-trip test.
- **AC-228** Settings → Airtable displays the base link, the row count on both sides, the last successful sync time, and the current outbox depth.
- **AC-229** The webhook keepalive survives 7 days without manual re-registration, and expiry is visible on Settings → Airtable before it causes silent data loss.

## Do not
- Do not read Airtable on any request path (guardrail G4). The import boundary MRQ-217 installs applies here unchanged.
- Do not add a network call to `npm test`.
- Do not run the acceptance cascade on inbound. See 4.
- Do not widen the mirrored table set beyond `submissions`, `speaker_tasks`, `people` — that needs a SPEC amendment (Amendment 24).

## Contract
`SPEC.md` §3.9, §4.2 and Amendment 24 · `sequence/USER_STORIES.md` US-72 · `EVALUATION.md` gate 9 · `SITEMAP.md:138,246` (the route is already drawn) · deadline traps 7 and 8.
