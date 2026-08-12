# Code Review: MRQ-96 — Organizer-configurable upload file types

Reviewed at `Marquee-worktrees/mrq-96` @ `3bed116` (3 commits on `mrq-96`).

## 1. Verdict

**FAIL (implementation-level)**

The approach is right — extend the already-routed `/settings/tasks`, persist through the existing
`file_config` shape, normalize server-side. But the editor offers the organizer four format presets
and an arbitrary-extension escape hatch that the upload pipeline **cannot serve**, and nothing in
the diff closes that gap. Choosing "Video", "Images", or "Documents" saves successfully, updates the
speaker's picker, and then makes every upload fail server-side — the exact "silently brick the task"
outcome the ticket asked to prevent.

## 2. Summary

I reviewed the new `src/lib/task-template-config.ts` normalizer, the `task-templates.routes.ts`
list/patch pair, the `TaskTemplatesPage` editor, the portal payload change, the friendlier upload
rejection copy, and both new test files. Route registration (glob manifest), auth scoping
(`program:read`/`program:write`, event-scoped by path param), normalization, empty-list rejection,
the 100 MB clamp, and null preservation are all correct and well covered — those four integration
tests and the four node contract tests pass locally, as do the existing portal and public-presign
suites. The blocking finding is that the organizer's vocabulary is wider than the enforcement
authority's: `policyFor("task_upload", …)` narrows `DOCUMENT_RULES` (pdf/pptx/key only), so any
accept list outside those three collapses to zero rules and rejects everything. Two secondary gaps:
the new page has no navigation entry point anywhere in the UI, and the custom-extensions input
cannot accept more than one extension.

## 3. Issues

---

**[CRITICAL] src/ui/settings/TaskTemplatesPage.tsx:13-18 (with src/lib/task-template-config.ts:18 and src/routes/task-templates.routes.ts:110) — Organizer can select file types the pipeline will reject, bricking the task**

`policyFor("task_upload", config)` narrows `DOCUMENT_RULES` — `pdf`, `pptx`, `key` — and nothing
else (`src/lib/r2/policy.ts:113-118`). `narrowRules` filters that base by the accept list, so an
accept list containing none of those three yields **zero rules**, and `validateDeclared` then
returns `violation: "extension"` for every file. The organizer surface offers `Documents`
(doc/docx/txt/rtf), `Images` (jpg/jpeg/png/webp/gif), `Video` (mp4/mov/webm/m4v) and a free-text
extension field; the server normalizer accepts anything matching `/^[a-z0-9][a-z0-9_-]{0,31}$/`,
and the PATCH handler never asks whether the pipeline can serve the result.

Verified against the real policy module:

```
["pdf","pptx","key"] -> rules: pdf,pptx,key
["mp4","mov"]        -> rules: (none)   upload deck.mov: {"ok":false,"violation":"extension"}
["jpg","png"]        -> rules: (none)   upload deck.png: {"ok":false,"violation":"extension"}
["doc","docx"]       -> rules: (none)   upload deck.docx:{"ok":false,"violation":"extension"}
["pdf","mp4"]        -> rules: pdf      upload deck.mp4: {"ok":false,"violation":"extension"}
```

Three of the four presets and the entire escape hatch brick the task. The failure is worse than a
plain rejection because `taskUploadRejection` (`src/routes/uploads.routes.ts:130-135`) builds its
message from `config.accept`, not from the policy rules — so a speaker uploading `deck.mp4` to a
Video-configured task is told *"That file type is not accepted. Choose one of .mp4, or .mov."*
The portal change at `src/routes/portal.routes.ts:711` compounds it: `accept` now comes from the
stored config instead of the policy, so the picker, the "Accepted: …" line and the client-side
`validateClientUpload` all agree with the organizer and all disagree with the server. That is a dead
end in the speaker loop, which the project treats as a defect class of its own.

This also means the ticket's motivating question — *"what if you take other forms of file"* — is not
actually answered: the UI says yes, the system says no.

**Fix:** make the organizer's vocabulary a subset of what the pipeline can classify, and enforce it
at the write boundary.
1. In `task-templates.routes.ts`, after normalizing, reject any extension with no rule in
   `policyFor("task_upload", { accept })` — 422 on field `accept`, message naming the supported set
   (this is the same guard as the empty-list rule, generalized: an all-unsupported list *is* an
   empty policy).
2. In `TaskTemplatesPage`, drop or disable the presets the sniffer cannot classify and constrain the
   custom field to the supported set. `SniffKind` is `jpeg | png | webp | pdf | pptx | key`
   (`src/lib/r2/sniff.ts:8`), so `Images` becomes reachable with a one-line change — add
   `IMAGE_RULES` to the `task_upload` base in `policyFor` (drop `gif`, which is unsupported).
   `Documents` and `Video` cannot be honored today.
