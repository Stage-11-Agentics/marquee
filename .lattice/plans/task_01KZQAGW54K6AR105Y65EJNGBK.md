# MRQ-62 implementation plan

## Binding decisions

- Keep `Sheraton New York Times Square, 811 7th Ave, New York, NY 10019` at
  `40.7625188, -73.9814528` as the primary building.
- Replace the same-address Workshop Annex with the real New York Marriott
  Marquis at `1535 Broadway, New York, NY 10036`, using the verified
  OSM/Nominatim coordinate `40.7585971, -73.9861935`. The repository walking
  formula gives 9 minutes from the Sheraton; seed 3 minutes of building access
  so the modeled total is 12 minutes. `Online` remains null/null and unpinned.
- Do not edit `prototypes/pipeline-v1.1/index.html`; v1.7 is binding, but its
  2025 building set conflicts with the operator ruling. Report that divergence
  to the Orchestrator when the PR opens.
- Keep building entrance/security instructions in `buildings.access_note` and
  keep room notes for room-specific operational notes only. Preserve the
  existing AV capability JSON shape and expose it in the venue editor.

## Implementation slices

1. **Schema and seed contract**

   - Add additive `migrations/0003_building_access_note.sql` and mirror the
     nullable `access_note` field in `BuildingRow`.
   - Update `scripts/seed/event.ts` to seed Sheraton, Marriott Marquis, and
     unpinned Online. Rename the overflow building/room identifiers so the
     public seed no longer calls a real second venue an Annex; use deterministic
     IDs and verified address-derived coordinates.
   - Seed AV tags and room notes in the existing JSON/text columns, with no
     room note containing door, photo-ID, entrance, or security instructions.
     Put the building access/security copy on `access_note`.
   - Make the existing agenda seed place a shared participant in two different
     physical buildings with an insufficient gap, so the seeded data itself has
     a genuine Transit candidate rather than merely a non-zero column.

2. **Measured geometry and seed proof**

   - Add a small pure geometry/conflict module with the contract formula
     `floor(haversine * 1.3 / 80)`, floored at 1, and explicit null/Online/same
     building exclusions. Return a `Transit` conflict with walk, access,
     needed, and available minutes.
   - Replace the `check:seed` stub with a live check that builds the real seed
     rows, resolves agenda rooms/buildings/participations, calls the same
     detector, and fails unless at least one actual Transit conflict fires.
     Also assert two distinct pinned buildings, a non-zero access value, and
     Online null coordinates. Add AC-tagged node coverage for the detector and
     its seeded result.

3. **Venue API and shared writer**

   - Add `src/routes/venues.routes.ts` (the `*.routes.ts` suffix is required)
     with an authenticated event-scoped GET and one atomic venue-model save
     endpoint. The save accepts the complete building/room model, validates
     coordinate pairs, ownership, room-building references, AV arrays, and
     non-negative access minutes, then applies deletions/upserts in one D1 batch.
   - Put the mutation in a reusable venue writer module so both the Venues
     screen and the Event Settings save path share one implementation/call
     site. Keep API paths under `/api/v1/events/...`; generated manifest and
     OpenAPI parity must discover the new module automatically.

4. **UI surfaces**

   - Add `/settings/venues` to the route table and render a real Venues screen:
     fixed-height reserved map box, plain OSM raster `<img>` tiles on a
     centre-clipped plane, SVG walking lines and minute labels, visible
     attribution, graph-paper/pins fallback on tile failure, and no map
     library/CDN/API key. Render building rows with name/address/coordinates,
     access minutes/access note, add/remove, and rooms with name/capacity,
     building, AV tags, notes, add/remove. Save and reload through the API.
   - Render `/settings` as a settings summary with building/room counts and a
     link to `/settings/venues`; do not place venue editor selectors there.
     Keep venue persistence in the shared writer path for future details,
     formats, and tracks work from MRQ-10.
   - Use conference vocabulary in UI copy and render room displays as
     `Room · Building` whenever the comparison is meaningful. Avoid reviving
     the prototype’s 2025 venue names.

5. **Acceptance artifacts and verification**

   - Add `tests/ac-claims/MRQ-62.json` owning AC-252, AC-253, AC-255, AC-256,
     and AC-257, with AC-259 exercised by the live seed check as required by
     the operator ruling.
   - Add route/API, migration, seed, geometry, shared-writer, and UI contract
     tests. Run the full hermetic suite, `check:seed`, `check:api`, design/repo
     checks as applicable, and a real local API/UI validation before opening
     the PR. Record observed runtime proof separately from static test results.
   - Self-review the exact branch diff, run `npm run pr-gate -- --ticket
     MRQ-62`, commit logical slices, push `mrq-62-venue-map` to Forgejo, open a
     PR against `master`, attach the PR reference, and stop at `pr_open` for
     the Orchestrator to merge.

## Non-goals

- Do not edit contract documents or mint AC IDs.
- Do not edit the binding prototype in this ticket.
- Do not implement the downstream agenda/public arrival/ICS surfaces owned by
  M-58/M-59; expose the stable venue data and geometry seam they consume.
- Do not use a fabricated venue, coordinate, map provider SDK, CDN, or API key.

## Verification commands

```text
npm test
npm run check:seed
npm run check:api
npm run trace:ac -- --ticket MRQ-62
npm run pr-gate -- --ticket MRQ-62
```
