# Plan Review: MRQ-91 — Speaker portal venue map

## 1. Verdict

**FAIL (plan-level)**

Two gaps need one round of plan revision before implementation. Neither requires a
redesign — both are amendments to existing plan steps.

## 2. Summary

Reviewed the plan against the live code: `src/ui/portal/PortalPage.tsx:442` (`ArrivalCard`),
`src/ui/venues/VenueMap.tsx`, `src/ui/portal/portal.css`, `src/ui/venues/venues.css`,
`tests/node/venue-disclosure.AC-263.test.mjs`, `scripts/checks/pr-gate.mjs`, and the
deploy posture recorded in `sequence/run-state.md:14`. The plan's strategy is correct and
covers all five "what it should be" items and every acceptance line at the level of intent;
scope discipline and evidence handoff are unusually good.

The key concern is that the plan's central technical commitment — reuse `VenueMap` unforked —
is under-specified in the one dimension that makes reuse hard. `VenueMap` bakes
`MAP_HEIGHT = 360` and `PLANE_WIDTH = 1120` into module constants *and into the geometry that
positions the pin*, while the portal's map slot is ~190–324px wide and 142px tall. The plan's
stated judgment call weighs only the *data* shape (`VenueBuildingInput` vs `slot.location`),
never the geometry. The obvious CSS-only workaround silently hides the pin. Second: the
acceptance criterion demands a screenshot from the live deployed site, and this project has
no auto-deploy — the plan's only answer is to flag a blocker.

## 3. Issues

**[MAJOR] Approach step 2/3 — `VenueMap`'s height and plane width are module constants, and the naive override hides the pin**

`VenueMap.tsx:9-10` fixes `MAP_HEIGHT = 360` and `PLANE_WIDTH = 1120`. Both feed the
projection: `originY = centerY - MAP_HEIGHT / 2` puts a single pin at `y = 180`, and the shell
carries an **inline** `style={{ height: "360px" }}` (`VenueMap.tsx:67`). The portal slot is
`minmax(190px, .7fr)` of `.portal-arrival-body` (`portal.css:23`) — roughly 190–324px wide —
and `142px` tall today (`portal.css:30`).

Two failure modes the plan does not foreclose:

- An implementer who sets the height in portal CSS gets nothing: an inline style beats a class
  rule. If they reach for `!important`, the shell clips to 142px with `overflow: hidden`
  (`venues.css:12`) while the plane still positions the pin at `y = 180` — **the pin renders
  below the visible area and the speaker sees tiles with no pin.** Tests asserting on source
  text would all pass. This is exactly the defect the ticket is fixing, in a new costume.
- Left at 360px, the map slot roughly triples in height and the card's two-column balance
  changes — a layout decision the operator did not ask for.

Horizontal centering *does* survive (`.venue-map-plane` is `left: 50%; translateX(-50%)`, and a
single pin lands at `PLANE_WIDTH / 2`), so width is a cost issue, not a correctness one: a
1120px plane over a ~324px viewport requests ~18 OSM tiles where ~6 are visible, on a project
where speed is graded (R7).

**Recommendation:** Make the plan state the geometry decision explicitly. The clean version is
to parameterize: give `VenueMap` optional `height` and `planeWidth` props defaulting to the
current `360` / `1120` so the organizer page is byte-identical, and have the portal pass its
slot dimensions. Name the chosen portal height in the plan (142px keeps the card layout
unchanged) and state that the height must flow through the component, never through a CSS
override. Add an assertion or manual check that the pin is visible at the portal's height, not
just that tiles render.

---

**[MAJOR] Approach step 5 / Evidence handoff — the live-site acceptance criterion has no reachable path, and the tempting shortcut is dangerous**

Acceptance requires a screenshot from `https://marquee.stage11.dev` showing tiles rendering.
There is **no auto-deploy** — `sequence/run-state.md:14` records this as a live critical-path
risk, notes `main` has drifted from the deployed site twice on 2026-08-11, and merging is
behind a human gate. A feature branch therefore cannot appear at that URL by any normal route,
and the plan's response ("record the exact blocker and raise a c11 flag") produces a PR that
knowingly misses a stated acceptance criterion.

The shortcut an implementer may reach for — `wrangler deploy` from the branch — would push
unreviewed code onto the **judged artifact** the day before a 2026-08-12 22:00 PT deadline.
The plan should forbid it in writing rather than leave it to judgment at 2am.

**Recommendation:** Amend step 5 to name the evidence it will actually produce and in what
order: (a) drive the change locally against the real Worker (`wrangler dev`, https) and capture
the screenshot of real OSM tiles + pin + single Directions control — tiles are third-party and
render identically regardless of host, so this is genuine proof the map works; (b) separately
confirm the *live* site's current portal still shows the old stub, so the PR body states plainly
what is proven and what is pending; (c) re-check `marquee.stage11.dev` after the human merge
and the operator's redeploy, and post that screenshot as a follow-up comment. Add an explicit
non-goal: **do not deploy this branch to `marquee.stage11.dev`.**

---

**[MINOR] Scope — CSS reuse must be portal-scoped or the organizer Venues page moves**

The plan says "portal/venue styling needed for the fixed map surface" while listing organizer
venue-map behavior as out of scope. `venue-map-*` rules live in `venues.css` and are shared;
the whole app is one static bundle (`AppShell.tsx:18,22` imports both pages statically), so
those styles *are* present on `/portal` — but editing them in place silently restyles the
organizer map.

