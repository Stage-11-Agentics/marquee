# Venue map — design brief

**Status:** Client-decided 2026-08-10 (Atin). Awaiting implementation in the prototype, then contract reconciliation.

> **SUPERSEDED IN ITS VENUE SET AND ITS LABEL — SPEC Amendment 14 (2026-08-11).** Two things below are now wrong. (1) **The buildings.** The suggested seed table names the real 2025 programme (The Times Center · Jay Suites · AWS JFK27); the shipped set is **Sheraton New York Times Square** (`access_minutes` 0), **New York Marriott Marquis** (`access_minutes` 3, a nine-minute walk), and **`Online`** unpinned. (2) **The label.** The conflict class is **Transit**, never "Travel" — AC-259 byte-scans for it, because the speaker task set legitimately keeps *"Hotel and Travel Reservations"*. The canonical message is *"Transit — 9 min walk to New York Marriott Marquis, plus 3 min building access. Needs 12 min; has 0."* Ground truth: `src/lib/venue-geometry.ts`, `scripts/seed/event.ts`, prototype v1.9.
**Owner:** the prototype surface (currently surface:110). Written by the map-design surface (surface:116) to avoid a concurrent edit on `prototypes/pipeline-v1.1/index.html`.

## The decision

Locations become real places on a map. Scope signed at **T1 + T2 + T3** (below); **T4 deferred**, not struck. Rendering: **Leaflet + OpenStreetMap tiles, lazy-loaded**, vendored locally (no CDN, no API key — this repo goes public).

| Tier | Ships | Signed |
|---|---|---|
| T1 | `lat`/`lng` on buildings; map on the room detail panel and Event Settings; directions link | ✅ |
| T2 | A **Venues** overview: all buildings pinned, rooms nested, sessions-today per building, walking lines with minutes | ✅ |
| T3 | **Travel-time conflict class** in the agenda; "leave by" in the speaker portal | ✅ |
| T4 | Public event-site map, non-session places (registration, green room, load-in), ICS `LOCATION`/`GEO` | deferred |

## Why this is not chrome

`getAgendaConflicts()` currently compares `day + time` only and catches two classes: same room overlapping, and a speaker double-booked. It will happily schedule a speaker into TimesCenter Theater at 10:00 and Jay Suites C at 10:30 and call it clean — a six-minute walk, plus building security at the far end.

The seed data is genuinely multi-venue (three physical buildings across a few Midtown blocks, plus a stream). Geography is therefore a real scheduling constraint that Sessionize and Sessionboard do not model. **The map is the evidence behind a warning the product can now make.** Build it in that order — the conflict class is the point, the map explains it.

## Model changes

Additive to the existing `buildings` array (`{id, name, address}`):

- **`lat`, `lng`** — nullable. `AIE YouTube` is a building with no pin; that null is a real, seeded, honest empty state, not an edge case to paper over.
- **`accessMinutes`** — ingress overhead for the building. This falls straight out of seed data already present: the AWS JFK27 room note reads *"Photo ID required at the 39th St entrance. Allow ten minutes for building security."* That ten minutes belongs in the model, not just in prose, because it changes the answer.

Suggested seed values — **verify each coordinate before shipping; a pin in the wrong place is loudly wrong**, and these are approximations, not surveyed points:

| id | Building | Approx lat, lng | accessMinutes |
|---|---|---|---|
| b1 | The Times Center, 242 W 41st St | ~40.7562, ~-73.9884 | 0 |
| b2 | Jay Suites, 109 W 39th St (2nd floor) | ~40.7533, ~-73.9867 | 2 |
| b3 | AWS JFK27, 12 W 39th St | ~40.7508, ~-73.9827 | 10 |
| b4 | AIE YouTube | null | 0 |

## T3 — the travel-time conflict class

Walking time between two buildings:

```
d      = haversine(a, b) metres
d_walk = d * 1.3                  // Manhattan grid detour — straight-line underestimates
minutes = max(1, ceil(d_walk / 80))  // 80 m/min ≈ 4.8 km/h
```

Required gap from a session in A to a session in B = `walkMinutes(A, B) + accessMinutes(B)`.

Raise a **Travel** conflict when two scheduled sessions share a speaker, sit in different buildings, and the actual gap between them is less than the required gap. Message shape:

> ⚠ Transit — 9 min walk to New York Marriott Marquis, plus 3 min building access. Needs 12 min; has 0.

Rules:
- **Warns, never blocks** — matches the existing agenda contract ("live conflicts warn without blocking").
- A building with no coordinates (the stream) raises **no** travel conflict. Physical → online is a legitimate zero-travel transition.
- Same building, different room: no travel conflict. Floor-level transit is below the resolution we model, and pretending otherwise produces noise.
- Feed it through the existing paths so it lands on the dashboard count, the conflicts drawer, and the tiles for free.

## T2 — the Venues overview

New route `#venues`. Left: the map in a **fixed-aspect reserved box**. Right: buildings listed, rooms nested under each, with sessions-today and summed capacity in tabular figures. Selecting a building highlights its pin; selecting a pin scrolls the list. Walking lines drawn pin-to-pin with minute labels, plus a scale bar.

The online venue renders as a card **below** the map, not as a pin. It has no location; inventing one for visual tidiness would be a lie.

## Craft constraints (binding, from DESIGN.md)

- **Elements never jump.** The map box is fixed-aspect and reserved before tiles load. No reflow on tile arrival — this is the single most likely way to violate DESIGN here.
- **Speed is graded (R7).** Leaflet and tiles load lazily and only on surfaces that show a map. Nothing map-related may sit in front of a first paint anywhere else.
- **No API key, no CDN.** Vendor Leaflet locally (BSD-2). Public repo.
- **Flight Deck palette.** Apply a CSS filter to the tile layer (grayscale, slight contrast lift) so the basemap sits in the instrument-panel palette; pins in accent teal; hairline borders, zero shadow.
- **Tile failure is a designed state.** When tiles don't load, the reserved box shows the pins, walking lines, and scale bar drawn over the graph-paper grid. Since the overlay is ours anyway, this fallback is nearly free — and it means the map is never a blank rectangle.

## Open flag for production

OSM's tile usage policy is not intended for heavy application traffic. Fine for the judging window; a real deployment needs a tile decision (self-hosted, or a provider with a key supplied by the operator). Note it in SPEC rather than silently depending on OSM.

## Contract work this implies

This lands **after** the contract was reconciled, so it is new scope, not a repair:

- Mint ACs from the current high-water mark (AC-254 as of this writing) covering: building coordinates + access minutes, the Venues overview, the travel conflict class, the tile-failure fallback state, and the null-coordinate venue.
- Reconcile `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, and the `USER_STORIES.md` lineage.
- `DESIGN.md` names v1.5 as the binding contract while the prototype is already past it — fix the pointer in the same pass.
- Log the decision in `sequence/run-state.md`.

Sequence T1 → T3 → T2 so the deadline cuts the least valuable tail first.
