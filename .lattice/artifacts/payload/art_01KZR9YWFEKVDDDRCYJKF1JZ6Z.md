# MRQ-52 validation

Head: `6868fc4` on `mrq-52-audit-bulk`, based on `forgejo/master` `8cbe426`.

The final branch diff is exactly test and claims evidence: `tests/node/bulk-paths.AC-66-69.test.mjs` and `tests/ac-claims/MRQ-52.json`. No production source changed in this branch.

## Static and suite proof

- `node --test tests/node/bulk-paths.AC-66-69.test.mjs`: pass. The guard inventories 14 current `map` placeholder sites, classifies the two named bulk-write findings and the two explicit 80-ID reviewer queue chunks, and rejects unclassified template-literal, `.fill`, or `.repeat` placeholder expansions.
- `npm run pr-gate -- --ticket MRQ-52`: pass, types, production build, design contract, API contract, 73/73 tests, merged AC trace; total 21.143s under the 45s budget.
- Final hermetic suite: 73/73 tests, 16.280s, under the 30s budget.
- Final merged trace: pass; live 212, test files 87, claims 49, uncovered auto criteria 0; AC-16 is the expected felt/operator item.
- Fast-track self-review at exact head `6868fc4`: PASS, artifact `art_01KZR9HDA06S2TFZ5233YTGYDQ`. Two spawned single-review attempts exited with code 1 before producing an artifact after the rebase; the binding fast-track fallback is recorded explicitly.

## Real Worker drives at the rebased head

Environment observed for the drives: `local-wrangler-dev`, `wrangler dev/miniflare`, deployed false, seeded by `scripts/seed/index.ts`, with 1,000 submissions.

- Bulk accept of 150 eligible `in_review` submissions: HTTP 200, 388ms, selected 150, succeeded 150, failed 0, state `completed`, 150 outbox rows, 150 per-item results.
- Bulk withdraw of 1,000 after the accept drive: HTTP 200, 61ms, selected 1,000, succeeded 960, failed 40, state `completed_with_failures`, 1,000 per-item results, 0 outbox rows. Post-drive counts were draft 40, withdrawn 936, published 23, scheduled 1; partial outcomes were durable and explicit.
- Assignment distribution with 150 selected `in_review` IDs: HTTP 500 from the direct-placeholder path; `round_assignments` count was 200 before and 200 after, delta 0. This is a routed defect in `src/routes/evaluation.routes.ts`, not a successful bulk path.
- A real 150-row Sessionize import returned upload HTTP 201, mapping HTTP 200, run HTTP 200, status `completed`, created 153 rows (150 sessions and 3 speakers), failed 0, row count 153.

## Idempotency and empty selection at the rebased head

- Explicit empty comms selection `{submission_ids: []}` returned HTTP 202 with selected 0, queued 0, duplicate 0; outbox total stayed 0 before and after.
- Repeating the same nonempty comms action returned one outbox ID: first selected 1 / queued 1 / duplicate 0, second selected 1 / queued 0 / duplicate 1; final outbox total was 1. The row had person `per_nico-albanese`, entity `sub_advanced-aisdk`, and one sha256 idempotency key.
- The provider-backed AC-117 integration observes one outbox row and one provider batch delivery, with zero single deliveries.

## Limitations and routed findings

- No safe mid-flight kill boundary was available; AC-69 completion was validated through the terminal completed response, post-drive durable state, per-item results, and audit path rather than an interruption drill.
- An earlier `npm run check:speed` probe did not reach the bulk path: the admin browser harness timed out waiting for `.page` at `scripts/checks/speed.ts:290`. That is a harness dead-path failure, not bulk runtime evidence.
- The two named D1-cap bypasses are routed findings: unbounded submission IDs in assignment distribution and unbounded track IDs in category routing. The repo-wide guard also records explicit 80-ID reviewer queue chunks and non-bulk observations for draft metadata enrichment before pagination and token event IDs at the 101-binding edge.

MRQ-52 owns no auto AC. It exercises AC-66 through AC-69 and AC-117; ownership remains with MRQ-19 for AC-66 through AC-69 and MRQ-12 for AC-117.
