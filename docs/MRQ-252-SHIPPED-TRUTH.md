# MRQ-252 — shipped truth for the adoption batch

Status: final merge-time report for the hub-directed adoption batch. It records what landed in `github/main`, the evidence attached to those landings, and the separate production migration close-out. A merge is not treated as a deployment unless the operational evidence says so.

Source snapshot: `github/main` at `e34ed61d794c94e1a461853bc296fd9c2a39ffcb` (19 PR landings plus one production close-out: 20 shipped units). Every ticket entry below is based on the first-parent landed diff plus its Lattice merge receipt. The merge log records the hub-gated tree for each PR.

## Landed-diff ledger

| Ticket | PR | Merge SHA | First-parent base | First-parent diff |
| --- | ---: | --- | --- | --- |
| MRQ-241 | #306 | `782e5137` | `e46b7da6` | 45 files, +963/-140 |
| MRQ-244 | #308 | `53a45cfd` | `782e5137` | 18 files, +418/-41 |
| MRQ-245 | #309 | `d70b9aa5` | `53a45cfd` | 27 files, +1001/-47 |
| MRQ-247 | #311 | `9e2cd3bb` | `d70b9aa5` | 34 files, +1301/-96 |
| MRQ-248 | #312 | `0fdcb136` | `9e2cd3bb` | 23 files, +2833/-242 |
| MRQ-233 | #310 | `bff38cd5` | `0fdcb136` | 43 files, +2735/-169 |
| MRQ-234 | #307 | `78dee50d` | `bff38cd5` | 38 files, +2758/-169 |
| MRQ-236 | #313 | `e15abb67` | `78dee50d` | 19 files, +1501/-31 |
| MRQ-246 | #316 | `770ac65c` | `e15abb67` | 31 files, +982/-62 |
| MRQ-235 | #314 | `6d985053` | `770ac65c` | 30 files, +3593/-197 |
| MRQ-249 | #318 | `256e8f66` | `6d985053` | 21 files, +526/-71 |
| MRQ-229 | #317 | `05c1100c` | `256e8f66` | 48 files, +4633/-465 |
| MRQ-259 | #321 | `e4cac37d` | `05c1100c` | 2 files, +181/-13 |
| MRQ-256 | #320 | `0ba76eda` | `e4cac37d` | 3 files, +92/-0 |
| MRQ-250 | #324 | `81a3b73b` | `0ba76eda` | 21 files, +958/-8 |
| MRQ-255 | #322 | `300d9420` | `81a3b73b` | 14 files, +335/-115 |
| MRQ-237 | #315 | `924c6711` | `300d9420` | 48 files, +3711/-260 |
| MRQ-225 | #319 | `a4a7e789` | `924c6711` | 33 files, +1725/-54 |
| MRQ-257 | #323 | `e34ed61d` | `a4a7e789` | 33 files, +294/-1703 |

## Per-ticket shipped truth

### MRQ-241 — reference codes

Landed behavior: migration `0030_submission_reference_codes.sql` adds `submissions.reference_code`, deterministically backfills existing rows, enforces the event-scoped unique index, and adds a durable per-event high-water ledger. `src/lib/submission-reference.ts` allocates `SUB-n` codes with one bounded unique-collision retry. Public submit, organizer/import/seed paths, list/search/board/record views, CSV export, confirmation messaging, and the outbound mirror read path carry the code; inbound mirror writes explicitly do not accept it. Search normalizes `SUB-41`, `sub41`, and spaced/punctuated input.

Evidence: browser proof `art_01M05PMWAFJH31HMM2D3T8FD03` (exact SUB-46 search, record route, copy, clipboard readback); production-creation inventory `art_01M05PNHV3KR0XJT63VVRBAGDY`; final narrow review `art_01M05QTGEG7ZDGDP70BGD2D456`; merge receipt note `art_01M05S53EVKNHM6DZVWETCQD4F`.

Documented carry-forward: outbound Airtable exposes `reference_code` but does not auto-provision the provider column; an operator had to add it before deployment. MRQ-248's later landed receipt explicitly says its provisioning work discharges that intake note. The merge receipt records no deployment.

### MRQ-244 — first-week truth and empty states

