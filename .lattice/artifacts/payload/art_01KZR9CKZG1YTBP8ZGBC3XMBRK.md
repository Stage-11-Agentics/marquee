# Plan Review: MRQ-72 — Cycle 2

## 1. Verdict

**FAIL (plan-level)**

Two major gaps remain, both of the kind that would surface mid-implementation or — worse — only on the deployed demo after green local tests. Both are quick to resolve: each needs a stated decision and a sentence or two of plan, not new research. Cycle 3 should be fast.

## 2. Summary

Reviewed the MRQ-72 implementation plan (cycle 2, with cycle-1 resolutions inlined) against the four MRQ-53 defects and the live codebase. The plan is well-grounded — every file:line claim checks out (`Sidebar.tsx:19` `unavailable(...)`, `reseed-demo.ts:75` global deletes, `scripts/seed/_source.ts:7` `node:fs`, routes at `admin-ops.routes.ts:36/83`), the cycle-1 resolutions genuinely closed their concerns, and the adversarial-proof design is strong. The key remaining concern is scale: the plan commits to restoring the full shipped seed through the existing single-`db.batch()` reset path without ever addressing that the shipped seed is **9,957 rows / ~7.2 MB of SQL** (measured via `buildSeedRows()`), which puts D1 batch limits, queue-consumer duration, and the AC-230 single-transaction atomicity claim all in play at once.

## 3. Issues

**[MAJOR] Implementation §1/§2 — Full-seed scale vs. the single-batch reset path is unaddressed**
`reseedDemo` (`src/lib/reset-demo/reseed-demo.ts:73-78`) runs wipe + insert as **one** `db.batch()`, and its doc comment stakes AC-230 on that: one batch = one transaction, a concurrent visitor never sees a partial reset. The plan swaps the 102-line minimal fixture for the full shipped seed — measured at **9,957 rows, ~7.2 MB of generated SQL** (`node scripts/seed/index.ts --sql-only | wc -c`) — and says nothing about whether a ~10k-statement, multi-MB batch fits inside production D1's batch/request limits or the queue consumer's duration budget. This is precisely the failure mode local tests cannot catch: workerd/miniflare does not enforce production D1 limits, so the integration test can go green over a reset that dies on the public deploy — recreating the ticket's own dead end one layer down. And if chunking turns out to be required, the AC-230 atomicity story (which this ticket's manifest declares it *exercises*) changes and must be reconciled, not silently weakened.
**Recommendation:** Add an explicit subsection: state the measured statement count and SQL volume, verify the real D1 batch constraints (statement count, aggregate message size, duration) against them, and pre-decide the strategy — single batch if verified safe, otherwise a defined chunking scheme (e.g., wipe batch + ordered insert chunks inside the queue job, with the job status and `demo_mode` gate as the consistency boundary) and a stated position on what AC-230 evidence looks like under it. Include one piece of *remote* running-system evidence (a reset against the deployed Worker) in the validation step, since this risk is invisible locally.

**[MAJOR] Implementation §2/§3 — A successful reset logs out the judge who pressed the button, and the plan's "refresh the shell" lands on that**
Sessions are D1-backed (`src/lib/auth/auth-sessions.ts`) and `auth_sessions` is in `WIPE_ORDER` (`reseed-demo.ts:45`); the plan's own test step explicitly dirties "session state" and expects it wiped. So on every *successful* reset, the initiating organizer's session is destroyed. The poll route survives (it is `auth: public`, KV-backed — `admin-ops.routes.ts:91`), so the job will report `done`, but the plan's step-3 instruction to "refresh the shell after a successful reset" then lands the judge on a logged-out screen with no explanation — a success that presents as a failure, at exactly the moment the ticket says is cruellest. The plan treats auth failure only as an error to report honestly; here it is the guaranteed outcome of success and needs a designed path.
**Recommendation:** Decide explicitly and put it in the plan: either (a) the post-success flow routes to demo login as a *narrated* step ("Demo restored — sign back in as Organizer"), leaning on the task constraint that demo login must work post-reset, or (b) the reset preserves/re-mints the initiating persona's session. Whichever is chosen, add a test assertion for the initiating session's fate and for what the shell shows immediately after a successful reset.

**[MINOR] Implementation §1 — Seeder discovery is Node-only; make the static-manifest parity check explicit**
The CLI discovers seeders by `readdirSync` glob (`scripts/seed/index.ts:51-61`), which cannot run in the Worker. The plan's "shared seed-module manifest/builder … retain the CLI's discovery/parity checks" implies the right shape (static import manifest + a node-level test asserting manifest === globbed directory), but doesn't say it outright.
**Recommendation:** One sentence: the Worker imports a static manifest; a node test asserts the manifest exactly matches `discoverSeedFiles()`, so a new seeder that isn't in the manifest fails CI rather than silently missing from reset.

**[MINOR] Implementation §2 — R2 key-scheme detail worth pinning**
Runtime uploads key as `uploads/{eventId}/{ownerType}/…` (`src/lib/r2/keys.ts:21`), while *seeded* attachment rows carry `r2_key` values under `submission-files/…` (`scripts/seed/submission-content.ts:75`). The plan's `uploads/<demo-event-id>/` prefix is therefore correct and safely disjoint from seeded keys — but the plan should state this so the implementer doesn't "helpfully" widen the delete to seeded keys, and should note R2 `list` pagination (cursor loop) so a >1,000-object store doesn't truncate the cleanup. The unrelated-tenant control object should use a realistic `uploads/<other-event-id>/…` key.
**Recommendation:** Name both prefixes in the plan, require a cursor loop on `list`, and shape the positive-control key like a real upload.

**[MINOR] Adversarial proof §4 — Test runtime for a ~10k-row baseline seeded twice**
Seeding the full baseline, dirtying it, and running two complete resets is the right proof, but it's a heavyweight integration test. The verification sequence already keeps it out of the hermetic 30s suite — good — just watch that the focused suite itself stays tolerable and doesn't rebuild the 10k-row baseline more times than needed.
**Recommendation:** Build the baseline once per test file (shared setup), and note the expected runtime in the PR so a slow suite is a known cost, not a surprise.

## 4. Positive Observations

- **Every factual claim in the plan is true of the codebase.** The dead button, the minimal fixture, the global `DELETE FROM` wipe, the node-only seed loader, the route paths, the queue consumer shape — all verified at the cited locations. Cycle 1's four resolutions each hold up against the code.
- **The per-table named-count assertion is an excellent forcing function.** Asserting an expected count for *every* `WIPE_ORDER` table means the MRQ-53 guard (new migration table → must join `WIPE_ORDER`) automatically forces a new expected count too — a table can't drift into "wiped but never checked."
- **The cross-tenant discipline is right:** explicit ownership predicates per table, refusal to guess on ownershipless mirror state, and a positive control that both proves the unrelated tenant survived *and* that the demo rows actually died. That's the correct shape for defect 3.
- **Double-reset + post-reset demo login as first-class assertions** map directly onto the task's constraints rather than being bolted on, and "counts, not a 200" is honored throughout.
- **Scope hygiene is clean:** no migration, no AC ownership grab, MRQ-66 collision handling pre-stated, and the shared builder framed as drift prevention rather than a second reset path.
