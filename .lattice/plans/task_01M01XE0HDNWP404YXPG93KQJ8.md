# MRQ-217: Airtable mirror — outbound: change feed, batched upserts, and the import boundary

Build the outbound half of the Airtable two-way mirror: D1 -> Airtable. SPEC §3.9 is the binding contract and is unchanged; SPEC Amendment 24 (2026-08-15) reinstates it after Amendment 17 cut it, and states the one ruling that differs from the first attempt — the build is HERMETIC and does not wait on a credential.

## Why this is cheap to start
Every seam already exists and is marked. Nothing here is greenfield architecture:
- `migrations/0001_init.sql:632-662` — `mirror_outbox` and `mirror_state` tables, with indexes at :922-928. No migration is needed for the tables themselves.
- `wrangler.jsonc:107` — `MIRROR_QUEUE` is bound to `marquee-mirror`, batch size 10.
- `src/index.ts:249` — `MIRROR_RECONCILE_MESSAGE_TYPE` already arrives on the queue and is stub-acked with the comment "Real reconcile consumer lands with M-25/M-26". `reset:demo` already enqueues exactly one of these.
- `src/api/grants.ts` / `src/lib/auth/scope-resolution.ts` — the `mirror:write` token scope already exists.
- `src/routes/health-surface.routes.ts:366,376` — the health surface already SELECTs from both tables.
- `src/db/schema.ts:933,1005,1068,1141` — row types are already declared.

## Scope
**Mirrored tables: `submissions`, `speaker_tasks`, `people`. Exactly those three.** Widening the set is a new SPEC amendment, not a build decision (Amendment 24).

1. **Airtable client behind an injected transport.** An interface with a real `fetch`-backed implementation and a fake. The suite exercises every criterion with no token, no base, no network — `npm test` must stay hermetic (EVALUATION §1.2). This is the ruling that unblocks the whole ticket; do not reach for a live base.
2. **`afterWrite` change feed.** A write to a mirrored row enqueues one `mirror_outbox` row (`op` upsert|delete, `payload` JSON, `status`, `attempts`). Stamp `last_write_source='marquee'`.
3. **`reset:demo` short-circuits the feed.** It writes with a `suppress_mirror` flag so NO per-row outbox entry is enqueued, then enqueues one reconcile job at the end. SPEC §3.9 does the arithmetic: without this, one reset queues ~1,000 submissions plus speakers and tasks and drains for 25s+. Replace the stub-ack at `src/index.ts:249` with the real reconcile consumer.
4. **The drain consumer.** Batches **10 records per PATCH** with `performUpsert.fieldsToMergeOn: ["marquee_id"]`, rate-limited to **4 req/s** by a token bucket (Airtable's Team throttle is 5 req/s and the inbound payload pull spends the same budget). Advances `attempts`, `last_error`, `drained_at`, and `mirror_state.last_sync_at`.
5. **Guardrail G4 / A-4 — the import-boundary lint.** The Airtable client is importable ONLY from `src/jobs/mirror/*`; a check fails any import elsewhere. This folds in cancelled MRQ-46's audit deliberately: a guardrail that ships with the code it guards cannot be skipped for capacity. Airtable must never be read on a request path — that is US-72's non-negotiable and what lets AC-225 coexist with R7.
6. **Attachments: outbound only ever carries a public R2 URL** (deadline trap 10 — Airtable attachment URLs expire in 2h; R2 is canonical and the arrow never reverses).
7. **Config, and its absence.** `AIRTABLE_API_KEY` as a Wrangler secret, base id as config, per-table `airtable_table_id` in `mirror_state`. **With no credential the mirror disables cleanly**: the feed does not accumulate, the consumer no-ops, nothing errors, nothing backlogs. A Marquee with the mirror off must be indistinguishable from today's.
8. Update the `check:mirror` stub (`package.json:30`) so its message names the missing *base*, not a missing implementation.

## Acceptance criteria
- **AC-225** A local change to a mirrored record appears in Airtable within 60 seconds of the change committing. (Hermetic: assert against the fake transport's observed call log and timing budget.)
- **AC-227** (outbound half) Echo suppression holds — a write that originated from the mirror does not bounce back. `last_write_source` is the mechanism. The inbound half of AC-227 lands with the inbound ticket.

## Do not
- Do not read Airtable on any request path, ever.
- Do not add a network call to `npm test`.
- Do not mirror a fourth table.
- Do not build the inbound webhook, the keepalive, or the Settings page — those are the inbound ticket.

## Contract
`SPEC.md` §3.9 and Amendment 24 · `sequence/USER_STORIES.md` US-72 · `EVALUATION.md` gate 9, harness row `check:mirror` · guardrails G4/G5, audit A-4.