Landed behavior: onboarding acceptance is counted from accepted participations rather than inferred from open-task presence, so “acceptance is the prerequisite” and genuine all-clear states are distinct. The setup checklist now derives live progress from settings/forms/plans, supports a compact dismissed row while reserving its layout slot, and routes the next step. Agenda, communications, dashboard, health, setup, shell/sidebar, and getting-started surfaces received truthful empty-state CTAs and demo/reset gating; the repository getting-started fallback is explicit rather than coupled to MRQ-243.

Evidence: cross-family review PASS `art_01M05SQ3CTDMY413RH0KWVQXWX`; landed behavioral coverage in `tests/unit/mrq-244-truth.test.ts` plus the touched onboarding/calendar tests; merge receipt note `art_01M05WHTMDVJBHMXK6J29TB5YB`.

Documented deviation: two earlier full-gate attempts were recorded as unverified contention failures; the third quiet-box gate passed the identical landed tree. The receipt makes no browser/deploy claim. Non-blocking notes were checklist refetch cadence and a pre-existing non-org-scoped demo lookup.

### MRQ-245 — conference-level submission capacity

Landed behavior: migration `0031_submission_capacity.sql` adds the form-level `submitter_limit_inherit` flag. Event settings expose a bounded conference default (1–100); forms either inherit it or retain a bounded per-form override. Legacy raw `per_submitter_limit = 0` remains a read-path unlimited state. The shared capacity resolver is used by event settings, forms, public submit/resume flows, Sessionize import, seed, and event-copy paths. Drafts are not counted as submitted capacity, and refusal copy distinguishes a new submission (use a saved resume link) from a resumed draft (ask the organizer to make room).

Evidence: final rebase delta review `art_01M05TZ1H4NR41GGHS1M245TXQ`; capacity tests in `tests/integration/api/event-settings.test.ts`, `forms.AC-17-33.test.ts`, `public-form.AC-25-42-155-157-231-234.test.ts`, `tests/node/submission-capacity.MRQ-245.test.mjs`, and the two form-editor unit files; merge receipt `art_01M05X3H1SRWN1PW4CWRKFE3CD`.

Documented deviation: the reviewer recorded the count-then-insert check's true-concurrency TOCTOU as pre-existing and out of scope. The browser/live/deploy path was not claimed in the landed receipt. The merge receipt records no deployment.

### MRQ-247 — saved-draft nudge

Landed behavior: the pre-close scheduler finds draft work per submission and submitter, queues one reminder per draft, and supplies honest `draft.resume_link` / `draft.missing_fields` merge behavior. A `draft_resume` magic link resolves to the existing draft while preserving raw resume-token continuity; the credential is admitted only in the keyed draft editor and is excluded from manual/bulk communication paths. The public upload/resume boundary has explicit closed-form refusal copy. Mail idempotency, human edits, submit, suppression, event isolation, and reruns are covered; same-person multiple drafts remain separate business entities.

Evidence: final cross-family review `art_01M05SS3FXTYN5GBQZKGW0HH17`; landed coverage in `tests/integration/mail.test.ts`, public-form, upload-presign, signin, auth-boundary, and idempotency tests; merge receipt note `art_01M05Y3M8Z9AJ8B5YP7JR8MEC4`.

Documented deviation: the ticket took two landing trips because the first hosted check's eight invalid title prefixes were real, not content failures; the final repair was title-prefix-only plus generated-doc regeneration. The receipt also records that no stable AC/US mint was part of this checkpoint and makes no browser/deploy claim.

### MRQ-248 — Airtable mirror schema and adoption

Landed behavior: the mirror now owns canonical role schemas (27 submissions / 19 events / 17 participants fields at the final reconciliation), provisions empty bases, adopts partial existing tables by exact field identity, and preserves organizer columns byte-for-byte. Verify/provision/adopt is preflighted, one-table-per-request, resumable, retry-safe, and reports safe 403/429 outcomes. A fresh three-table conformance check precedes webhook/mirror-state activation; the active state is cleared only after the final successful DB batch. CLI, UI, API, mapping, progress, retry, and the shared base-wide 4 req/s capacity-1 limiter agree. The landed surface contains the real mounted Airtable settings test and the hermetic mirror-schema integration suite.

Evidence: final delta review `art_01M061Q5RWFVXAV2N9JK2HPFVE`; `tests/integration/mirror-schema.MRQ-248.test.ts` and `tests/unit/airtable-setup.MRQ-248.test.ts`; merge receipt note `art_01M062369KYFNSV9BKKAJMZXGX`.

