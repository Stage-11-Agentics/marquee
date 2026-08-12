# Code Review: MRQ-117 — Bulk ZIP export of deliverables

**Reviewed HEAD:** `19fe323` (`mrq-117-zip-export`, worktree `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-117-zip-export`)
**Reviewer:** independent, cold context.

## 1. Verdict

**FAIL (implementation-level)**

The approach is sound and the plan is well executed. One gate-blocking defect and one
unvalidated acceptance surface keep it out of PASS; neither requires a new plan.

## 2. Summary

Reviewed the vendored ZIP-STORE writer (`src/lib/zip-store.ts`), the streaming export route
(`src/routes/files-export.routes.ts`), the Preparing→Ready dialog
(`src/ui/files/BulkExportDialog.tsx` + `export.css`), the `FilesPage` mount, and the three
test files. The core mechanism is correct and genuinely careful: the ZIP byte layout is
right field-for-field, latest-only goes through MRQ-115's shared `listVersionsForOwners`
pointer derivation rather than a second definition, event scope is enforced server-side on
both `speaker_tasks` and `attachments`, and missing deliverables reach `manifest.txt`
instead of being fabricated.

The blocking finding is unrelated to the export itself: `cli/api-registry.json` was
regenerated from a stale Worker bundle and silently **deleted** MRQ-113's
`inviteSpeakersToPortal` operation. `npm run check:api` is a `pr-gate` step and exits 1 on
any finding, so this branch cannot pass the gate as it stands. Secondarily, the ticket's own
premise — *the scored artifact is the visible state* — is covered only by regex assertions
over the source file; nothing drove the real dialog.

**Checks I ran:** `npx tsc --noEmit` → clean (exit 0); `node --test
tests/node/files-export-ui.MRQ-117.test.mjs` → 2/2 pass. **I did not run Vitest or
`pr-gate`** — one-minute load was 72–78 during the review, well past the project's
load-24 threshold, so a result either way would not have been believable.

## 3. Issues

```
**[CRITICAL] cli/api-registry.json:110 — the regenerated registry deletes MRQ-113's invite operation**
The diff removes `POST /api/v1/events/{eventId}/speakers/invite inviteSpeakersToPortal`
while `src/routes/speaker-invites.routes.ts:31-32` still defines and exports it, and
`src/routes/_manifest.ts` registers by glob, so the Worker still serves it. I diffed every
`operationId` in `src/routes/` against the committed registry: exactly one operation is
missing, and it is that one. `scripts/checks/check-api.mjs:169-181` will raise both
`cli-registry-parity` (missing) and `cli-registry-hash-mismatch`, and line 208
(`if (findings.length > 0) process.exit(1)`) makes that a hard failure of the
`["API contract", "npm", ["run", "check:api"]]` step in `scripts/checks/pr-gate.mjs:18`.
This is also a silent revert of a committed artifact from another ticket — the kind of
regression that survives a merge and only surfaces when the CLI can no longer see a route.
The likely cause is `cli/generate-api-registry.mjs` running against a `dist/marquee/index.js`
built before MRQ-113 landed in this branch.
**Fix:** `npx vite build && node cli/generate-api-registry.mjs` from a clean `dist/`, then
confirm the diff for `cli/api-registry.json` adds only `listConferenceFiles` and
`exportDeliverableFiles` and removes nothing. Re-run `npm run check:api` once machine load
is under 24.
```

```
**[MAJOR] tests/ — the acceptance surface this ticket is scored on was never exercised**
The ticket states the scored artifact is the visible Preparing→Ready state, and the plan
required validating "the browser state if the parent surface is runnable, recording
validation evidence before `pr_open`." The only UI coverage is
`tests/node/files-export-ui.MRQ-117.test.mjs`, which is `assert.match` over the raw source
text of `FilesPage.tsx` and `BulkExportDialog.tsx`. That asserts the strings exist in a file;
it cannot tell you the dialog opens, that `Preparing…` ever renders, that `Ready to download`
persists, or that the object URL is live. It would pass unchanged if the dialog were never
mounted. This is exactly the "green tests ≠ working product" gap the project rules call out,
on the one surface where it matters most.
**Fix:** Drive the real path once and attach the evidence — `npx vite dev`, select two
deliverables, open the dialog, screenshot `Preparing…` and the `Ready to download` panel.
Where practical, promote the source-regex test to a Playwright case under `npm run e2e` that
asserts the two visible states in order; keep the regex file only as a cheap discovery guard.
```

