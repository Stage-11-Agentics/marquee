# MRQ-166 — require a real speaker email in Sessionize import

## Objective

Close the Sessionize speaker-import failure where a blank email becomes a fabricated `@example.invalid` address and can corrupt an existing person matched by name. The importer must reject an unusable export or row before it creates an inert speaker record, while preserving the existing profile merge behavior from MRQ-164.

## Scope

1. Enforce that the speaker mapping maps an actual CSV column to `email` at the mapping endpoint, before the mapping is persisted or any conference data is written. Return a 422 with a message naming the missing `speakers.email` column.
2. Make a speaker row with a blank or whitespace-only email fail through the existing per-row error boundary with a readable `speaker email is required` reason; other rows continue.
3. Remove only the speaker placeholder fallback. Leave the unattributed reviewer placeholder intact because reviewer identity is optional and semantically distinct.
4. Change name lookup to return a person only for exactly one case-insensitive name match; duplicate names must not be selected arbitrarily.
5. When a unique name match is used, retain the stored email while importing the remaining profile fields and record that retention in the row reason. Email-based matches continue to use the normalized incoming email.

## Non-goals

- Do not change the raw `uq_people_org_email` uniqueness wart or add a migration/dedupe pass.
- Do not change `/submissions/new` or its submitter-only behavior.
- Do not change the unattributed reviewer placeholder.

## Implementation and test plan

- Add a focused MRQ-166 integration test fixture with an authenticated organizer, duplicate-name people, a pre-existing name-matched person, and multiple speaker rows. Exercise the mapping API, row outcomes/reasons, stored profile/email values, placeholder absence, duplicate-name non-match, and repeat-run idempotence.
- Add the tests before the implementation and run the focused test file against the current branch, recording the expected failures. Commit that failing test checkpoint.
- Update `src/lib/sessionize-import.ts` beside the MRQ-164 merge helper: validate/normalize the email before lookup, query at most two name matches and accept only one, retain email on name matches, and remove the speaker-only fabricated address. Keep reviewer synthesis unchanged.
- Update the mapping route boundary as needed so a selected email mapping must name a real speaker CSV header and is refused before persistence.
- Run the focused test again, then the relevant existing Sessionize integration tests and static checks. Inspect the diff and test titles for `trace:ac` compliance.

## Validation gates

1. Focused MRQ-166 tests fail before the fix and pass after it.
2. Existing Sessionize import tests pass, including speakers-only import, reviewer placeholder, merge/undo, and repeat import behavior.
3. `npm run pr-gate` passes within the documented contention-aware 120s budget.
4. Build and exercise the real local Worker import at least once using the README recipe, with a unique port and a demo-organizer cookie/API path. Capture the observed mapping rejection and/or row outcomes, plus a check that no `speaker+...@example.invalid` person is created. Attach validation evidence to MRQ-166.
5. Commit and push the implementation, open one ready PR against `github/main`, move the ticket through review/validation/pr-open, address any review findings, and merge only after an independent review and green gate. Do not deploy.

## Handoff evidence

- Commits on `mrq-166-require-speaker-email` for the failing test checkpoint and implementation/gate checkpoints.
- Lattice validation attachment for the running import proof.
- PR body states the ruling: a fabricated address cannot participate (no portal invite, task, or reminder), so clear import-time rejection is preferable to a later bounced invite; it also states what remains unfixed.
