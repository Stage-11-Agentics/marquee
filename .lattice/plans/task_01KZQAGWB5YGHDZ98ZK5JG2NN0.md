# MRQ-64: Arrival instructions — portal location card, place merge fields, ICS GEO

Status: planning
Ticket: BUILDPLAN M-59 · AC-260–AC-262 · SPEC Amendment 14 · US-79
Base: `forgejo/master` @ `24973bb966b049b41d8e4a081f744f3878ed18d6`

## Authority and boundaries

The boot prompt and current `DESIGN.md` bind prototype **v1.9**. The ticket
scaffold still says v1.7; that stale wording is not an implementation target.
Do not edit SPEC/EVALUATION/BUILDPLAN/USER_STORIES/DESIGN/PHILOSOPHY or mint
AC IDs. The implementation must preserve the already-merged venue, comms,
portal, and calendar seams and must keep `access_note` off every public
projection.

## Implementation plan

1. **Create one shared arrival/place projection in `src/lib/venue-geometry.ts`.**
   Extend the building shape used by the existing venue records with the
   address, entrance note, coordinates, and access minutes needed by a speaker
   session. Add pure, testable helpers for a room/building location, optional
   GEO, local-day matching, and leave-by calculation. Leave `walkingMinutes()`
   as the only walking calculation (haversine × 1.3 ÷ 80, floored at one).
   A scheduled session uses the speaker's own previous same-day session as its
   origin; if there is no such session, use the event's primary building. A
   missing schedule, missing building, or unpinned origin/current building must
   produce an explicit degraded state rather than a guessed time or location.

2. **Expose the projection only to the authenticated portal.** In
   `src/routes/portal.routes.ts`, load the complete room/building record and
   the speaker's own schedule, compute the arrival model through the shared
   geometry helper, and include it in each scheduled submission's slot. Keep
   the session/person authorization predicates unchanged. In
   `src/ui/portal/PortalPage.tsx` and `src/ui/portal/portal.css`, reproduce the
   v1.9 "Where you are speaking" card: room, building, street address,
   entrance note, leave-by explanation, and honest unscheduled/unpinned copy;
   preserve stable layout and avoid a public-facing map or disclosure.

3. **Thread the same projection through comms.** Extend the canonical
   recipient row in `src/routes/comms.routes.ts` (including the existing
   explicit-empty-selector no-op) with the current room/building record and
   the speaker's previous-session/primary-building context. Pass it through
   `mergeDataForRecipient` in `src/jobs/mail/merge-data.ts`; do not add a
   renderer. Add the five exact place fields to the existing editor reference
   in `src/ui/comms/CommsScreen.tsx`. Ensure preview and outbox queueing call
   the same merge/render path and therefore produce byte-identical subject,
   HTML, and text; preserve unknown-field pass-through and all demo-safe mail
   policy behavior.

4. **Upgrade the existing calendar seam without changing invite lifecycle.**
   In `src/jobs/calendar/invites.ts`, select the room's building address and
   coordinates and build the location/GEO inputs through the shared helper.
   In `src/jobs/calendar/ics.ts`, add an optional `GEO:lat;lng` property only
   for a complete pin and keep `LOCATION` RFC-5545 escaped for backslash,
   comma, and semicolon. Do not alter METHOD, UID, SEQUENCE, status/cancel,
   MIME, or idempotency semantics; preserve the existing public calendar
   projection's disclosure boundary.

5. **Add AC-tagged proof and claim ownership.** Extend/add tests under
   `tests/` for AC-260–AC-262: shared geometry/fallback/degraded cases;
   authenticated portal presence plus a positive-control public agenda/page
   response that is 200 and does not contain the access note; comms preview vs
   rendered outbox equality for all five fields plus unknown-field pass-through
   and editor reference; and parsed ICS LOCATION escaping, pinned GEO, absent
   GEO, and unchanged request/update/cancel fields. Keep negative assertions
   paired with status/positive controls. Add `tests/ac-claims/MRQ-64.json`
   owning AC-260–AC-262, then run the focused tests, `npm test`, and the full
   ticket gate.

## Verification and delivery sequence

- After each phase boundary, fetch `forgejo` and record the exact base SHA.
- Self-review the plan, append an authoritative resolution block for any
  finding, then move `in_planning → planned → in_progress` before code.
- Commit and push this plan as the first commit from the MRQ-64 worktree.
- After implementation, run focused AC tests, `npm test`, `npm run check:api`,
  `npm run check:design`, and `npm run pr-gate -- --ticket MRQ-64`.
- Move to `review`, attach a PASS review for the exact branch HEAD, then move
  to `in_validation`. Exercise the authenticated portal and public agenda
  locally (headless/c11 browser if available) and attach observed evidence.
- Create a Forgejo PR from `mrq-64-arrival` to `master`, attach its URL,
  include the gate output in the completion comment, move to `pr_open`, and
  report the terminal state to the Orchestrator at workspace:9/surface:60.

## Non-goals and hazards

- No public `access_note` exposure, public-site redesign, venue migration, or
  duplicate merge renderer.
- No third `always_live` writer and no direct provider fetch.
- No changes to the calendar invite lifecycle or to the existing list/route
  contracts. If the stale v1.7 ticket wording conflicts with the v1.9 design,
  keep v1.9 and flag the deviation in the completion breadcrumb.

Baseline observed before implementation: `npm test` passed 30 files / 173
tests in 14.8s on the clean install; existing missing-secret warnings were
non-fatal.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

**Verdict: PASS.** Self-review found no untriaged plan defect. The plan keeps
the geometry formula in the existing helper, routes both comms preview and
outbox through the master merge path, preserves the empty-selector no-op and
calendar lifecycle, and makes the authenticated/public disclosure boundary a
single positive-control test. The v1.7 wording conflict is explicitly resolved
in favor of the v1.9 binding visual contract.
