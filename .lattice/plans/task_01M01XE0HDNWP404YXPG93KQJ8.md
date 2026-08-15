# MRQ-217: Airtable mirror — outbound: change feed, batched upserts, and the import boundary

## Objective

Ship only the outbound D1 → Airtable half for `submissions`, `speaker_tasks`, and
`people`. The build is hermetic: all behavior is exercised through an injected
transport and a recorded fake, while a fetch-backed adapter remains available for
the later inbound/configuration work. No token, base, or network is needed by
`npm test`.

## Contract and boundaries

- Binding behavior: `SPEC.md` §3.9 and Amendment 24, US-72 AC-225–AC-229,
  EVALUATION gate 9 / `check:mirror`, G4/G5, and audit A-4.
- Preserve the existing `mirror_outbox`, `mirror_state`, queue binding, row
  types, token scope, health reads, and reset enqueue seam; no migration or
  contract-document edits.
- Mirror exactly the three named tables. Do not build inbound webhook handling,
  allowlist application, keepalive, Settings UI, or any fourth-table path.

## Delivery sequence

1. Establish the baseline and enumerate every write seam for the three mirrored
   tables. Record the existing reset and mail-consumer conventions, then move the
   ticket through `planned` to `in_progress` after this plan commit.
2. Add the mirror transport boundary under `src/jobs/mirror/`: a typed Airtable
   records/upsert interface, fetch-backed implementation, and deterministic fake
   test transport. Keep the provider importable only within that job boundary;
   normalize the three table payloads and emit public R2 URLs for attachments.
3. Add config gating and the shared outbound change-feed writer. Enabled writes
   stamp `last_write_source='marquee'` and enqueue one JSON `mirror_outbox` row
   per mirrored row/op; disabled configuration does neither and is silent. A
   mirror-originated write is explicitly excluded so the inbound ticket can set
   `last_write_source='airtable'` without an echo.
4. Wire the real write seams and reset path: ordinary writes use the feed, while
   reseed writes carry the existing `suppress_mirror` intent and produce zero
   row entries; replace the `mirror_reconcile` stub acknowledgement with the
   mirror job consumer and retain exactly one reconcile message per reset.
5. Implement the queue drain in the shipped mail-consumer style. Claim/retry
   rows safely, coalesce into PATCH groups of ten, send
   `performUpsert.fieldsToMergeOn: ["marquee_id"]`, enforce a shared ≤4 req/s
   token bucket, and update attempts/errors/drained timestamps plus sync state.
   Missing credentials/base are a successful no-op, never a retry storm.
6. Replace the `check:mirror` stub text to identify the absent base, and add the
   A-4 import-boundary check. Its test will first introduce a deliberately bad
   import and prove failure, then remove it; the committed check covers static
   imports without importing Airtable during request-path tests.
7. Add focused unit/integration coverage and retain evidence artifacts in test
   output: fake call log with ten-record PATCH/upsert fields, measured limiter
   rate, reset one-message/zero-row behavior, absent-config no-op, attachment
   URL projection, echo suppression, retry bookkeeping, and import-boundary
   mutation failure. Run focused tests, `npm test`, and the honest `npm run
   pr-gate` under the shared gate lock as appropriate.
8. Commit each coherent implementation unit, push the branch, open the PR
   against `main`, and hand the parent the exact SHA, gate status, review/
   validation evidence, and any recoverable blocker. The parent owns review and
   merge.

## Verification matrix

| Claim | Evidence |
|---|---|
| AC-225 / batching | Fake transport call log: PATCH batches of 10, exact `performUpsert` field, elapsed drain budget |
| Rate safety | Clock-injected limiter test: no more than four provider requests per second |
| AC-227 outbound | Mirror-originated row has no new outbox entry; alternating edits remain bounded and drain |
| Reset guardrail | `reset:demo`/reseed fixture yields one reconcile queue message and zero per-row outbox rows |
| Disabled product | No key/base yields no feed rows, no provider call, no retry/backlog, no thrown error |
| G4 / A-4 | Mutation test fails on a bad import outside `src/jobs/mirror/*`; clean tree passes |
| Payload safety | Three-table allowlist and public R2 URL assertions; no request-path Airtable import |

## Non-goals

No inbound webhook, field allowlist, Airtable-to-D1 write, keepalive cron,
Settings page, live-base run, migration, schema expansion, contract edits, or
PR merge.
