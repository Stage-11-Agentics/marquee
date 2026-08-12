# MRQ-96: Upload file types are hardcoded in the seed — give the organizer a real control

Let an organizer configure which file types a speaker upload task accepts.
Operator decision, 2026-08-11, prompted by exercising the Presentation Upload task
on the live site: *"are you able to select or allow any arbitrary set of types as
an event whenever you set it up? Because right now, what if you take other forms
of file."*

## Where it stands

Accepted types and the size cap are **hardcoded in the seed script**.
`scripts/seed/event.ts:348-350`:

    [TEMPLATE_IDS.presentationUpload, "Presentation Upload", "file",
      "Upload your final deck so the AV team can stage it before your session.",
      14, null, JSON.stringify({ accept: [".pdf", ".pptx", ".key"], maxBytes: 26_214_400 }), 1, 1],

The good news is that the enforcement path is already complete and correct — this
ticket is a UI and a route, not new plumbing:

- The value lives on the task-template row as `file_config`
  (`src/db/schema.ts:516`).
- The server reads and enforces it on presign, for both the authenticated and the
  public path (`src/routes/uploads.routes.ts:273-285`, `:391-400`, via
  `parseUploadOwnerConfig`).
- The portal honors it client-side — the file picker's `accept` attribute and
  `validateClientUpload` (`src/ui/portal/PortalPage.tsx:238`, `:283`).

What is missing is any way for an organizer to change it. `src/ui/settings/EventSettings.tsx`
has no task-template editor. So a conference that wants video, a Keynote export, a
Google Slides link, or simply a larger cap has to edit a seed script — which
contradicts **"own your conference"** in `PHILOSOPHY.md`.

## Scope

1. **An organizer surface for file task templates.** Where task templates are set
   up for an event, let the organizer edit, per file-kind template: the **accepted
   file types** and the **maximum size**. Find the existing task-template
   surface first and extend it; only add a new screen if none exists, and say which
   you found in the PR.
2. **Speak the organizer's language.** Offer meaningful choices — "Slides (PDF,
   PPTX, Keynote)", "Documents", "Images", "Video" — with an escape hatch for
   arbitrary extensions, rather than making someone hand-author a JSON array of
   dotted strings. Size in MB, not bytes.
3. **Persist through the existing shape.** Write the same `file_config`
   (`{ accept: string[], maxBytes: number }`) the server already parses. Do not
   invent a second representation or a parallel enforcement path.
4. **Normalize and validate on the server.** Accept `.pdf` and `pdf` and `PDF` and
   store one canonical form — the portal already re-adds the leading dot at
   `PortalPage.tsx:283`, so garbage in the array becomes a broken picker. Reject an
   empty accept list (that would accept nothing and silently brick the task) and
   cap the maximum size at whatever the R2 path can actually take.
5. **Tell the speaker the truth.** The portal already prints "Accepted: …" and the
   limit under the file input; confirm it reflects edited config live. A speaker who
   picks an unsupported file must get a plain sentence naming what *is* accepted —
   not a terse validation string.

## Constraints

- **Do not touch the presign or upload transport.** MRQ-92 is concurrently fixing a
  CORS failure in exactly that path (`src/lib/r2/presign.ts`, `src/ui/upload/upload-client.ts`).
  Stay in the config/UI layer and coordinate through Lattice if you think you need
  to cross into it.
- Existing templates with no `file_config` must keep working unchanged — absent
  config means "no restriction beyond the system default", and that behavior is
  already relied upon.
- This repo goes public: no credentials, no Stage 11 internals.
- Flight Deck aesthetic per `DESIGN.md`; **elements never jump** — adding or
  removing a type chip must not reflow the surrounding form.
- Suite budget 45s, gate budget 120s.

## Acceptance

- An organizer can change the accepted types and size cap for the Presentation
  Upload task from the UI, save, and see it persist across a reload.
- A speaker's file picker and the "Accepted: …" line immediately reflect the
  organizer's choice.
- A file outside the configured list is rejected **server-side** (not only by the
  picker), with a message naming what is accepted.
- An empty accept list cannot be saved.
- A template with no `file_config` behaves exactly as it does today.
- Validated on the **live deployed site** at https://marquee.stage11.dev — change
  the config as an organizer, then upload as a speaker. Screenshots of both in the PR.
- `npm test` green within budget; PR open against `Stage-11-Agentics/marquee` `main`.

## Delegator plan (MRQ-96)

### Operator correction (2026-08-12)

