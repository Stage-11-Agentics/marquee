# MRQ-241: Reference codes you can say on a call: SUB-n on every submission, searchable everywhere

WHY. The submission record header prints a raw ULID (src/ui/submissions/SubmissionRecordPage.tsx:897), every board card prints one (src/ui/board/ProgramBoardPage.tsx:57), and quick-search subtitles are "<ulid> · type". Nobody reads 01J8ZQ7X2M4N6P8R0T2V4Y6A8C aloud on a program call, a speaker cannot quote it back, and the one string an organizer would naturally type into ⌘K is one the product never issued. PHILOSOPHY 6 (the organizer's language), R7 (legibility at speed).

SCOPE. Per-conference sequential reference code (SUB-1, SUB-2 …), minted at insert on every creation path — public submit, organizer add, Sessionize import, seed — so no surface ever branches on "has a code". Surfaces: record-header chip with one-click copy (ULID demoted out of the default view); quick search matches it (the normalizer already strips punctuation, src/lib/quick-search.ts:4-10, so sub41 / SUB-41 / sub 41 agree — add the column to the match fields in search.routes.ts:81-155, the list q filter submissions.queries.ts:292, and the board query src/api/board.ts:185); board cards and list-row sub-line; submitter confirmation screen and email subject ("Abstract SUB-41 received — <title>"); CSV export carries code AND opaque id; one read-only column in the Airtable mirror submissions field map (src/jobs/mirror/records.ts:68-105; NOT added to the inbound allowlist). Deliberately NOT in URLs — routes keep ULIDs; the command bar is the resolver.

DATA MODEL. ALTER TABLE submissions ADD COLUMN reference_code TEXT; backfill existing rows in deterministic (created_at, id) rank order per event; CREATE UNIQUE INDEX uq_submissions_reference ON submissions(event_id, reference_code). Allocation is MAX-based, computed inside the insert statement — 'SUB-' || (COALESCE(MAX(CAST(substr(reference_code,5) AS INTEGER)),0)+1 scoped to the event) — monotonic across deletions (reset/delete-conference exist; a COUNT-based scheme re-issues numbers), race-backstopped by the unique index with one bounded retry so a submitter never sees a 500. Chores: src/db/schema.ts row type, schema-delta file (check:schema), seed mints codes for all rows with a check:seed assertion.

CONTRACT FOLD (executing agent): SPEC + US/AC mint at consolidation; re-check next-mint in EVALUATION.md (AC-314 as of 2026-08-15).

AC DRAFTS. Unique per conference (two conferences may both hold SUB-7). Typing sub-41 / SUB-41 / sub 41 into quick search surfaces the record inside the AC-103 budget (p95 ≤ 200ms). Header chip copies the bare code in one click. Codes never renumber: withdraw/reject/delete never changes another submission's code; post-deletion allocation continues the sequence. Concurrent submits yield distinct codes (race test); allocation never 500s. Backfill is deterministic (run-twice-identical against a fixture).

VALIDATION. Integration: allocation race, backfill determinism, search matching incl. normalization. E2E: type a code into ⌘K, land on the record; copy affordance.

CUT LINE. Smallest: column + backfill + allocation + header chip + quick-search + CSV. Complete: board/list prints, confirmation email subject, mirror column, seed/check:seed assertion.

## Implementation plan (MRQ-241)

### Contract and allocation hold

- Work from `github/main` at `bbb8e21e3ae3f040623171049a774455fada53c6`; keep routes ULID-based.
- The six AC drafts above are the complete acceptance set allocated as story `US-97`, criteria `AC-343` through `AC-348`, and migration `0030`. The next shared slots are `US-98` and `AC-349`; do not consume them.
- Consolidation is authorized: fold only the agreed `US-97`/`AC-343`–`AC-348` lineage into `SPEC.md`, `USER_STORIES.md`, `EVALUATION.md`, and `BUILDPLAN.md`; do not edit `DESIGN.md` or mint outside the allocated range.

### Build phases

1. Add the schema seam: `submissions.reference_code`, the allocated migration, its full-name schema-delta receipt, and `SubmissionRow`/insert typing. Backfill with `ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY created_at, id)` so rerunning the migration fixture yields the same code; enforce `UNIQUE(event_id, reference_code)` while retaining nullable compatibility for isolated legacy fixtures.
2. Centralize the bounded allocation retry and use an insert-time `MAX(CAST(substr(...)))` expression on every runtime creation path: public draft creation, public final submission, routing-stage draft creation, organizer add, and Sessionize import. Retry only the reference-code unique violation once; never retry arbitrary database errors or duplicate non-submission side effects. Preserve the current importer idempotency and all existing status/origin semantics.
3. Make seed rows carry deterministic per-event codes across accepted-core, pool, sponsor, and any other submission table producers. Add a `check:seed` assertion that every seeded submission has a `SUB-n` code, codes are unique within each event, and the seeded allocation remains monotonic. Keep seed counts/statuses unchanged.
4. Thread the code through reads and operator surfaces: search API candidates/subtitles, server-side list and board filters with separator-insensitive matching (`SUB-41`, `sub 41`, `sub41`), list-row metadata, board card label, record response/header, and the one-click copy affordance. All navigation continues to encode the opaque ULID.
5. Complete the receipt surfaces: public confirmation state/copy and confirmation subject (`Abstract SUB-41 received — <title>`), CSV export with both `reference_code` and opaque `submission_id`, and outbound Airtable submission fields with the code as read-only. Do not add the code to `MIRROR_INBOUND_ALLOWLIST` or create an Airtable write-back path for it.

### Regression and proof plan

- Add parent-failing integration coverage for deterministic backfill, deletion-monotonic allocation, per-event uniqueness, and two concurrent creates proving distinct codes with no 500. Include a positive control and assert the bounded retry does not mask unrelated failures.
- Add parent-failing list/board/search coverage for all three normalized forms and event isolation; retain a title/speaker positive control and verify the result remains under the existing quick-search/list budget contract.
- Add source/route tests only for structural invariants that cannot be exercised by the integration harness; prefer database and rendered-response assertions over source-text matches.
- Run the focused tests first, then `npm test`, `check:seed`, `check:schema`, and the serialized full `npm run pr-gate -- --ticket MRQ-241` slot requested from `merge-captain`. Treat `pass-over-budget` as a warning, but do not accept `fail` or `timeout`.
- Move through `in_planning → planned → in_progress → review → in_validation`; attach a non-author review artifact naming the reviewed HEAD and a real c11/browser validation artifact. Validate the running command bar with a seeded code, open the ULID route, and exercise the header copy action with clipboard permission scoped to this local flow. Stop at `pr_open`; do not merge or deploy.

### Non-goals and handoff

- No reference-code URLs, global numbering, count-based allocation, renumbering after delete/withdraw/reject, inbound Airtable edits, or new parallel speaker/submission tables.
- Commit and push this plan before code, then push each meaningful implementation commit. At handoff, report exact HEAD, gate/review/validation evidence, the six-AC/one-migration allocation, and any contract deviation to Adoption Orchestrator surface `513` and mailbox `adoption-orchestrator`.