3. Genuine video/docx support needs new sniff kinds plus rules — that is a follow-up ticket, and
   worth minting so the operator's original question gets a real answer rather than a disabled
   button.

---

**[MAJOR] src/ui/shell/route-table.ts:38 — The new editor is unreachable from anywhere in the UI**

`task-templates` is in the `utility` group without `sidebar: true`, so `routesForGroup`
(`route-table.ts:63`) never renders it, and no page links to `/settings/tasks` — I grepped all of
`src/`: the only occurrences are the route-table row and the `AppShell` dispatch. `Venues`, the
closest analogue, is also sidebar-hidden but has an explicit "Open Venues →" button in
`EventSettings.tsx:277`. As shipped, an organizer can only reach this page by typing the URL, which
does not satisfy "an organizer can change the accepted types and size cap … from the UI" and works
against the discoverability the ticket is about.

**Fix:** add a card/link in `EventSettings` mirroring the `settings-venue-link` pattern
(`navigate("/settings/tasks")`), or set `sidebar: true` on the route row. The link is the cheaper
and more consistent option.

---

**[MAJOR] src/ui/settings/TaskTemplatesPage.tsx:107 — The custom-extensions field cannot hold more than one extension**

The input is fully controlled by `custom`, which is recomputed from the normalized accept list on
every render. `extensionDraft` splits on `/[\s,]+/` and drops empty entries, so typing `csv,` yields
`["csv"]` and re-renders the input with value `csv`. Preact re-syncs a controlled input whenever
`props.value !== dom.value` (`preact@10.29.8`, `src/diff/index.js:594`), so the separator the user
just typed is erased on the keystroke — a comma or space can never survive, and a second extension
can never be entered. The placeholder (`"csv, zip, or another extension"`) and the helper text
("Separate extensions with commas") both promise a behavior the control does not have. This is the
escape hatch scope item 2 asks for, so it matters.

**Fix:** keep the raw text in local component state (`const [draft, setDraft] = useState(custom)`),
render `draft`, and push the parsed list up on change; re-seed `draft` from `custom` only when the
template id changes. Alternatively commit chips on Enter/blur and render the input uncontrolled.

---

**[MAJOR] tests/integration/api/task-templates.MRQ-96.test.ts — No test covers the acceptance criterion that actually failed**

The suite covers list ordering, normalization, the 100 MB clamp, empty rejection, non-file
rejection, null preservation and 401. It does not cover the two behaviors the ticket calls out as
acceptance: *"a file outside the configured list is rejected server-side, with a message naming what
is accepted"* and *"a speaker's file picker and the Accepted line reflect the organizer's choice."*
The plan promised exactly this ("a positive configured extension plus a rejected extension",
step 5). Neither `taskUploadRejection` nor the `portal.routes.ts:710-716` change has a single
assertion. A round-trip test — PATCH the template, then presign as the speaker with an in-list and
an out-of-list file — would have caught the critical issue above on the first run.

**Fix:** add an integration test that PATCHes a config, then calls the authenticated sign route with
(a) a file whose extension is in the saved list and (b) one that is not, asserting 200 and a
rejection message that names the configured types; and one that asserts `taskPayload.accept` /
`max_bytes` reflect the saved config after an edit.

---

**[MINOR] src/ui/settings/TaskTemplatesPage.tsx:152-160 — Save is N sequential PATCHes with no partial-failure recovery**

`save` loops every file template — changed or not — and awaits one PATCH each. If request 3 of 5
fails, the first two are already persisted, `dirty` stays true, `reloadKey` is not bumped, and the
local state now mixes saved and unsaved rows behind a generic "Save failed" banner. It also bumps
`updated_at` on templates nobody edited, and last-write-wins across all templates if two organizers
are editing.

**Fix:** track per-template dirtiness and PATCH only changed rows; on failure, refetch so local state
cannot drift from the server.

---

**[MINOR] src/ui/settings/settings.css:71 and TaskTemplatesPage.tsx:113 — Layout shifts contradict the "elements never jump" constraint**

`.task-template-inline-error` is conditionally rendered, so clearing the last type inserts a
paragraph and pushes the save bar down. The codebase already has the right pattern for this:
`.field-error { … min-height: 15px; }` (`src/styles/components.css:88`) — reserved space, text
swapped in. Separately, `.task-template-effective { min-height: 58px }` reserves about two lines
while the "Accepted: …" string grows with every type added (`overflow-wrap: anywhere`), so adding
types past a line's worth reflows the row — the specific case the constraint names.