```
**[MAJOR] src/routes/files-export.routes.ts:59,70 (with src/lib/zip-store.ts:125,136) — non-ASCII speaker, room, and file names are destroyed in the archive**
`safeSegment` and `safeFilename` collapse everything outside `[a-z0-9._ -]` to `_`. For an
international conference this mangles ordinary names: "José Álvarez" becomes
`Jos__lvarez`, "Zoë Müller" becomes `Zo__M_ller`, and a CJK name reduces to a run of
underscores. The ticket specified "folder names humans use"; these are not. The root cause
is that `localHeader`/`centralHeader` never set the ZIP general-purpose UTF-8 flag (bit 11,
`0x0800`), so the encoder cannot honestly emit non-ASCII names and the route over-sanitizes
to compensate. `utf8Path` already encodes UTF-8 and already strips separators, `.`, `..`,
and control characters — the extra ASCII-only filter is the only thing standing between the
organizer and a correct name.
**Fix:** OR `0x0800` into the flags word in `localHeader` (line 125) and `centralHeader`
(line 136) so decoders read the names as UTF-8, then narrow the route's regexes to reject
only what is genuinely unsafe — path separators, control characters, leading/trailing dots,
and reserved Windows names — instead of everything non-ASCII. Add a `zip-store` unit case
for a non-ASCII path asserting both the flag bit and the round-tripped bytes.
```

```
**[MINOR] src/lib/zip-store.ts:126,137 — every file in the archive carries an invalid timestamp**
The DOS mod-time and mod-date words are both hardcoded to `u16(0)`. Zero is not a valid DOS
date (month 0, day 0), so extractors show `1980-00-00 00:00` or a blank date on every entry.
An AV lead unpacking twenty decks the night before a conference reads those dates.
**Fix:** Pass a timestamp into `writeZipStore` (the caller already has `attachment.created_at`
per entry, and can fall back to a single archive-generation time) and encode it as DOS
time/date: `((hours << 11) | (minutes << 5) | (seconds >> 1))` and
`(((year - 1980) << 9) | (month << 5) | day)`.
```

```
**[MINOR] src/lib/zip-store.ts:217 — `void writer.abort(error)` can raise an unhandled rejection**
When the client disconnects mid-download, the readable side is cancelled, `writer.write()`
rejects, and the `.catch` runs `writer.abort(error)` on an already-errored writable — which
returns a rejected promise. `void` attaches no handler, so it surfaces as an unhandled
rejection in the Worker on what is otherwise a routine cancellation (and the dialog's own
"Stop" button makes that path user-reachable, not theoretical).
**Fix:** `void writer.abort(error).catch(() => undefined);`
```

```
**[MINOR] src/routes/files-export.routes.ts:187-215 — a mid-stream R2 failure aborts the whole archive rather than becoming a manifest line**
`env.MEDIA.get()` returning null or a stale etag is handled honestly. A body that starts
streaming and then errors is not: the rejection propagates out of `writeZipStore`, the
writer aborts, and the organizer gets a truncated 200 and a generic error. This is defensible
(you cannot un-write bytes already emitted), but it is the one hole in the ticket's
"missing deliverables stay visible" guarantee and it is undocumented.
**Fix:** No behavioural change needed, but say so in the comment above the generator so the
next reader does not assume mid-stream failures are also manifest-covered.
```

