# MRQ-52 validation

Head: `5213ab7` on `mrq-52-audit-bulk`.

The final branch diff is test and claims evidence only: `tests/node/bulk-paths.AC-66-69.test.mjs` and `tests/ac-claims/MRQ-52.json`. No production source changed after the runtime drives below.

## Static and suite proof

- `node --test tests/node/bulk-paths.AC-66-69.test.mjs`: pass. The guard inventories 12 current `map` placeholder sites, classifies the two named bulk-write findings, and rejects unclassified `.fill` or `.repeat` placeholder expansions.
- `npm test`: pass, 67/67 tests, 20.355s, under the 30s budget.
- `npm run trace:ac -- --ticket MRQ-52`: pass; uncovered auto criteria 0; AC-16 is the expected felt/operator item.
- Independent Lattice code review at exact head `5213ab7`: PASS, artifact `art_01KZR937ZE9Y9AAH62K05CZ6D8`.

## Real Worker drives

Environment observed for the drives: `local-wrangler-dev`, `wrangler dev/miniflare`, deployed false, seeded by `scripts/seed/index.ts`, with 1,000 submissions.

- Bulk accept of 150: HTTP 200, 373ms, selected 150, succeeded 150, failed 0, state `completed`, 150 outbox rows, 150 per-item results. The post-drive submission state was 150 accepted and the durable decision/audit path completed.
- Bulk withdraw of 1,000: HTTP 200, 100ms, selected 1,000, succeeded 960, failed 40, state `completed_with_failures`, 1,000 per-item results, 0 outbox rows. Post-drive counts were draft 40, published 24, withdrawn 936; partial outcomes were durable and explicit.
- Assignment distribution with 150 selected `in_review` IDs: HTTP 500 from the direct-placeholder path; `round_assignments` count was 200 before and 200 after. This is a routed defect in `src/routes/evaluation.routes.ts`, not a successful bulk path.
- Category routing and import integration: 2 files / 5 tests passed. The seeded category route exercised 8 tracks; the direct-placeholder path has no input max and is routed in the source inventory. A real 150-row Sessionize import returned HTTP 200 with status `completed`, created 151 rows (one speaker and 150 sessions), failed 0.

## Idempotency and empty selection

- Explicit empty comms selection `{submission_ids: []}` returned HTTP 202 with selected 0, queued 0, duplicate 0; outbox count stayed 0 before and after.
- Repeating the same nonempty comms action returned the same outbox ID: first selected 1 / queued 1 / duplicate 0, second selected 1 / queued 0 / duplicate 1; final outbox count was 1 and the idempotency key was one sha256 value.
- Provider-backed AC-117 integration observed one outbox row and one provider batch delivery, with zero single deliveries.

## Limitations and routed findings

- No safe mid-flight kill boundary was available; AC-69 completion was validated through the terminal completed response, post-drive durable state, per-item results, and audit path rather than an interruption drill.
- `npm run check:speed` did not reach the bulk path: the admin browser harness timed out waiting for `.page` at `scripts/checks/speed.ts:290`. This is a harness dead-path failure, not bulk runtime evidence.
- The two named D1-cap bypasses are routed findings: unbounded submission IDs in assignment distribution and unbounded track IDs in category routing. The repo-wide guard also records non-bulk routed observations for answers, draft metadata enrichment before pagination, and token event IDs at the 101-binding edge.

MRQ-52 owns no auto AC. It exercises AC-66 through AC-69 and AC-117; ownership remains with MRQ-19 for AC-66 through AC-69 and MRQ-12 for AC-117.