Documented deviation: runtime is explicitly N/A for live Airtable mutation. The owner recorded that authenticated local Worker plus injected fake-provider setup was not run because provider credentials/mutation are forbidden; hermetic integration and mounted-component evidence are the claimed proof. The receipt also retires MRQ-241's manual reference-code-column intake note. No migration and no deployment.

### MRQ-233 — batched calendar invites

Landed behavior: migration `0032_calendar_batch_parts.sql` adds durable calendar batch parts. Calendar resolver, projection, sequence, ICS, invite, mail-consumer, agenda/dashboard, record, and calendar routes now turn schedule changes into retryable per-recipient calendar work with sequence/CAS and recovery behavior. The agenda UI exposes the schedule-update/calendar state, and the e2e/integration/unit suite covers the resulting operation and invite surfaces. The D1 bulk path is bounded: four new dynamic sites are structurally chunked at 80 placeholders and the fifth is proven bounded by the queue's max batch size of 10.

Evidence: non-author review `art_01M05SWN4G0J6HM9T1DEN5RFTC`; landed `tests/e2e/mrq-233-calendar-strip.spec.ts`, `tests/integration/calendar-batch.MRQ-233.test.ts`, `tests/unit/calendar-batch.MRQ-233.test.ts`, and the smoke-ICS path; merge receipt note `art_01M062V5XK05JSD3846Y43T9CB`.

Documented deviation: the first two gate passes stopped on real calendar-pinned-clock and unclassified-placeholder defects; the final tree fixes both. The receipt explicitly notes that the e2e guard rewrite is not textually behavior-equivalent under partial environment variables: three independent guards now match each test's consumed preconditions, which was judged the safer semantic change. No deployment.

### MRQ-234 — decision plans and preflighted sends

Landed behavior: the decision-plan service computes four explicit disposition rows, grounded template/recipient preview data, a SHA-256 plan fingerprint, strong ETag, and queue revision. Record and bulk decision routes require the current plan through `If-Match` / fingerprint checks; the UI gets a Decision Plan panel, and the CLI gets plan/apply flows with registry/help coverage. The caller migrations in smoke-ICS and speed fetch the plan before their measured operation and carry the fingerprint/ETag through the apply request. Decision-plan API, unit, integration, e2e, CLI, and recovery tests landed with it.

Evidence: review artifact `art_01M05TBX74761V887M6J4A7G42`; landed `tests/e2e/mrq-234-decision-plan.spec.ts`, `tests/integration/api/decision-plan.MRQ-234.test.ts`, `decision-plan.routes.MRQ-234.test.ts`, `tests/unit/decision-plan.MRQ-234.test.ts`, and the merge receipt note `art_01M063QD0VB2QWD5RQN67HNSXZ`.

Documented deviation: the live ICS round trip is a precise N/A because `MARQUEE_SMEE` and a running instance are required; the landed receipt claims code/migration evidence and the smoke guard, not live-provider success. A previously dynamic PRAGMA flag was set false after proving the joined alias cannot be referenced by the relevant query path; the receipt records that as an inert semantic change. No migration and no deployment.

### MRQ-236 — reusable question library

Landed behavior: migration `0033_field_library.sql` adds the field-library tables and indexes; seed/reset support supplies reusable questions. The builder and API expose library list/create/update/archive and “copy field from library”; copied fields are form-local while the library remains reusable, with usage/version/stale-copy information in the UI. Event copy/delete manifests and form routes preserve the library dependency and copied-field isolation.

Evidence: the landed runtime artifact `artifacts/mrq-236-runtime.txt` proves Worker health, the authenticated boundary (401 without a cookie), and the published `listFieldLibrary` / `copyFieldFromLibrary` OpenAPI operations. Behavioral proof is `tests/integration/api/field-library.MRQ-236.test.ts`; the final R2 PASS is recorded in the Lattice review stream at head `43091f70`, with final review/receipt note `art_01M064HHDHWDXHJF78PDNDX3HS`.

Documented deviation: the checked-in runtime transcript is endpoint/OpenAPI/auth-surface proof, not an authenticated browser copy round trip. The merge receipt records the migration sequence 0030–0033 and no deployment.

### MRQ-246 — combined form character budgets

Landed behavior: migration `0037_form_length_rules.sql` adds form-owned group limits. A shared evaluator counts selected text fields as one printed block, reports overage/disabled/missing-field state, ignores hidden fields through the same projection path, and enforces violations in public/server writers. The forms API supports CRUD for combined limits; the builder offers field selection, max-character editing, disabled “Fix rule” state, and live preview counters. Copy/delete/import/reset/portal/submission seams carry the rule data.