```
**[MINOR] src/routes/files-export.routes.ts:186,220 — manifest truthfulness rests on undocumented array aliasing**
`createZipStoreStream(entries, { missing: manifest })` is called while `manifest` is still
empty; the generator pushes into it during streaming, and `manifestBody` happens to read it
only after the generator is exhausted because `writeZipStore:381` writes `manifest.txt` last.
It works, and the integration test covers the current ordering — but the field is typed
`readonly string[]`, so nothing signals that mutation is load-bearing. Anyone who moves the
`manifest.txt` write earlier for a cosmetic reason silently ships an always-empty manifest,
which is precisely the dishonest artifact this ticket exists to prevent.
**Fix:** Make the contract explicit — accept `manifest` as a thunk
(`() => ZipStoreManifest`) evaluated at write time, or add a one-line comment at both the
call site and `writeZipStore` stating that the manifest is read after the last entry.
```

```
**[MINOR] src/ui/files/BulkExportDialog.tsx:185 + src/ui/files/export.css:32 — the footer violates the project's "elements never jump" rule**
The primary button's label runs "Generate download" → "Preparing…" → "Try again" against a
`min-width: 108px` floor: the widest label overflows that floor, so the button visibly
shrinks on the exact transition the organizer is watching. The footer note also swaps between
a 32-character string and a ~95-character one that wraps at this dialog width, changing the
footer's height and shifting both buttons vertically. `.files-export-status` correctly
reserves `min-height: 78px` — the footer just needs the same treatment.
**Fix:** Raise `.files-export-foot > div button { min-width: 148px }` (wide enough for
"Generate download") and give `.files-export-foot-note` a `min-height` sized to its longest
copy so the button row cannot move.
```

```
**[MINOR] src/ui/files/BulkExportDialog.tsx:88-99 — focus is pulled back to the dialog on every state change**
The focus effect lists `state` in its dependencies, so `dialogRef.current?.focus()` re-fires
on idle→preparing and preparing→ready. The second one moves focus off whatever the organizer
was on and onto the dialog container at the exact moment the "Download ZIP" link appears —
a keyboard user has to Tab back to reach it. The dialog also has no focus trap, so Tab walks
out to the page behind it.
**Fix:** Split the effects — focus once on `[open]`, keep the Escape listener on
`[open, state]`. On entering `ready`, move focus to the download link deliberately rather
than to the container. Add a Tab cycle within the dialog.
```

```
**[MINOR] src/ui/files/BulkExportDialog.tsx:47 — the 400 message asserts a cause it cannot know**
`responseMessage` maps any 400 to "Export up to 200 deliverables at a time." But the client
already blocks >200 (`generate` guards on `MAX_EXPORT_ITEMS`), so a 400 that actually reaches
this branch is something else — a duplicate `task_ids` entry from the refine at
`files-export.routes.ts:39`, or a malformed `grouping`. The organizer is told to remove files
that are not the problem.
**Fix:** Fall through to `apiMessage` for 400 as the 422 branch already does, keeping the
200-item sentence only as the fallback when the API sends no message.
```

```
**[MINOR] src/routes/files-export.routes.ts:187-215 — deliverables are fetched from R2 strictly one at a time**
`env.MEDIA.get()` is called lazily inside the generator, so 200 selected files cost 200
serialized round trips before any of their bodies stream. Body streaming has to be sequential
(one ZIP stream), but the `get()` latency does not. At a conservative 30 ms per call that is
~6 s of pure waiting on a full selection, against a project rule that treats a slow transition
as a defect (R7).
**Fix:** Keep a small look-ahead — issue the next 3–4 `MEDIA.get()` calls while the current
body streams, and consume the resolved handles in order. Memory stays bounded because only
the handles, not the bodies, are pre-fetched.
```

```
**[MINOR] src/lib/zip-store.ts:29-36 — the CRC32 inner loop is the archive's real CPU cost**
The table-driven CRC runs one byte at a time over every streamed byte. Against the route's
1 GB `MAX_ZIP_BYTES` ceiling that is ~10^9 iterations, which is a meaningful share of a
Worker's CPU budget — and the file's own header comment claims "STORE keeps Worker CPU
predictable," which is only half true while the CRC is scalar.
**Fix:** Either adopt a slice-by-4 CRC (four parallel tables, ~3–4× throughput, still well
under 120 lines) or lower `MAX_ZIP_BYTES` to a figure you have actually measured end-to-end.
Update the header comment either way.
```