**Fix:** give the inline error a reserved min-height and always render it (empty when valid); give
`.task-template-effective strong` a fixed line clamp or a min-height sized for the longest
selectable list.

---

**[MINOR] src/ui/settings/settings.css:71 — Off-token color fallback**

`var(--danger, #b34848)` — `--danger` is defined in `src/styles/tokens.css:44`, so the hex fallback
is dead code and an off-palette literal in a design-token-bound repo.

**Fix:** `var(--danger)`.

---

**[MINOR] src/ui/settings/TaskTemplatesPage.tsx:104-108 — No way back to "no restriction"**

The API accepts `file_config: null`, and the UI offers "Configure file policy" to move a null
template to a default config — but once configured there is no control to clear it. An organizer who
configures by accident cannot restore the documented "absent config means no restriction beyond the
system default" behavior without an API call.

**Fix:** add a "Remove restriction" action on a configured row that calls `onChange(null)`.

---

**[MINOR] src/routes/task-templates.routes.ts:80-91 vs TaskTemplatesPage.tsx:167 — List returns non-file templates the UI discards**

The plan said non-file templates would render "as read-only context" so the surface can explain
which tasks are file tasks; the page filters them out entirely and shows "No file tasks yet". Either
the payload or the plan is wrong.

**Fix:** render the non-file rows as read-only context as planned, or scope the query to file
templates and update the plan note.

---

**[MINOR] src/routes/uploads.routes.ts:134 — Two-item rejection sentence reads badly**

`accepted.slice(0, -1).join(", ")` + `", or "` produces *"Choose one of .pdf, or .key."* for two
types. Also, the completion path renders `completion failed: That file type is not accepted. …`
(`:544-546`), stacking a machine prefix onto the plain sentence the ticket asked for.

**Fix:** special-case two items (`"Choose a .pdf or .key file."`); drop the `completion failed:`
prefix when the friendly message is used.

---

**[MINOR] src/routes/portal.routes.ts:708-711 — Same JSON parsed twice with different semantics**

`parseUploadOwnerConfig` and `readTaskFileConfig` now both parse `task.file_config` in one function,
with different validation and dot handling, and the payload prefers the second while enforcement
uses the first. That divergence is the mechanism behind the critical issue. Once the policy is the
authority for what can be offered, `accept` can go back to being derived from `policy.rules` and the
second parser drops out of this path.

**Fix:** after the critical fix, re-derive `accept` from the policy and keep `readTaskFileConfig`
confined to the settings route.

---

## 4. Positive Observations

- **Correct read of the existing surface.** `/settings/tasks` really was already in the route table
  (`route-table.ts:38`) and unimplemented; extending it rather than minting a new screen is the
  right call, and the PR can say so honestly.
- **The normalizer is the right shape and the right size.** `src/lib/task-template-config.ts` is 67
  lines, does exactly one thing, and gets the tricky part right: `readTaskFileConfig` returns `null`
  on anything it cannot canonicalize, so a malformed legacy config degrades to today's behavior
  instead of throwing inside a portal render. Dot-stripping matches the portal's re-add at
  `PortalPage.tsx:283`, and lowercasing plus dedupe covers the `.pdf` / `pdf` / `PDF` requirement.
- **Route hygiene matches the codebase.** Glob registration picked the module up with no manifest
  edit; `program:read` / `program:write` grants are event-scoped by path param via
  `router.ts:165-186`, so cross-event access is denied by the shared layer rather than a bespoke
  check; `templateFor` scopes by `(id, event_id)` so a wrong-event id is a clean 404. The
  `api-registry.json` regeneration is present and correct.
- **Tests are behavior-level and well named.** The integration tests assert stored JSON *and*
  round-tripped response, not just the response — which is what proves persistence. The
  non-file-template case additionally asserts the stored config is unchanged after the 422, which is
  the assertion most people skip.
- **Local verification reproduced clean:** `task-templates.MRQ-96.test.ts` 4/4 (14.2s),
  `task-templates-ui.MRQ-96.test.mjs` 4/4, and the neighbouring
  `portal.AC-43-52-233-237-240` + `public-upload-presign.MRQ-81` suites 24/24 — no regression in the
  paths this diff touches.
- **The friendlier rejection copy is a real improvement** over `rejected: extension`, and confining
  it to `ownerType === "task_upload"` leaves the public draft path's contract (and its MRQ-81 tests)
  untouched. The presign/transport constraint was respected — `src/lib/r2/presign.ts` and
  `src/ui/upload/upload-client.ts` are untouched.
