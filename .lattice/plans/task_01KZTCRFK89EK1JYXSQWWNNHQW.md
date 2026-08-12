# MRQ-115: Files library and version lists

**Ticket:** MRQ-115 · T-F1 · P0 keystone of the content area
**Branch:** `mrq-115-files-library` · worktree `../Marquee-worktrees/mrq-115-files-library`
**Base:** `github/main @ 23a06b0` (Contract fold: the cold-start band)
**Rubric IDs:** CNT-13 (w1, direct) · CNT-04 (w2, both halves) · CNT-02 (w3, rescue) · doors to CNT-05 (w2, T-F2) and CNT-14 (w2, T-F3)

---

## 1. What is actually true today (evidence)

| Fact | Evidence |
|---|---|
| No migration is needed. Every presign mints a fresh `attachments` row with a unique `r2_key`; superseded rows persist. | `src/lib/r2/keys.ts:14-22` (`objectKeyFor` mixes `randomKeySuffix()`), `migrations/0001_init.sql:106-130` |
| `speaker_tasks.attachment_id` is the latest-pointer, written by the portal's complete call. | `migrations/0001_init.sql:611`, `src/ui/portal/PortalPage.tsx:269-296`, `src/routes/portal.routes.ts:994` |
| `people.headshot_attachment_id` is the same shape for the other versioned owner. | `migrations/0001_init.sql` (people), `src/db/schema.ts:233` |
| Completion flips `status` `pending → ready`; a failed upload leaves a `pending` row behind. | `src/routes/uploads.routes.ts:549-556` |
| The portal file task shows a `✓` and nothing else — no filename, no version, no download. | `src/ui/portal/PortalPage.tsx:524-535` (TaskRow), `:317-325` (file surface) |
| The portal payload for a file task already carries `attachment_id` but no filename. | `src/routes/portal.routes.ts:708-718` |
| `publicMediaUrl` is the only outbound representation of a stored object, and the media origin is live (`media.marquee.stage11.dev` answers 404 for an unknown key, i.e. it is routed). | `src/lib/r2/keys.ts:29-36`, `wrangler.jsonc:103`, `curl` against the deployed origin |
| No organizer surface lists attachments at all. | register row 28; `grep` finds no admin read of `attachments` outside preview/serve |
| The chase board (`/onboarding`) is the closest existing screen and the right structural model. | `src/ui/onboarding/OnboardingPage.tsx`, `src/routes/onboarding.queries.ts` |
| `route-table.test.ts` asserts the **exact ordered label list** for home+pipeline+modules. | `tests/unit/route-table.test.ts:5-11` — adding a sidebar row *requires* editing that test |
| `check:design` asserts each of a fixed label set is *present* in the route table (subset check, not exact). | `scripts/checks/verify-design-contract.mjs:30-32` |

## 2. Design decisions (and the traps they avoid)

1. **`is_latest` is derived, never stored.** `listVersionsFor` resolves a *pointer* per owner type — `task_upload → speaker_tasks.attachment_id`, `person_headshot → people.headshot_attachment_id` — and marks the row whose `id` equals that pointer. A stored flag drifts from the pointer the portal writes, and AV stages the wrong deck. For owner types with no pointer column (`draft_file`, `submission_file`, `event_logo`, `import_file`) the newest ready row is latest and the result carries `latest_source: "recency"` so no caller can mistake a fallback for a pointer.
2. **Only `status = 'ready'` rows are versions.** A presign that never completed is not a version. Counting pending rows would inflate the count and directly fail CNT-13's "version count of 2".
3. **Version numbers come from `ROW_NUMBER() OVER (PARTITION BY owner_type, owner_id ORDER BY created_at, id)`** — stable, gapless, oldest = v1, so "v2 of 2" reads the way a human means it.
4. **The library's row set is the *expected* deliverable, not the attachment.** One row per file-kind `speaker_tasks` row: filled or empty, chaseable in place. An attachment-first list would show only what already arrived — useless to the AV lead who needs to know what has *not*. This also makes the screen non-empty before the judge ever uploads, which is what makes CNT-13's library findable at all.
5. **Cancelled tasks stay visible but cannot be "missing".** Dropping them would silently lose an upload that was made before the talk was withdrawn; counting them as owed would lie to the chase.
6. **"Copy link" states its caveat inline**, at the control, not in a tooltip: the URL is an unauthenticated capability URL on the media origin. Anyone with the link can fetch the file. That is the truth about `publicMediaUrl`; the honest fix is to say so, not to hide the control (PHILOSOPHY: respect the operator).
7. **No per-session Files tab** — CNT-13 explicitly forgives its absence, and T-F1 is on the critical path for F2/F3.
8. **Selection lives in the library from day one** (checkbox column + "n selected" count) so T-F3 mounts its export dialog on an existing selection surface rather than rebuilding one. F3 owns the dialog; F1 ships only the selection.
9. **Elements never jump.** Fixed-width state chip, tabular numerals for size/version/counts, an em-dash placeholder for every empty cell, and a reserved-height row-expansion region.