```
**[MINOR] src/ui/files/FilesPage.tsx:157 — hand-rolled button where the shared component is already imported**
`<button class="button primary" type="button" …>` reproduces exactly what
`<Button variant="primary">` emits, and `Button` is already imported on line 21 of this file
and used elsewhere in it. Two spellings of the same control drift the moment `Button` gains
a prop.
**Fix:** `<Button variant="primary" disabled={selected.size === 0 || !ready} onClick={() => setExportOpen(true)}>Download files ({selected.size})</Button>`
```

```
**[MINOR] src/routes/files-export.routes.ts:161,163 — casts discard the framework's typed-handler guarantee**
`context.req.valid("param" as never) as { eventId?: string }` and the matching `"json"` cast
are unique to this file; every other route in `src/routes/` writes the handler inline so
`defineApiRoute` type-checks `req.valid()` against the route's own schemas — the property
`src/api/route.ts:100-106` explicitly advertises. The casts are a consequence of declaring
`handleExport` as a bare `Context<ApiEnv>` function, and they made the defensive
`if (!eventId)` on line 162 necessary for a parameter Zod already guarantees.
**Fix:** Inline the handler in `defineApiRoute` (the `as never` on line 250 is the
established repo escape hatch for the non-JSON return, and can stay), which restores typed
`valid()` and lets line 162 go.
```

## 4. Positive Observations

- **The ZIP encoder is correct field-for-field.** I checked the local header, data
  descriptor, central directory header, and EOCD against the APPNOTE layout — every field is
  in the right position and the right width, `u16`/`u32` range-guard on write, and the
  central directory carries only metadata so memory stays flat regardless of archive size.
  For ~220 hand-written lines with no dependency, that is a good trade.

- **`latestFor` genuinely resolves the shared definition.** The comment at
  `files-export.routes.ts:154-156` — "Do not use `versions[0]`" — is not decoration: it is
  the exact failure mode `src/lib/files/versions.ts` was built to prevent, and the test
  *"export follows the pointer even when an older ready version is current"* pins it by
  repointing `speaker_tasks.attachment_id` at the older attachment and asserting `old.pdf`
  ships while `latest.pdf` does not. That is a behavioural test of the thing that actually
  breaks, not of the code that was written.

- **Event scope is enforced twice, on both tables.** `taskRowsFor` binds `task.event_id = ?`
  and 404s on a count mismatch; `attachmentObjectsFor` independently binds
  `event_id = ? AND status = 'ready'`. The cross-event test proves it. The etag comparison at
  line 205 also matches the existing convention in `src/lib/r2/serve.ts:31`, so it will not
  drift from how the rest of the codebase decides an object is the one it recorded.

- **Backpressure is real, not nominal.** `writeZipStore` awaits `writer.write()` and reads
  R2 bodies through a reader that is explicitly cancelled in a `finally` on the abnormal
  path. A 1 GB export does not become 1 GB of Worker memory, and an abandoned download
  releases the R2 reader instead of leaking it.

- **The dialog is honest about what it is.** "Only the current version of each selected
  deliverable is included," "Missing deliverables are listed in manifest.txt," and "Empty
  slots stay visible in manifest.txt" all state the actual behaviour, and nothing claims the
  export is queued or stored. `.files-export-status { min-height: 78px }` reserves the
  status panel's space across all four states — the craft rule was applied deliberately
  there, which is why the footer missing it reads as an oversight rather than indifference.

- **`uniquePath` and path sanitization are tested for the cases that bite.** The
  `../speaker/../slides.pdf` traversal case and the duplicate-filename `slides (2).pdf`
  rename are both covered, and the CRC continuity test (`crc32(second, crc32(first))` equals
  the whole-string CRC) checks the one property that makes streamed CRC valid at all.
