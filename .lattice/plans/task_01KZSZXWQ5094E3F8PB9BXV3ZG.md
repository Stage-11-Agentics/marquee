# Execution plan

## Approach

1. Establish a clean baseline without touching the existing unrelated working-tree changes; inspect `ArrivalCard`, `VenueMap`, the portal/venue styles, and AC-263 coverage.
2. Reuse the existing `VenueMap` projection, OSM tile loading, labelled-pin rendering, and tile-failure fallback. The preferred judgment call is to adapt the portal location at the call site into the existing `VenueBuildingInput` shape, widening the shared input only if the current type makes that mapping materially unsafe; no parallel map implementation.
3. Replace only the portal map slot: remove its `<details>` disclosure and header Directions duplicate, render a fixed-height always-visible map for a pinned location, put one Directions link over the map, and render a fixed-height truthful empty state with no link when either coordinate is absent. Use existing Flight Deck/venue tokens and preserve `show_building_comparison` for comparison behavior.
4. Update the stale portal assertion in `tests/node/venue-disclosure.AC-263.test.mjs` to assert the new map contract while leaving the remaining AC-263 comparison assertions unchanged. Add focused coverage for named/fallback labels, the single Directions link and URL, no disclosure, and the no-pin state/fixed slot.
5. Run the focused tests and full `npm test` within the 45-second suite budget, then run the proportionate static/build gate. Exercise the deployed speaker flow at `https://marquee.stage11.dev` with the c11 embedded browser, signed in as a speaker with a scheduled session; verify rendered OSM tiles, building label, exactly one Directions control, its new-tab Google Maps URL, and the no-fold surface, and capture a screenshot. Browser approval is scoped to that domain and navigation-only validation; do not submit or mutate conference data.
6. Commit only MRQ-91 files, push the task branch to the `github` remote, refresh exact-head/base evidence, and open a PR with the root cause, implementation, judgment call, AC-263 assertion rationale, test results, and live screenshot evidence. Human merge remains out of scope.

## Scope and non-goals

- In scope: `ArrivalCard`'s speaker-portal venue slot, the shared `VenueMap` interface/call site only as required for reuse, portal/venue styling needed for the fixed map surface, and the named AC-263 test assertion.
- Out of scope: organizer venue-map behavior, building comparison, seed/deployment plumbing, unrelated live-site defects, and any other ticket.

## Evidence handoff

- Keep observed browser behavior, screenshot path, exact test commands/timings, commit SHA, branch, and PR URL in the Lattice comments and final review artifact.
- If the deployed site is behind the branch or speaker credentials are unavailable, record the exact blocker and raise a c11 flag instead of claiming live proof.

# MRQ-91: Speaker portal venue map is a coordinate stub — render a real map, name the building, put Directions on it

The speaker portal's "Where you are speaking" card shows a fake map. Operator
feedback while exercising the live site (2026-08-11).

## What is wrong

`src/ui/portal/PortalPage.tsx` `ArrivalCard` (~line 473) renders a placeholder,
not a map:

- It is a `.portal-arrival-map` div — a CSS-gradient grid with a `::before` dot —
  showing the literal string **"Pinned venue"** and the raw **`lat, lng`** pair.
  A speaker sees `40.7625, -73.9814` where a map belongs.
- The label says "Pinned venue" instead of the building's name, which the card
  already has in hand as `location.building`.
- The map sits inside a `<details class="portal-arrival-map-fold">` whose summary
  toggles "Show venue map" / "Venue map" — a shrink/expand the operator does not
  want in that slot.

A real tile map already exists and is in production use on the organizer Venues
page: `src/ui/venues/VenueMap.tsx` (OpenStreetMap tiles, Web-Mercator projection,
pins with labels, `tilesFailed` fallback). It handles the single-pin case
correctly — `pinned.length === 1` renders tiles and one labelled pin, and the
walking-line loop is simply empty. The portal was never wired to it.

The live site sends no Content-Security-Policy header, so `tile.openstreetmap.org`
images are not blocked. Verified 2026-08-11 via `curl -sI https://marquee.stage11.dev/`.

## What it should be

1. **Real map.** Render an actual tile map for the session's building instead of
   the coordinate stub. Reuse `VenueMap` rather than writing a second map — extract
   or adapt it so the portal can pass one point. `VenueMap` currently takes
   `readonly VenueBuildingInput[]`; the portal has `slot.location` with
   `{ building, address, lat, lng }`. Adapt at the call site or widen the component's
   input; do not fork the projection/tile code.
2. **Name, not jargon.** The label reads the building name (`location.building`).
   Fall back to the address, then to a plain sentence if neither exists. The word
   "Pinned" is internal vocabulary and should not reach a speaker.
3. **Directions replaces the disclosure.** Remove the `<details>` fold in the map
   slot; the map is always visible. Put the **Directions** control on the map itself,
   where the expand/collapse affordance used to be. Its behavior is unchanged —
   the existing `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>` link
   opening in a new tab is correct and the operator confirmed it is fine as-is.
4. **One Directions button, not two.** `ArrivalCard`'s header already renders a
   `Directions ↗` link. With the button moving onto the map, remove the header
   duplicate — a card should not offer the same action twice.
5. **No-pin case stays honest.** When `lat`/`lng` are null, keep a truthful empty
   state ("The conference team has not pinned this building.") and render no
   Directions button. Do not show a broken map frame.

## Constraints

- **`tests/node/venue-disclosure.AC-263.test.mjs:50` asserts
  `/portal-arrival-map-fold/` against `PortalPage.tsx`.** Removing the fold breaks
  it. That assertion encodes the old disclosure design, not the AC's intent —
  AC-263 is about folding *building comparison* until a second building is pinned,
  which is a different surface (the organizer Venues page keeps its
  `venue-map-fold`, untouched). Update the portal assertion to match the new design
  and leave the other AC-263 assertions alone. Explain the change in the PR body.
- `show_building_comparison` still governs comparison affordances elsewhere in the
  card; do not repurpose it to hide the map.
- Flight Deck aesthetic per `DESIGN.md`. The map is a real surface now — give it the
  same treatment `venues.css` gives `.venue-map-shell`, adapted to the portal's
  darker card, and reuse tokens rather than inventing colors.
- **Elements never jump** (global UI rule): the map slot has a fixed height whether
  tiles load, fail, or there is no pin.
- Suite budget 45s, gate budget 120s.

## Acceptance

- A speaker with a scheduled, pinned session sees a real map with their building
  pinned and labelled by name — no coordinates rendered as body text anywhere.
- The words "Pinned venue" appear nowhere in the speaker portal.
- A **Directions** button sits on the map and opens the Google Maps directions URL
  for the building in a new tab; there is exactly one Directions control on the card.
- No expand/collapse control remains in the portal's map slot.
- Unpinned session: honest empty state, fixed height, no Directions button.
- Validated against the **live deployed site** at https://marquee.stage11.dev,
  signed in as a speaker with a scheduled session — screenshot in the PR showing
  tiles actually rendering, not just a passing test.
- `npm test` green within budget; PR open against `Stage-11-Agentics/marquee` `main`.
