# S-3 verdict — use one `json_each(?)` ID-set parameter

## Decision

**M-07 should default every ID-set bulk write to one JSON array binding expanded by `json_each(?)`.** Both candidates safely changed 150 and 1,000 submissions in local D1, but `json_each` uses one write query and seven total bindings at either scale. The strongest bounded-chunk candidate (`D1Database.batch`, no statement over 90 total bindings) needs 2 write queries for 150 records and 12 for 1,000.

At 1,000 records, `json_each` was faster in this local probe as well: **6 ms median / 6 ms p95**, versus **8.5 ms median / 12 ms p95** for bounded chunks. At 150, both medians were 2 ms; timings at this scale are below the resolution at which a 1 ms local difference deserves architectural weight. The decisive advantages are the 12× lower query count at wave scale, fewer rows read, and much more headroom for M-18's decision/cascade work inside the same Worker invocation.

Do not build a general placeholder-counting chunker as M-07's default. Keep bounded chunks only as a documented fallback for a future query that cannot express its input through D1's JSON functions.

## Measured results

Environment: macOS 26.5 arm64, Node 26.5.0, Wrangler 4.120.0, local D1 through `wrangler dev --local`, workerd 1.20260801.1, compatibility date 2026-08-08. The schema mirrors the binding `submissions` fields and the `(event_id, status, kind)` index from `SPEC.md` §3.4. Each cell is ten separate Worker invocations after a deterministic 1,000-row seed. Every trial reset equivalent state, timed only the candidate write, then asserted both `meta.changes` and the final accepted count.

| Selected | Pattern | Bindings per write query | Write queries | Wall ms, 10 trials | Median | p95 | D1 rows read |
|---:|---|---|---:|---|---:|---:|---:|
| 150 | ≤90-bound chunks, batched | 90, 72 | 2 | 3, 2, 3, 3, 3, 2, 2, 2, 2, 2 | 2 | 3 | 2,450 |
| 150 | `json_each(?)` | 7 | 1 | 2, 4, 2, 2, 2, 2, 2, 2, 2, 2 | 2 | 4 | 1,600 |
| 1,000 | ≤90-bound chunks, batched | 90 × 11, 82 | 12 | 9, 8, 8, 9, 9, 9, 12, 8, 8, 8 | 8.5 | 12 | 15,000 |
| 1,000 | `json_each(?)` | 7 | 1 | 5, 6, 6, 5, 5, 6, 5, 6, 6, 6 | 6 | 6 | 5,000 |

All 40 trials changed exactly the selected row count. The 1,000-ULID-shaped JSON array was **29,001 bytes**; the 150-ID array was 4,351 bytes.

The explicit cap control also behaved as required:

- 100 bound IDs: succeeded and changed 100 rows.
- 101 bound IDs: rejected locally with `D1_ERROR: too many SQL variables ... SQLITE_ERROR`.

The chunked statement has six fixed bindings (`status`, `wave_id`, `decided_at`, `decided_by_person_id`, `updated_at`, `event_id`), so a 90-total-binding safety ceiling permits **84 IDs**, not 90. That all-bindings accounting is the first trap this spike found.

## Exact M-07 helper contract

Build this helper and make callers supply a prepared statement whose final logical input is the JSON ID set:

```ts
export async function runBulkByIds<T = Record<string, unknown>>(
  ids: readonly string[],
  prepare: (idsJson: string) => D1PreparedStatement,
): Promise<D1Result<T> | null>;
```

Required behavior:

1. Deduplicate IDs while preserving first-seen order.
2. Return `null` without querying D1 for an empty set.
3. `JSON.stringify()` the normalized IDs exactly once and pass that string to `prepare`.
4. Call `.run<T>()` exactly once; do not silently fall back to placeholder expansion.
5. Callers use this SQL shape, with a cast to keep ID affinity explicit:

```sql
WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
```

Representative call:

```ts
await runBulkByIds(ids, (idsJson) =>
  db.prepare(`
    UPDATE submissions
    SET status = ?, wave_id = ?, decided_at = ?,
        decided_by_person_id = ?, updated_at = ?
    WHERE event_id = ?
      AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
  `).bind(status, waveId, now, deciderId, now, eventId, idsJson)
);
```

This is deliberately a statement factory rather than a raw-SQL helper: each route retains control of its fixed bindings, while the helper centrally owns empty-set behavior, deduplication, serialization, and the one-query invariant. M-07's tests should drive 150 and 1,000 IDs and mechanically assert that no bulk helper constructs `IN (?, ?, ...)`.

## What is verified, and what is not

Locally verified through the D1 Worker binding:

- The 100-binding boundary is accepted and 101 is rejected.
- D1's JSON functions accept one bound JSON array and expand 150/1,000 text IDs correctly.
- Both candidate patterns survive both target sizes and change exactly the intended rows.
- The bounded-chunk write uses 2/12 D1 statements; `json_each` uses one.
- The full probe invocation used 4/14 D1 queries for chunking and 3/3 for `json_each` (these include one harness reset and one verification query). Thus both shapes are arithmetically below Cloudflare's documented Free-plan 50-query and Paid-plan 1,000-query ceilings; `json_each` leaves substantially more room.

Deploy-verified later, once Cloudflare auth and a scratch D1 exist:

- Production D1 latency, regional/network variance, and p95 under concurrent traffic.
- Actual account-plan enforcement of the 50/1,000 per-invocation query ceilings, Worker CPU limits, and the 30-second D1 query-duration limit. Local D1 does not prove plan/account enforcement.
- The assembled M-18 transaction, including selector resolution, `submission_decisions`, cascade/outbox work, rollback, and per-record result reporting. This spike settles the shared ID-set transport only.

Cloudflare's current D1 limits document 100 maximum bound parameters and 50 Free / 1,000 Paid queries per Worker invocation: <https://developers.cloudflare.com/d1/platform/limits/>. Cloudflare also documents the exact `json_each` + `JSON.stringify()` Worker-binding pattern used here: <https://developers.cloudflare.com/d1/sql-api/query-json/#expand-arrays-for-in-queries>.

## Reproduce

```bash
cd spikes/s3-d1-chunking
npm install
npm run run
```

The run recreates only this spike's local D1 database, starts Wrangler on `127.0.0.1:8796`, runs the cap control and 40 asserted trials, prints one JSON record per probe/trial, then stops the local Worker.
