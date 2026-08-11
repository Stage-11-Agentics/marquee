# MRQ-31: Sessionize import

BUILDPLAN: M-30 — Tier B rank 11 (US-66), Wave 2 (§5)

Scope (verbatim): mapping preview, relationships/scores/statuses, idempotent outcomes, batch undo, named empty-state/README entry.

AC-109 is the plan's **single `op-assist` criterion**: it needs one real Sessionize export from the operator (any event: sessions + speakers + evaluation results) — the only thing that proves our column fixture's names and status vocabulary match reality. Everything else runs against `fixtures/sessionize/{sessions,speakers}.csv`.
When this lands, fold its real text back into M-45's README import section (which was written against the fixture).

ACs: AC-109 – AC-113
Hours: 7
Workflow: sub-agent-full (≥7 h)
Shared files: `README.md` is **M-45's** — file the import section as `docs/notes/M-30.md` for M-45 to fold in (§7).
Deps: M-08
Human precondition: one real Sessionize export (§8 item 8, EVALUATION §1.6 item 6)

## Grounded implementation plan

### 1. Preserve the merged seams and make the import data durable

- Build on the existing `imports` / `import_rows` tables in `migrations/0001_init.sql` and their mirrors in `src/db/schema.ts`; no contract-document edits and no new AC IDs.
- Add a small, independently testable `src/lib/sessionize-import.ts` module for CSV parsing, header normalization, default field detection, mapping validation, first-row preview, canonical status conversion, and deterministic import IDs.
- Accept the two CSV payloads through the authenticated upload route, persist the manifest in the existing `MEDIA` R2 binding under an event/import-scoped key, and keep that key in `imports.file_key`. The D1 row remains the source of truth for the batch and R2 holds only the uploaded source bytes.
- Store the selected mapping in `imports.mapping`. Preview and mapping validation must perform no domain writes; only the import row and its mapping metadata may change before Run.

### 2. Implement the API as one generated route module

- Add `src/routes/imports.routes.ts` (the `*.routes.ts` name is required by the generated manifest) with the SPEC §4.2 paths:
  - `POST /api/v1/events/{eventId}/imports` — authenticated `program:write`; upload sessions/speakers CSV text, create the batch, and return detected headers/default mapping.
  - `POST /api/v1/events/{eventId}/imports/{importId}/mapping` — save an explicit mapping and return fixed-size first-row previews plus unmapped fields; no submission/person/evaluation writes.
  - `POST /api/v1/events/{eventId}/imports/{importId}/run` — apply the mapping and return per-row `created`, `updated`, `skipped`, or `failed` outcomes and counts.
  - `POST /api/v1/events/{eventId}/imports/{importId}/undo` — reverse one completed batch once, restore captured `before_json`, remove only rows/attachments created by that batch, and mark `undone_at`.
- Scope every lookup and mutation by `eventId`; conceal foreign-event batches as not found. Use the shared `ApiError`, route policy, request/response schemas, and no parallel route registry.
- Match sessions by `(event_id, external_ref)` and speakers/reviewers by normalized email, with deterministic IDs for newly materialized source records. Replace only the import-owned speaker/co-speaker relationships for a matched session; preserve unrelated roles and seeded records.
- Map Sessionize `undecided`/pending vocabulary to Marquee's existing canonical `in_review` status. Retain the raw source status in each successful row's reason/outcome detail so the source state is auditable without expanding the binding `submissions.status` enum used by every existing reader.
- Import scores/comments into `evaluations`, attribute by reviewer email when matched, and otherwise use a deterministic synthetic reviewer record whose evaluation comment/outcome explicitly says `unattributed`. Attach external headshot URLs as pending import-file metadata rather than fetching operator data or pretending the bytes are locally verified. Import session custom fields into matching/created closed Sessionize form fields and `submission_answers`.
- Build undo snapshots before each write. A session snapshot includes its submission, import-owned participations, answers, and evaluations; a speaker snapshot includes the person and external-headshot attachment state. Restore updates and delete only batch-created records in dependency-safe order. Retain the inert R2 manifest after the D1 undo succeeds so the import audit remains inspectable.

### 3. Ship the operator path and named discovery affordance

- Add `src/ui/import/SessionizeImportPage.tsx` and feature CSS. The page is a stable three-step flow: choose the two CSVs, review editable column mappings and a first-five-row preview, then Run and inspect per-row outcomes with one Batch undo action.
- Keep mapping rows and preview columns fixed-width so matching a header never reflows the layout (DESIGN v1.9 / “Elements never jump”). Use “conference” in UI copy and name the source explicitly as “Import from Sessionize.”
- Replace the honest empty-program dashboard action with a named “Import from Sessionize” action alongside “Add session,” and wire `/import` into `AppShell` using the route already present in the shell table.