## 3. Build

### 3.1 `src/lib/files/versions.ts` (new — the one owner of attachments SQL, per §4 rule 4)

```ts
export type VersionedOwnerType = "task_upload" | "person_headshot" | "submission_file" | "draft_file" | "event_logo" | "import_file";
export interface FileVersion {
  attachment_id: string; version: number; filename: string; content_type: string;
  size_bytes: number; uploaded_at: number; is_latest: boolean; url: string;
}
export interface FileVersionList {
  owner_type: VersionedOwnerType; owner_id: string; versions: FileVersion[];   // newest first
  latest: FileVersion | null; version_count: number; latest_source: "pointer" | "recency";
}
export function listVersionsFor(db, ownerType, ownerId, mediaOrigin): Promise<FileVersionList>
export function listVersionsForOwners(db, ownerType, ownerIds[], mediaOrigin): Promise<Map<string, FileVersionList>>
```

`listVersionsForOwners` is the real implementation (one query for N owners — the portal has several file tasks and the library has many); `listVersionsFor` is the thin single-owner wrapper the ticket names. Both are exported.

### 3.2 `GET /api/v1/events/{eventId}/files` (new `src/routes/files.routes.ts`)

`policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" } }` — same shape as `onboarding.routes.ts`. Query params: `state` (`all|uploaded|missing|overdue`), `task_type` (template id), `q` (speaker/session/filename search). Response:

```
{ data: { rows: [{ id: <task id>, state, task{id,title,template_id,due_at,cancelled_at},
                   person{id,name,email}, session{id,title}|null,
                   latest: FileVersion|null, version_count, versions: FileVersion[] }],
          counts{all,uploaded,missing,overdue}, facets{task_types[]},
          metrics{expected,received,missing,overdue} } }
```

Versions ship inline: the row set is speakers × file-tasks (tens, not thousands), and a second round-trip per expansion would make the row feel slow (R7). Filename must be named `*.routes.ts` so `_manifest.ts`'s glob picks it up (COMMON §"Route module naming").

### 3.3 `FileVersions` component (new `src/ui/files/FileVersions.tsx` + `files.css`)

Renders `slides.pdf · v2 of 2 · uploaded Mar 3, 2027 · 4.1 MB`, then prior versions each with an explicit **Download** link (`publicMediaUrl`, `download` attribute) and a **Copy link** button carrying the caveat line. Neutral `file-versions-*` class names, tokens only, so it mounts inside both the Flight Deck shell and the portal's own chrome. Exported for T-D2.

### 3.4 Portal rescue (CNT-02, w3)

- `src/routes/portal.routes.ts`: `taskPayload` for `kind === "file"` gains `versions`/`latest`/`version_count`, sourced from one batched `listVersionsForOwners` call in `listTasks`; `listTasks` takes the media origin from `context.env.MEDIA_PUBLIC_ORIGIN`.
- `src/ui/portal/PortalPage.tsx`: `TaskRow` renders `<FileVersions>` under the title when the task has an upload — **collapsed row included**, because the evidence CNT-02 wants ("filename listed") must not require expanding anything. The upload form gains "Upload new version" wording once a version exists.