Evidence: final R3 PASS is recorded at landed head `5228306b`; review chain/receipt note `art_01M065GQ32RY3140JJNX9NF4TX`; landed tests include `tests/unit/form-length-rules.MRQ-246.test.ts`, updated forms/public/portal/submission tests, and the public-write inventory; merge receipt confirms the post-merge tree.

Documented deviation: a stale “Fix rule” badge on library-copy was explicitly carried as a non-blocking later-pass note. The 0034–0036 migration gap was expected at this landing; 0037 was appended after 0033. No deployment.

### MRQ-235 — people merge, aliases, movement receipts, undo

Landed behavior: migration `0035_person_aliases_merges.sql` adds merge/alias persistence. `src/lib/person-merge.ts` plans and atomically executes survivor/retired identity movement across the canonical person-owned references, emits durable movement receipts and audit activity, flattens chained aliases, rejects alias conflicts and illegal lifecycle dependencies, and supports CAS-protected undo with explicit `undo_blocked`/partial outcomes when rows changed after merge. Routes/UI provide preview, survivor selection, merge receipt, alias-based sign-in continuation, and undo. Event deletion, reset-demo, imports, mirror credentials, and person references use the same cleanup/inventory rules.

Evidence: bundled R2 review `art_01M064SBGTK8ED3YF8G2JJFAVY`; landed `tests/integration/api/person-merge.MRQ-235.test.ts`, reset-demo, and bulk-path coverage; owner runtime receipt recorded `/health` plus merge OpenAPI paths; merge receipt note `art_01M066D23NDDD5CFSCP71W5R6E`.

Documented deviation: the repair round had no owner command-tail evidence in the Lattice record; the reviewer called that out plainly while independently verifying the code and hosted gate. The landing receipt records only mechanical conflicts in generated docs/schema/migration union, no deployment, and leaves migration 0034 out because MRQ-237 remains separate.

### MRQ-249 — decision emails with grounded facts and widened copy grain

Landed behavior: decision-plan/send paths load grounded event, submission, speaker, and note facts; recipient-scoped portal links are minted in the send loop and appended at render time only when absent. Acceptance/rejection templates, markdown feedback text/HTML links, decision template CRUD, bulk/notify/resend/onboarding-cascade callers, UI plan/record surfaces, and note non-leak behavior are wired and covered. The adjacent custom-send idempotency fix also landed: the key grain now includes client send key, recipient, subject, and body. Same key with changed copy queues a distinct message; an exact retry dedupes.

Evidence: final bundled re-review `art_01M067960RW8ZHYBZPQ3S7F9B6`; `tests/integration/api/decision-emails.MRQ-249.test.ts` and the companion idempotency/merge-field tests; merge receipt note `art_01M067G38955PCP8JXQHXB0WB5`.

Documented deviation: the copy-grain widening was an adjacent defect fixed in-place, explicitly marked “FIXED, not re-ticketed,” rather than silently dropped. The receipt distinguishes this landed tree from production shipping; no deployment is claimed.

### MRQ-229 — answer-driven routing rules

Landed behavior: migration `0036_routing_tags.sql` adds routing rules, tags, levels, submission tags/arrivals, indexes, and triggers. The API provides CRUD/reorder/archive for rules, tags, and levels with reference validation and soft-disable/dangling-reference reporting. The shared evaluator accepts conditions on arbitrary answer keys and derived fields, honors first-match-wins and skip-not-evaluate, and applies track/level/tag/review destinations at arrival. The builder exposes ordered inline rules, enable/fix states, taxonomy management, and would-land-in preview. Copy/reset/delete remap and preserve dependencies; answer projection is explicit-removal-only and arrival/replay is idempotent. The landed diff includes the previously missing feature suite and both Cycle-4B regressions.

Evidence: runtime curl transcript `artifacts/mrq-229-runtime-proof.txt` proves an arbitrary `notes` answer fires tag+level, a non-match fires neither, and re-arrival preserves the same submission/timestamp/route with tag count 1. R2 content review is recorded in the Lattice review stream at head `91e0ae3b`; final merge receipt note `art_01M068SPHQQCVMVVVM7XVEBRT9` records hosted/full-gate and tree parity. Landed tests are the routing-rules, routing-preview, event-copy, submission-answers-retention, unit routing, and repaired guardrail files.

