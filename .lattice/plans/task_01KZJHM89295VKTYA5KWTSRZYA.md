# MRQ-10: Event settings: details, formats, tracks, rooms, buildings

BUILDPLAN: M-09 — Wave 1 (§4), walkthrough step 2

Scope (verbatim): Event details (incl. timezone driving every rendered time and ICS `DTSTART`), formats with default durations, tracks with colors + reorder, rooms with capacity. Save confirms in place, no reload.

Amendment 11 fold (SPEC.md, post-BUILDPLAN-v1.4 — flagged to the orchestrator; SPEC allocates +2 h across Event Settings, seed, and agenda): **Buildings card** — an event supports multiple buildings, each with a name and address, managed from Event Settings; every room belongs to a building (AC-252). **Rooms card** gains a building select, an **AV capabilities** tag editor (projector, confidence monitor, mic count, livestream), and free-text **notes** (AC-253). Room displays that schedulers and day-of staff read render "Room · Building". The v1.6 prototype (`prototypes/pipeline-v1.1/index.html`) carries the buildings card, room AV tags/notes, and Room·Building headers — reproduce it one-to-one.

File surface: `src/routes/event-settings.routes.ts`, `src/ui/settings/*`

ACs: AC-5 – AC-13 · **AC-252, AC-253** (Amendment 11 fold — settings-side owner)
Hours: 4 (+~1 for the venue fold)
Workflow: inline-full
Shared files: none — module-local.
Deps: M-08
Plan: filled in by delegator's plan phase

## Plan (MRQ-10)

### Scope and ownership

- Add the generated API module `src/routes/event-settings.routes.ts` for the event settings resource and its event-scoped formats, tracks, buildings, and rooms collections.
- Add `src/ui/settings/EventSettings.tsx` and module-local settings styles, then mount the real settings surface from `AppShell` for `/settings` and `/settings/venues`.
- Add AC-tagged integration coverage under `tests/` and `tests/ac-claims/MRQ-10.json` for event persistence, timezone validation, collection CRUD/reorder, building/room invariants, AV/notes, and no-reload UI contract markers.
- Do not edit contract documents, migrations, seed files, agenda/submission readers, or the prototype. MRQ-58's geography columns are read and written through the settings API; no new columns are added.

### API design

- `GET/PATCH /api/v1/events/{eventId}` returns the event plus formats, tracks, buildings, and rooms in one settings payload. PATCH accepts only settings-owned event fields (`name`, dates, timezone, venue, logo key, tagline, accent), validates date order and IANA timezone, and uses `If-Match`/ETag for concurrent writes.
- `GET/POST /api/v1/events/{eventId}/{formats|tracks|buildings|rooms}` and `GET/PATCH/DELETE /api/v1/events/{eventId}/{formats|tracks|buildings|rooms}/{resourceId}` provide CRUD. Collection rows carry `position`; PATCHing a position normalizes the collection order, so the drag reorder is durable.
- Formats validate default/min/max duration bounds; tracks validate hex colors; buildings require name and address and expose `lat`, `lng`, and `access_minutes`; rooms require a same-event `building_id`, positive capacity, a JSON array of AV tags, and nullable notes.
- Reads require `program:read`; writes require `program:write`. Resource IDs are always constrained by `event_id`, and failed building deletes are explicit when rooms still reference the building. Mutations return current ETags; a stale `If-Match` is a 409.

### UI design

- Use the installed Flight Deck shell primitives and prototype copy: `Conference settings`, `Event details`, `Formats`, `Tracks`, `Buildings`, `Rooms`, and primary `Save event settings`. UI copy uses “conference”; API paths retain `/api/v1/events/...`.
- Load with an honest skeleton and inline retryable error; submit one in-place save operation with dirty-state tracking and fixed card geometry. No `window.location` or reload is used after save; success/error is a toast and an inline status region.
- Details include name, dates, venue, logo file affordance, timezone, and the inheritance note. Formats include range/default duration and add/remove. Tracks include color and drag reorder. Buildings include name/address plus existing geography fields. Rooms include name/capacity/building select, AV capability tag buttons, notes, and reorder controls.
- Buildings and Rooms use full-row cards (`grid-column: 1 / -1`) for legibility. `/settings/venues` uses the same data and writer with a venue-focused heading/tab, so there is no read-only duplicate surface.

### Verification

- Run TypeScript/build checks and the AC-tagged integration test against the real generated manifest and D1 migration fixture.
- Run the default suite, `npm run trace:ac -- --scope=all`, and `npm run pr-gate -- --ticket MRQ-10` before opening the PR. Record exact results in the completion comment.
- Self-review the exact HEAD with a standard-shaped review artifact because headless plan/code review is suspended; validate the API with Worker tests and the UI's no-reload/save contract through the route component tests or running app probe available in this worktree.
