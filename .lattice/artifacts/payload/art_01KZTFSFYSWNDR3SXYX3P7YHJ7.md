# Code Review: MRQ-117 — Bulk ZIP export of deliverables

**Reviewed HEAD:** `3eb44c9` (worktree `Marquee-worktrees/mrq-117-zip-export`, branch `mrq-117-zip-export`, rebased onto `d5708c8` = MRQ-115)
**Independent verification run during this review:**

- `npx tsc --noEmit -p tsconfig.json` → **exit 0**
- `npx vitest run tests/unit/zip-store.test.ts tests/integration/api/files-export.MRQ-117.test.ts` → **2 files, 6 tests, all passed (6.27s)**
- Machine one-minute load at review time: **47.98** (fleet-heavy; full suite deliberately not run, per the plan and CLAUDE.md)

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the architecture is right. Two user-facing defects on plausible operator paths need fixing before the PR opens; both are small, well-scoped changes to files this ticket already owns. Everything else below is minor.

## 2. Summary

I reviewed the vendored ZIP-STORE encoder, the new `POST /api/v1/events/{eventId}/files/export` route, the `BulkExportDialog` surface and its mount on MRQ-115's Files page, plus the three new test files. The core is genuinely good: the encoder's local-header/data-descriptor/central-directory layout is correct byte-for-byte, latest-only resolution goes through MRQ-115's pointer-derived `is_latest` rather than a second definition (verified against `src/lib/files/versions.ts`), event scope is enforced on both the task query and the attachment-object query, and missing deliverables become `manifest.txt` lines instead of fabricated files — which is exactly the honesty the ticket asked for. The visible `Preparing… → Ready to download` panel is real state, not an anchor click, so the CNT-S3 step-13 rubric surface exists.

The key finding is a scale mismatch the two halves don't agree on: the export route caps a selection at 200 ids while the Files library it selects from returns **every** row for the event with no `LIMIT`, so one click on "Select all shown" at conference scale produces a 400 carrying a raw Zod string. Second: while `Preparing…`, every exit from the dialog is disabled and the fetch has no `AbortController`, so a stalled or multi-gigabyte export strands the operator with a page reload as the only way out.

## 3. Issues

**[MAJOR] src/routes/files-export.routes.ts:37 — the 200-id cap is smaller than the list it selects from, and its failure is a raw Zod string**
`task_ids` is `z.array(...).min(1).max(200)`, but `src/routes/files.queries.ts` has no `LIMIT` anywhere — the Files library renders every file-task row for the event, and `FilesPage.tsx:204` offers a single "Select all shown" checkbox over all of them. At AIE-NYC scale (hundreds of speakers × file tasks per speaker) select-all trivially exceeds 200. The request then fails validation in the router's `defaultHook`, and `BulkExportDialog.responseMessage` has no 400 branch, so it falls through to `apiMessage` and prints Zod's own sentence ("Too big: expected array to have <=200 items") into an operator-facing panel. Nothing in the dialog warns before the click, and nothing in the copy states a limit.
**Fix:** enforce the cap where the operator can see it. In `BulkExportDialog`, define `const MAX_EXPORT = 200`, disable `Generate download` when `selected.length > MAX_EXPORT`, and put a plain sentence in the footer note ("Export up to 200 deliverables at a time — 240 selected. Remove some, or export in two passes."). Add a 400 branch in `responseMessage` that says the same thing rather than relaying the validator. Alternatively raise the server cap and let the route chunk, but the visible client-side guard is the part that matters.

**[MAJOR] src/ui/files/BulkExportDialog.tsx:67-70,112-117 — `Preparing…` is an inescapable state with no abort**
`close()` returns early whenever `state === "preparing"`, and the close button (`:132`), Cancel (`:155`), the Escape handler (`:78`) and the backdrop click (`:128`) all route through it. The `fetch` at `:112` carries no `signal`. A large selection streaming multi-hundred-megabyte bodies through R2, or a single stalled object read, therefore leaves every exit dead — the dialog can only be escaped by reloading the page, which also loses the table selection. This is the operator-trap pattern the org has an explicit standing ruling about, and it costs one hook to avoid.
**Fix:** hold an `AbortController` in a ref; pass `signal` to the fetch; let `close()` abort the in-flight request and reset to `idle` instead of returning early. Keep Cancel enabled during `preparing` (relabel it "Stop" if you want the intent explicit), and treat `AbortError` in the catch as a return to `idle` rather than an error state.

