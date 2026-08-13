# MRQ-117: Bulk ZIP export of deliverables

CNT-14 (w2, auto-partial). STACKED on the files-library ticket (multi-select lives on its list). THE SCORED ARTIFACT IS THE VISIBLE STATE, NOT THE BYTES: CNT-S3 step 13 tells the agent 'do NOT download or inspect the ZIP' — a bare anchor-download produces nothing to screenshot and scores not_found even when it works. Build: multi-select -> export dialog (grouping by session / by speaker; deselection) -> visible Preparing -> Ready panel. Mechanism: streaming ZIP via TransformStream over the MEDIA R2 binding, STORE not deflate (decks are pre-compressed; CPU is the billed budget), latest-only via the library's is_latest derivation (one shared definition of current or the human manual check fails while the UI looks right). Folder names humans use: Thu-1400-Room_Speaker/; manifest.txt listing missing deliverables; total size shown before generating (attachments.size_bytes exists). Vendored ~120-line ZIP-STORE encoder or client-zip (~3KB) — prefer vendored (public repo, six deliberate runtime deps). Full spec: section T-F3. Register row 29. DEPENDS ON / STACKED: see boot prompt; parent is the 'Files library and version lists' ticket.

## Plan

### Scope and acceptance

Implement CNT-14 / CNT-S3 step 13 on top of MRQ-115's Files library. The organizer can select current library entries, open an Export dialog, choose grouping by session or speaker, remove an entry, see the selected total size, and start generation. The page must visibly move through `Preparing…` to a stable `Ready to download` panel; generation is never represented only by an anchor download. The server produces a real ZIP from the MEDIA binding, but the browser-facing proof is the visible state. The implementation must remain truthful when an entry has no ready upload or R2 has lost an object by writing that deliverable to `manifest.txt` instead of fabricating a file.

### Parent/stacking contract

This branch was cut from `github/main` because `github/mrq-115-files-library` was not published at planning time. Before implementation, poll for the parent ref, rebase onto its tip, and then use the Files library's row shape and `is_latest`/version helper as the only current-version definition. Do not add a second attachment-version query or edit the contract documents. If MRQ-115 exposes a different file-row identifier, adapt the export request to that stable row/slot identifier so missing deliverables can still appear in `manifest.txt`; do not trust a client-supplied filename, event, or stale attachment as authority.

### Implementation steps

1. Add a small vendored ZIP-STORE encoder under `src/lib/zip-store.ts`. Use a `TransformStream` writer over sequential `MEDIA.get()` bodies, STORE method (no deflate), data descriptors for streamed CRC/size, and a central directory. Sanitize archive paths and filenames, reject unsafe/oversize inputs, and keep the encoder independent of D1 so it has direct unit coverage.
2. Add a conforming `*.routes.ts` export route (prefer a separate `src/routes/files-export.routes.ts` to keep MRQ-115's library handlers readable) at `POST /api/v1/events/{eventId}/files/export`. Require `program:read`; validate grouping and selected library row/slot IDs; resolve rows through the MRQ-115 shared query/helper; enforce event scope and latest-only server-side; calculate the displayed total from `attachments.size_bytes`; and stream `application/zip` with a safe attachment filename. Include missing/inaccessible deliverables in `manifest.txt` with human-readable session/speaker/task context. A missing R2 object becomes a manifest entry and does not turn a successful partial export into a falsely complete artifact.
3. Extend MRQ-115's Files page (and only its owned shell touchpoints after rebase) with checkboxes, a clearly named `Export selected` action, and an export dialog. Show selected entries and their size, grouping controls (`By session`, `By speaker`), per-entry deselection, and a deliberate `Generate download` action. Fetch the ZIP into a Blob/object URL so the UI can show `Preparing…` while the response is in flight and a persistent `Ready to download` panel after it resolves; expose errors with retry and preserve selection. Reserve status-panel space so elements never jump, and revoke object URLs on replacement/unmount.
4. Keep the dialog and ready panel honest: state that only latest versions are included, identify missing deliverables in the manifest, and do not claim that an export is queued in R2 when this implementation is an inline streamed generation. Use the Files page's visible noun and route so CNT-S3 discovery stays within the 70-turn budget.
5. Add targeted tests: ZIP headers/CRC/data descriptors, STORE/no-deflate behavior, path sanitization and manifest generation; export route auth/event scoping, latest-only resolution, size reporting, missing-object handling, and streamed response headers; and a focused UI/source test for selection → grouping/deselection → Preparing → Ready/error copy. Do not run the full suite under fleet load.

### Verification and lifecycle

- Before code: `git fetch github`; once MRQ-115 exists, rebase with the stacked rule and run `npm ci`.
- Commit and push this plan first from the exact worktree, then push each meaningful implementation checkpoint.
- Run only touched-file Vitest tests and TypeScript/build checks during iteration.
- Run `uptime` before `npm run pr-gate -- --ticket MRQ-117`; if one-minute load exceeds 24, wait 2–3 minutes and retry. Paste the successful gate output into the completion comment.
- Use a single fresh headless review in inline-full mode or complete the adversarial review inline; attach a PASS artifact naming the exact HEAD. Validate the route with a running local Worker/curl and the browser state if the parent surface is runnable, recording validation evidence before `pr_open`.
- Open the PR against `main` with the body text `stacked on MRQ-115 — merge that first; this rebases.` and cite CNT-14, CNT-S3, and register row 29. Stop at `pr_open`; a human merges.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Self-review PASS: the plan keeps the visible Preparing→Ready artifact as the primary rubric surface, avoids a bare download-only implementation, and makes the server authoritative for event scope and latest-only selection.
- Self-review PASS: it explicitly defers the parent-specific row/helper names until MRQ-115 is published, preventing a parallel `is_latest` definition or a collision with its selection surface.
- Self-review PASS: it treats missing deliverables and missing R2 objects as manifest entries, uses STORE streaming to control Worker CPU, and reserves UI status space per the cross-cutting rules.

## Reset 2026-08-12 by agent:delegator-mrq-117

## Reset 2026-08-12 by agent:delegator-mrq-117

## Reset 2026-08-12 by agent:delegator-mrq-117

## Reset 2026-08-12 by agent:delegator-mrq-117

## Reset 2026-08-12 by agent:delegator-mrq-117

## Reset 2026-08-12 by agent:delegator-mrq-117

## Reset 2026-08-12 by agent:delegator-mrq-117

## Reset 2026-08-12 by agent:delegator-mrq-117