Documented deviation: the ticket landed after two rebases and a dropped-CI/mergeability investigation; only generated `llms.txt` needed manual conflict resolution on the final tax pass, while real-code/idempotency/comms seams auto-merged and the post-merge full suite was clean. Migration 0036 is present after 0035 and before 0037 in the landed union; the receipt records that it is independent of 0030/0035/0037. No deployment is claimed.

### MRQ-259 — production-shaped 0030 backfill repair

Landed behavior: migration `0030_submission_reference_codes.sql` now materializes the ranked candidate rows through an uncorrelated `UPDATE ... FROM` source and computes the existing per-event floor once. It preserves the null-only write predicate, fresh-database semantics, and the unique index while avoiding the live-CTE re-evaluation that restarted numbering as rows received codes. A real SQLite node regression suite applies migrations before 0030, seeds populated submissions, executes the complete migration including the unique index, and covers the four production-shaped cases; the old tree fails those cases and the repair passes.

Evidence: production incident ledger `art_01M068W4S8W4747ZZ5EQWB8TSD`; independent review PASS at `88aaacf5`, with the merge receipt's title-only delta at `6731f2af`; merge `#321` is `e4cac37d` and its receipt records post-merge tree `1d12e0ed`, quiet gate `246 files/1676 pass`, and no deployment claim. The final live remediation proof is recorded separately below: the earlier hub-supplied `9f` proof through `0037` was extended by the second production pass through `0038`.

Documented deviation: the reviewer verified the SQL mechanism and regression-test shape but did not independently rerun the snapshot convergence/4-of-4 execution claims. The fix is intentionally in-place in migration 0030 because production had not recorded that filename. The migration's unrelated schema/index statements remain unchanged.

### MRQ-256 — mandatory pre-push battery

Landed behavior: `npm run prepush` is the single fail-fast wrapper for the fleet's pre-push discovery battery: the root/client/test TypeScript checks, generated-doc verification/regeneration, clock and no-op registries, trace coverage, schema delta, and the focused registry audits required by the repository contract. `CLAUDE.md` documents running it before every push. The wrapper prints the named step and propagates failures, including cleanly reporting invocation errors rather than leaking a raw spawn exception.

Evidence: R2 review PASS at `4b88c150`; merge `#320` is `0ba76eda` with post-merge tree `2442e2b3`, quiet gate `246 files/1676 pass`, and the merge receipt's no-deploy boundary. The implementation is tooling/process behavior; no product runtime claim is applicable.

Documented deviation: this ticket does not add a live endpoint or UI path. Its shipped truth is the local battery contract and failure reporting; hosted CI remains the independent post-push verification.

### MRQ-250 — fail-closed model-written kind feedback

Landed behavior: the decision workflow can draft a kind-feedback paragraph through the model provider only when both `AI_RUNTIME_MODE=enabled` and a nonempty provider key are present; the default Wrangler mode stays disabled. Provider failure is contained as a successful route response with a reasoned notice, without exposing raw provider errors or organizer-private notes. The model supplies tone only; deterministic decision facts remain application-owned. Bulk feedback validates every selected record before one shared model call, UI writes only into the draft textarea, and model usage events record bounded metadata without prompt/note/paragraph content. Migration `0038_model_usage_events.sql` records the usage event schema.

Evidence: final review PASS `art_01M06C9YD53SDHNPBR2F2WX2DB`; owner receipt hosted run `31975488739`; merge `#324` is `81a3b73b` with post-merge tree `e8a0bea2`, focused Worker 4/4/static evidence, and no deployment claim. Behavioral coverage is in `tests/integration/api/kind-feedback.MRQ-250.test.ts`.

Documented deviation: live provider mutation/model calls were not made. Disabled mode, provider failure, redaction, transition guards, usage logging, and the real decision-plan/confirm path are covered hermetically; production enablement remains an explicit runtime configuration fact.

### MRQ-255 — global search speed and local AC gate

Landed behavior: global search ranking and route/UI handling now bring the painted search path from the `1613.23ms` baseline to a quiet-box AC-103 p95 around `94ms`, with the agent search path reduced in the same fix. The AC-sourced speed subset is wired into local `pr-gate` and the MRQ-256 pre-push battery, so the binding local gate measures the acceptance budget rather than only reporting an objective.

