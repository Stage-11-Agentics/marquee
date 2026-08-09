# Code Review: MRQ-2 — complete init schema

Reviewed exact HEAD `d4ad790f5f3108300324b9e996620b08a6818211` against `forgejo/master` (`5288442`) after the Orchestrator-directed squash-parent rebase. Scope: `migrations/0001_init.sql`, `src/db/schema.ts`, and `scripts/schema-verify.mjs`.

## Verdict

**PASS — own-reviewer, quota directive.** No unresolved blocking findings remain.

## Findings

- **[RESOLVED MAJOR] `migrations/0001_init.sql:498` — reviewer track scope was not event-safe by construction.** Replaced the single-column track reference with `(track_id, event_id) → tracks(id, event_id)`. `scripts/schema-verify.mjs:507` now adversarially rejects an event-2 scope using an event-1 track.
- **[RESOLVED MAJOR] `migrations/0001_init.sql:947` — session bypass default existed only as a writer convention.** Added an insert-only derivation trigger, kept later admin updates legal, removed `bypass_evaluation` from the TypeScript default-column set, and proved session=1 / abstract=0 / later session update=0 in `scripts/schema-verify.mjs:379`.
- **[RESOLVED MINOR] `scripts/schema-verify.mjs:269` — foreign-key coverage was a loose lower bound.** The verifier now requires the exact 89-row FK graph.
- **[RESOLVED MINOR] `scripts/schema-verify.mjs:261` — Amendment 12 nullability was formatting-coupled.** The verifier now introspects nullable `attachments.sha256` and `attachments.r2_etag` from the applied D1 schema.
- **[NON-BLOCKING] `scripts/schema-verify.mjs:13` — direct SQLite introspection requires Node 22.5+.** The script now fails immediately with an actionable version message. The current validation runtime is Node 26.5 and passed; MRQ-6 should pin a compatible CI runtime.
- **[NON-BLOCKING] `migrations/0001_init.sql:727` — five plan-named indexes are deliberately omitted because equivalent UNIQUE indexes cover the same leftmost prefixes.** This avoids duplicate write cost; the completion/PR note records the mapping rather than adding redundant indexes.

## Verification

- `npm exec tsc -- --noEmit` — PASS.
- `node scripts/schema-verify.mjs` — PASS: 46 product tables, 116 named indexes, 89 foreign-key rows, 3 triggers; migration replay is a no-op; adversarial constraint probes pass.
- `npm exec vite -- build` — PASS, with only the expected local warning that Turnstile secrets are unset.
- `git diff --check forgejo/master...HEAD` — PASS.
- Worktree status clean at reviewed HEAD.

SPEC Amendment 12 is authoritative, not a deviation: nullable SHA-256, R2 ETag, and indexed `draft_file` / `submission_file` attachment ownership are present in the single init migration.
