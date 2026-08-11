# MRQ-18 validation (final current head)

Validated commit: 492a7ffaed196f4f07d2853be6d00fdc2541ba5c
Base: forgejo/master @ a05a015da45d3c9379b99ef1e48d5b291e127c32
Branch: mrq-18-reviewer-queue (pushed; remote matches the validated HEAD)
Verdict: PASS

## Static and hermetic evidence

- `npm test`: PASS, 28 files / 148 tests.
- Focused reviewer tests: PASS, 2 files / 8 tests.
- Worker, client, and test TypeScript checks: PASS.
- `npm run check:api`: PASS, OpenAPI 3.1, 45 operations.
- `npm run trace:ac -- --scope=merged --ticket=MRQ-18`: PASS, 17 claims, 0 uncovered, 0 errors.
- `npm run pr-gate -- --ticket MRQ-18`: PASS, 19.0s; worker/client/test types, production build, design contract, 28-file hermetic suite, and merged AC trace all passed.
- `git diff --check forgejo/master...HEAD`: PASS; `git merge-base --is-ancestor forgejo/master HEAD`: PASS.

## Running-system evidence

Fresh local D1 state was migrated and seeded from this build (5,826 rows, including 40 organizer-unreviewed round-one assignments), and a local Wrangler Worker was served on loopback HTTP port 8800 because the prior ephemeral port was still shutting down.

- Demo organizer login: HTTP 200.
- `GET /api/v1/events/evt_aie-ny-2026/reviewer/queue`: HTTP 200; plan `2026 Program Review`, round `rnd_initial-review`, 8 scopes, 40 cards, current index 0, remaining 40.
- Reviewer detail: HTTP 200; full abstract and 8 evaluator-visible fields, `blind_mode: true`, `identity: null`.
- Reviewer CSV export with `?format=csv`: HTTP 200; header includes submission, title, abstract, format, and tracks.
- Guessed out-of-scope submission detail: HTTP 403; response body contained neither the guessed ID nor seeded organizer identity metadata.
- c11 embedded browser `/reviewer`: observed the Flight Deck reviewer surface with no admin shell, anonymous-review state, 1/40 queue position, responsibility chips, exact Approve/Maybe/Deny controls, optional 1–5 score, and keyboard hint.
- c11 detail flow: opened the full submission, observed evaluator-visible fields, blind redaction, `ATTACHED FILES · 0`, and `Queue ID sub_synthetic-pool-0001 · position 1 preserved`; close returned to the same queue card and 1/40 position.
- c11 keyboard flow: `A` → `1` → `Enter` advanced to 1/39 and displayed `Approve saved · next submission ready`; the saved API record was `recommendation: approve`, `score: 1`, `criteria_scores: null`, `identity: null`, `lifecycle_status: in_review`.

## Scope and review checks

- All reviewer queue/detail/files/export/write routes are in `src/routes/review.routes.ts` and use the one centralized `authorizeReviewerScope` helper.
- No second authorization path was introduced; out-of-scope bodies are generic before resource metadata loads.
- Existing evaluation/admin routes, MRQ-19 decision/cascade paths, and MRQ-13 shell paths were preserved through the final rebases.
- Headless reviews remain suspended by ticket directive; exact-HEAD inline self-review is attached separately.
