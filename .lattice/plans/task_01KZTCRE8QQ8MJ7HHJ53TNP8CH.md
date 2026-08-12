# MRQ-112: Headshots render and speaker files panel

## Ground truth and base

- Ticket: SPK-08 (w3), SPK-10 (w2), CNT-10 half; validated findings register rows 21 and 22; contract section T-D2.
- Rubric anchors: `.eval-kit/specs/03-speaker-management.yaml` SPK-08 and SPK-10, and `.eval-kit/specs/04-content-management.yaml` CNT-10. SPK-08 is the two-sided portal-to-organizer headshot roundtrip; SPK-10 is organizer metadata/download; CNT-10 is persisted organizer-side bio/photo.
- Working branch: `mrq-112-speaker-files`, initially `github/main` at `23a06b0b28473edbd9d5feeea1a8d5ae32dc1a80`, because `github/mrq-115-files-library` did not yet exist when planning began. Parent anchor is MRQ-115, not main; once the parent ref is published, rebase with the explicit stacked cut point and run `npm ci`.
- Parent contract: consume MRQ-115's `listVersionsFor` and exported `FileVersions`; do not add attachment/version SQL here. MRQ-115 owns sign/complete and all attachment SQL.

## Scope

1. Add one authenticated headshot serve/read path in `uploads.routes.ts` (prefer widening the existing preview handler if it can safely authorize both organizer and the owning speaker; otherwise add the T-D2 person-headshot path). It must locate a ready `person_headshot` attachment through `people.headshot_attachment_id`, stay event/person scoped, serve only previewable raster images inline, and never expose pending/unowned/cross-event bytes. Preserve the existing submission-answer behavior and keep media-origin downloads separate.
2. Project the person headshot reference/URL data needed by the portal and organizer surfaces. Render a real `<img>` after reload in the portal profile, organizer roster row, and speaker record/drawer. Keep a fixed avatar box and initials fallback on missing, pending, failed, or photo-less state so elements never jump. Use the existing event/person identifiers to build the authenticated preview URL; do not duplicate attachment lookups in UI code.
3. Add the speaker record Files panel using MRQ-115's `listVersionsFor` and `FileVersions` exports. The panel must combine person-owned attachments (including the uploaded headshot) and the speaker's task uploads, showing filename, human-readable size, uploaded-at, and an honest download/view control. Keep latest/version semantics delegated to the parent helper and do not create a second attachments query. If a public capability URL is displayed, label its unauthenticated nature as the parent contract requires.
4. Add targeted API/UI tests covering headshot reachability, authorization/non-disclosure, image fallback, the portal reload render, organizer metadata/download affordances, and combined person/task file projection. Name tests with the relevant existing AC IDs where applicable; do not expand the default suite or add migrations.

## Ownership and non-goals

- Owned here: read/serve handlers in `src/routes/uploads.routes.ts`, portal headshot render, organizer roster/record renders, and the speaker record files panel.
- Owned by MRQ-115: `listVersionsFor`, `FileVersions`, attachment/version SQL, signing/completion lifecycle, and the files library. Wait for its published branch/ref before final integration.
- Coordinate with MRQ-111's new Speakers roster/record surfaces; do not take over its CRUD, membership repair, status, custom fields, audit, or route ownership. If its final file shape differs, add the smallest render integration after rebase.
- No contract-doc edits, no schema migration, no public-site/R2-origin wiring, no new parallel attachments data model, and no changes to sign/complete authorization.

## Verification and lifecycle

- Before implementation: self-review this plan against T-D2, Section 1 (YAML rubric, 70-turn discoverability, honest artifact, stable layout), and Section 4 ownership rules; append any resolutions below.
- After implementation: run targeted Vitest files only (never full `npm test`); run typecheck/build/static checks proportionate to touched surfaces. At the `pr-gate` phase, inspect `uptime`; if 1-minute load exceeds 24, wait 2–3 minutes before retrying. Run `npm run pr-gate -- --ticket MRQ-112` and paste the exact result into the completion comment.
- Validation: exercise the real Worker read path with seeded/integration data and the actual portal/organizer browser surfaces if available; record observed response status, non-disclosure behavior, and visible fallback/render evidence separately from inference. Attach review and validation artifacts before `pr_open`.
- PR body must state: `stacked on MRQ-115 — merge that first; this rebases.` and cite SPK-08, SPK-10, CNT-10, plus register rows 21/22. Terminal status is `pr_open`; a human merges.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- No reviewer findings yet. Self-review decision: use one serve path with explicit dual authorization and parent-provided version/list components; preserve the existing answer preview contract rather than broadening media access by URL shape alone.

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

- Parent MRQ-115's frozen export contract is now authoritative: import `VersionedOwnerType`, `FileVersionList`, `listVersionsFor`, `listVersionsForOwners` from `src/lib/files/versions.ts`, and mount `FileVersions` from `src/ui/files/FileVersions.tsx`. Do not recreate either helper/component or write attachment SQL.
- MRQ-115 also owns `GET /api/v1/events/{eventId}/files` and `/files`; this ticket only adds the speaker record panel and consumes the returned version lists. `FileVersion.url` is an unauthenticated capability URL, so any copy-link/download affordance will be truthfully labeled.
- The parent ref is published at `feb3654`; this branch was rebased onto it before implementation. Re-run `npm ci` after the rebase and do not expect the parent exports until its implementation commit lands.