**Recommendation:** State that portal adaptations are written as descendant overrides under a
portal-scoped wrapper class in `portal.css`, and that `venues.css` is not modified.

---

**[MINOR] "What it should be" #3 — the Directions overlay must not cover the OpenStreetMap attribution**

`VenueMap` renders `© OpenStreetMap contributors` inside the shell (`VenueMap.tsx:73`), and the
`tilesFailed` status line shares that space. OSM tile usage requires visible attribution;
placing Directions "where the expand/collapse affordance used to be" — the bottom of the slot —
collides with it, especially in a 142px-tall shell.

**Recommendation:** Note the constraint and place Directions clear of the attribution and the
fallback status line (top-right of the map is the natural slot), with a check that both remain
legible when `tilesFailed` is true.

---

**[MINOR] Test plan — assert the absence of the old vocabulary, not only the presence of the new**

Two acceptance lines are absence claims: "Pinned venue" appears nowhere, and no coordinates
render as body text. The plan's coverage list ("named/fallback labels, the single Directions
link and URL, no disclosure, no-pin state") tests presence. The repo's existing style makes
absence assertions cheap — `venue-disclosure.AC-263.test.mjs` already regex-matches source
text.

**Recommendation:** Add negative assertions against `PortalPage.tsx` and `portal.css` for
`/Pinned venue/`, `/portal-arrival-map-fold/`, and the `${location.lat}, ${location.lng}`
interpolation, plus a positive assertion that exactly one Directions link remains in
`ArrivalCard`.

---

**[MINOR] Step 5 — `pr-gate` will warn on a missing AC-claims manifest for MRQ-91**

`pr-gate.mjs:19` runs `trace:ac --scope=merged --ticket=MRQ-91`, and
`trace-ac.mjs:38` pushes a `missing-current-ticket-manifest` warning when no
`tests/ac-claims/MRQ-91.json` exists (none does). It is a warning, not a failure — but this
ticket does touch a test that `tests/ac-claims/MRQ-65.json` declares as owning AC-263.

**Recommendation:** Add a one-line step: create `tests/ac-claims/MRQ-91.json` with
`"exercises": ["AC-263"]`, leaving MRQ-65's ownership intact. Also state that `npm run pr-gate
-- --ticket=MRQ-91` is the gate being run, rather than "the proportionate static/build gate."

---

**[MINOR] Risk not listed — passing an unpinned building through `VenueMap` would leak organizer copy**

`VenueMap.tsx:34-35` has its own zero-pin branch whose text is written for organizers: "No
buildings are pinned yet. Add a verified coordinate to see the conference map." A speaker
cannot add a coordinate. The plan's design (branch in the portal before calling `VenueMap`)
avoids this correctly, but the trap is one refactor away.

**Recommendation:** Record it as an explicit invariant: the portal never calls `VenueMap` with
a null-coordinate building; the empty state is the portal's own copy.

---

**[MINOR] Adaptation detail — `VenueBuildingInput` needs four fields the portal has no natural value for**

`src/lib/venues.ts:4-13` requires `id`, `name`, `address`, `position`, `lat`, `lng`,
`access_minutes`, `access_note`. `slot.location` supplies `building`, `address`,
`access_minutes`, `access_note`, `lat`, `lng` — `id` (used as the pin's key) and `position`
must be synthesized.

**Recommendation:** Note the mapping in the plan, including a stable synthetic `id`. This is a
point in favor of the call-site adapter over widening the shared type, and worth stating as
the resolution of the plan's own open judgment call.

---

**[MINOR] Cleanup — the plan does not say the dead stub styles are removed**

`portal.css:30-38` carries `.portal-arrival-map-fold`, `.portal-arrival-map`, its
`::before` dot, and the `span`/`small` rules that render the coordinate pair. Left behind, they
are dead CSS that still greps as "the portal has a fake map."

**Recommendation:** Add removal of those rules to the scope list.

## 4. Positive Observations

- **Correct reuse instinct, correctly bounded.** The plan commits to the existing projection,
  tile loading, labelled pins, and `tilesFailed` fallback, and explicitly rules out a parallel
  map implementation. That is the right call — `VenueMap` is in production use and its
  Web-Mercator math is the part nobody should rewrite twice.
- **The judgment call is named rather than deferred.** Stating a preference (adapt at the call
  site) with a stated condition for changing it (widen only if the mapping is materially
  unsafe) is exactly how an open architectural question should be carried into implementation.
- **Scope and non-goals are sharp and correct.** Organizer venue-map behavior, building
  comparison, and unrelated live-site defects are all explicitly excluded — important on a
  shared file at a deadline with several agents in the tree.
- **The AC-263 handling is right.** The plan updates one stale assertion, leaves the rest alone,
  and commits to explaining it in the PR body. It correctly identifies the assertion as
  encoding the old disclosure design rather than the AC's intent.
- **`show_building_comparison` is protected.** The plan preserves it for comparison behavior
  instead of repurposing it — worth noting because removing the `<details open=…>` binding is
  the one place where repurposing would have been tempting.
- **Honest evidence discipline.** "Record the exact blocker and raise a c11 flag instead of
  claiming live proof" is the right instinct, and the browser scope is pre-declared as
  navigation-only against one domain. The issue above is only that the fallback needs to name
  the evidence it *will* produce, not that the plan is willing to fake it.