Evidence: final AC-103 artifact `art_01M06EW592ETFS4D51HA5HX3VM` records a strict ten-query post-prime p95 of `94.25ms` with empty acceptance failures; merged-tree quiet gate reports `93.39ms`; merge `#322` is `300d9420`, with final hosted workflow `31979924413` passing after the hosted speed step was removed. The first-parent diff is 14 files, +335/-115.

Documented deviation: hosted `check:speed` was removed after the GitHub runner required a widened calibration and still failed unrelated AC-16 dashboard timing; the hub overruled that P1 because the runner was measuring infrastructure rather than AC-103. Local `pr-gate`/`prepush` AC speed enforcement is the binding shipped check. No route behavior was removed and no deployment is claimed.

### MRQ-237 — publication truth and zero-effect honesty

Landed behavior: migration `0034_request_operations.sql` and its schema delta add the durable request-operation lease/claim/dispatch/replay machine. A shared publication-truth classifier now drives the nine production publication decisions with closed machine reason codes and public copy, including the scheduled/unpublished and live-but-no-longer-accepted gauges, withheld reasons, public agenda/record/dashboard parity, honest batch refusal, and explicit direct-publish no-op messaging. Dispatch claims are fenced and recoverable; keyed bulk replay claims before plan preflight, excludes the changing plan fingerprint from operation identity, and preserves the adjacent MRQ-249 ad-hoc mail-dedupe behavior.

Evidence: runtime transcript artifact `art_01M063FZTCA20R8QBEJC71ABR4` (`docs/evidence/mrq-237-runtime-curl.md`) records a withheld `MISSING_AGENDA_ITEM` row absent from public output, dashboard/count clickthrough parity, and a `409 ALREADY_PUBLISHED` no-op. Final branch head `4b78f919` passed the AIA-07 delta verification; merge `#315` is `924c6711`, with post-merge tree `d49bde3e`, quiet gate `1695 vitest + 280 node pass`, and R5 plus both delta reviews recorded in the receipt.

Documented deviations: the final empty-selector request is a `400 malformed_request` with no mail rather than main's prior `202` zero-effect response, applying the ticket's rule that every zero-effect action states why. For ad-hoc communications, the client `Idempotency-Key` remains mail-layer `sendId` identity while template-only requests retain request-operation claims, preserving MRQ-249's changed-copy and exact-retry semantics. No deployment is claimed by the merge receipt.

### MRQ-225 — announce kit, publication gate, unfurls, and absolute public links

Landed behavior: the organizer now has an `/announce` surface leading the Public links group. It is publication-gated: before any live agenda it says announcing an unpublished program announces nothing and links back to the builder; after publication it assembles announcement copy, absolute conference/speaker/CFP URLs, the canonical embed snippet, and per-speaker share/mail actions. The accepted speaker portal always renders an “Announce your talk” panel, changing from a truthful pre-publish state to copy plus the live permalink after publication. `/p/:slug`, `/s/:slug`, and `/agenda` emit OpenGraph/Twitter metadata with a static branded fallback card and bounded public caching, while unpublished speakers remain 404/no-leak. `speaker.public_link` is now populated through the MRQ-234 decision-plan preview, accept/reject send, and not-notified notify preview/send paths; previewed and queued absolute links are byte-equal.

Evidence: final combined review `art_01M06H2C89BK7Q51YFYA4PSNX7`; hosted fast-gate `31977879669`; merge `#319` is `a4a7e789` with hub-gated tree `176f9f5e` and final branch head `2eec7eb0`. The final focused Worker coverage was 3 files/16 tests, including real preview-to-outbox parity for decision and notify links; the merge receipt records the mandatory battery and no migration.

Documented deviation: no tokenized share credential or public headshot URL was introduced. The contractual `/p/:slug` permalink is intentionally absent before publish or after unpublish/unaccept, and the in-portal same-origin link may remain relative while mail paths are absolute. No deployment is inferred from the merge receipt.

### MRQ-257 — build-time agent front-door generation

Landed behavior: `src/agent-front-door/llms.txt` and `llms-full.txt` are no longer tracked generated merge-conflict artifacts. `npm run build` now bootstraps a local Worker, regenerates the front door from the served OpenAPI facts, and embeds the exact generated bytes; `/health` remains the build-SHA beacon and `check:docs` remains byte-level drift detection. Local runtime, CI, API parity, gate, deploy guidance, and generated skill callers route through the build entry point. The schema table count is derived from the canonical table tuple, and the fresh migration harness discovers and sorts `migrations/*.sql` while retaining name-addressed legacy repair checks.

