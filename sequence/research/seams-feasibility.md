# Marquee — External Seams & Feasibility

**Agent:** Seams Feasibility (Marquee Initiation → Seams Feasibility)
**First pass:** 2026-08-08, ~17:15 EDT. All figures retrieved 2026-08-08 unless dated otherwise.
**Serves:** Q1 (Airtable primary vs mirror), Q9 (ICS vs OAuth), R3 (comms + calendar invites), R7 (speed is graded), R46 (1,000–3,000 submissions), §5 (stack signals).
**Status:** Evidence gathered as recommendations — **Q1 and Q9 ratified by Atin, 2026-08-08 ~17:40 EDT.** The two bets below are now decisions the architecture stage inherits, not options it re-litigates. Everything else on this page remains evidence.

> **Ratified 2026-08-08.**
> **Q1 —** D1 is the source of truth. Airtable is a genuine, visible, bidirectional mirror over the Records API, off every read path.
> **Q9 —** ICS `METHOD:REQUEST` + deep links. OAuth calendar-write is out of scope for this build.
> Reopening either requires a Discord ruling from swyx, not a preference.

---

## 0. Executive read — four bets and one number

**The number that decides Q1: Airtable's per-base rate limit is 5 requests per second, and blowing it costs 30 seconds.** ([Airtable, Rate limits](https://airtable.com/developers/web/api/rate-limits)) Thirty judges browsing a 3,000-row list at ~3 API calls per page navigation is ~90 req/s against a 5 req/s ceiling — 18× over, with each 429 imposing a mandatory 30-second wait. In a competition whose emotional core is *"oh my god, this is so slow"* (R7, [07:16]), a 30-second stall in front of a judge is a loss condition, not a performance regression.

| # | Bet | Confidence | Cost |
|---|---|---|---|
| **Q1** | **D1 as source of truth + a genuine, visible, two-way Airtable mirror** via the Records API with `performUpsert`, plus an Airtable webhook for inbound edits on an allowlist. Never read Airtable to render a page. | High | 10–16 h |
| **Q9** | **ICS with `METHOD:REQUEST` + ATTENDEE, delivered as a Resend attachment**, plus Google/Outlook deep links. OAuth calendar-write is **confirmed infeasible** by Wednesday. | Very high | 3–5 h |
| Email | **Resend from `marquee@stage11.systems`** — already verified and sending-enabled since 2026-03-11. Zero domain-warm-up risk. Outbox pattern to survive the 100/day free cap. | Very high | 2–4 h |
| Uploads | **Browser → R2 direct via presigned PUT** (never through the Worker), Cloudflare Images for headshot transforms, Turnstile on the public form. | High | 4–6 h |