### 4. Fixture and README handoff

- Add `fixtures/sessionize/sessions.csv` and `fixtures/sessionize/speakers.csv` with deliberately small, ugly, deterministic data covering accepted, undecided, rejected, speaker relationships, bios, external headshot URLs, custom fields, matched and unmatched reviewers, score/comment rows, duplicate/re-run identity, and one malformed row for a failed outcome. These are explicitly authored fixtures, never real-export evidence.
- Add `docs/notes/M-30.md` with the mechanical README section: upload both files, preview mappings before Run, canonical `undecided → In review` behavior, row outcomes, email/external-ID matching, batch undo, fixture paths, and the outstanding real-export AC-109 operator step. Do not edit `README.md`, which is MRQ-40/M-45-owned.

### 5. AC-tagged proof and claim manifest

- Add an integration test under `tests/integration/api/sessionize-import.AC-110-113.test.ts` using the fixture files and a program-lead session. It will prove mapping/preview is write-free; AC-110 profile/status/relationship landing, canonical `in_review` plus recoverable raw `undecided`, and the pending headshot attachment representation; AC-111 matched and unattributed score/comment rows; AC-112 with both an exact same-file rerun (identical row counts/no duplicate external refs or emails) and an updated-file pass (matched title/bio/status updates, a new row inserts, unchanged rows skip, and outcomes say so); and AC-113 by undoing the batches and asserting imported rows are gone while a seeded unrelated submission/person/evaluation remains byte/count identical.
- Add `tests/ac-claims/MRQ-31.json` owning only auto AC-110–AC-113. AC-109 remains explicitly `op-assist`, uncovered-pending-operator; the fixture preview test is not used as real-export validation and the manifest must not claim it.

### 6. Review, validation, and delivery arc

- After this plan commit, transition `planned`, then `in_progress`; implement and run focused tests plus type/build checks.
- Transition `review`; self-review the exact branch HEAD adversarially (or use the one permitted synchronous reviewer), attach a PASS review artifact naming that HEAD, and resolve every finding before validation.
- Transition `in_validation`; run the focused integration test, `npm run check:api`, and `npm run pr-gate -- --ticket MRQ-31`. Record the real-export gap plainly; do not raise an operator flag unless the real export arrives and requires action.
- Push every meaningful commit to `forgejo/mrq-31-import`, create the Forgejo PR against `master` with M-30/AC-109–AC-113, exact README handoff text, the `pr-gate` result, and the AC-109 pending note; attach the PR and final review/validation evidence, bump `pr_open`, then c11-send the Orchestrator at workspace:9/surface:60.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Status vocabulary:** The binding SPEC and D1 CHECK do not contain a literal `undecided` status. The resolution is semantic preservation: map Sessionize's undecided/pending source vocabulary to Marquee's `in_review`, retain the raw source term in the import outcome/audit detail, and explain that mapping in `docs/notes/M-30.md` and the PR. Expanding the enum would fork the merged list/dashboard/reviewer seams and is out of scope.
- **AC-109 truthfulness:** The operator's real export was not present at planning time. Authored fixtures may prove mechanics only; AC-109 remains `op-assist` and pending, with no claim-manifest coverage and no “real export” language in the test or PR evidence.
- **Shared README ownership:** `README.md` is not edited. `docs/notes/M-30.md` is the sole handoff artifact for MRQ-40/M-45 to fold mechanically.
- **Undo safety:** Batch snapshots are captured before writes and undo is event-scoped, dependency-ordered, and idempotence-tested against an unrelated seeded record. No global reset/delete path is introduced.

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

- **AC-112 major finding:** The test now has two explicit passes. It first imports the exact fixture twice to prove the trust proposition's row-count/idempotence half. It then imports an updated variant containing changed values for a matched external ref/email and one new source row, and asserts `updated`/`created`/`skipped` outcomes, persisted changed values, and uniqueness. This closes both the AC's update/insert clause and the duplicate clause.
- **AC-110 raw status:** The test must assert the fixture row with source status `undecided` persists as Marquee `in_review` and that its `import_rows.reason` retains the literal raw source term. The README handoff and PR will name this canonical mapping rather than implying the D1 enum contains `undecided`.
- **AC-110 headshot:** The test must assert the imported person's `headshot_attachment_id` points to an `attachments` row with `owner_type='person_headshot'`, `status='pending'`, and the external URL encoded in its import-owned metadata/key. No network fetch or verified image bytes are claimed.
- **R2 audit retention:** Undo marks the batch undone and restores/deletes D1 domain rows but retains the uploaded manifest in R2. The README note will say undo removes imported conference records while retaining the batch source for audit; no cleanup delete is needed or performed.