### 3.5 `/files` route + page

- `route-table.ts`: `{ id: "files", path: "/files", label: "Files", icon: "▤", group: "modules", sidebar: true }`, placed directly after `Agenda`. Label is **exactly** `Files` (CNT-S3 step 5 enumerates the agent's guesses; match one verbatim).
- `tests/unit/route-table.test.ts`: extend the contract list — the ordered assertion is the point of that test, so it is edited deliberately, not worked around.
- `AppShell.tsx`: `route?.id === "files" ? <FilesPage /> : …` in the existing chain.
- `src/ui/files/FilesPage.tsx`: PageHeader + metric tiles (Expected / Received / Missing / Overdue) + filter chips + search + table (select · file · speaker · session · uploaded · versions · size · actions). Row expands to `<FileVersions>`. Empty and error states are honest ("No file tasks have been assigned yet" ≠ "no files").

## 4. Tests (targeted vitest only — fleet load rule)

| File | Covers |
|---|---|
| `tests/unit/file-versions.MRQ-115.test.ts` | version numbering, `ready`-only filter, pointer-derived `is_latest` (incl. pointer at a *non-newest* row — the drift case), `latest_source` fallback, batch = single-owner parity, empty owner |
| `tests/unit/api/files.MRQ-115.test.ts` (integration shape matching `tests/unit/api/`) | `GET .../files` row set includes expected-but-empty deliverables, state/search filters change the set, counts agree with rows, version_count reflects two uploads, 404 on unknown event, 401/403 without grants |
| `tests/unit/files-library.MRQ-115.test.ts` | `FileVersions` renders "v2 of 2", lists prior versions with a download control, states the capability-URL caveat; `FilesPage` renders a missing row with an em-dash placeholder (elements never jump) |
| `tests/unit/route-table.test.ts` (edit) | `Files` is in the modules order and `/files` resolves |

No AC IDs exist for this ticket (eval-response tickets carry none, and minting them is forbidden), so test names carry `MRQ-115` and the rubric ID they defend.

## 5. Validation (deployed-shape, not just green tests)

`npx vite dev` + real browser via the c11 embedded browser: sign in as the organizer, open **Files** from the sidebar, confirm the seeded expected-deliverable rows; then drive the speaker portal, upload a file twice against one task, and confirm (a) the portal row names the file and reads "v2 of 2" **without expanding**, (b) the library row shows version count 2 with the latest marked and the prior version downloadable, (c) Copy link yields a `media.marquee.stage11.dev` URL. Screenshots attached with `--role validation`.

## 6. Collisions (§4 file-ownership rules)

- **Attachments SQL: only this ticket writes it** (rule 4). `listVersionsFor` + `FileVersions` are the exports T-D2 consumes; T-F2 mounts its thread in the row detail this ticket ships; T-F3 mounts its export on the selection this ticket ships.
- `route-table.ts` (rule 6): trivial conflict with Z/D1/K/N — rebase freely. The paired edit to `tests/unit/route-table.test.ts` is the non-obvious half; note it in the PR so the next ticket to add a row expects it.
- `uploads.routes.ts` (rule 3) is **not touched** — no sign/complete change is needed.
- `portal.routes.ts` / `PortalPage.tsx`: additive only (payload fields + one component mount).

## 7. Risks

1. **Route-table test conflict** with any sibling adding a sidebar row. Mitigation: rebase before the gate; the resolution is mechanical (both labels in the list, order from route-table.ts).
2. **`check:api` parity** — a new versioned route must appear in the served OpenAPI document. Mitigation: `*.routes.ts` naming + `npm run check:api` inside the gate.
3. **Media origin availability** — if `media.marquee.stage11.dev` stops resolving, Download/Copy-link degrade to dead URLs. Verified live at plan time; the caveat text names the origin so a failure is legible rather than mysterious.
4. **Seeded demo may have zero file tasks**, which would make the library look broken on a fresh reset. Mitigation: check `scripts/checks/check-seed.mjs` / the demo fixture during implementation; if there are none, the empty state says exactly that and points at `/settings/tasks` — it does not pretend.