**Two things that must be switched on before anyone writes code:** Workers **Paid** ($5/mo — the Free plan's 10 ms CPU per invocation will not server-render a 1,000-row table), and a **verified R2 entitlement** (Stage 11 has had this lapse account-wide before; see Trap 4).

---

## 1. Airtable as a datastore

### 1.1 Objects, limits, and numbers

| Dimension | Value | Source |
|---|---|---|
| **Rate limit, per base** | **5 requests / second** | [Rate limits](https://airtable.com/developers/web/api/rate-limits) |
| **Rate limit, per PAT / user** | 50 requests / second (all traffic for that token) | ibid. |
| **429 penalty** | **Wait 30 seconds** before subsequent requests succeed | ibid. |
| **Monthly API calls / workspace** | Free 1,000 · Team 100,000 · Business & Enterprise Scale **unlimited** | [Managing API call limits](https://support.airtable.com/docs/managing-api-call-limits-in-airtable) |
| **Over-cap behavior** | Free: one 30-day grace period, then blocked until month reset. **Team: throttled to 2 req/s until month reset.** | ibid. |
| **Records / base** | Free 1,000 · Team 50,000 · Business 125,000 · Enterprise Scale **500,000/base, 250,000/table** | [Airtable plans](https://support.airtable.com/docs/airtable-plans); Enterprise figures from [Airtable blog, enterprise features](https://blog.airtable.com/new-enterprise-features-to-govern-and-scale/) |
| **Attachment storage / base** | Free 1 GB · Team 20 GB · Business 100 GB · Enterprise up to 1 TB | ibid. |
| **Seat price** | Team $20–24/seat/mo · Business $45–54/seat/mo · Enterprise contact sales | [Airtable plans](https://support.airtable.com/docs/airtable-plans) |
| **Batch size, create/update/delete** | **10 records per request** → hard ceiling of **50 records/second per base** | [Managing API call limits](https://support.airtable.com/docs/managing-api-call-limits-in-airtable) ("batching can handle up to 10 records per request, enabling you to update up to 50 records per second") |
| **Pagination** | `pageSize` max **100** (also the default); cursor is an opaque `offset` from the previous response — **inherently serial** | [List records](https://airtable.com/developers/web/api/list-records) |
| **URL length** | 16,000 chars; long `filterByFormula` must move to `POST /v0/{baseId}/{table}/listRecords` | ibid. |
| **Upsert** | `performUpsert.fieldsToMergeOn` — 1–3 fields, must be non-computed and one of number/text/long text/single select/multi select/date | [Update multiple records](https://airtable.com/developers/web/api/update-multiple-records) |
| **Transactions** | **None.** No atomicity guarantee; the API defines a `partialSuccess` response variant, i.e. partial writes are an expected outcome | [Create records](https://airtable.com/developers/web/api/create-records) |
| **Read-only (computed) fields** | `formula`, `rollup`, `multipleLookupValues`, `autoNumber`, `createdTime`, `lastModifiedTime`, `createdBy`, `lastModifiedBy` — cannot be written by the API | [Field model](https://airtable.com/developers/web/api/field-model) |
| **Select options** | API rejects unknown choices (`INVALID_MULTIPLE_CHOICE_OPTIONS`) unless `typecast: true`, which then silently creates new options | ibid. |
| **Attachment URLs** | **Expire 2 hours after being returned from the API** | ibid. |
| **Attachment upload endpoint** | 5 MB max, base64-encoded body; larger files must be passed as a public URL | [Upload attachment](https://airtable.com/developers/web/api/upload-attachment) |
| **Auth** | API keys deprecated **2026-02-01** *(doc reads Feb 1, 2024)*; PATs or OAuth only. OAuth access token **60 min**, refresh token **60 days** | [Deprecation guidelines](https://support.airtable.com/docs/airtable-api-deprecation-guidelines), [OAuth reference](https://airtable.com/developers/web/api/oauth-reference) |

### 1.2 Webhooks — real semantics

Airtable webhooks are **not** data-carrying. ([Webhooks overview](https://airtable.com/developers/web/api/webhooks-overview))

- The POST to your notification URL contains only `base` ID, `webhook` ID, and a timestamp. You must respond 200/204, then make a **second** call to `list webhook payloads` with a cursor to learn what actually changed.
- That second call **counts against the same 5 req/s per-base budget** as everything else.
- **Webhooks expire after 7 days.** Calling refresh or list-payloads extends by 7 days from that moment. An expired webhook keeps metadata and payloads for one further week.
- Delivery is at-least-once, with up to **13 retries over roughly one day**.

Consequence for a two-way mirror: inbound sync is a *pull triggered by a ping*, must be idempotent (at-least-once + your own outbound writes will echo back), and needs a keepalive. All of that is tractable; none of it is free.

### 1.3 Pattern A — Airtable as the primary store. Where exactly it breaks.

It breaks in five specific places, and only one of them is the record cap.

**(a) Pagination is serial, and R46 makes it long.**
`pageSize` caps at 100 and the `offset` for page *N+1* only exists inside the response for page *N*. A full listing of 3,000 submissions is **30 sequential round trips**. At a realistic 150–400 ms per Airtable round trip from a Worker, that is **4.5–12 seconds** for one unfiltered list — before rendering. At 1,000 submissions it is still 10 serial hops, ~1.5–4 s. R7 is a graded feature; this loses it outright.

**(b) The 5 req/s per-base ceiling is a concurrency wall, not a throughput wall.**
Two judges browsing simultaneously can saturate it. Thirty judges — the §3 estimate of the evaluation field — at ~3 calls per page navigation is ~90 req/s against 5. Every overflow costs a **30-second** stall. There is no per-base scaling lever: Business and Enterprise remove the *monthly* cap but the doc states rate limiting still "applies per base."

**(c) There is no aggregation, so every dashboard tile is a full scan.**
R6 (outstanding onboarding tasks), R11 (program dashboard), and the accept-rate/wave counters of R43 all want `COUNT`/`GROUP BY`. Airtable's REST API has neither. Each tile becomes another 10–30-hop paginated scan, or you denormalize into rollup fields and accept that they are read-only and eventually consistent.

**(d) No transactions, and R43 is a bulk mutation.**
"Accept 40 submissions in Wave 1" is 4 batched PATCHes with no rollback and a documented `partialSuccess` path. A judge who bulk-accepts and gets 27 of 40 has found a data-integrity bug on camera.

**(e) Attachment URLs expire in 2 hours — this alone disqualifies Airtable for R2's media.**
Speaker headshots and slides are the speaker portal. If Airtable holds them, every page render must re-call the API to re-mint URLs (more 5 req/s pressure), and any URL you cached in your own DB is a broken image after two hours. Plus the upload endpoint caps at **5 MB**, which does not hold a 25 MB slide deck.

**What Airtable-as-primary is *not* blocked by:** the record cap. 3,000 submissions plus ~150 speakers plus tasks fits comfortably in Team's 50,000/base. The binding constraints are latency, concurrency, aggregation, atomicity, and attachment TTL — in that order.

### 1.4 Pattern B — real DB as source of truth + a genuine Airtable mirror

Three mechanisms exist. They are not equivalent.

| Mechanism | Two-way? | Plan required | Throughput | Verdict |
|---|---|---|---|---|
| **B1. Records API + `performUpsert`** | **Yes** — table is fully editable in Airtable; inbound via webhook | Any (Free upward) | 10 records/request, 5 req/s → 50 rec/s; 3,000-row backfill ≈ **300 requests ≈ 60 s** | **Recommended** |
| **B2. Sync API (CSV push)** | No — synced records "cannot be manually deleted"; table is effectively read-only | **Business / Enterprise Scale only** | 10,000 rows / 500 cols / 2 MB per request; **20 requests per 5 min per base** → whole table in ONE call | Cheapest by far, but paywalled and kills two-way |
| **B3. Airtable's own external-source sync** | No — Airtable states sync integrations are "always a one way sync from the external application into an Airtable base" | Team+ | n/a | Not applicable; we are not a supported source |

**B2 detail, for the record** ([Sync API support doc](https://support.airtable.com/docs/airtable-sync-integration-sync-api), [endpoint reference](https://airtable.com/developers/web/api/post-sync-api-endpoint)):
`POST https://api.airtable.com/v0/{baseId}/{tableIdOrName}/sync/{apiEndpointSyncId}` · `Content-Type: text/csv` · scopes `data.records:write` + `schema.bases:write` · first CSV row is headers · supports single-line text, email, long text, number, date, duration, phone, currency, URL, percent. It is genuinely elegant — one request replaces the whole table — but Business-plan gating makes it undemonstrable unless AIE already has Business (they might; unknown), and one-way read-only defeats the "our ops people edit the data" need that §5 identifies as the *actual* reason for the bonus.

**Recommended architecture (B1), concretely:**

1. Every D1 row carries a stable `marquee_id` (ULID). Mirror it into an Airtable text field of the same name.
2. **Outbound:** a change-feed table in D1 (`mirror_outbox`) drains on a Workers cron (min granularity: 1 minute) and/or a Queue consumer, batching 10 records per PATCH with `performUpsert.fieldsToMergeOn: ["marquee_id"]`. Idempotent by construction; safe to replay.
3. **Inbound:** one Airtable webhook per mirrored table → Worker receives the bare ping → calls list-payloads with a stored cursor → applies **only an allowlisted set of fields** (e.g. `status`, `reviewer_notes`, `score`, `track`) back into D1. Everything else in Airtable is display-only and gets overwritten on the next outbound pass. Stamp `last_write_source` to break echo loops.
4. **Keepalive:** a daily cron calls webhook refresh. The 7-day expiry is inside the contest window, but a mirror that silently dies eight days after judging is exactly the kind of thing this buyer would notice.
5. **Never read Airtable on a request path.** Not once. That is the whole point.

**Estimated setup cost:** outbound + upsert + seeded base + settings UI: **6–10 h**. Inbound webhook + allowlist + echo suppression: **+4–6 h**.

### 1.5 What "genuine" has to mean to this judge

§5 of the dossier reads the Airtable bonus correctly: the underlying need is *"our ops people must be able to open the data directly."* A README claim is worth nothing. Make the mirror a **surface in the product**:

- A **Settings → Airtable** page showing: the connected base (a real, clickable `airtable.com/app…` link), per-table row counts on both sides, last successful sync timestamp, pending-outbox depth, and a **Sync now** button with a live log.
- The demo base is **pre-populated before judging** with the full seeded event (Q3's ~800–1,000 submissions — note that 1,000 rows exceeds the **Free** plan's 1,000-record base cap, so the demo base must be on **Team or above**).
- A documented round-trip in the README: *"change a submission's status in Airtable, refresh Marquee, see it."* That is a 20-second demo that converts the bonus from a checkbox into a proof.

### 1.6 Prior art worth borrowing

| Tool | What it is | Useful to us? |
|---|---|---|
| [`airtable-postgres-sync`](https://pypi.org/project/airtable-pg-sync) (PyPI) | One-off + perpetual Airtable→Postgres replication | **Read it, don't use it.** Wrong direction, wrong runtime (Python, not Workers), but its change-detection and schema-mapping approach is the shape we want. |
| [Airbyte Airtable connector](https://airbyte.com/connectors/airtable) | OSS ELT, Airtable source | Wrong direction and far too heavy for 104 hours. |
| Whalesync / Sequin / Stacksync | Commercial real-time two-way Postgres↔Airtable | Not usable (SaaS dependency in an open-source hackathon entry), but **they are the competitive proof that two-way is a real, sellable category** — worth one line in the README. |
| [`airtable.js`](https://github.com/Airtable/airtable.js) (official) | Airtable's own JS client, **includes built-in 429 back-off** | The back-off logic is the part to copy. The client itself is Node-oriented; on Workers, hand-rolled `fetch` + a token-bucket limiter at 4 req/s is simpler and more predictable. |

### 1.7 **What I'd bet on Q1** *(recommendation, not decision)*

**D1 is the source of truth; Airtable is a genuine, visible, bidirectional mirror over the Records API, off every read path.** Claim the bonus explicitly in the README with the round-trip demo, and say out loud *why* — "your team keeps its Airtable, without paying Airtable's 5 req/s and 30-hop pagination on every page load." Stating the engineering reason is itself a credibility play with a buyer whose top complaint is craft.

**The one thing that would change my mind:** a Discord ruling from swyx that Airtable must be the literal primary datastore. Even then I would argue the mirror, in writing, and build the mirror.

---

## 2. Cloudflare platform

### 2.1 Workers

| Dimension | Free | Paid ($5/mo min) | Source |
|---|---|---|---|
| Requests | 100,000/day | 10 M/mo included, then $0.30/M | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| **CPU per invocation** | **10 ms** | 30 s default, configurable to **5 min**; 30 M CPU-ms/mo included, then $0.02/M | ibid. |
| Wall-clock (HTTP) | No enforced limit while client connected | same | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Memory | 128 MB per isolate (JS heap + Wasm) | same | ibid. |
| **Startup time** | Global scope must parse+execute in **< 1 s** | same | ibid. |
| **Request body size** | **100 MB** (Free/Pro) · 200 MB Business · 500 MB Enterprise | same | ibid. |
| Subrequests / request | 50 | 10,000 (configurable higher) | ibid. |
| Simultaneous outgoing connections | 6 | 6 | ibid. |
| Script size | 3 MB gz / 64 MB raw | 10 MB gz / 64 MB raw | ibid. |
| Cron triggers | 5/account | 250/account | ibid. |
| Cron CPU | — | 30 s (interval < 1 h) · 15 min (≥ 1 h); wall clock 15 min | ibid. |
| Cache API | 512 MB object; 50 calls/req | 512 MB; 1,000 calls/req (**shares the subrequest quota**) | ibid. |

**Cold start.** There is no meaningful cold start in the Node/container sense — isolates start in single-digit ms — but the **1-second global-scope budget** is a real constraint if a framework does heavy top-level work. Keep imports lean; construct DB/auth clients *inside* the handler (which D1 forces anyway — see §5).

**The 10 ms Free-plan CPU limit is the trap.** Server-rendering a 1,000-row table, generating ICS, or hashing a session token will exceed 10 ms. **Workers Paid is mandatory**, and $5/mo makes this a non-decision.

### 2.2 Static assets / Pages

Workers Static Assets: **20,000 files** (Free) / 100,000 (Paid), **25 MiB per file**, and **"requests to static assets are free and unlimited"** with no storage cost. ([Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [platform limits](https://developers.cloudflare.com/workers/platform/limits/#static-assets)) Pages Functions are "billed as Workers" with identical pricing. Either satisfies the "mild bonus"; Workers + static assets is the current-shape default and keeps one deployment artifact.

### 2.3 D1

| Dimension | Free | Paid | Source |
|---|---|---|---|
| Max database size | 500 MB | **10 GB** (not increasable) | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Databases / account | 10 | 50,000 | ibid. |
| Storage / account | 5 GB | 1 TB (increasable) | ibid. |
| Columns / table | 100 | 100 | ibid. |
| Rows / table | Unlimited (bounded by DB size) | same | ibid. |
| Row / string / BLOB size | 2 MB | same | ibid. |
| SQL statement length | 100 KB | same | ibid. |
| **Bound parameters / query** | **100** | same | ibid. |
| Query duration | 30 s | same | ibid. |
| **Queries per Worker invocation** | **50** | **1,000** | ibid. |
| Simultaneous D1 connections / invocation | 6 | 6 | ibid. |
| **Rows read** | 5 M/day | 25 B/mo included, then $0.001/M | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| **Rows written** | 100 k/day | 50 M/mo included, then $1.00/M | ibid. |
| Storage | 5 GB total | first 5 GB included, then $0.75/GB-mo | ibid. |
| Egress | none charged | none charged | ibid. |

**Speed characteristics that serve R7.** The whole AIE NYC 2026 dataset — 3,000 submissions, 150 speakers, tasks, scores, agenda — is roughly **2–5 MB**. It fits in page cache. Simple indexed lookups on D1 benchmark in the sub-millisecond to low-single-digit-ms range; complex aggregations lag Postgres (one 2026 comparison: ~45 ms vs 18 ms on an aggregation, ~4 ms p50 on PK lookups). ([Cloudflare D1 production notes](https://tanstackship.com/blog/cloudflare-d1-production-guide) — third-party benchmark, treat as indicative not authoritative.) For our shape — indexed filters and counts over a few thousand rows — this is the fast answer, and it is the direct counter to R7.

**The 100-bound-parameter cap is a real constraint** on bulk operations: a wave-acceptance of 200 submissions cannot be one `WHERE id IN (...)`. Chunk at 90, or use a temp table / `json_each()`.

**Read replication** ([docs](https://developers.cloudflare.com/d1/best-practices/read-replication/)): enable via dashboard or REST `read_replication.mode: auto`; requires the **Sessions API** with bookmarks to get sequential consistency (monotonic reads/writes, read-your-writes); six regions; **no extra cost**; **disabling takes up to 24 hours**. For a single-day judging window with judges plausibly all in North America, this is optional polish, not a requirement — and the 24-hour disable makes it a one-way door if flipped late.

**Smart Placement** ([docs](https://developers.cloudflare.com/workers/configuration/smart-placement/)): `placement.mode: smart`, available on all plans, but Cloudflare explicitly says it "requires consistent traffic from multiple locations" and takes up to **15 minutes of analysis** after deploy. A hackathon demo with sparse traffic will not benefit. **Do not rely on it for R7.**

### 2.4 R2

| Dimension | Value | Source |
|---|---|---|
| Storage | $0.015/GB-mo (Standard) · free tier **10 GB-mo** | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Class A ops (writes/lists) | $4.50/M · free tier 1 M/mo | ibid. |
| Class B ops (reads) | $0.36/M · free tier 10 M/mo | ibid. |
| **Egress** | **Free** | ibid. |
| Max object size | 4.995 TiB | [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) |
| Max single-part PUT | 4.995 GiB | ibid. |
| Max multipart parts | 10,000 | ibid. |
| Buckets / account | 1,000,000 | ibid. |
| Custom domains / bucket | 100 | ibid. |
| Bucket management ops | 50/s | ibid. |
| **Concurrent writes to same object** | **1/s** (HTTP 429 beyond) | ibid. |
| R2 REST API | 1,200 requests / 5 min | ibid. |
| `r2.dev` subdomain | variable rate limiting; **testing only, not production** | ibid. |

**Presigned URLs** ([docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)): GET / HEAD / **PUT** / DELETE supported. **POST (HTML multipart form upload) is NOT supported** — browser uploads must be a `fetch`/`XHR` **PUT**, not a plain `<form>`. Expiry 1 s – 7 days. CORS rules are required on the bucket for browser origins. Pin `Content-Type` in the signature so a mismatched upload fails 403. **Presigned URLs only work against the S3 API domain (`{account}.r2.cloudflarestorage.com`), not a custom domain** — sign against S3, serve reads from the custom domain.

**Stage 11 reusable:** `code/platform/cloudflare.md` has a validated end-to-end recipe for creating a bucket and attaching a public custom domain, including the non-obvious step that the custom-domain POST **ignores `enabled: true`** and must be followed by a PUT. Copy it verbatim; it saves an hour of confusion.

### 2.5 KV, Queues, Durable Objects, Turnstile, Images

**KV** ([limits](https://developers.cloudflare.com/kv/platform/limits/)): key 512 bytes; value 25 MiB; metadata 1,024 bytes; **same-key writes capped at 1/s on both plans**; 1,000 namespaces/account; 1,000 operations per Worker invocation; minimum `cacheTtl` 30 s. Free: 100 k reads/day, 1 k writes/day. **KV is eventually consistent — do not put sessions that must invalidate instantly in KV.** Good for: form-definition caching, rendered public agenda fragments, rate-limit counters (accepting slop).

**Queues** ([limits](https://developers.cloudflare.com/queues/platform/limits/)): 10,000 queues/account; message 128 KB; consumer batch 100 messages; `sendBatch` 100 messages or 256 KB; max batch wait 60 s; **5,000 msg/s per queue**; retention 14 days configurable (**Free: fixed 24 h**); 100 retries; 250 concurrent consumer invocations; 15 min wall clock. This is the right home for the Airtable mirror drain and the email outbox — both want retry semantics we should not hand-roll.

**Durable Objects (SQLite backend)** ([docs](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)): GA; SQL via `ctx.storage.sql`; point-in-time recovery to any moment in the past 30 days via bookmarks; compute and storage colocated (Cloudflare notes that with D1 "your application code and SQL database queries are not colocated, which can impact application performance"); SQL pricing intended identical to D1. **Tempting for a per-event database** (R45 multi-event), and genuinely faster. **I would not take it for this build** — it is a materially less-travelled path, the tooling around migrations is thinner, and 104 hours is the wrong window to discover that. Note it in the README as the scaling story.

**Turnstile** ([plans](https://developers.cloudflare.com/turnstile/plans/), [overview](https://developers.cloudflare.com/turnstile/)): free tier allows **20 widgets**, 10 hostnames each, all widget types, unlimited challenges; **works on any site, no traffic through Cloudflare required**. Client widget + server `siteverify`. ~30 minutes to wire, and it is the correct answer to "R19 says the public form works logged-out" (§6.2 below).

**Images** ([pricing](https://developers.cloudflare.com/images/pricing/)): **5,000 unique transformations/month free**, then $0.50/1,000; storage $5/100 k images/mo; delivery $1/100 k. **Transformations work on images stored in R2**, and when the source is outside Images you are billed *only* for transformations — so R2-for-storage + Images-for-resize costs $0 at our volume. Over the free cap, requests return error 9422 rather than billing you.

### 2.6 What a judge-proof Cloudflare deployment looks like

- One Worker with static assets (SPA or SSR framework of choice), one D1, one R2 bucket, one KV namespace, one Queue, Turnstile on the public form, cron for reminders + mirror keepalive.
- **Workers Paid, enabled and verified on day 1.**
- Custom domain: `marquee.stage11.dev` (dev) and a production host. Note `.dev` is **HSTS-preloaded** — `https://` only, always.
- **Cookies scoped to the exact subdomain, never to `.stage11.systems`** (Stage 11 hard rule; a parent-domain cookie is readable by every other project).
- Seed script that populates D1 + R2 + the Airtable base in one command, idempotently, so the demo can be reset between judges.

---

## 3. Outbound email

### 3.1 The constraint

**Cloudflare Workers cannot send SMTP.** There is no outbound TCP to port 25/465/587. The historical workaround — MailChannels' free Workers-only API — was **terminated 2024-06-30 and fully shut down 2024-08-31** ([MailChannels EOL notice](https://support.mailchannels.com/hc/en-us/articles/26814255454093-End-of-Life-Notice-Cloudflare-Workers)). Cloudflare Email Routing is **receive-only** and cannot send. Every email path is therefore an HTTPS API call to a third party.

### 3.2 Options

| Provider | Free tier | Setup cost | Verdict |
|---|---|---|---|
| **Resend** | 3,000/mo, **100/day**, 1 custom domain, 30-day retention; Pro $20/mo → 50 k/mo, no daily cap, 10 domains | **~0 h — already provisioned** | **Take it** |
| Amazon SES | $0.10/1,000; but **new accounts start in sandbox** (verified recipients only) and production access is a support ticket with a review | 2–24 h of *waiting* | Deadline trap |
| Postmark | 100/mo free (trial); strong deliverability | ~1 h + approval review for some accounts | Viable fallback |
| MailChannels (post-EOL) | 100/day free on the new API | ~1 h | Fallback only; the migration churn suggests instability |

### 3.3 Resend — real semantics

([API reference](https://resend.com/docs/api-reference/emails/send-email), [batch](https://resend.com/docs/api-reference/emails/send-batch-emails), [pricing](https://resend.com/pricing))

- **Rate limit: 10 requests/second per team**, increasable on request.
- **Batch endpoint: max 100 emails per call — but `attachments` is explicitly "not supported yet" in batch.** This matters directly for R3: **calendar-invite emails cannot go out via the batch endpoint.** They must be individual sends, at 10/s.
- Single send: `to` accepts max 50 recipients; attachments **max 40 MB per email after base64 encoding**; `content` accepts a base64 string or Buffer; `content_type` derived from filename if omitted; `content_id` supports inline `cid:` images.
- **`scheduled_at`** accepts ISO 8601 or natural language — this is a real gift for R35 (reminder before CFP close): the reminder can be scheduled at send time rather than requiring our own scheduler. (I would still build the cron, and use `scheduled_at` as the belt to the cron's braces.)
- **`Idempotency-Key` header**, valid 24 h — use it on every send keyed by `(template, recipient, entity_id)`. It is the cheapest possible protection against a retry storm emailing 800 speakers twice.
- `tags` (key/value, ASCII, ≤256 chars) — use for `event_id` / `template` so the Resend dashboard doubles as an audit trail.
- Custom `headers` — needed for `List-Unsubscribe` and for `Auto-Submitted: auto-generated` on system mail.

### 3.4 Deliverability from a hackathon-fresh domain — **already solved**

**Verified live, 2026-08-08, against the Stage 11 Resend account:**

```
{ "id": "3df4394e-…", "name": "stage11.systems", "status": "verified",
  "created_at": "2026-03-11 01:15:12+00", "region": "us-east-1",
  "capabilities": { "sending": "enabled", "receiving": "disabled" } }
```

`stage11.systems` has been verified and sending-enabled for **five months**. SPF, DKIM, and DMARC are already on the zone (see `code/platform/cloudflare.md` §"Email"). **There is no domain-warm-up risk and no DNS work on the critical path** — send as `Marquee <marquee@stage11.systems>` from hour one.

This also collapses the biggest email-side deadline trap. Platform notes warn Resend verification takes "minutes to hours, even when DNS records resolve immediately via `dig`" and to "set up domains well before you need them." We already did, in March.

**The $500 signal (§5 of the dossier).** AIE budgeted "custom email domain setup" at $500, twice — branded outbound mail is something this buyer *pays for*. `marquee@stage11.systems` reads as a real product domain. If we want the sharper version, registering `marquee.<something>` and verifying it is ~1 h of work *plus* an unbounded verification wait — do it **Saturday or not at all**. Do not attempt a fresh sending domain on Tuesday.

### 3.5 Templating, merge fields, and scheduling — what we get vs. what we build

| Need | Resend gives us | We build |
|---|---|---|
| HTML rendering | Nothing server-side; you POST final HTML (React Email is an optional client-side lib) | Template store in D1 + a tiny `{{speaker.name}}`-style merge renderer. **~2 h.** Keep it visible: admins must be able to edit templates in the UI (R3 says "templated"). |
| Merge fields | — | ditto |
| Scheduled sends | **`scheduled_at`** | Cron + outbox for anything conditional ("remind speakers with outstanding tasks") |
| Per-recipient batching | 100/call, **no attachments** | Split: bulk announcements via batch; anything with an ICS goes single-send at ≤10/s |
| Delivery status | `GET /emails/{id}`, 30-day retention, webhooks | A **Communications log** screen in-product. This is a visible feature, not just plumbing — it makes R3 legible to a judge in one screen. |
| Suppression / unsubscribe | `topic_id` subscription management | `List-Unsubscribe` header + an opt-out row |

### 3.6 The 100/day trap, and the outbox pattern

On the Free plan we get **100 emails/day**. A seeded demo containing 800–1,000 submissions must never actually attempt to mail 800 people — and a judge *will* click "Send reminder to all speakers with outstanding tasks."

**Mitigation (build this from the start, not as a patch):**
- Every send goes through an `outbox` table with status `queued | sent | suppressed | failed`.
- A **demo-safe mode** flag: real delivery only to an allowlist (`*@stage11.systems`, plus the judges' addresses if we learn them); everything else is written to the outbox as `suppressed (demo mode)` and rendered in the Communications log with a full preview.
- The judge sees a *complete, honest* record of what would be sent, with real HTML previews and the actual ICS attached — and can send one to themselves to prove the pipe works.
- This is better than the alternative even with unlimited quota: it makes R3 demonstrable in five seconds instead of requiring an inbox.

**Also note** (`code/platform/resend.md`): `api.resend.com` sits behind Cloudflare and **hard-blocks the `Python-urllib` User-Agent** with a 403 / `error code: 1010`. Irrelevant if we call it from a Worker with `fetch`, but it will bite any Python seed/backfill script. Always set an explicit UA.

---

## 4. Calendar invites (R3 / Q9)

### 4.1 ICS real semantics

The governing specs: **RFC 5545** (iCalendar core object), **RFC 5546** (iTIP — the scheduling methods), **RFC 6047** (iMIP — iTIP over email).

**The single fact that decides whether this feature reads as real:**

> An ICS with **`METHOD:REQUEST`** and **`ATTENDEE`** lines renders in Gmail, Outlook, and Apple Mail as an **actual invitation with Accept / Decline / Maybe buttons**. An ICS with no `METHOD`, or `METHOD:PUBLISH`, renders as an attachment you can *import* — no RSVP flow.

Get this wrong and R3 looks like a file attachment. Get it right and it is indistinguishable from a real meeting invite — while Sessionboard, per the dossier's §1.1 note, ships **no calendar-invite feature at all**.

**The pieces that must be correct:**

| Element | Requirement |
|---|---|
| MIME | `Content-Type: text/calendar; charset=utf-8; method=REQUEST; name=invite.ics`. Gmail is most reliable when the calendar part is *also* present as a `multipart/alternative` part alongside the HTML body, not only as a plain attachment. |
| `METHOD` | `REQUEST` in the VCALENDAR (must match the MIME `method` parameter). |
| `ORGANIZER` | `ORGANIZER;CN=AI Engineer:mailto:program@…` — the address the recipient's client will send the RSVP to. Must be a **real, receiving** mailbox if RSVPs are to be captured. Cloudflare Email Routing can receive here (receive-only is fine for RSVPs), or route to a real inbox. |
| `ATTENDEE` | One per invitee: `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Name:mailto:speaker@…` |
| `UID` | **Stable and globally unique per session per speaker.** Use `{session_id}.{speaker_id}@marquee.…`. This is the join key for every future update. |
| `SEQUENCE` | Starts at 0. **Increment on every material change** (time, location, cancellation). A resend with the same UID and a *lower or equal* SEQUENCE is ignored by most clients. |
| `DTSTAMP` | Fresh UTC timestamp on every emission; on ties, latest `DTSTAMP` wins (RFC 5546). |
| **Updates** | Same `UID`, `SEQUENCE+1`, `METHOD:REQUEST`. The client updates the existing event in place. |
| **Cancellation** | Same `UID`, `SEQUENCE+1`, `METHOD:CANCEL`, `STATUS:CANCELLED`. Removes it from the attendee's calendar. |
| Timezones | Either UTC (`DTSTART:20261013T170000Z`) or `DTSTART;TZID=America/New_York:20261013T130000` **with a matching `VTIMEZONE` component**. A `TZID` without `VTIMEZONE` is malformed and Outlook in particular will mishandle it. For AIE NYC (Oct 12–14, 2026, single non-recurring sessions) **UTC is correct, simplest, and DST-safe** — but emit `VTIMEZONE` + `TZID` anyway so a human reading the raw file sees "1:00 PM Eastern." Cheap; reads as care. |
| All-day | `DTSTART;VALUE=DATE:20261012` with `DTEND` the **exclusive** next day (`20261013`). Off-by-one here is the classic bug. |
| Line folding | RFC 5545 requires CRLF line endings and folding at 75 octets. Use a library or fold correctly; Outlook is unforgiving. |

**Delivery via Resend:** base64 the ICS into `attachments[].content` with `filename: "invite.ics"` and `content_type: "text/calendar; charset=utf-8; method=REQUEST"`. Remember §3.3: **the batch endpoint does not support attachments**, so invite sends are individual, rate-limited at 10/s. 150 accepted speakers = ~15 seconds. Fine.

### 4.2 Add-to-calendar deep links (the zero-risk complement)

Ship these alongside the ICS in every acceptance/schedule email and in the speaker portal. They work for anyone whose mail client mangles the attachment.

**Google:**
```
https://calendar.google.com/calendar/render?action=TEMPLATE
  &text=<title>
  &dates=20261013T170000Z/20261013T173000Z
  &details=<description>
  &location=<location>
  &ctz=America/New_York
```
(`dates` in `YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ`; `ctz` optional tz-database name.)

**Outlook (work/school):**
```
https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent
  &subject=<title>&startdt=<ISO8601>&enddt=<ISO8601>&body=<description>&location=<location>
```
Substitute `outlook.live.com` for personal Microsoft accounts.

**Apple / everything else:** the `.ics` file itself, served from a stable URL (`/i/{uid}.ics`) as well as attached.

Sources: [add-event-to-calendar-docs — Google](https://interactiondesignfoundation.github.io/add-event-to-calendar-docs/services/google.html) (community-maintained; Google does not publish an official spec for the TEMPLATE endpoint — treat the parameter set as empirically stable, not contractual).

### 4.3 OAuth calendar-write — **the dossier's read is confirmed. It is infeasible.**

Q9's default said OAuth "cannot realistically complete before Wednesday." That holds, and the evidence is stronger than "probably."

| Blocker | Evidence |
|---|---|
| Calendar scopes are **sensitive** (and `…/auth/calendar`, the full read-write-delete scope, is widely treated as restricted) | [Google, sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification); [Calendar API auth](https://developers.google.com/workspace/calendar/api/auth) |
| Verification takes **"up to 10 days"** per Google's own doc — practically days to several weeks | ibid. |
| Requires **domain ownership verified in Google Search Console**, a **publicly accessible homepage** (not login-gated), a **privacy policy hosted on the same domain**, and an **unlisted YouTube demo video** showing the consent screen with the correct app name and client ID | ibid. |
| **Testing** publishing status caps the number of Google Accounts that may grant access (100) and **limits refresh-token lifetime** — the tester warning screen is shown to every user | ibid. |
| Restricted scopes additionally require a **CASA Tier 2 security assessment**, quoted at 4–12 weeks | [Google, restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) |

Deadline is **2026-08-12, 22:00 PT — ~104 hours from the brief's timestamp.** Google's *best case* stated timeline is 10 days. Microsoft's Graph consent path is faster for single-tenant but requires each speaker to be in a tenant that grants consent — which is not how a conference speaker roster works.

**Even in Testing mode it fails the actual test:** a judge signing in with their own Google account would see an unverified-app warning screen, and only if we had pre-added them as a test user. That is a worse demo than a clean ICS.

### 4.4 **What I'd bet on Q9** *(recommendation, not decision)*

**ICS with `METHOD:REQUEST` + `ATTENDEE` as a Resend attachment, plus Google/Outlook deep links, plus a stable `/i/{uid}.ics` URL. Implement `SEQUENCE` bumping and `METHOD:CANCEL` from the start** — reschedule and cancellation are what separate "we generated an ics file" from "we handle calendar invites," and they are maybe 90 extra minutes.

**Setup cost: 3–5 h total.** Say so in the README: *"OAuth calendar write requires Google verification (10+ days) — we ship the RFC 5546 path that works today, and the OAuth adapter is a documented extension point."* That sentence turns a constraint into evidence of judgment.

---

## 5. Auth for two seats

### 5.1 The requirement, precisely

Two seats, and the walkthrough tests both: an **organizer/admin** login, and a **speaker** who reaches their portal with zero friction (R2, R16, R17, R18). R19 requires the public form to work **fully logged-out**, and the video shows swyx verifying exactly that in incognito. The likely judge path is: submit the form logged-out → receive an email → land in the speaker portal.

### 5.2 Options

| Option | Setup | Speed cost | Notes |
|---|---|---|---|
| **Roll-your-own on D1 + signed cookie** | **3–5 h** | ~0 (one indexed D1 lookup, sub-ms) | Single-use magic-link token row (`token_hash`, `speaker_id`, `expires_at`, `used_at`), 15-min TTL, exchanged for an HttpOnly `Secure` `SameSite=Lax` session cookie. Argon2/bcrypt is too slow for Workers CPU — use `crypto.subtle` + random 256-bit tokens and store only the hash. |
| **Better Auth** | 4–8 h | low | Framework-agnostic TS with an official [magic-link plugin](https://better-auth.com/docs/plugins/magic-link). **No direct D1 adapter** — goes through Drizzle or Kysely. Cloudflare gotcha: **D1 bindings only exist inside the request handler**, so the auth instance must be constructed per-request, not at module scope. A community [`better-auth-cloudflare`](https://github.com/zpg6/better-auth-cloudflare) package exists. Real, but it is a dependency to debug at 2 AM. |
| **Clerk** | 2–3 h | +1 network hop | Free Hobby: **50,000 MRU**, 100 organizations, custom domain included. **But MFA, passkeys, and custom email templates require Pro ($25/mo)** — a magic-link email carrying Clerk's default branding in a demo whose entire thesis is craft is a self-inflicted ding. ([Clerk pricing](https://clerk.com/pricing)) |
| **WorkOS AuthKit** | 2–4 h | +1 hop | **First 1 M MAU free**, includes magic auth, social, passkeys, MFA. SSO connections $125 each (irrelevant to us). Genuinely generous. ([WorkOS pricing](https://workos.com/pricing)) |

### 5.3 **What I'd bet** *(recommendation)*

**Roll it yourself on D1.** Reasons, in order: (1) it is the fastest possible auth — one indexed D1 read, no external hop, which serves R7 directly; (2) magic-link-only for speakers plus password-or-magic-link for organizers is genuinely ~4 hours of well-understood code; (3) it introduces zero third-party branding into the speaker's inbox; (4) an open-source clone that pulls in Clerk has a hosted SaaS dependency at its front door, which is thematically the wrong note for *"Kill My SaaS."* That last point is not an engineering argument, but this competition is being judged by people who care about it.

**Judge-friendly demo credentials.** Non-negotiable, and it is the answer to R25 (he resents the demo gate):
- The landing page shows **two buttons: "Enter as Organizer" and "Enter as Speaker"** that log you straight in as seeded demo accounts. One click, no form, no email round-trip.
- The real login form still exists and works, with the demo credentials pre-filled and visible.
- A **"magic link (demo)"** path that shows the generated link on screen instead of requiring an inbox — so a judge can exercise the real speaker-auth flow in ten seconds without checking email.
- A **Reset demo data** button. Thirty judges will leave the demo trashed; the second judge should not inherit the first judge's mess.

---

## 6. File uploads

### 6.1 The shape

Two very different payloads:
- **Headshots** — images, ~0.5–5 MB, need resize/thumbnail for list views and the public speaker gallery (Q2).
- **Slides / supporting documents** — PDF/PPTX, realistically 10–50 MB, occasionally more.

### 6.2 The architecture

**Browser → R2 direct, via a presigned PUT. Never through the Worker.**

1. Client asks the Worker for an upload target: `POST /api/uploads/sign` with filename, size, and content type.
2. Worker validates (extension allowlist, size cap, authenticated or Turnstile-verified), writes a pending `attachment` row in D1, and returns a **presigned PUT URL** signed against `{account}.r2.cloudflarestorage.com` with `Content-Type` pinned and a short expiry (5–15 min).
3. Browser `PUT`s the file directly to R2 with `XMLHttpRequest`/`fetch` (**not** an HTML form — R2 does not support presigned POST form uploads) and reports progress.
4. Client calls `POST /api/uploads/complete`; Worker `HEAD`s the object to confirm size and type, flips the row to `ready`.
5. Reads are served from a **custom domain** on the bucket (presigned URLs cannot use custom domains), with Cloudflare Images transformations for headshot variants.

**Why not through the Worker:** the request body cap is **100 MB** on Free/Pro plans, the isolate has **128 MB of memory**, and buffering a 40 MB PPTX burns CPU-ms and risks OOM. Direct-to-R2 is also *faster*, which is the whole game.

**CORS** must be configured on the bucket for the app origin, or the browser PUT fails opaquely.

### 6.3 Abuse and safety on a public form

R19 requires the CFP form to accept uploads from a fully logged-out visitor. That is an open write endpoint on the internet.

| Risk | Mitigation | Cost |
|---|---|---|
| Bot spam / form flooding | **Turnstile** on the public form; verify server-side before signing any upload URL | ~30 min |
| Oversized uploads | Size declared at sign time, `Content-Length` and `Content-Type` pinned in the signature, verified with a `HEAD` on completion | included above |
| Wrong/hostile file types | Extension + MIME allowlist; **sniff magic bytes on completion** (PDF `%PDF`, PPTX/ZIP `PK\x03\x04`, JPEG `\xFF\xD8\xFF`, PNG `\x89PNG`) — a Worker can `Range`-read the first bytes cheaply | ~1 h |
| Malware in slide decks | **Out of scope, and say so.** No AV scanner is landing in 104 hours. Serve all uploads from a **separate origin** with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` so nothing executes in the app's origin. Document it as a known extension point (ClamAV in a container, or a scanning vendor). | ~30 min + one README paragraph |
| Storage abuse | Per-IP and per-submission upload counts in KV; hard cap per submission | ~1 h |
| Orphaned objects | Nightly cron sweeps `pending` rows older than 24 h and deletes the R2 objects | ~30 min |

**Never store Airtable attachment URLs as image sources** — they expire 2 hours after the API returns them ([field model](https://airtable.com/developers/web/api/field-model)). If headshots are mirrored to Airtable at all, push the R2 public URL into the attachment field and let Airtable fetch it; the canonical copy stays in R2.

**Setup cost:** 4–6 h for the full path including Turnstile, magic-byte sniffing, and the orphan sweeper.

---

## 7. Cost at AIE scale — the README line

AIE's real numbers (dossier §6.2): 4 events/year, ~775 speakers/sessions/year, 1,000–3,000 submissions per event, quoted at **$42,997/year** by Sessionboard.

| Component | Assumption | Monthly |
|---|---|---|
| Workers Paid | 12,000 submissions/yr, well inside 10 M requests + 30 M CPU-ms | **$5.00** |
| D1 | ~5 MB/event; rows read far inside 25 B/mo; rows written ~240 k/yr | **$0.00** |
| R2 | 775 × (~0.5 MB headshot + ~25 MB slides) ≈ 20 GB; 10 GB free → ~10 GB billable @ $0.015; egress free | **~$0.15** |
| Cloudflare Images | ~3,000 unique transformations/mo, inside the 5,000 free tier | **$0.00** |
| Turnstile | Free tier | **$0.00** |
| Resend | ~48,000 emails/yr ≈ 4,000/mo → exceeds Free's 3,000/mo → Pro | **$20.00** |
| **Total infrastructure** | | **≈ $25/month** |

**$25/month against $3,583/month.** That is a 143× ratio and it is defensible line by line. Airtable seats are excluded because AIE already pays for them — which is the entire premise of the bonus.

---

## 8. Deadline traps

Ranked by (probability × cost). Deadline: **Wed 2026-08-12, 22:00 PT**.

| # | Trap | Why it bites | Do this instead |
|---|---|---|---|
| **1** | **OAuth calendar write (Google/Microsoft)** | Google's own doc says sensitive-scope verification takes **up to 10 days**, and requires Search Console domain verification, a public homepage, a same-domain privacy policy, and an unlisted demo video. Restricted scopes add a **4–12 week** CASA Tier 2 assessment. Testing mode shows an unverified-app warning and expires refresh tokens. **This cannot land by Wednesday.** | ICS `METHOD:REQUEST` + deep links (§4). Document OAuth as an extension point. |
| **2** | **Workers Free plan's 10 ms CPU per invocation** | SSR of a 1,000-row list, ICS generation, or token hashing will exceed it. Fails *at deploy*, not in local dev where there is no CPU meter. | **Enable Workers Paid ($5/mo) on day 1** and deploy once, early, to the real plan. |
| **3** | **Resend Free: 100 emails/day** | A judge clicks "remind all speakers" on a demo seeded with 800 submissions and watches it fail. | Outbox + demo-safe allowlist mode from the first commit (§3.6). Consider Pro ($20) for the judging window regardless. |
| **4** | ~~**Cloudflare R2 entitlement can lapse account-wide**~~ **— CHECKED 2026-08-08, healthy** | Documented in `code/platform/cloudflare.md`: a dead payment method silently 403s **every public bucket URL** while DNS, zone, and TLS all look healthy. API returns error **10042** / `NotEntitled`. **Fix is dashboard-only.** | **Probed and clear.** `https://videos.stage11.dev/` returns **HTTP 404**, not 403 — a lapse 403s at the edge *before* key lookup, so 404 proves the custom domain, TLS, and bucket binding are live. Re-probe on deploy day; it can lapse at any time. |
| **5** | **A fresh sending domain** | Platform notes: Resend verification takes "minutes to **hours**" even with DNS resolving. A Tuesday domain registration is a coin flip. | `stage11.systems` is **already verified** (checked 2026-08-08). Use `marquee@stage11.systems`. If a bespoke domain is wanted, register and verify **Saturday**. |
| **6** | **Airtable demo base on the Free plan** | Free caps at **1,000 records per base**. A seeded demo of ~1,000 submissions (Q3's default) hits the wall exactly. | Team plan or above for the demo base. Verify the seat/plan **before** writing the seed script. |
| **7** | **Airtable webhooks expire after 7 days** | Inside the contest window, so it will demo fine — and then silently die the week after, during the exact period AIE might be evaluating it for the NYC pilot. | Daily cron calling webhook refresh. ~20 lines. |
| **8** | **Airtable Team plan throttles to 2 req/s after 100 k calls/month** | If any read path touches Airtable, 30 judges will push us over and the app goes glacial mid-judging. | Architectural, already handled: **never read Airtable on a request path.** The mirror is write-mostly and asynchronous. |
| **9** | **R2 presigned URLs don't work on custom domains** | Signing against `files.marquee.…` fails with `SignatureDoesNotMatch`. Easy to build wrong and only discover in staging. | Sign against `{account}.r2.cloudflarestorage.com`; serve reads from the custom domain. |
| **10** | **Airtable attachment URLs expire in 2 hours** | Cache one in D1 as a headshot `src` and every speaker photo breaks after lunch. | R2 is the canonical media store. Airtable gets a public R2 URL, never the reverse. |
| **11** | **D1's 100-bound-parameter cap** | A wave-acceptance of 200 submissions as one `WHERE id IN (…)` throws at runtime, only under load, only with real seeded data. | Chunk at ≤90, or `json_each()` a single JSON parameter. |
| **12** | **D1 read replication takes up to 24 h to disable** | Flipping it on Tuesday to chase latency is a one-way door inside the remaining window. | Decide by Sunday or don't enable it. Sequential consistency also requires adopting the Sessions API everywhere — not a Tuesday change. |
| **13** | **Smart Placement won't help** | Needs "consistent traffic from multiple locations" and 15 min of analysis. A sparse demo gets nothing, and it only affects `fetch` handlers. | Don't budget R7 against it. |
| **14** | **Resend batch endpoint doesn't support attachments** | Discovered while wiring bulk acceptance emails with ICS attached, at the worst moment. | Two send paths from the start: batch for plain bulk, single-send (≤10/s) for anything with an invite. |
| **15** | **`.dev` is HSTS-preloaded; cookies must not be set on the parent domain** | `http://…stage11.dev` never connects. A cookie on `.stage11.systems` is a documented cross-project data leak (Stage 11 hard rule). | `https://` always; scope cookies to the exact subdomain. |
| **16** | **`Python-urllib` User-Agent is 403'd by `api.resend.com`** | Cost Stage 11 a full money-path outage on Acetate (2026-07-25). Bites seed/backfill scripts, not Workers. | Set an explicit `User-Agent` on every stdlib HTTP call. |

---

## 9. Setup-cost summary

Hours, for a competent agent-driven build. Excludes product/UI work.

| Seam | Scope | Hours |
|---|---|---|
| Cloudflare skeleton | Worker + static assets + D1 + R2 + KV + Queue + cron, wrangler config, custom domain, Paid plan | 3–5 |
| D1 schema + migrations + seed | Events, submissions (abstracts/sessions), speakers, forms, evaluations, tasks, agenda, comms; idempotent seeder for ~1,000 rows | 6–10 |
| Airtable mirror — outbound | Outbox, queue drain, `performUpsert`, rate limiter, settings UI with live status | 6–10 |
| Airtable mirror — inbound | Webhook receive, cursor'd payload pull, field allowlist, echo suppression, 7-day refresh cron | 4–6 |
| Email | Resend client, template store + merge renderer, outbox, demo-safe mode, Communications log, idempotency keys | 4–7 |
| Calendar invites | ICS builder (REQUEST/CANCEL, SEQUENCE, VTIMEZONE), MIME wiring, deep links, `/i/{uid}.ics` | 3–5 |
| Auth | Magic link + sessions on D1, organizer login, demo one-click entry, reset-demo | 3–5 |
| Uploads | Presign endpoint, direct PUT + progress, magic-byte validation, Images variants, Turnstile, orphan sweeper | 4–6 |
| **Total, seams only** | | **33–54** |

Against ~104 hours to deadline, of which roughly a third elapses before requirements freeze (dossier §4). The seams are affordable **only if none of them turn into research projects mid-build** — which is what this document exists to prevent.

---

## 10. What I could not verify

Flagged honestly so nobody treats these as settled.

1. **Stage 11's Resend plan tier.** The domain is verified and sending-enabled, and `stage11.systems` being the *only* domain is consistent with the Free plan's 1-domain limit — but Resend exposes no plan endpoint and I did not log into the dashboard. **The 100/day cap may or may not apply.** Worth a 30-second check by a human; it changes whether Trap 3 is urgent or theoretical.
2. **Which plan AIE's own Airtable workspace is on.** Determines whether the Sync API (B2, Business+) was ever an option, and whether their ops people would hit the Team-plan 100 k call cap. Unknowable from outside; a Discord question if anyone is asking questions.
3. **Workers subrequest limit on Paid.** The limits page as fetched today reads **10,000** (configurable to 10 M); other Cloudflare surfaces have historically said 1,000. Either number is far above our needs, so it does not affect any decision here.
4. **Airtable's "up to 10 records per request" cap** is stated in the [support doc](https://support.airtable.com/docs/managing-api-call-limits-in-airtable) and enforced by an explicit API error message, but the developer reference pages for create/update records do not state it. Treat 10 as authoritative — it is enforced — and note the docs are inconsistent.
5. **Gmail/Outlook ICS rendering** is described in RFC 5546 and corroborated by multiple implementer guides, but neither Google nor Microsoft publishes a normative statement about how they render `METHOD:REQUEST` attachments. **This must be smoke-tested against a real Gmail and a real Outlook inbox before Wednesday** — send yourself an invite, click Accept, confirm it lands on the calendar, then send an update and a cancel. That test is 15 minutes and it is the difference between R3 working and R3 looking like it works.
6. **Google Calendar `render?action=TEMPLATE` parameters** are community-documented, not officially specified. Stable for a decade, but not contractual.
7. **D1 latency figures** in §2.3 come from third-party benchmarks, not Cloudflare's own published numbers. Directionally right; do not quote them at a judge without measuring our own.

---

## 11. Sources

**Airtable** — [Rate limits](https://airtable.com/developers/web/api/rate-limits) · [Managing API call limits](https://support.airtable.com/docs/managing-api-call-limits-in-airtable) · [Plans](https://support.airtable.com/docs/airtable-plans) · [List records](https://airtable.com/developers/web/api/list-records) · [Create records](https://airtable.com/developers/web/api/create-records) · [Update multiple records](https://airtable.com/developers/web/api/update-multiple-records) · [Field model](https://airtable.com/developers/web/api/field-model) · [Upload attachment](https://airtable.com/developers/web/api/upload-attachment) · [Webhooks overview](https://airtable.com/developers/web/api/webhooks-overview) · [OAuth reference](https://airtable.com/developers/web/api/oauth-reference) · [API deprecation guidelines](https://support.airtable.com/docs/airtable-api-deprecation-guidelines) · [Sync API (support)](https://support.airtable.com/docs/airtable-sync-integration-sync-api) · [Sync API (endpoint)](https://airtable.com/developers/web/api/post-sync-api-endpoint) · [Enterprise Scale record limits](https://blog.airtable.com/new-enterprise-features-to-govern-and-scale/)

**Cloudflare** — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [Static assets](https://developers.cloudflare.com/workers/static-assets/) · [Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) · [Cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) · [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) · [KV limits](https://developers.cloudflare.com/kv/platform/limits/) · [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) · [Durable Objects storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) · [Turnstile](https://developers.cloudflare.com/turnstile/) · [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/) · [Images pricing](https://developers.cloudflare.com/images/pricing/)

**Email** — [Resend send email](https://resend.com/docs/api-reference/emails/send-email) · [Resend batch](https://resend.com/docs/api-reference/emails/send-batch-emails) · [Resend API intro / rate limits](https://resend.com/docs/api-reference/introduction) · [Resend pricing](https://resend.com/pricing) · [MailChannels EOL notice](https://support.mailchannels.com/hc/en-us/articles/26814255454093-End-of-Life-Notice-Cloudflare-Workers) · [MailChannels blog announcement](https://blog.mailchannels.com/important-update-mailchannels-email-sending-api-for-cloudflare-workers-to-be-terminated/)

**Calendar** — [RFC 5545 (iCalendar)](https://datatracker.ietf.org/doc/html/rfc5545) · [RFC 5546 (iTIP)](https://datatracker.ietf.org/doc/rfc5546/) · [Google sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) · [Google restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) · [Google Calendar API auth scopes](https://developers.google.com/workspace/calendar/api/auth) · [Configure OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent) · [add-event-to-calendar-docs](https://interactiondesignfoundation.github.io/add-event-to-calendar-docs/services/google.html)

**Auth** — [Clerk pricing](https://clerk.com/pricing) · [WorkOS pricing](https://workos.com/pricing) · [Better Auth magic link plugin](https://better-auth.com/docs/plugins/magic-link) · [better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare)

**Stage 11 internal** — `code/platform/cloudflare.md` (R2 custom-domain recipe, entitlement-lapse gotcha, DNS tokens, cookie scoping, Email Routing) · `code/platform/resend.md` (domain setup flow, verification timing, urllib UA block) · Live Resend API check, 2026-08-08: `stage11.systems` → `status: verified`, `sending: enabled`, created 2026-03-11.

---

*Living document. Re-run against the Saturday and Sunday clarification videos and any Discord rulings — particularly anything swyx says about Airtable, which is the one answer that could overturn §1.7.*
