# MRQ-116: Comments on deliverables

## Contract and base

- Ticket: MRQ-116 / CNT-05 (w2), with CNT-S3 as the adversarial scenario.
- The branch was cut from `github/main` because `github/mrq-115-files-library` was absent at planning time. The exact cut point is `github/main @ 23a06b0b28473edbd9d5feeea1a8d5ae32dc1a80`.
- Before implementation, poll for the parent ref and rebase this branch onto it. While the parent is unmerged use `git rebase --onto github/mrq-115-files-library 23a06b0b28473edbd9d5feeea1a8d5ae32dc1a80 mrq-116-file-comments`; after the parent is squash-merged, use the COMMON.md `--onto github/main <parent-tip-sha>` form. Re-run `npm ci` after either rebase.

## Scope

Implement a real, event-scoped comment thread for each file deliverable slot. The durable owner is the slot (`owner_type` + `owner_id`, never the current attachment). `attachment_id` is nullable metadata identifying the version the author was looking at. A v1 comment must remain visible after the speaker uploads v2, and an organizer reply must land in the same thread.

1. Add migration `0009_file_comments.sql` for `file_comments(id, event_id, owner_type, owner_id, attachment_id NULL, author_person_id, body, created_at)` plus useful event/slot indexes and non-empty body constraints. Register the table/types in `src/db/schema.ts` and demo reset ordering so tests and reset remain truthful. Do not create a versions table or modify attachment versioning, which T-F1 owns.
2. Add a shared `src/lib/file-comments.ts` query/write helper. Reads join the author person and the event membership needed to render a human name and role. Validate that the slot and optional tagged attachment belong to the same event/task; reject cross-event, foreign-slot, missing, blank, or non-ready attachment references without writing. Do not enqueue mail or create outbox rows.
3. Add authenticated API routes in a new `*.routes.ts` module: speaker read/write for the current task, and organizer read/write for the Files library's event-scoped deliverable slot. Both use the shared helper and return comments with stable ordering, author name, author role, and nullable version metadata. Keep API route naming in the generated manifest and expose useful OpenAPI schemas.
4. Extend the speaker portal task projection and add a compact `FileComments` UI in the file-task row: visible `Comments` heading, existing thread, author name + role, version chip when present, and a real submit control with pending/error/empty states. Preserve layout space so submitting a comment does not make adjacent controls jump. Speaker writes use the current task and may tag its selected attachment.
5. After rebasing onto MRQ-115, mount the same thread in the organizer Files row expansion/detail surface. Make the slot anchor explicit in the UI, show old version chips after a replacement upload, and let the organizer reply without opening a second attachment-specific thread. Keep all F1 version-list ownership intact and avoid changes to F1's attachment query semantics.

The parent UI/API contract is frozen: consume `listVersionsFor`/`listVersionsForOwners` and `FileVersions` from MRQ-115; do not redefine `FileVersion`, add CSS imports for its consumer, or write attachment SQL. The organizer Files API returns rows keyed by speaker-task ID with versions inline, and the Files page owns the per-row selection column. Comments mount around those surfaces.

## Non-goals and collision boundaries

- No email, notifications, outbox, or mail-trigger changes; the rubric explicitly excuses notifications.
- No attachment/version schema redesign, `is_latest` storage, ZIP export, or per-session Files tab; T-F1/T-F3 own those.
- No edits to contract docs or new AC IDs. Do not touch `attachments` SQL except through the nullable foreign-reference validation needed by comments.
- Expect rebase conflicts in `route-table.ts` or the parent Files component; resolve only the child integration, preserving MRQ-115's library and version helper. `uploads.routes.ts` remains T-F1-owned for signing/completion.

## Verification

- Add targeted migration/helper/API tests for isolation, author role/name, blank-body refusal, optional version chips, and the v1-comment → v2-upload → organizer-reply sequence. Test refusal has no row/count side effect and include a positive control.
- Add targeted portal/library UI or route-contract tests asserting the comments affordance is reachable by exact “Comments”/“Files” nouns and that version-tagged historical comments remain in the slot thread.
- Run only targeted Vitest/node tests for touched files during development; never run the full `npm test` in this fleet. Before the PR gate, check `uptime`; if 1-minute load exceeds 24, wait 2–3 minutes. Run `npm run pr-gate -- --ticket MRQ-116` and paste the exact output into the completion comment.
- Perform running-system validation against the actual portal and organizer Files detail flow after rebasing. Attach review and validation evidence, open a PR to `github/main`, include `stacked on MRQ-115 — merge that first; this rebases.`, cite CNT-05/CNT-S3, and stop at `pr_open`.

## Plan-review resolutions

This plan self-review checked the ticket's two failure traps: it anchors all storage and route reads on the deliverable slot, and it keeps `attachment_id` nullable metadata rather than a thread key. It also names the parent-ref absence and the exact rebase rule, keeps F1's attachment ownership intact, and requires a no-side-effect refusal test plus a positive control.