**[MINOR] src/routes/files-export.routes.ts:59 — filename truncation can eat the extension**
`safeSegment` ends with `.slice(0, 96)`. A deliverable named `Building_a_Multi_Agent_Retrieval_Pipeline_Without_Losing_Your_Mind_final_v7_reviewed.pdf` (>96 chars) is cut mid-name, and the extracted file loses `.pdf` — it no longer opens by double-click, which is the whole point of a human-usable archive. Folder segments are unaffected in practice, but filenames are the common long case.
**Fix:** truncate the stem, not the string. In `archivePath`, split the extension off first, `safeSegment` the stem to `96 - extension.length`, then re-append the sanitized extension.

**[MINOR] src/routes/files-export.routes.ts:46 — the size guard is the ZIP-format limit, not the platform limit**
`MAX_ZIP_BYTES` is ~4 GB minus 4 MB, i.e. the point at which the non-ZIP64 central directory would overflow. But `crc32` (`src/lib/zip-store.ts:214`) walks the payload one byte at a time in JS, which is the dominant CPU cost of this route — STORE removed deflate, not the CRC. A multi-gigabyte selection will exhaust the Worker's CPU budget mid-stream, and because headers are already sent the operator gets a truncated archive under a `200` rather than the actionable 422 the smaller path produces.
**Fix:** set the guard from what the platform can actually finish (a low-GB ceiling is a defensible starting point) rather than from the format ceiling, and say so in a comment so the number reads as deliberate. Optionally read four bytes per iteration in `crc32` to buy headroom.

**[MINOR] tests/integration/api/files-export.MRQ-117.test.ts:128-132 — the cross-event test does not test cross-event**
The test name claims event-scope enforcement, but the 404 assertion at `:131` uses the literal id `"task-from-another-event"`, which simply does not exist. `EVENT_OTHER_ID` is seeded at `:57` and never given a task, so the branch that actually matters — a **real** file task belonging to another event of the same org, requested through this event's URL — is never exercised. The route is correct (`WHERE task.event_id = ?` plus the `event_id`-scoped attachment query), but this is the security boundary the ticket introduced and it is currently unproven.
**Fix:** insert a `speaker_tasks` row under `EVENT_OTHER_ID` (with its own person/template) and assert that requesting it via `/events/${EVENT_ID}/files/export` returns 404 — and, ideally, that a mixed selection of one valid and one foreign id returns 404 rather than a partial archive.

**[MINOR] tests/integration/api/files-export.MRQ-117.test.ts — plan-required missing-object coverage is absent**
Plan step 5 called for "missing-object handling". Only the `no completed upload` manifest branch is covered. The two branches that encode the ticket's central honesty claim — a lost R2 object and an etag mismatch, both producing `the latest upload bytes are unavailable` (`files-export.routes.ts:190`) — have no test, so a regression that silently drops a file from the archive without a manifest line would pass green.
**Fix:** after the fixture setup, `await env.MEDIA.delete(...)` the latest attachment's key and assert both that the archive is still a 200 and that it contains `the latest upload bytes are unavailable` for that deliverable. A second case updating `r2_etag` to a bogus value covers the mismatch branch.

**[MINOR] src/ui/files/BulkExportDialog.tsx:155 and src/ui/files/FilesPage.tsx:153 — relabeling buttons change width**
The footer primary cycles "Generate download" → "Preparing…" → "Try again" with no reserved width, and the header action reads "Download files (1)" → "(10)" → "(100)". Both shift the elements beside them on state change, against the standing elements-never-jump rule. The status panel gets this right (`export.css` reserves `min-height: 78px`), so the omission reads as an oversight rather than a decision.
**Fix:** give `.files-export-foot > div button` a `min-width` sized to the longest label, and apply the existing `tabular` treatment (or a fixed min-width) to the header count.

