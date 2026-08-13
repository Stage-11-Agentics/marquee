# Code Review: MRQ-117 — Bulk ZIP export of deliverables

**Reviewed HEAD:** `49b795c` (`mrq-117-zip-export`, stacked on `d5708c8` = MRQ-115)
**Worktree:** `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-117-zip-export`

**Verification actually run by this reviewer**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/unit/zip-store.test.ts tests/integration/api/files-export.MRQ-117.test.ts` | 2 files / 5 tests passed (12.5s) |
| `npm run check:api` | **exit 1** — `cli-registry-parity` + `cli-registry-hash-mismatch` |

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the architecture follows it. The branch cannot open a green PR today (`check:api` is a required `pr-gate` step and it exits 1), and there are four substantive defects on top of that — two server-side scale/streaming bugs and two UI-honesty bugs. All are local fixes; nothing requires re-planning.

## 2. Summary

Reviewed the vendored ZIP-STORE encoder, the `POST /api/v1/events/{eventId}/files/export` route, the `BulkExportDialog` + `FilesPage` wiring, and the three test files. The encoder is genuinely good work — correct local/central/EOCD field order, data descriptors, path sanitization, and a real streaming shape — and the route correctly treats MRQ-115's pointer-derived `is_latest` as the only definition of current, with missing bytes becoming `manifest.txt` lines rather than fabricated files. The key findings: the PR gate is red because `cli/api-registry.json` was never regenerated for the new operation; both new D1 queries bind up to 201 parameters where the repo's own helpers deliberately chunk at 80; every R2 object is opened *before* the response is returned, which defeats the streaming design the ticket exists to get; and the Ready panel keeps serving a stale archive (under a filename claiming the *new* grouping) after the operator changes grouping or removes an entry.

## 3. Issues

**[CRITICAL] cli/api-registry.json — the PR gate fails: the new operation was never registered**

`npm run check:api` exits 1 on this HEAD:

```
"code": "cli-registry-parity",
"missing": [
  "GET  /api/v1/events/{eventId}/files          listConferenceFiles",
  "POST /api/v1/events/{eventId}/files/export   exportDeliverableFiles"
],
"code": "cli-registry-hash-mismatch"
```

`scripts/checks/pr-gate.mjs:17` runs `check:api` as the "API contract" step, so `npm run pr-gate -- --ticket MRQ-117` cannot pass — and the plan's lifecycle section requires pasting successful gate output into the completion comment. `git log -- cli/api-registry.json` shows every route-adding PR on `main` regenerates this file; this branch (and its parent) skipped it.
**Fix:** run `node cli/generate-api-registry.mjs` and commit `cli/api-registry.json`. It picks up both `exportDeliverableFiles` and the parent's `listConferenceFiles`; after the rebase onto MRQ-115 that is the correct single regeneration. Re-run `npm run check:api` to confirm exit 0 before `pr_open`.

---

**[MAJOR] src/routes/files-export.routes.ts:108, :117 — up to 201 bound parameters per D1 query; "Select all" breaks in production and cannot break in tests**

`task_ids` is capped at 200 (line 37), and both queries expand it inline: `taskRowsFor` binds `eventId` + up to 200 ids (line 108/110), `attachmentObjectsFor` the same (line 117). D1 caps bound parameters per statement well below that — which this codebase already knows and encodes twice, in the module this route depends on:

- `src/lib/files/versions.ts:75-76` — *"D1's bind limit is finite… chunking keeps them safe as they grow"*, `OWNER_CHUNK = 80`
- `src/lib/reviewer-scope.ts:186-188` — same comment, same 80

The Files page has a "Select all shown deliverables" checkbox (`FilesPage.tsx:206`) over an unpaginated library, so a real conference reaches 100+ selections on one click. Miniflare's SQLite has a variable limit in the tens of thousands, so no local test can ever catch this — the integration test uses two ids.
**Fix:** chunk both queries at 80 the way `versions.ts` does (reuse the `chunked` shape), and merge the result sets. Keep the `!== taskIds.length` completeness check against the *total* across chunks. Consider lowering the zod `max(200)` only if you also give the UI a clear "too many selected" message — chunking is the real fix.

---

**[MAJOR] src/routes/files-export.routes.ts:159-175 — every R2 object is opened before the response is returned, defeating the streaming design**

The loop `await env.MEDIA.get(...)` runs to completion for all rows *before* `createZipStoreStream` is called at line 178. Consequences: TTFB is the sum of N sequential R2 round trips (100 files ≈ 100 serial RTTs before a single byte reaches the client); N `R2ObjectBody` streams sit open and unread while the writer drains them one at a time; and if the writer aborts mid-archive, the remaining bodies are never cancelled. The plan asked for "a `TransformStream` writer over sequential `MEDIA.get()` bodies" — i.e. fetch each body when the writer reaches it.

`writeZipStore` already accepts `AsyncIterable<ZipStoreEntry>` (`zip-store.ts:290`) and that capability is currently unused — the fix is exactly what the type was designed for.
**Fix:** resolve the D1 rows and the manifest eagerly (cheap, metadata only), then pass an async generator as `entries` that does the `MEDIA.get()` per row at yield time. Missing-object rows still need to reach `manifest.txt`, so either (a) do a cheap `MEDIA.head()` pass to build the manifest up front and `get()` lazily, or (b) move `manifest.txt` to the end of the generator and append late-discovered misses — the encoder already writes the manifest last (line 332), so (b) is a small change. Cancel the remaining bodies in a `finally` when the writer aborts.

---

**[MAJOR] src/ui/files/BulkExportDialog.tsx:92-93, 105 — the Ready panel serves a stale archive under a filename that claims the new grouping**

Nothing resets `state`/`downloadUrl` when the operator changes grouping or removes an entry. Concrete failure: generate with **Session** → panel shows "Ready to download" → click **Speaker** → the panel still says Ready, the link still points at the session-grouped blob, and `download={\`deliverables-${grouping}.zip\`}` (line 105) now names it `deliverables-speaker.zip`. The operator opens a file labelled speaker-grouped and finds session folders. Same for removing an entry after generating: the removed deliverable is still inside the ZIP the panel offers.

This is precisely the honesty property the ticket is built around ("the scored artifact is the visible state") — the visible state is wrong.
**Fix:** invalidate on input change. In the `setGrouping` handlers and the Remove handler, if `state === "ready"`, revoke `downloadUrl`, `setDownloadUrl(null)`, `setState("idle")` — or add a `useEffect` keyed on `[grouping, removed]` that does it. Reserve the panel height so the idle↔ready swap still doesn't move anything (the CSS `min-height: 78px` already covers this).

---

**[MAJOR] src/ui/files/BulkExportDialog.tsx:27-32, 69, 73-75 — the error message is computed, thrown, and discarded; a 401 shows the wrong sentence forever**

`responseMessage(response)` produces two carefully written sentences, including the one that actually helps ("…is no longer available. Refresh the Files library and try again."). Line 69 wraps it in an `Error`, line 73 catches it into an unused `error` binding, and the render (line 106) prints a fixed string: *"Export unavailable / The archive was not created."* The 404 guidance never reaches a human, and `responseMessage` is effectively dead code.

Compounding it: this is a raw `fetch`, so it bypasses everything `src/ui/shell/api-client.ts` exists for — the error envelope, the `request_id` the operator is meant to be able to quote, and the `forbidden` listener that drives session recovery. An expired session (401) renders as "The archive could not be generated… try again", and retrying will never work. Using raw `fetch` is *correct* here (`apiFetch` always parses JSON and this is a blob) — reusing the envelope parsing is what's missing.
**Fix:** add a `message` field to the error state and render it. On `!response.ok`, parse the JSON envelope (`{ error: { code, message }, request_id }`) and map through the existing `ERROR_TREATMENTS` taxonomy, or export a small `blobFetch`/`readErrorEnvelope` helper from `api-client.ts` so the dialog gets the sentence, the recovery line, the request id, and the `forbidden` listener for free.

---

**[MINOR] src/routes/files-export.routes.ts:208, :132, :134 — `as never` casts disable the type-check `defineApiRoute` exists to enforce**

`src/api/route.ts:1-10` states the invariant explicitly: *"the handler is type-checked against the route's own request/response schemas, so a handler that returns a shape the document does not declare fails at compile time rather than at parity."* `handleExport as never` (line 208) waives that, and it also forces `context.req.valid("param" as never)` / `("json" as never)` with hand-written result types (lines 132, 134) — so `ExportRequest` (line 43) is a second, unchecked restatement of the zod schema at line 36 that can silently drift from it. A stream response genuinely isn't expressible in `RouteHandler`'s `TypedResponse`, so *a* cast is needed; it's currently far wider than necessary.
**Fix:** type the handler as `(context: Context<ApiEnv>) => Promise<Response>` and keep the single narrow cast at registration; derive the request type with `z.infer<typeof exportRequest>` instead of restating it; and cast `context.req.valid("param")`/`("json")` results to the inferred types rather than to hand-written interfaces.

---

**[MINOR] tests — the ticket's headline naming requirement is never exercised**

The fixture creates no `agenda_items` row, so `sessionFolder` (line ~74) always takes the `starts_at === null` branch and yields `Unscheduled_Priya_Raman`. That means the requirement stated in the ticket — folder names humans use, `Thu-1400-Room_Speaker/` — has **zero** coverage: the `Intl.DateTimeFormat` path, the `h23` hour cycle, the event-timezone handling, and the room segment are all untested. `grouping: "speaker"` (the two-level `Speaker/Session/file` path) is also untested, and `latestFor`'s comment claims it exists for the case where the pointer names an *older* upload, which the fixture never sets up.
**Fix:** add an `agenda_items` row (+ `rooms`) to the fixture and assert the archive contains `Thu-1400-<Room>_Priya_Raman/latest.pdf`; add a `grouping: "speaker"` case asserting the nested path; and add a case where `speaker_tasks.attachment_id` points at `OLD_ATTACHMENT_ID` while a newer ready attachment exists, asserting `old.pdf` is included and `latest.pdf` is not. (I verified the Node-side formatting produces `Mon-1400-Room_Speaker` for a known instant — it's the Workers-runtime path and the wiring that are unproven.)

---

**[MINOR] src/lib/zip-store.ts:48 — per-byte `for...of` in the one CPU-bound loop**

`for (const byte of bytes)` pays iterator-protocol cost per byte on the only hot loop in a ticket whose thesis is "decks are pre-compressed; CPU is the billed budget". Over a few hundred MB of decks this is the dominant Worker CPU cost, and it's free to remove.
**Fix:** `for (let i = 0; i < bytes.length; i += 1) value = crcTable[(value ^ bytes[i]!) & 0xff]! ^ (value >>> 8);`

---

**[MINOR] src/lib/zip-store.ts:163, :175 — no zip64: a >4 GiB export aborts mid-stream after the operator has waited**

`write()` throws "ZIP archive is too large" once `offset` passes `UINT32_MAX`, mid-archive — the client sees a failed fetch and the generic error panel, with no explanation and no way to know a smaller selection would work. The dialog already knows the total from `attachments.size_bytes` before generating, so this is checkable up front. (200 decks × 25 MB is 5 GB; this is reachable, not theoretical.)
**Fix:** sum `size_bytes` server-side and return a 422 with a clear message ("this selection is larger than a single archive can hold — export it in two passes") before streaming a byte; optionally surface a warning in the dialog when the displayed total approaches 4 GiB.

---

**[MINOR] src/ui/files/BulkExportDialog.tsx:71 — the whole archive is buffered into browser memory as a Blob**

`await response.blob()` holds the entire multi-GB archive in the tab. The Blob is required by the plan (it's what makes the persistent Ready panel possible), so this is a deliberate trade — but it's undefended, and pairs with the previous finding.
**Fix:** at minimum, gate on the same pre-checked total. Long term, `showSaveFilePicker` + a piped stream gives the same visible Ready state without buffering.

---

**[MINOR] src/routes/files-export.routes.ts:202 — `read` rate bucket (600/min) for a multi-GB streamed archive**

`RATE_BUCKET_DEFAULTS.read` is 600/minute (`src/api/rate-limit.ts:26-30`). This operation opens N R2 objects and streams gigabytes; `import` (12/min) is the bucket whose shape matches. The grant (`program:read`) is right.
**Fix:** `rateLimit: { bucket: "import" }`.

---

**[MINOR] src/ui/files/BulkExportDialog.tsx:56 — no Escape-to-close, no focus management, unlike every other overlay**

Four overlays in `src/ui` bind Escape (`shell/OverlayHosts.tsx:19`, `shell/identity.tsx:78`, `review/ReviewerPage.tsx:317`, `onboarding/OnboardingPage.tsx:212`). This dialog declares `role="dialog" aria-modal="true"` and offers only the × button and a backdrop click. Nothing moves focus into the dialog on open or restores it on close.
**Fix:** add a `keydown` listener calling `close()` on Escape (it already no-ops while `preparing`), and focus the dialog heading or the close button on open.

---

**[MINOR] src/ui/files/BulkExportDialog.tsx:46-53 — stale closure in the `[open]` effect; and `MEDIA_PUBLIC_ORIGIN` read without the sibling route's guard**

The close-reset effect reads `downloadUrl` but doesn't list it as a dependency, so on close it sees the value from the render where `open` last flipped (always `null`). It happens to be harmless today — `setDownloadUrl(null)` triggers the `[downloadUrl]` cleanup, which does the revoke — but the revoke on line 49 is dead code and the next edit here will leak. Separately, `files-export.routes.ts:141` passes `env.MEDIA_PUBLIC_ORIGIN` straight into `listVersionsForOwners`, where `publicMediaUrl` calls `.replace()` on it (`src/lib/r2/keys.ts:33`); the sibling route guards with `?? ""` (`files.routes.ts:22`) and this one doesn't. The var is set in `wrangler.jsonc:103`, so this is consistency, not a live break.
**Fix:** add `downloadUrl` to the dependency array (or drop the now-dead revoke and rely on the `[downloadUrl]` cleanup); mirror the `?? ""` guard.

---

**[MINOR] src/routes/files-export.routes.ts:176 — export filename dated in UTC while folder names use the event timezone**

`new Date().toISOString().slice(0, 10)` is UTC; `sessionFolder` correctly uses `row.timezone`. An export generated Thursday evening in New York is filed as Friday.
**Fix:** format the date with the same `Intl.DateTimeFormat` + event timezone already in the module.

## 4. Positive Observations

- **The encoder is the strong part of this change.** Local header, data descriptor, central directory, and EOCD field orders are all correct on inspection (I walked each byte layout); the `DATA_DESCRIPTOR_FLAG` / method-0 assertions in `tests/unit/zip-store.test.ts` check the bytes at the right offsets rather than trusting the writer; and CRC continuation across chunks is tested against a whole-buffer CRC, which is the property that actually matters for streamed bodies.
- **Path safety is defended twice, independently.** `safeSegment` in the route (character class + leading/trailing-dot strip + length cap) and `utf8Path` in the encoder (`..`/`.`/empty segment filter, control-char scrub) don't rely on each other, and `uniquePath` handles the collision that sanitization inevitably creates. The `"../speaker/../slides.pdf"` test proves it rather than asserting it.
- **The latest-only contract is honoured properly.** `latestFor` refuses `versions[0]` and finds `is_latest`, with a comment naming the exact scenario (`files-export.routes.ts:120-124`) — that is the one thing the ticket said would make the human manual check fail while the UI looks right, and it was got right. The route consumes MRQ-115's helper rather than writing a second version query, exactly as the stacking contract required.
- **Truthfulness under partial failure is real, not claimed.** Four distinct manifest reasons (no upload / record unavailable / bytes unavailable / no readable body), plus the R2 etag comparison at line 168 that catches a silently replaced object. The integration test asserts the missing deliverable's *title* and reason appear in the archive — behaviour, not implementation.
- **Server-side authority throughout.** Event scope in SQL on both queries, `program:read` grant, no client-supplied filenames or attachment ids trusted, and a cross-event id returning 404 with a test that proves it.
- **The UI honours the cross-cutting rules.** `aria-live="polite"` status region that is always mounted, `min-height: 78px` reserved so the idle→preparing→ready swap doesn't move the footer, tabular numerals on sizes, and Close/Generate disabled (not hidden) while preparing. Copy is in the organizer's language and states the latest-only and manifest.txt facts plainly.
