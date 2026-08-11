# Plan Review: MRQ-64 — Cycle 2

Reviewer: Claude (plan review) · Base checked: working tree at `2ebdc89` lineage · Binding artifact driven: `prototypes/pipeline-v1.1/index.html` (v1.9)

## 1. Verdict

**FAIL (plan-level)** — the plan is structurally excellent and every seam it names verifiably exists, but its written semantics for two of the three deliverables diverge from the binding v1.9 prototype in ways that would fail AC-261 and the "degrade honestly" requirement if the plan text were followed literally. Each fix is a small plan amendment; return to `in_planning`, append resolutions, and proceed.

## 2. Summary

I reviewed the five-step plan against the task description, SPEC Amendment 14, EVALUATION.md AC-260–AC-262, and the actual codebase and prototype. The codebase claims all check out: `walkingMinutes()` exists in `src/lib/venue-geometry.ts` with the exact formula, `mergeDataForRecipient` is the single canonical merge path shared by preview and outbox, `escapeIcsText` handles RFC 5545 TEXT escaping, `access_note` is migrated (`migrations/0003_building_access_note.sql`), and the portal query already joins agenda → room → building. The key concern is that the plan's prose under-specifies leave-by suppression semantics and mischaracterizes the current editor field reference as already satisfying AC-261's "insertable" requirement — both places where the plan text and the binding prototype disagree, which is exactly the ambiguity a plan should close.

## 3. Issues

**[MAJOR] Step 3 — "the existing editor reference" is display-only; AC-261 requires insertable**
The plan says "Add the five exact place fields to the existing editor reference in `src/ui/comms/CommsScreen.tsx`." The existing reference (`CommsScreen.tsx:83–89, 323`) is a passive row of `<code>` chips with no click handler. AC-261 grades "an insertable field reference exists in the editor," and the binding v1.9 prototype renders each field as a `<button class="merge-chip" data-merge-field=…>` that inserts the token at the textarea caret, with the field-note "Click a field to insert it" (prototype lines 2338, 3187–3189). A builder extending "the existing reference" ships nine passive chips and fails AC-261 and the one-to-one reproduction rule. Note also the prototype's reference carries nine fields (including `conference.name`), not just the current five plus the new five — the built list must match the prototype's set.
**Recommendation:** Amend step 3 to state the chip row is upgraded from display-only to click-to-insert buttons (token inserted at caret in the focused subject/body field, per prototype v1.9), with the field set matched to the prototype, and add an insertion interaction to the AC-261 test/e2e coverage in step 5.

**[MINOR] Step 1 — leave-by suppression rules omitted; the 1-minute floor can fabricate a leave-by**
The plan's degraded states cover unscheduled session, missing building, and unpinned origin/current building — but the binding prototype's `transitTo` (line 2626–2632) suppresses leave-by in two further cases: (a) `geoActive()` is false — fewer than two *pinned* buildings, the AC-263 fold rule ("zoom 1 is not independent of building count"); and (b) origin building equals destination building (`from.id === to.id` → null). Because `walkingMinutes()` floors at 1 minute, a helper built from the plan text alone would emit "leave by = start − 1 − access" for back-to-back sessions in the same building and for every single-building conference — a fabricated number, violating the task's "state the absence rather than implying a location." The prototype also defines the merge-field fallback precisely: `session.leaveBy` resolves to the session start time when there is no transit context, `—` when unscheduled (line 2361).
**Recommendation:** Enumerate all suppression cases in step 1's helper contract (no leave-by when <2 pinned buildings, when origin === destination building, plus the already-listed degraded states) and state the `session.leaveBy` fallback chain explicitly; add same-building and single-pinned-building cases to the geometry tests in step 5.

**[MINOR] Steps 1–3 — leave-by format and timezone unstated; the ISO-string precedent would leak into delivered mail**
The prototype renders leave-by as a local clock string ("HH:MM"); the app stores `starts_at` as epoch ms, and the existing `session.time` merge field renders a raw ISO-8601 string (`merge-data.ts:25–27`). The plan never says what format or timezone `{{session.leaveBy}}` and the portal card use. Following the nearest in-repo precedent produces "Plan to leave by 2026-10-12T14:35:00.000Z" in a delivered speaker email — prototype-divergent and a clear violation of the organizer's-language principle. Timezone infrastructure already exists in the calendar seam (`ics.ts` VTIMEZONE handling).
**Recommendation:** State in step 1 that leave-by is formatted as a local clock time in the event's timezone, used identically by the portal card and the merge field (byte-identical preview/outbox comes free from the shared path), and assert the format in the AC-260/AC-261 tests.

**[MINOR] Step 1 — "the event's primary building" is undefined in plan and schema**
The schema has no primary flag; buildings carry only `position`. The prototype defines `primaryBuilding()` as `pinnedBuildings()[0]` — the first *pinned* building in position order (line 2609). A builder picking `buildings[0]` regardless of pin would, for an unpinned first building, either fabricate an origin or degrade unnecessarily.
**Recommendation:** Define "primary building" in step 1 as the first pinned building in position order, matching the prototype, with a test where the first-positioned building is unpinned.

One observation, not blocking: when adding `GEO:lat;lng` in `ics.ts`, note GEO is a float-pair property, not TEXT — running `escapeIcsText` over it would escape the semicolon and corrupt the property. The plan's wording ("add an optional GEO property") is compatible with the right implementation; flagging so it lands in the resolution block rather than in code review.

## 4. Positive Observations

- **Every codebase claim in the plan verified true.** The shared-helper location, the `haversine × 1.3 ÷ 80` floor-at-1 formula, the single `mergeDataForRecipient` path serving both preview (`comms.routes.ts:394, 550–554`) and outbox (`outbox.ts:66–69`), the explicit-empty-selector no-op (`comms.routes.ts:204`), the existing portal room/building join (`portal.routes.ts:421–434`), and the migrated `access_note` column are all exactly as described. This is a plan written from the code, not from imagination.
- **The v1.7/v1.9 authority conflict is resolved correctly and explicitly** — DESIGN.md line 4 confirms v1.9 is binding, and the plan both names the stale ticket wording and commits to flagging the deviation in the completion breadcrumb.
- **Excellent hazard discipline**: keeping `access_note` off every public projection with a positive-control 200 test, refusing a second merge renderer, preserving METHOD/UID/SEQUENCE/cancellation semantics from AC-95–AC-97, and pairing every negative assertion with a status control.
- **The decomposition is the right shape** — one pure projection in `venue-geometry.ts` consumed by three surfaces is exactly how byte-identical preview/mail and consistent portal/ICS behavior fall out for free, and it keeps the walking formula in one place.
- **Verification sequence is complete**: focused AC tests, full suite, `check:api`, `check:design`, the ticket gate, ac-claims ownership, and live portal/public-agenda evidence before PR.

The four issues share one root: the plan trusts "reproduce v1.9" to carry semantics its own prose contradicts or omits. Closing them is a few sentences in the resolution block — the architecture needs no change.
