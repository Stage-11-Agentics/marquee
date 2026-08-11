# Code Review: MRQ-64 — Arrival instructions (portal location card, place merge fields, ICS GEO)

## 1. Verdict

**PASS**

## 2. Summary

I reviewed the MRQ-64 implementation against the plan and AC-260–AC-262, then verified it live in the `mrq-64-arrival` worktree: `npm test` passes (hermetic suite in budget, 47 node tests), and `npm run pr-gate -- --ticket MRQ-64` passes (15.5s / 45s budget, 0 uncovered ACs, 0 errors). The implementation is faithful to the plan: one shared arrival projection in `venue-geometry.ts` feeds the authenticated portal card, the comms merge path, and the calendar seam; preview and delivered mail are proven byte-identical by test; ICS gains conditional GEO and correct RFC-5545 LOCATION escaping without touching METHOD/UID/SEQUENCE semantics; and the public agenda disclosure boundary is asserted with a 200 positive control. Only minor issues remain — none blocks merge.

**Scope note for the record:** the diff embedded in this review prompt was generated against a stale base and therefore includes upstream content that is not part of this ticket — the entire MRQ-30 token/auth surface (`tokens.routes.ts`, `ApiTokensPage.tsx`, `auth-middleware.ts`, `scope-resolution.ts`, `router.ts` method-scoping) plus `.lattice/**` board state for MRQ-30/31/35/38. I confirmed against the repository that `forgejo/master...mrq-64-arrival` is exactly 16 files / +604 −27, all MRQ-64-scoped, and that the branch does **not** touch the auth predicates (`requireComms`/`tokenHasGrant` changes are already merged upstream). This review's judgment covers the real 16-file branch diff; the MRQ-30 material was reviewed under its own ticket.

## 3. Issues

**[MINOR] src/routes/portal.routes.ts:431 — duplicated `arrivalBuildingFor` adapters with divergent guards**
The portal adapter additionally requires `building_address !== null` while the comms adapter (`src/routes/comms.routes.ts:210`) defaults a missing address to `""`. Today the divergence is unreachable — `buildings.address` is `NOT NULL` in `migrations/0001_init.sql:65`, so `building_address` can only be null when the whole LEFT JOIN missed (in which case `building_id` is null too) — but the plan's premise was *one* shared projection, and two near-identical row adapters with different guards is exactly where the surfaces drift apart if address ever becomes nullable.
**Fix:** Hoist a single row→`ArrivalBuilding` adapter into `src/lib/venue-geometry.ts` (or align the two guards) so portal and comms cannot diverge.

**[MINOR] src/ui/portal/PortalPage.tsx (ArrivalCard) — the "unscheduled" copy branch is unreachable dead code**
`ArrivalCard` renders only when `submission.slot` is non-null, and `slot` exists only when `starts_at` is non-null — so `arrival.status === "unscheduled"` can never occur inside the card, and the copy "Your arrival instructions will appear when the session time is set" is dead. This matches the binding prototype (`portalLocationCard()` returns `""` when there is no slot), so it is not an AC miss — the unscheduled degrade is legitimately "no card + Schedule —" — but the dead branch reads as coverage that doesn't exist.
**Fix:** Delete the unreachable branch (and the equally unreachable default copy), or leave a one-line comment stating the card is slot-gated so the branch is defensive only.

**[MINOR] src/ui/portal/PortalPage.tsx (ArrivalCard) — same-building arrivals render "0 min walk"; prototype uses access-only phrasing**
When the origin equals the current building, `walk_minutes` is 0 and the copy renders "From South Annex · 0 min walk · 3 min to get in. Leave by …". The prototype's same-building case drops the walk clause entirely ("Allow N min to get through the door — arrive by …"). "0 min walk" is honest but awkward, and it is a visible copy deviation from the binding prototype.
**Fix:** Suppress the walk fragment when `walk_minutes === 0`, keeping the access-minutes and leave-by clauses.

**[MINOR] tests/integration/api/role-confirmation-feedback.AC-152-154-235-236.test.ts:3800 — the leave-by assertion is too weak to catch a resolution regression**
The AC-261 test asserts `text` contains `"Leave by"` but never the resolved time, so a regression that resolves `{{session.leaveBy}}` to the `"—"` fallback (e.g., a broken previous-session join or a null-pin path) would still pass — the preview/delivery byte-equality would hold on the wrong value. The fixture deliberately seeds a previous same-day session in a second pinned building, so a concrete expected time is computable.
**Fix:** Assert the resolved formatted time (or at minimum `not.toContain("Leave by —")`).

**[MINOR] src/ui/portal/PortalPage.tsx:3307 (ArrivalCard) — heading id keyed on `starts_at` can collide**
`aria-labelledby={`arrival-heading-${slot.starts_at}`}` produces duplicate DOM ids if one speaker has two sessions with the same start time (double-booked parallel tracks do happen). Duplicate ids break the aria association.
**Fix:** Key the heading id on the submission id, which is already unique per card.

## 4. Positive Observations

- **The shared projection actually is shared.** `arrivalForSession`, `sessionLocation`, `buildingGeo`, and `walkingMinutes` in `venue-geometry.ts` are the single math/formatting source for the portal card, the comms merge fields, and the ICS LOCATION/GEO inputs — the plan's central bet, executed cleanly. The degraded states (`unscheduled` / `unassigned` / `unavailable`) are explicit values, not guessed times, and `previousSessionFor` has a deterministic tie-break.
- **Byte-identical preview and delivery is proven, not asserted.** Both preview (comms.routes.ts:652) and send (comms.routes.ts:699) flow through the same `recipientsFor` → `hydrateRecipientArrivals` → `mergeDataFor` path, and the AC-261 test compares the delivered outbox row `{subject, text, html}` to the preview payload with `toEqual` — plus unknown-field pass-through (`{{session.not_a_field}}` survives intact).
- **The disclosure boundary test is done right.** The AC-240/AC-260 portal test asserts the access note *is* present in the authenticated portal, then fetches the public agenda, asserts a 200 (positive control), and asserts the note is absent — a negative assertion that can't rot into a vacuous pass.
- **Hydration is batched, not N+1.** `hydrateRecipientArrivals` resolves every recipient's schedule in one `json_each`-bound query plus two lookups regardless of audience size — respectful of R7 (speed as a graded feature).
- **Calendar lifecycle untouched.** GEO is emitted only for a complete finite pin, LOCATION escaping covers `,` `;` `\`, and the integration test re-verifies UID/SEQUENCE/METHOD across request → update → cancel alongside the new assertions. Room-scoped joins (`room.event_id = s.event_id`, `building.event_id = ...`) keep the cross-event boundary tight.
- **Honest fallbacks in mail.** Every place field degrades to `"—"` rather than blanking, and `leaveBy` renders through the event timezone with a UTC fallback.

## Verification performed

- `npm test` in the `mrq-64-arrival` worktree: **PASS** (hermetic suite 18.9s/30s budget; 47/47 node tests).
- `npm run pr-gate -- --ticket MRQ-64`: **PASS** (15.5s/45s budget; AC trace 0 uncovered, 0 errors; types, build, design contract all pass).
- Confirmed the real branch diff (`forgejo/master...mrq-64-arrival`) is 16 files scoped to MRQ-64; the MRQ-30 content in the prompt's embedded diff is upstream, already merged at the branch base.
- Confirmed the binding prototype (`prototypes/pipeline-v1.1/index.html`, `portalLocationCard()`) omits the card when unscheduled, matching the implementation's slot-gating.
