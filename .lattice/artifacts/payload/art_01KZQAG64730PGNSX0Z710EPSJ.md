# Plan Review: MRQ-10

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The plan's API design, permission model, schema usage, file surface, and file-naming convention are all sound and correctly grounded in the existing codebase (schema.ts, concurrency.ts, scope-resolution.ts, the `*.routes.ts` manifest-glob convention). However, the UI design section describes placing full, editable Buildings and Rooms cards on **both** the main Conference/Event settings screen and `/settings/venues` — but the binding prototype (`prototypes/pipeline-v1.1/index.html`) was updated same-day, immediately before this ticket was dispatched, specifically to *remove* that duplication (commit `74a781c`, "Venues is the screen that edits venues"). The plan reproduces the exact architecture the operator just rejected, in direct conflict with the task's explicit "reproduce it one-to-one" instruction for Amendment 11.

## 3. Issues

**[CRITICAL] UI design — Buildings/Rooms card placement contradicts the current, binding prototype**
The plan states: *"Buildings and Rooms use full-row cards (`grid-column: 1 / -1`) for legibility. `/settings/venues` uses the same data and writer with a venue-focused heading/tab, so there is no read-only duplicate surface."* This describes full editable Buildings/Rooms cards living on *both* the main settings screen and `/settings/venues`.

That is not what the current prototype does, and it is not an incidental detail — it was the subject of a dedicated fix committed the same day this ticket was dispatched (`74a781c`, "Venues is the screen that edits venues", 2026-08-10 22:05:43, one commit before the board note raising MRQ-61 and the refill commit that dispatched MRQ-10). Reading `prototypes/pipeline-v1.1/index.html`:
- `settingsView()` (the Conference tab, `#settings`) renders only a **summary card** — "Venues and rooms" with a building/room count and an `Open Venues →` link — no add/edit affordances for buildings or rooms at all.
- `venuesView()` (`#settings/venues`) is the **sole** location of `buildingsCard()` and `roomsCard()` — the actual Building/Room CRUD, AV tag editor, notes field, and reorder handles.
- The commit message is explicit about why: *"A tab named Venues that could only be read was the defect: buildings and rooms were still authored under the Conference tab... Buildings and rooms now live on #settings/venues... Both screens share one writer, so the conference Save no longer silently owns venue edits it does not show, and Venues gets its own Save."*

So the correct behavior is the **inverse** of what the plan proposes: the Conference screen gets the read-only summary card, and only `/settings/venues` gets the full editable Buildings/Rooms cards. The plan's phrase "so there is no read-only duplicate surface" reads as a deliberate decision to avoid the very pattern that is now correct — which suggests the plan was drafted against an earlier prototype state, before Amendment 11's final iteration landed.

This also means there are **two independent primary Save actions** ("Save conference settings" on `#settings`, "Save venues" on `#settings/venues`), each with its own dirty-state tracking over the fields it displays — not one shared "Save event settings" spanning both screens' data, as the plan's UI copy list implies.

**Recommendation:** Rewrite the UI design section to match `settingsView()`/`venuesView()` exactly: Conference screen = Event details + Formats + Tracks + a read-only Buildings/Rooms summary card linking to Venues; Venues screen = site map (or omit the map if it's out of scope — confirm) + full `buildingsCard()`/`roomsCard()` editors, each screen with its own Save action and dirty-state scope. The underlying API/collection design in the plan (per-resource CRUD under `.../{formats|tracks|buildings|rooms}`) already supports this split cleanly and does not need to change — only the UI section does.

**[MINOR] UI design — copy list doesn't match prototype text**
The plan's copy list ("`Event details`... primary `Save event settings`") doesn't match the prototype, which uses `Conference details` as the card heading and `Save conference settings` / `Save venues` as two separate primary buttons. This is a direct symptom of the critical issue above — SPEC.md §425's older four-card description ("Event details... Save event settings") predates the Amendment 11 / Venues-split copy in the current prototype.
**Recommendation:** Once the card-placement issue above is fixed, pull copy strings verbatim from `settingsTabs()`, `settingsView()`, and `venuesView()` rather than from SPEC.md's earlier prose.

## 4. Positive Observations

- **Schema/migration boundary is correctly scoped.** The plan correctly identifies that `buildings`, `rooms.building_id`, `rooms.av_capabilities`, and `rooms.notes` already exist in `migrations/0001_init.sql`, and that the geography columns (`lat`/`lng`/`access_minutes`) already exist via MRQ-58's `0002_venue_geography.sql`. It correctly declines to touch migrations, matching the actual current schema state (verified directly against `migrations/0001_init.sql` and `src/db/schema.ts`).
- **Route file naming sidesteps a live, related defect.** `event-settings.routes.ts` follows the `*.routes.ts` manifest-glob convention (`src/routes/_manifest.ts`), which avoids exactly the gap just raised as MRQ-61 (`*.endpoints.ts` files silently missing from the generated manifest/OpenAPI doc). This wasn't called out explicitly in the plan but is the right call.
- **Permission scopes match the existing auth model.** `program:read`/`program:write` are real, already-wired grants (`src/api/router.ts`, `src/lib/auth/scope-resolution.ts`), correctly assigned to reads vs. writes.
- **AV capabilities correctly modeled as a fixed tag set**, not a numeric "mic count" field — matches the prototype's `AV_TAGS = ["Projector", "Confidence monitor", "Mics", "Livestream"]` toggle-button implementation despite the task description's looser "mic count" phrasing.
- **Concurrency design reuses the existing helper** (`src/api/concurrency.ts` strong ETag / `If-Match` / 409-stale pattern) rather than inventing a new one.
- **FK/invariant handling is accurate**: rooms' compound FK (`building_id, event_id → buildings(id, event_id)`) genuinely enforces same-event building references, and the plan correctly flags that a building delete with referencing rooms needs an explicit, friendly error rather than a raw constraint failure.
- **Verification section is concrete and appropriately scoped** given headless review is suspended for this run — real build/typecheck, AC-tagged integration tests against the real manifest/migration fixture, `trace:ac`, `pr-gate`, and a self-review artifact.