**[MINOR] src/ui/files/BulkExportDialog.tsx:27-41 — bespoke error copy bypasses the shared taxonomy and drops the reference code**
`apiFetch` genuinely cannot be used here (it always parses JSON), so a direct `fetch` is the right call. But `responseMessage` then re-invents error wording that `ERROR_TREATMENTS`/`errorSummary` already own, and never reads `X-Request-Id`. The api-client module's whole stated doctrine is that every error surface prints a quotable reference — this panel is the one place in the Files feature where an operator hits a failure and gets nothing to quote.
**Fix:** parse the envelope into a `MarqueeApiError` (or at minimum read the `X-Request-Id` header and append `· ref ${referenceCode(id)}`) and render through `errorSummary`, keeping only the export-specific 422 sentence as an override.

**[MINOR] src/ui/files/BulkExportDialog.tsx:150 — the anchor discards the server's filename**
The route composes a dated `Content-Disposition` (`deliverables-session-2026-08-12.zip`), but because the href is a `blob:` URL the anchor's `download={`deliverables-${grouping}.zip`}` wins, so the date never reaches the operator's Downloads folder and two exports on different days collide as `deliverables-session (1).zip`.
**Fix:** parse the filename out of the response's `Content-Disposition` header and store it alongside the object URL, falling back to the current literal.

## 4. Positive Observations

- **The encoder is correct, not merely plausible.** Local headers, the `0x0008` data-descriptor flag, descriptor ordering (`sig, crc, csize, usize`), the central-directory field sequence and the EOCD are all laid out to spec, and `crc32`'s running-state form is verified by a test that composes two chunks against a single-shot digest. Reading it against the ZIP spec, I found nothing to correct.
- **`latestFor` (`files-export.routes.ts:138`) is the single most important line in the ticket and it is right** — it resolves through MRQ-115's `is_latest`, with a comment explaining precisely why `versions[0]` would be wrong. The test at `:117` that repoints `speaker_tasks.attachment_id` at the *older* attachment and asserts the archive follows the pointer is the correct adversarial case, and it proves the "one shared definition of current" requirement rather than asserting it.
- **The event boundary is enforced twice**, on the task query and independently on the attachment-object lookup, so a cross-event attachment pointer degrades into a manifest line rather than a leak. The `r2_etag` comparison matches the established convention in `src/lib/r2/serve.ts` exactly.
- **Streaming discipline is careful:** the R2 body reader is cancelled in a `finally` on every abrupt exit, the manifest array is mutated by the generator and read only after the loop drains (subtle, but correct by construction), and backpressure flows through the `TransformStream` writer rather than buffering.
- **The 422 for oversized selections is thrown before any bytes are written**, so that failure arrives as an actionable envelope instead of a truncated download — the right instinct, and the reason issue #4 above is only a matter of picking a better number.
- **The manifest reasons are written in the organizer's language** ("no completed upload", "the latest upload bytes are unavailable") and carry session/speaker/task context, and the Ready panel states plainly that only current versions are included and that gaps live in `manifest.txt`. The route makes no claim about queuing in R2. That is the honesty the plan asked for, delivered.
- **Repo conventions are followed without prompting:** `*.routes.ts` with the `apiRoutes` export for glob discovery, `z.any()` for a binary response body (matching `uploads.routes.ts`), a regenerated `cli/api-registry.json` carrying both the parent's and this ticket's operations, and a `tests/node` source-assertion test in the same shape as the existing `*-ui` tests.

## 5. Notes (not blocking)

- The dialog has no focus trap and does not restore focus to the trigger on close. I checked `QuickSearch`, `OverlayHosts`, `AcceptanceReversalPanel` and `ReviewerPage` — none of the existing `aria-modal` surfaces do either, so this is consistent with the codebase and belongs in a cross-cutting a11y ticket, not this one.
- Entries removed inside the dialog are not reflected back into the Files table's checkbox state, and reopening the dialog restores them. Defensible as a scoped edit; worth one sentence of confirmation from the operator if it comes up in validation.
- The plan required pasting successful `npm run pr-gate -- --ticket MRQ-117` output into the completion comment. I found no gate output in the task's event stream. `tsc` and the two new test files pass under my own run, but the gate itself (`check:api`, `check:design`, `check:repo`, the full suite) remains unevidenced and should be run and pasted before `pr_open` — noting that one-minute load was 47.98 during this review, so it will need a quieter window.
