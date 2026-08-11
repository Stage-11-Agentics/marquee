# MRQ-20: Agenda: data, pool, placement, and day/list/week/room views

BUILDPLAN: M-19a — Wave 1 (§4), walkthrough step 10

Scope (verbatim): Unscheduled pool = accepted-and-unplaced, configurable schedulable statuses, drag pool↔slot, drop sets date/time/room, duration from format, resize, **no save button**, filters + scroll preserved across view switches. **The unscheduled pool is derived from status** (accepted-and-unplaced), so a live M-18 accept flows into it with no code dependency — which is why this ticket depends on M-08's list/queries and **not** on M-16's evaluation plan. That dependency was serializing the whole agenda branch behind evaluation and made M-08 → M-16 → M-19a → M-20 → M-22 the longest chain in Wave 1; removing it is the single cheapest schedule win available (F-17).

Non-goal (EVALUATION §5): **no Month view.** List, Day, Week, Track, and Room are the five signed views; "Month" appeared only in a context reference image.
Amendment 11 fold (SPEC.md): agenda room headers render "Room · Building" and expose the AV/notes tooltip panel where placement decisions happen (AC-252, AC-253) — without cluttering public surfaces.

File surface: `src/routes/agenda.routes.ts`, `agenda.queries.ts`, `src/ui/agenda/*`

ACs: AC-70 – AC-74, AC-80, AC-82 · **AC-252, AC-253** (agenda-side rendering, Amendment 11 fold)
Hours: 7
Workflow: sub-agent-full (≥7 h)
Shared files: none — module-local.
Deps: M-08 (explicitly **not** M-16)
## Implementation plan

### Contract and boundaries

- Implement M-19a in the existing M-08 API/query conventions. The signed agenda views are List, Day, Week, Track, and Room; Month is explicitly out of scope.
- Keep the unscheduled pool derived from the configured raw submission statuses, defaulting to `accepted`, and exclude submissions already represented by a session agenda item. Do not seed or edit buildings: MRQ-62 owns venue geography and its operator ruling; this ticket only reads room/building data for agenda placement and room disclosure.
- Keep agenda drag-and-drop as the only drag placement surface. The program board remains untouched and read-only.
- Preserve existing API protections: route modules use `*.routes.ts` and `defineApiRoute`, event-scoped joins, the `agenda:write` grant for mutations, and strong `If-Match` CAS for mutable agenda items/settings.

### API and query layer

1. Add agenda API types and pure helpers in `src/api/agenda.ts` and `src/routes/agenda.queries.ts` for status-derived pool selection, room labels, schedule metadata, default format durations, and honest room/person/geography warnings. The query layer will carry submission title, speakers, format, primary/all tracks, room/building, AV tags, notes, timezone, publication state, and ETags in one snapshot.
2. Add `src/routes/agenda.routes.ts` with a GET snapshot route plus immediate placement/update/unplace routes. Placement validates that the submission belongs to the conference and has a configured schedulable status, chooses the format default when no duration is supplied, and never blocks a warning conflict. Updates validate room/track ownership and format duration bounds. Settings persistence uses `event_settings` for the configurable schedulable-status list, defaulting safely when absent.
3. Let `_manifest.ts` discover the new module through its existing `./**/*.routes.ts` glob; do not hand-register or create a differently named route module. Keep all public API paths under `/api/v1/events/...` while UI copy says “conference”.

### Agenda UI

1. Add `src/ui/agenda/AgendaPage.tsx` and `agenda.css`, integrate `/agenda-builder` in `AppShell`, and leave the existing route-table contract intact.
2. Reproduce the binding prototype’s Flight Deck structure: page header, five view tabs, day/track filters, scrollable unscheduled pool, dense instrument grid/list/swimlanes, tabular times/counts, and honest loading/error/empty states. Do not render a Save button; drag/drop and resize call the API and update the shared snapshot immediately.
3. Maintain per-view scroll offsets and filter state across switches. Support pool-to-slot, slot-to-slot, and slot-to-pool drag; compute a timezone-correct start instant, use format defaults on first placement, and constrain resize to the format’s min/max.
4. Render every agenda room header as `Room · Building` and attach a hover/click room panel inside the organizer agenda only. The panel shows building/address plus AV capability tags and room notes; no AV/notes metadata is emitted by public agenda surfaces.
5. Surface the deliberately seeded double-bookings and any query-derived travel warnings on tiles and in an accessible conflicts panel. Warnings remain non-blocking and this ticket does not duplicate MRQ-62’s building seed work.

### AC evidence and verification

- Add an AC-tagged test under `tests/` covering AC-70, AC-71, AC-72, AC-73, AC-74, AC-80, AC-82, AC-252, and AC-253 against the exported query/API/UI helpers without weakening existing guardrails.
- Add `tests/ac-claims/MRQ-20.json` with the owned AC IDs. Do not claim AC-75 or MRQ-19b conflict ACs as owned.
- Baseline recorded before edits: after the required clean `npm ci`, `npm test` passed (21 Vitest files, 110 tests; the node seed suite also passed) with only expected missing-secret warnings.
- After implementation: run targeted tests, `npm test`, worker/client/test TypeScript checks, production build, `check:design`, `trace:ac --scope=all`, and the mandatory `npm run pr-gate -- --ticket MRQ-20`. Validate the running agenda API/UI with a local Worker/curl or browser-appropriate probe, attach the evidence, and self-review the exact branch HEAD.

### Lifecycle notes

- Headless plan/code reviews are suspended by the boot instruction. Move through `planned → in_progress → review → in_validation`, attach a standard-shape self-review naming the exact HEAD with a PASS verdict, then open the Forgejo PR and stop at `pr_open` for the Orchestrator.
- If the current contract conflicts with MRQ-62’s later comment assigning AC-252/253 to venue authoring, follow this ticket’s boot scope for agenda-side rendering and explicitly flag the split in the completion comment.
