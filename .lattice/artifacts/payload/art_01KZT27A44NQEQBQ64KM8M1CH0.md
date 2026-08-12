# Code Review: MRQ-91 — Speaker portal venue map

## 0. Harness note — the diff in the review prompt was the wrong branch

The prompt's `### Diff` section contains the **publish-policy** change
(`scripts/checks/repo-policy.mjs` + `tests/node/check-repo.test.mjs`), which is the
diff of the *current checkout's* branch `publish-policy-history` (PR #43). It has
nothing to do with MRQ-91.

MRQ-91's real work lives in its own worktree:
`Marquee-worktrees/mrq-91-venue-map`, branch `mrq-91-venue-map`, tip `7659edc`
(three commits: `7135fb5` plan, `1c6fc8f` implementation, `7659edc` test traceability;
rebased onto the post-#42 main). **This review is of that branch.** The diff-capture
step in the review harness should resolve the task's worktree/branch rather than
`HEAD` of the orchestrator's checkout — otherwise every delegator ticket reviewed from
this directory gets reviewed against someone else's code.

Files actually changed by MRQ-91:

```
 .lattice/plans/task_01KZSZXWQ5094E3F8PB9BXV3ZG.md | 103 ++++++++++++
 src/ui/portal/PortalPage.tsx                      |  38 +++++--
 src/ui/portal/portal.css                          |  17 ++--
 tests/node/portal-arrival-map.MRQ-91.test.mjs     |  20 +++++
 tests/node/venue-disclosure.AC-263.test.mjs       |   4 +-
```

---

## 1. Verdict

**FAIL (implementation-level)** — narrowly.

The design and the code are right; every functional acceptance criterion about what a
speaker *sees* is met and demonstrated. Two things keep it from being accepted as-is:
the **PR that the ticket requires does not exist**, and the **tiles-failed notice is
rendered unreadable by the new Directions button**. Both are small, local fixes — this
is a short trip back to `in_progress`, not a redesign.

## 2. Summary

Reviewed the replacement of the portal's coordinate stub with the shared `VenueMap`
component: a new `ArrivalMap`/`arrivalVenueBuilding` pair in `PortalPage.tsx`, the
portal-side CSS reskin of `.venue-map-*`, a new contract test, and the AC-263 assertion
update. The reuse call is correct — no forked projection or tile code, the single-pin
path through `VenueMap` was already sound, and `.venue-map-plane`'s
`left:50%/translateX(-50%)` centering means one pin lands dead-centre in the portal's
narrow ~470px column without any new layout math. `npx tsc -p tsconfig.client.json
--noEmit` is clean, `npm test` is 92/92 green on the node shard including the new
MRQ-91 contract, and the attached screenshot shows real OSM tiles, the "Sheraton New
York Times Square" pin label, one Directions control on the map, and attribution intact.
The key finding is the error-path collision between the new Directions button and
`VenueMap`'s existing `.venue-map-fallback` badge, which occupy the same corner.

## 3. Issues

**[MAJOR] no PR — acceptance criterion unmet**
The ticket's acceptance list ends with "PR open against `Stage-11-Agentics/marquee`
`main`." `gh pr list --state all --head mrq-91-venue-map` returns `[]`. The branch is
pushed (`github/mrq-91-venue-map` == local `7659edc`), and the final validation comment
says "PR **will** state local validation and post-merge deploy still required" — so this
is simply an unfinished last step, but it is the deliverable the orchestrator merges.
**Fix:** `gh pr create --repo Stage-11-Agentics/marquee --base main --head
mrq-91-venue-map`. The body must carry the two things the ticket asked to be explained:
(a) why `tests/node/venue-disclosure.AC-263.test.mjs:50` changed — AC-263 folds *building
comparison*, a different surface, and the organizer Venues page keeps its own
`venue-map-fold` untouched; and (b) per the operator's brief correction on this ticket,
validation is local-Wrangler with browser automation and the change **still needs a
deploy to reach `marquee.stage11.dev`**.

**[MAJOR] `src/ui/portal/portal.css:36` — Directions button covers the "map tiles
unavailable" notice**
`.portal-arrival-map-directions` is `bottom: 12px; left: 12px; z-index: 2`.
`VenueMap`'s own degraded-state badge is `.venue-map-fallback { bottom: 7px; left: 7px }`
(`src/ui/venues/venues.css:24`) and is ~347px wide against a ~470px map. When
`onError` fires on any tile — offline speaker, blocked tile host, OSM rate-limit — the
opaque teal button sits on top of the first ~18 characters, so the notice reads
"…lable · pins and walking times remain available". The ticket explicitly calls out the
tiles-fail state as one of the three the slot must handle, and this is the only state
where the speaker needs the text.
**Fix:** put the button where nothing else lives — `top: 12px; left: 12px` (attribution
is bottom-right, the fallback bottom-left, both then clear) — or scope the badge inside
the portal: `.portal-arrival-map .venue-map-fallback { bottom: 52px; }`. Prefer moving
the button; it keeps the fix in the portal's own stylesheet without depending on the
button's rendered height.

**[MINOR] `src/ui/portal/portal.css:31` — `360px` is duplicated from `VenueMap`'s
`MAP_HEIGHT` with no link between them**
`VenueMap` computes `originY = centerY - MAP_HEIGHT / 2` and renders the plane at
`height: MAP_HEIGHT`, so the pin sits `MAP_HEIGHT/2` from the plane's top. The portal
hard-codes `height: 360px` on the wrapper and `height: 360px !important` on the shell.
They agree today. If `MAP_HEIGHT` is ever changed in `VenueMap.tsx:9`, the organizer
page follows and the portal silently does not — the shell clips at 360 while the pin
stays at the new `MAP_HEIGHT/2`, pushing the pin off vertical centre. Nothing fails; it
just quietly goes wrong.
**Fix:** export `MAP_HEIGHT` from `VenueMap.tsx` and let the wrapper take it inline, or
drop the `!important` and the shell rule entirely — `VenueMap` already sets its own
inline height and the wrapper's `overflow: hidden` does the clipping. The `!important`
currently only re-asserts the value the component already applied.

**[MINOR] `tests/node/portal-arrival-map.MRQ-91.test.mjs` — asserts source text, not
behaviour**
Six of the eleven assertions match the *syntax* of the implementation, not its effect:
`/location\.building\?\.trim\(\) \|\| location\.address\?\.trim\(\)/`,
`/<VenueMap buildings=\{\[building\]\}/`, `/query=\$\{lat\},\$\{lng\}/`. Renaming the
local `building` variable, or hoisting the fallback into a helper, breaks a green test
without changing a pixel. This matches the file-scanning convention already used by
`venue-disclosure.AC-263.test.mjs`, so it is not a deviation — but the negative
assertions (`doesNotMatch(/Pinned venue/)`, `doesNotMatch(/portal-arrival-map-fold/)`)
and the `Directions ↗` count are the ones carrying real contract value; the
source-shape ones mostly buy brittleness.
**Fix:** keep the three negative assertions and the count; replace the syntax matches
with renders-and-asserts against the component (the project already runs vitest with a
DOM for other UI), or at minimum loosen them to name-agnostic forms like
`/<VenueMap\s+buildings=/`.

**[MINOR] `tests/node/venue-disclosure.AC-263.test.mjs:50` — AC-263 now asserts a
MRQ-91 fact**
The old `assert.match(portalPage, /portal-arrival-map-fold/)` was inverted to
`doesNotMatch`, and two MRQ-91 assertions (`<VenueMap buildings=`,
`portal-arrival-map-directions`) were added. AC-263 is about folding building
comparison; the portal map is now a different contract that already has its own test
file asserting exactly these three things. The inversion leaves AC-263 failing if MRQ-91
is ever reverted, for reasons AC-263 does not describe.
**Fix:** delete the portal-map assertions from the AC-263 test rather than inverting
them — the ticket's constraint said "update the portal assertion to match the new
design," and removal is the cleaner reading now that
`portal-arrival-map.MRQ-91.test.mjs` owns them. Leave the other AC-263 assertions alone,
as the ticket required.

**[MINOR] `src/ui/portal/PortalPage.tsx:459,466` — `aria-label` on a role-less `<div>`**
Both the empty state and the map wrapper carry `aria-label` on a plain `div`. ARIA does
not permit naming a generic element, so assistive tech generally drops both labels; the
empty state's label is also redundant with its visible sentence, and the wrapper's
duplicates the `aria-label="Conference site map"` that `VenueMap` puts on the shell one
level down. Note that inner label is organizer vocabulary ("Conference site map")
reaching a speaker looking at one building.
**Fix:** give the wrapper `role="group"` (or `role="img"` with the label) so the name is
honoured, drop the redundant label on the empty state, and consider letting `VenueMap`
take an optional label so the portal can pass "Map of {building}".

**[MINOR] `src/ui/venues/VenueMap.tsx:44-53` — ~18 tiles fetched for a ~470px viewport**
`PLANE_WIDTH` is a fixed 1120px, sized for the organizer page's full-width map. In the
portal's `minmax(190px, .7fr)` column roughly 40% of that plane is visible, but every
tile is still requested — the delegator's own validation counted 18 tile images where
~8 would cover what a speaker can see. Pre-existing in `VenueMap`, newly paid for on a
surface where speed is a graded feature (R7), and it is ten extra third-party round
trips on the first paint of the portal's most important card.
**Fix:** out of scope for this ticket — worth a follow-up to make `PLANE_WIDTH` a prop
(default 1120) and have the portal pass something near its column width.

**[NIT] `src/ui/portal/PortalPage.tsx:446` — a sentence used as a pin label**
When neither `building` nor `address` exists, `name` becomes "The conference team has
not named this building." and that string becomes the map pin's label, which is
`white-space: nowrap` — roughly 300px of mono text streaming right from a centred pin,
clipped by `overflow: hidden`. The ticket did ask for a plain-sentence fallback, and the
case is close to unreachable (a pinned building almost certainly has a name), so this is
a note, not a defect. A short label like "Your venue" for the map with the sentence kept
for the details list would read better if it ever fires.

## 4. Positive Observations

- **The reuse instruction was followed exactly.** No second map, no copied projection
  math. `arrivalVenueBuilding` adapts `slot.location` to `VenueBuildingInput` at the
  call site — the lighter of the two options the ticket offered — and `VenueMap` was
  left untouched, so the organizer Venues page carries zero risk from this change.
- **The single-pin path was verified rather than assumed.** `.venue-map-plane`'s
  `left: 50%; transform: translateX(-50%)` centring is what makes a 1120px plane work
  inside a 470px column; getting this wrong would have put the pin off-screen, and the
  screenshot shows it dead-centre.
- **`showBuildingComparison` was left doing its real job.** The ticket warned against
  repurposing it to hide the map; it still governs only the arrival-copy branches, and
  the map is now unconditional.
- **The empty state is honest and the height is stable.** `.portal-arrival-map` fixes
  `height: 360px` on the wrapper, so pinned, tiles-failed, and no-pin all occupy the same
  box — the global "elements never jump" rule satisfied by construction rather than by
  three matching `min-height`s.
- **One Directions control, asserted as a count.**
  `assert.equal((portalPage.match(/Directions ↗/g) ?? []).length, 1)` is the right shape
  of test for "a card should not offer the same action twice" — a presence check would
  have passed with both buttons still there.
- **Validation was real and correctly scoped.** Local Wrangler with fresh migrations and
  seed, signed in as a speaker, tile images counted, the Directions link's `href` and
  `target` read out of the DOM, the click followed to Google Maps and the tab closed —
  and production explicitly read-only, matching the operator's mid-ticket correction that
  merging does not ship and six delegators must not each deploy to the judge-facing site.
  The screenshot is the artifact the ticket asked for.
- **The AC-263 breakage was anticipated, not discovered.** The plan artifact names it up
  front and the change is confined to the one assertion the ticket authorised.
- **Clean type-check and green suite.** `tsc --noEmit` passes; `npm test` is 92/92 on the
  node shard with the new contract passing. The run reported `pass-over-budget`
  (56.8s vs the 45s objective) — on a box currently hosting 27 worktrees at 253% CPU,
  which is precisely the contention case CLAUDE.md says to check before believing. Zero
  failures; no correctness signal here.