Evidence: owner exact-head review `art_01M069GSQX4QR9DTSBTVMETVYP`; final delta review `art_01M06J3EJBD8CG0ATGERPETCST`; hosted fast-gate `31982048855`; merge `#323` is `e34ed61d` with hub-gated tree `0e01ed34` and final head `cc4e10d9`. The delta proof reports exact served/generated bytes, `/health` build `cc4e10d9`, 7 node contract tests, 2 focused derivation/discovery tests, 77 derived tables from 44 migrations, and no conflict markers.

Documented deviation: the independent review retained a non-blocking note that AC-103 `check:speed` is red on both parent and this head; search/client timing is outside MRQ-257's diff. Build-time generation intentionally requires the full Worker build path; direct Vite invocation is guarded and fails with the intended entry-point message.

### Operational close-out — production migrations through 0038

This is the deployment truth paired with the migration landings, not a Git PR. Production D1 now has **44 migrations applied through `0038`**. The out-of-order `0034_request_operations.sql` application was proven live under filename-tracked Wrangler migration semantics; no migration was renumbered. The production-shaped 0030 repair was verified through two live passes: `35 → 42` applied with `1008` rows and `1008` distinct reference pairs, then `42 → 44` after `0034` and `0038` still reported `1008/1008`. The hub's final `8f` proof is the close-out pointer; the earlier `9f` proof covered the intermediate `0037` state.

Source receipt: Lattice event `ev_01M06HA6F9S92EYN9CR3B9S1ZV` on MRQ-259 records the snapshot rehearsal, both live passes, the `1008/1008` convergence, and the migration sequence. This operational row is the twentieth shipped unit in the merge log below; it must remain separate from source-tree and PR claims.

## Hub-gated merge log

The tree column is the exact tree of the merge commit on `github/main`, which is the captain's identity proof for each landing. Rows 1–19 are PR merges; row 20 is the production operational close-out and therefore has no Git merge SHA.

| Unit | Landing | Merge | Hub-gated tree / proof |
| ---: | --- | --- | --- |
| 1 | MRQ-241 / #306 | `782e5137` | `522cc76f` |
| 2 | MRQ-244 / #308 | `53a45cfd` | `f192eecc` |
| 3 | MRQ-245 / #309 | `d70b9aa5` | `51e7b23e` |
| 4 | MRQ-247 / #311 | `9e2cd3bb` | `d36d0d20` |
| 5 | MRQ-248 / #312 | `0fdcb136` | `1f629272` |
| 6 | MRQ-233 / #310 | `bff38cd5` | `45d7d676` |
| 7 | MRQ-234 / #307 | `78dee50d` | `f89104b7` |
| 8 | MRQ-236 / #313 | `e15abb67` | `b3f557bd` |
| 9 | MRQ-246 / #316 | `770ac65c` | `490320de` |
| 10 | MRQ-235 / #314 | `6d985053` | `433303f6` |
| 11 | MRQ-249 / #318 | `256e8f66` | `e3dcf7b8` |
| 12 | MRQ-229 / #317 | `05c1100c` | `9b549d9f` |
| 13 | MRQ-259 / #321 | `e4cac37d` | `1d12e0ed` |
| 14 | MRQ-256 / #320 | `0ba76eda` | `2442e2b3` |
| 15 | MRQ-250 / #324 | `81a3b73b` | `e8a0bea2` |
| 16 | MRQ-255 / #322 | `300d9420` | `f13cc56b` |
| 17 | MRQ-237 / #315 | `924c6711` | `8bb77f1b` |
| 18 | MRQ-225 / #319 | `a4a7e789` | `176f9f5e` |
| 19 | MRQ-257 / #323 | `e34ed61d` | `0e01ed34` |
| 20 | Production migration close-out | — | `8f` · `1008/1008` through `0038` |

## Finalization notes

- Final source is `github/main=e34ed61d`; #323 is contained and there are no open PRs in the adoption queue at cut time.
- The report intentionally distinguishes 19 source merges from the twentieth operational unit. No deployment claim is inferred from a Git tree alone.
- This document is the hub-directed MRQ-252 shipped-truth artifact for the adoption batch; it contains landed behavior, evidence pointers, deviations, and the production close-out only.
