# Plan Review: MRQ-31 (Cycle 2)

## 1. Verdict

**PASS** — with one **major** required amendment to the AC-112 test design (below). The amendment changes one test's second-pass input, not the architecture, file list, or scope; the implementer must fold it in. Everything else is grounded and sound.

## 2. Summary

Reviewed the Cycle-2 plan for MRQ-31 / M-30 (Sessionize import: mapping preview, relationships/scores/statuses, idempotent outcomes, batch undo, named empty-state + README handoff) against the live codebase. The plan is exceptionally well grounded — every structural claim I checked is true in the repo: `imports`/`import_rows` exist in `migrations/0001_init.sql:664-688` with exactly the fields the plan uses (`file_key`, `mapping`, `undone_at`, `before_json`, the four-value `outcome` CHECK); the `/import` route is already in `src/ui/shell/route-table.ts:39`; `_manifest.ts` auto-globs `*.routes.ts`; the `uq_submissions_event_external_ref` partial unique index (line 814) backs the proposed matching key; the claims-manifest and test-file naming match existing artifacts; `check:api` and `pr-gate` scripts exist; the `MEDIA` R2 binding exists. The Cycle-1 resolutions (status vocabulary, AC-109 truthfulness, README ownership, undo safety) are correctly reasoned and consistent with the binding SPEC. The key remaining concern is that the AC-112 test as literally planned proves idempotency but not the AC's central update/insert clause.

## 3. Issues

**[MAJOR] §5 AC-tagged proof — AC-112 test as planned does not test AC-112's main clause**
EVALUATION.md AC-112 reads: *"import an **updated** export twice — matched records **update**, new rows **insert**, zero duplicates."* The plan's test proves it "by importing the **exact same files** twice and asserting all imported table row counts are identical with no duplicate external refs/emails." A same-file rerun proves idempotency and the zero-duplicates clause, but cannot prove that matched records take updated values or that new rows insert — the two clauses that are the point of the criterion. If implemented verbatim, `tests/ac-claims/MRQ-31.json` would own AC-112 backed by a test that doesn't exercise it, which the terminal audit would (rightly) treat as a false claim.
**Recommendation:** Keep the same-file rerun as the idempotency half, and add a second pass using an *updated variant* of the fixtures (changed title/bio/status on a matched external_ref/email, plus at least one brand-new row). Assert: the matched submission/person rows carry the new values, the new rows are `created`, the changed rows are `updated`, unchanged rows are `skipped`, and external-ref/email uniqueness still holds. The variant can be a second checked-in fixture file or a programmatic mutation of the CSV text — either fits the plan's existing fixture section ("duplicate/re-run identity") without new scope.

**[MINOR] §2 / Cycle-1 resolution — make "undecided preserved" concretely testable in the AC-110 test**
AC-110's text says "statuses preserved **including undecided**," while the resolution (correctly — the D1 CHECK at `migrations/0001_init.sql:336` has no `undecided` member and expanding the enum would fork every reader) maps it to `in_review` with the raw source term retained in the row's outcome/audit detail. The residual risk is a literal-minded terminal audit. The defense is to make preservation observable: the AC-110 test should explicitly assert that an imported `undecided` row lands as `in_review` **and** that the raw string `undecided` is recoverable from the import row's detail. The plan implies this but doesn't commit the test to it.
**Recommendation:** Name the raw-source-status assertion as part of the AC-110 test's checklist, and keep the mapping rationale in `docs/notes/M-30.md` and the PR body (already planned).

**[MINOR] §2 — headshot "lands" needs a stated observable, since the plan deliberately doesn't fetch**
AC-110 includes "headshots … land." The plan attaches external headshot URLs as pending import-file metadata rather than fetching bytes — a defensible call (no outbound fetches of operator data; fixture URLs are fake and would fail in tests anyway; the `import_file` attachment owner type at `0001_init.sql:111` supports it). But "lands" then needs a concrete testable form or the AC claim is soft.
**Recommendation:** Have the AC-110 test assert the specific representation (attachment row / person field carrying the external URL with its pending state), and state the no-fetch decision explicitly in `docs/notes/M-30.md` so the M-45 README fold and the audit both see it as a decision, not an omission.

**[MINOR] §1/§2 — undo deleting the R2 manifest trades away the batch's audit trail**
The plan deletes the batch's R2 manifest after a successful D1 undo. `imports`/`import_rows` rows survive (marked `undone_at`), so the record of *what happened* remains, but the source bytes that produced it are gone — the one artifact that would let an operator re-inspect or re-run a disputed import.
**Recommendation:** Consider retaining the R2 object and letting undo touch only D1 (the object is inert once `undone_at` is set); if deletion stays, note the rationale in `docs/notes/M-30.md`. Either is acceptable — this is a judgment call, not a defect.

## 4. Positive Observations

- **Grounding is real, not decorative.** Every schema field, index, route convention, script name, and UI hook the plan relies on exists in the repo today, including the pre-wired `/import` entry in the shell route table and the partial unique index on `(event_id, external_ref)` that makes the session matching key safe by construction. This is what a Cycle-2 plan should look like.
- **The Cycle-1 resolutions are correct and well-argued.** The `undecided → in_review` decision is anchored to the actual D1 CHECK constraint and the cost of forking every status reader; AC-109 honesty (fixtures prove mechanics only, no claim-manifest coverage, no "real export" language) is exactly the right posture for the single `op-assist` criterion; README ownership is respected via `docs/notes/M-30.md` with no `README.md` edit.
- **Undo design follows the SPEC's own idiom** — `before_json` snapshots captured pre-write, `undone_at` as a nullable timestamp (the same shape SPEC §3 calls out for `magic_links.used_at`), event-scoped, dependency-ordered restore, and an idempotence check against a seeded unrelated record.
- **Write-free preview is stated as an invariant** ("no submission/person/evaluation writes before Run") and tested, not just implied — the exact property AC-109's mapping-step design exists to protect.
- **Conventions are matched throughout:** `sessionize-import.AC-110-113.test.ts` follows the existing `feature.AC-n-m.test.ts` naming, the claims manifest follows the `owns`/`exercises` shape of `MRQ-32.json`, and the route module rides the generated manifest rather than a parallel registry.
- **Fixed-layout mapping UI** (mapping rows and preview columns fixed-width so header matches never reflow) correctly applies the binding "elements never jump" craft rule to the one screen in this ticket most prone to violating it.