The ticket's original live-site acceptance is superseded for this run by the
operator's correction: do not deploy, because merges do not auto-deploy and
parallel delegators must not trample the judge-facing Worker. Read-only live
site inspection is allowed, but behavior validation for this PR is local. The
PR must say that local running-system evidence is complete and deployment still
belongs to the post-merge owner.

### Decision

Extend the existing `/settings/tasks` utility route. It is already present in
the route table and currently renders the shell's honest empty state, so a new
settings screen would duplicate an established handoff. Add a dedicated
task-template API module rather than widening the aggregate conference-settings
response: the editor owns only task-template configuration, while the existing
event, format, track, and venue writers remain unchanged.

Persist `file_config` exactly as the upload pipeline already reads it:
`{ accept: string[], maxBytes: number }`, or `null` when a file template has no
restriction. The server normalizes extension values to lowercase, strips a
leading dot, removes duplicates, rejects an explicitly empty list, and caps the
byte value at `ABSOLUTE_MAX_BYTES` (100 MB). The UI presents the size in whole
megabytes and converts only at the API boundary. This keeps templates without a
config on their current system-default behavior.

The organizer-facing editor will use fixed-width preset controls for Slides,
Documents, Images, and Video plus a Custom extensions field. Presets and custom
values all produce the same canonical extension array; no second config format
or parallel upload path is introduced. The existing upload policy remains the
enforcement authority, and the local proof will use the already supported
Presentation Upload formats while checking that the portal reads the saved
config after its normal refresh.

### Implementation

1. Add a shared task-template config normalizer/validator in the config layer,
   reusing the existing R2 ceiling and file-policy vocabulary without changing
   presign, completion, R2 signing, or the browser upload transport.
2. Add `src/routes/task-templates.routes.ts` with an organizer-readable list
   route and a program-write patch route scoped by `eventId` and `templateId`.
   Return all templates so the surface can explain which tasks are file tasks;
   permit configuration writes only for `kind = 'file'`, keep `null` configs
   intact, and return fielded 422 errors for empty accepts or invalid sizes.
3. Build `TaskTemplatesPage` for the already-routed `/settings/tasks` screen,
   wire it through `AppShell`, and reuse Flight Deck settings primitives. Show
   non-file templates as read-only context; give each file template stable
   accept controls, a custom extension escape hatch, MB input, dirty/save state,
   reload persistence, and plain validation messages without layout shifts.
4. Keep the portal's existing `accept`/size projection and client validation as
   the consumer of `file_config`; add only the smallest portal-facing assertion
   needed to prove that an edited config reaches the speaker picker and the
   accepted-types line. Do not edit `src/lib/r2/presign.ts` or
   `src/ui/upload/upload-client.ts`.
5. Add route/integration coverage for normalization, duplicate and dotted/upper
   case input, empty-list rejection, 100 MB ceiling, event/template scoping,
   no-config preservation, and a positive configured extension plus a rejected
   extension. Add a source-level UI contract for the task route, organizer
   vocabulary, MB conversion, stable controls, and portal copy.

### Verification and delivery

- Re-run the focused tests against the unfixed baseline where useful so new
  failures are attributable, then run `npm test` and record the known unrelated
  MRQ-74 baseline failure separately if it remains.
- Run the repository gate within its 120-second budget, checking only MRQ-96
  owned paths and preserving all pre-existing dirty work.
- Run the app locally and use the c11 embedded browser against the local HTTPS
  or secure dev origin described by `DEPLOY.md`: enter as organizer, open
  `/settings/tasks`, change Presentation Upload from the seeded config to
  another supported set and size, save, reload, then enter as speaker and
  verify the picker `accept`, the “Accepted: …” line, and a server-side
  rejection for a file outside the configured list. Capture screenshots of the
  organizer editor and speaker task and attach them to the Lattice validation
  evidence and PR body. Do not run `npx wrangler deploy`; the live site may be
  read only and is not evidence for this unmerged branch.
- Commit the plan first, then meaningful MRQ-96 checkpoints; push only to
  `github`, open the GitHub PR against `Stage-11-Agentics/marquee` `main`, and
  stop at `pr_open` for human merge. The PR will name the existing `/settings/tasks`
surface, the normalization decision, the tests, screenshots, the local-only
validation boundary, and any unrelated live defects noted in Lattice only.

### Non-goals

No migration, new upload owner, presign/CORS change, R2 transport change,
parallel enforcement path, changes to the seed's default, or fixes for the
unrelated dirty-tree/live-site findings owned by other tickets.
