# Code Review: MRQ-117 — Bulk ZIP export of deliverables

**Reviewer:** independent (cold context)
**Worktree:** `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-117-zip-export`
**HEAD reviewed:** `21a1ded` — *MRQ-117 make export limits and cancellation honest*
**Base / merge-base:** `fd977f1` (MRQ-113, #72)

## 1. Verdict

**FAIL (implementation-level)**

The design is sound and the feature itself is well built. One committed artifact
regression makes `npm run pr-gate` red at this HEAD and silently deletes a shipped
operation from the CLI contract, which is a hard blocker. Everything else is
polish-grade.

## 2. Summary

I reviewed the vendored ZIP-STORE encoder, the new `POST /api/v1/events/{eventId}/files/export`
route, the Preact export dialog and its Files-page mount, and the three new test files.
The core mechanism is genuinely good: correct ZIP local/central/EOCD field layout,
event-scoped and pointer-derived latest-only resolution that reuses MRQ-115's single
`is_latest` definition rather than forking a second one, and a manifest that stays
honest when bytes are gone. `npx tsc --noEmit` is clean and the three new test files
pass in 2.9 s.

The blocking finding is `cli/api-registry.json`: commit `e5b04e5` regenerated it from a
`dist/` bundle built *before* the rebase, which dropped `inviteSpeakersToPortal` (MRQ-113's
route, still present in `src/routes/speaker-invites.routes.ts`) and left a stale
`documentSha256`. I rebuilt the Worker and ran `check:api` — it fails at HEAD. Because
`check:api` reuses an existing `dist/` instead of rebuilding, a stale build is exactly
how this passed the gate locally.

**Verification performed:** `npx vite build` (clean), `npx tsc --noEmit` (clean),
`npx vitest run tests/unit/zip-store.test.ts tests/integration/api/files-export.MRQ-117.test.ts`
(7/7 pass, 2.9 s), `node scripts/checks/check-api.mjs` (**fail**, output below),
`npm run check:design` (pass). I regenerated `dist/` and `artifacts/checks/` in the
worktree; both are gitignored, so nothing tracked was touched.

## 3. Issues

**[CRITICAL] cli/api-registry.json:3 — a shipped operation was deleted from the registry and the document hash is stale; `pr-gate` is red**

The diff removes `POST /api/v1/events/{eventId}/speakers/invite inviteSpeakersToPortal`
from the operations list while `src/routes/speaker-invites.routes.ts:32` still declares
that operationId and the route is still discovered by the `import.meta.glob` manifest.
`cli/generate-api-registry.mjs` reads the *built* `dist/marquee/index.js`, and
`scripts/checks/check-api.mjs` only builds when `dist/` is absent — so the registry was
regenerated from the 03:57 bundle that predated the rebase onto MRQ-113. `npm run pr-gate`
runs `check:api` (`scripts/checks/pr-gate.mjs:18`), so this fails the gate on any clean
checkout. Verified after a fresh `npx vite build`:

```json
"findings": [
  { "code": "cli-registry-parity",
    "missing": ["POST /api/v1/events/{eventId}/speakers/invite inviteSpeakersToPortal"],
    "extra": [] },
  { "code": "cli-registry-hash-mismatch",
    "served":   "dac3a55784b1797d77301dbd01267a9f8d081ab1be3d496373a6360f1488e1bb",
    "registry": "08d0f4828d0e8a763bfbfb6860b8638e07e59918a285f01ca6cb4eee832b5817" }
]
```

Beyond the red gate, the registry is the CLI's contract surface: shipping it minus an
operation means the CLI stops knowing about speaker portal invites.

**Fix:** `npx vite build && node cli/generate-api-registry.mjs`, then commit the result.
The regenerated file should contain 2 additions (`listConferenceFiles`,
`exportDeliverableFiles`), 0 removals, and `documentSha256`
`dac3a55784b1797d77301dbd01267a9f8d081ab1be3d496373a6360f1488e1bb`. Re-run
`npm run pr-gate -- --ticket MRQ-117` and paste the passing output; the previously
recorded gate result was produced against a stale bundle and should not be trusted.

---

**[MAJOR] src/ui/files/BulkExportDialog.tsx:128 — `Preparing…` has no minimum dwell, so the ticket's named visible state can be unobservable**

The ticket is explicit that the scored artifact is the visible state and names the
sequence `multi-select → dialog → visible Preparing → Ready panel`. `setState("preparing")`
is cleared as soon as `response.blob()` resolves. On the demo dataset — a handful of
small PDFs streamed STORE from R2 — that round trip is well under the interval between a
click and a screenshot, so a scoring agent can go straight from click to `Ready to
download` and never capture `Preparing…`. The state exists in the code and is still
effectively invisible, which is the exact failure mode the ticket was written against.

**Fix:** floor the preparing state — capture a start timestamp before the fetch and
`await` the remainder of a ~600 ms minimum before transitioning to `ready` (keep the
error path immediate). This costs nothing on large exports and makes the transition
reliably observable on small ones.

---

**[MAJOR] tests/node/files-export-ui.MRQ-117.test.mjs:11 — the dialog's state machine has no behavioural coverage; the assertions test source text and constant values**

Regex-over-source node tests are an established pattern in this repo
(`api-tokens-ui.AC-106`, `comms-ui.AC-128-131-250`, `empty-state.AC-161`), so the *form*
is fine — but these particular assertions do not pin behaviour:

- `assert.match(dialog, /MAX_EXPORT_ITEMS = 200/)` and `assert.match(route, /QUERY_CHUNK_SIZE = 80/)`
  break on a harmless retune and prove nothing about the limit being enforced.
- `assert.match(dialog, /By session|Session/)` and `/By speaker|Speaker/` — the
  alternation's right branch matches incidental text, so both are near-vacuous.
- `assert.match(dialog, /MAX_EXPORT_ITEMS/)` is asserted twice (lines 22 and 24).

Nothing anywhere exercises selection → grouping change → `Preparing` → `Ready`/error, or
that changing grouping invalidates a generated URL. Given that the visible transition
*is* the deliverable, that is the one path most worth a test.

**Fix:** drop the constant-value and alternation assertions; assert the enforcement
instead (the disabled condition, the `>200` footer copy, the invalidate-on-grouping-change
call). If a real transition test is wanted, the integration suite can already drive the
route — a small Playwright spec under `npm run e2e` covering click → Preparing → Ready
would close it properly.

---

**[MINOR] src/routes/files-export.routes.ts:55,66 — `safeSegment`/`safeFilename` re-implement the existing `sanitizeFilename`**

`src/lib/r2/policy.ts:184` already provides `sanitizeFilename` with near-identical
semantics (`/[^A-Za-z0-9._ -]/g` → `_`, leading-dot strip, length clamp, non-empty
fallback), and it is what `src/lib/r2/serve.ts:37,70` uses for every other
`Content-Disposition` in the product. Two sanitizers means two places to fix the next
filename that gets through.

**Fix:** use `sanitizeFilename` for the leaf filename and keep only `safeSegment` — which
is genuinely different, since it produces a *path segment* — with a comment saying so.

---

**[MINOR] src/routes/files-export.routes.ts:104 — `chunks()` duplicates `chunked()` in `src/lib/files/versions.ts:89`**

Same function, same chunk size intent (`QUERY_CHUNK_SIZE = 80` vs `OWNER_CHUNK = 80`),
two copies in files this route already imports across.

**Fix:** export `chunked` from `src/lib/files/versions.ts` (or a small shared util) and
import it here.

---

**[MINOR] src/routes/files-export.routes.ts:49 / src/ui/files/BulkExportDialog.tsx:20-21 — the 1 GiB and 200-item caps are duplicated client and server with nothing binding them**

`MAX_ZIP_BYTES` and `MAX_EXPORT_BYTES` are both `1024 * 1024 * 1024`; `MAX_EXPORT_ITEMS = 200`
mirrors the zod `.max(200)`. When one moves the other silently disagrees, and the client
copy is what produces the pre-flight refusal copy the operator reads.

**Fix:** define both in one module (e.g. `src/lib/files/export-limits.ts`) and import
from the route, the zod schema, and the dialog.

---

**[MINOR] src/ui/files/BulkExportDialog.tsx:120 — an in-flight export is not aborted when the dialog stops rendering**

`close()` correctly aborts while `state === "preparing"`, but the component returns `null`
on `!open` without unmount cleanup for `abortRef`. Any future parent-driven close (route
change, a second entry point) leaves a potentially gigabyte-sized fetch running, and when
it resolves it calls `URL.createObjectURL` on a dialog nobody can see — a blob URL held
until the next `downloadUrl` change. Not reachable today, since `onClose` is only ever
called from `close()`.

**Fix:** add `useEffect(() => () => abortRef.current?.abort(), [])`, and abort in the
existing `!open` reset effect.

---

**[MINOR] src/routes/files-export.routes.ts:39,162 — two unreachable guards**

`exportParams` declares `eventId: z.string().min(1)`, so `if (!eventId) throw ApiError.badRequest(...)`
at line 162 cannot fire. Likewise the schema's `.refine` rejects duplicate `task_ids`, and
the handler then re-dedupes with `[...new Set(request.task_ids)]` at line 169. Both are
harmless, but the second one hides which layer owns the rule.

**Fix:** drop the `!eventId` guard (or keep it and note it is a type narrower, not a
runtime check), and pick one owner for de-duplication — the schema reads as the right one.

---

**[MINOR] src/ui/files/FilesPage.tsx:156 — raw `<button class="button primary">` where the shared `Button` is already imported**

The file imports `Button` on line 18 and uses it elsewhere; the export action hand-writes
the class string `Button` would produce. It renders identically today and drifts the first
time `Button` gains a prop.

**Fix:** `<Button variant="primary" disabled={…} onClick={…}>Download files ({selected.size})</Button>`.

---

**[MINOR] src/lib/zip-store.ts:123 — the UTF-8 name flag (general-purpose bit 11, `0x0800`) is never set**

`utf8Path` encodes with `TextEncoder` and only strips control characters, so it happily
accepts non-ASCII paths, but the local and central headers advertise only
`DATA_DESCRIPTOR_FLAG`. Extractors that fall back to CP437 will mojibake any non-ASCII
name. Safe as called today, because the route's `safeSegment`/`safeFilename` reduce
everything to `[A-Za-z0-9._ -]` — but the module is written and unit-tested as a
standalone encoder, so the next caller inherits the trap.

**Fix:** `const NAME_FLAGS = DATA_DESCRIPTOR_FLAG | 0x0800;` and use it in both
`localHeader` and `centralHeader`. Add a unit case for a non-ASCII path.

---

**[MINOR] src/ui/files/export.css:23 — the status panel still grows on the Ready transition**

`.files-export-status { min-height: 78px }` reserves space per the project's
elements-never-jump rule, but the `ready` branch adds a `Download ZIP` anchor
(`.files-export-download`, `margin-top: 4px`) that pushes the panel past that floor. The
footer is outside the scroll container so it holds, but the panel itself visibly resizes
at exactly the moment the operator is watching it.

**Fix:** raise `min-height` to the ready-state height (~112px) so all four states occupy
one box.

---

**[MINOR] src/routes/files-export.routes.ts:130 — cancelled deliverables are exportable**

`taskRowsFor` filters `task.kind = 'file'` but not the cancelled state, while
`FilesRow.state` includes `"cancelled"` and those rows are selectable on the library. A
cancelled slot with a prior upload lands in the ZIP as a current deliverable.

**Fix:** either exclude cancelled tasks server-side, or fold them into `manifest.txt`
with a "cancelled" reason — the manifest already exists for exactly this kind of honesty.

---

**[MINOR] src/ui/files/FilesPage.tsx:156 — the action is named `Download files (N)`, not the plan's `Export selected`**

Plan step 3 specifies "a clearly named `Export selected` action"; the dialog it opens is
titled "Export deliverables". The shipped noun is arguably *more* discoverable for
CNT-S3's phrasing, so this may well be a deliberate improvement — but it is an
undocumented divergence from an authoritative plan.

**Fix:** keep the label and record the reasoning in the completion comment, or align to
the plan.

---

### Note on gate hygiene (not a defect in this diff)

`scripts/checks/check-api.mjs:47-57` only builds when `dist/marquee/index.js` is absent.
In a long-lived worktree that means `check:api` — and therefore `pr-gate` — can validate a
bundle several commits stale and pass, which is precisely what happened here. Worth a
separate ticket: rebuild unconditionally, or fail when the bundle is older than the
newest `src/` mtime.

## 4. Positive Observations

- **`latestFor` (`files-export.routes.ts:157`) does the hard thing correctly.** It resolves
  through MRQ-115's `listVersionsForOwners` and selects on `is_latest` rather than
  `versions[0]`, with a comment naming the deliberately-reverted-pointer case. The test
  *"export follows the pointer even when an older ready version is current"* proves it —
  that is the exact failure `src/lib/files/versions.ts` was written to prevent, and this
  ticket is the first consumer that could have quietly reintroduced it.
- **The manifest is populated during streaming and read after the entry loop.** `manifest`
  is passed by reference into `createZipStoreStream` and only serialised by `manifestBody`
  once the `for await` over entries has drained, so `manifest.txt` is complete and last.
  Subtle, and correct.
- **Byte-level ZIP correctness holds up.** I checked the field layout by hand: 30-byte
  local header, 16-byte data descriptor, 46-byte central header, 22-byte EOCD, sizes and
  offsets consistent. `crc32` chunk continuation is right, and the unit test asserting
  `crc32(second, crc32(first)) === crc32(first+second)` is the correct property to pin for
  a streaming CRC.
- **Event scoping is enforced in two independent places** — `taskRowsFor` on
  `task.event_id` and `attachmentObjectsFor` on `attachments.event_id` — with a test for
  the cross-event 404 and the unauthenticated 401.
- **The R2 etag integrity check matches the precedent in `src/lib/r2/serve.ts:31,66`,**
  so a bucket that has lost or replaced an object becomes a truthful manifest line rather
  than a silently corrupt archive.
- **Zip-slip is handled at both layers** — `utf8Path` drops `.`/`..`/empty segments and
  normalises `\` to `/`, `safeSegment` strips separators — and `uniquePath` disambiguates
  collisions as `name (2).pdf` instead of overwriting. The traversal + duplicate test is
  the right one to have written.
- **The pre-flight 422 on size fires before any bytes are streamed,** so an oversized
  selection gets a clean enveloped error rather than a truncated download.
- **The dialog's honesty discipline is exactly what the ticket asked for.** "Only the
  current version of each selected deliverable is included", "Missing deliverables are
  listed in manifest.txt", and no claim of queueing or background work that this inline
  implementation does not do. Selection survives an error, `Cancel` becomes `Stop` while
  preparing, and grouping/removal invalidate a stale generated URL rather than letting the
  operator download something that no longer matches the panel.
- **`as never` on the handler and `req.valid` casts follow the established
  non-JSON-response pattern** already used in `uploads.routes.ts`, `auth.routes.ts`, and
  `admin-ops.routes.ts` — not a shortcut invented here.
