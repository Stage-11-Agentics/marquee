# Where the map lives — geography as a product primitive

**Status:** UX design thinking, 2026-08-10. Follows `venue-map-brief.md` (T1 model + T3 travel conflict already shipped in the prototype).
**Question this answers:** not "where do we put a map," but "what does it mean for Marquee to know where things are."

---

## 1. The thesis

The failure mode is obvious and common: build a **Venues page**, put a map on it, link it from the sidebar, and watch nobody go there. A map page is a map ghetto. It costs a sidebar slot, it duplicates the buildings list, and it answers a question nobody asked at the moment they asked it.

The alternative: **geography is a property of records we already have**, and it surfaces wherever a decision depends on it. The map is one of five ways to render that property — and it is the most expensive one, so it should be the rarest.

> The product doesn't gain "a map." It gains the ability to answer *can they get there in time*, *where do I go*, and *how do I get in* — in whatever form the surface can afford.

---

## 2. Five zooms of attention

One location primitive, five renderings. Every surface picks the cheapest one that answers its question.

| Zoom | Rendering | Cost | Answers |
|---|---|---|---|
| **0 · Token** | `Room · Building` chip inline | free | which room |
| **1 · Relation** | `+6 min from Times Center` — text, no pixels | free | is it far |
| **2 · Instruction** | Address, entrance note, access time, "leave by 10:14" | free | how do I get in |
| **3 · Panel** | 280px map in the room popover, pin + directions link | one tile fetch | where *is* that |
| **4 · Overview** | Full map: all buildings, walking lines, today's load | lazy Leaflet | how does the whole thing sit |

**Most surfaces need zoom 1 and 2, not a map.** "6 min walk, 10 min security, leave by 10:14" is more actionable than any pin, costs nothing, and can't fail to load. That is the whole design in one line — and it's a direct application of *respect the operator*: a map asks the reader to do the spatial reasoning; a sentence hands them the answer.

Zoom 3 and 4 exist to build trust in zooms 1–2. When a speaker doubts "6 minutes," they open the panel and see it. The map is the **receipt**, not the interface.

---

## 3. The anchor — "from where?"

Zoom 1 is relative, so it needs an origin. Designate a **primary building** on the conference (the main stage — Times Center in the seed). Everything then reads *N min from the main stage*, and the whole product gets spatial awareness in text with no map anywhere.

In the agenda, the origin is smarter: for a speaker's next session, the origin is **their previous session's building**, not the main stage. That's the number they actually need.

---

## 4. Progressive disclosure — collapsed, not absent

**Ruled by the client, 2026-08-10: show venue surfaces for every conference, collapsed by default when there is one building.**

Working out what "collapsed" concretely means surfaced a distinction the five zooms had blurred, and it's the load-bearing rule of this whole section:

> **Zoom 2 (instruction) is independent of building count. Zoom 1 (relation) is not.**

A one-hotel conference still has a door, a floor, a check-in desk, and a security policy. "Empire East, 3rd floor, badge required past the lobby" is exactly as useful with one building as with four. What *needs* two buildings is the comparison — walk times, transit conflicts, the overview.

So the rule is not "hide the feature," it's **hide the comparison**:

| | 1 building | 2+ buildings |
|---|---|---|
| Zoom 0 · `· Building` suffix | **off** — deduplication, not chrome; with one building it's noise on every row. Building named once in the page header instead. | on |
| Zoom 2 · address, entrance, access note | **on** — full value | on |
| Zoom 1 · walk times, "leave by" | off — nothing to compare | on |
| Transit conflicts | inert by definition (same building) | on |
| Settings → Venues | **collapsed to one summary row**, expands | expanded |
| Overview (zoom 4) | reachable, shows the one pin | reachable, linked from agenda |

This keeps the capability discoverable for the single-building organizer — they can find the venue section, expand it, and record their entrance instructions — without spending a single pixel of the common case's attention on comparisons that can't exist.

---

## 5. Surface by surface

| Route | Zoom | What it gets | Why |
|---|---|---|---|
| `#settings` → Buildings | **4 + authoring** | Shared map, one pin per building, drag to set. Address + pin + access minutes. | This is where coordinates come from. Drag-a-pin beats a lat/lng text field. |
| `#agenda` | **1, 3** | Travel conflicts *(shipped)*. Room columns grouped under a **building band**. Room header opens the panel. | The grid itself should encode geography — a scheduler sees building adjacency structurally, before any map. |
| `#dashboard` | **1** | Travel folded into the existing conflicts count *(shipped)*. | Geography earns dashboard space only when something is wrong. |
| `#board` | — | Nothing. | The board is lifecycle. Don't pollute it. |
| `#submissions/:id` | **1, 2** | Scheduled room → building, address, walk-from-anchor. | The record owns every consequential action; place is part of the record. |
| `#onboarding` | — | Nothing. | Chasing headshots has no geography. See the naming collision in §7. |
| `#reviewer` | — | Nothing. | Reviewers judge abstracts. Rooms don't exist yet. |
| `#portal` | **2, 3** | **The single highest-value placement in the product.** | See below. |
| `#comms` | **2** | Location merge fields. | See below. |
| `#publicAgenda`, `#s/:id` | **1, 3, 4** | Building on every session; map on the site; travel warning in a personal schedule. | Attendees have the same travel problem organizers do. |
| `/i/:uid.ics` | **2** | Real `LOCATION` + `GEO`. | See below. |
| `#import` | **authoring** | Parse buildings out of Sessionize room strings. | See below. |
| `#api/docs`, CLI | **data** | Buildings with coordinates; travel conflicts as a queryable class. | *Agent-native by design* — an agent should be able to ask "is this schedule walkable." |

### The speaker portal is the hero

Everything the post-acceptance workflow is supposed to be, in one card:

> **Your session · Wed Oct 14, 10:30**
> Jay Suites C · **Jay Suites**, 109 W 39th St, 2nd floor
> Your previous session ends 10:00 at The Times Center — **6 min walk, leave by 10:22**.
> Photo ID required at the 39th St entrance. Allow ten minutes for building security.
> *[map]* *[Directions]* *[Add to calendar]*

Sessionize does not do this. Sessionboard does not do this. It is pure zoom 2 — text — with a map as the receipt. It's the screen to open the walkthrough video on.

### Comms is how geography scales without pixels

Today there are exactly three merge fields: `{{conference.name}}`, `{{session.title}}`, `{{task.title}}`. None describe place.

Add `{{session.room}}`, `{{session.building}}`, `{{session.address}}`, `{{session.accessNote}}`, `{{session.leaveBy}}`. Now every "you're confirmed" and "you're on in an hour" email carries the entrance with the gold doors and the security queue. **Email is the surface speakers actually read** — more than any portal. This is the highest ratio of value to effort in the entire feature.

### The ICS is a one-line fix with real reach

Today: `LOCATION:Empire East` — a bare room name, hardcoded, no address, no coordinates. A phone can't navigate to it.

Make it `LOCATION:Jay Suites C, Jay Suites, 109 W 39th St, 2nd floor, New York, NY 10018` plus `GEO:40.75311;-73.98569`. The speaker taps the calendar entry and their phone routes them to the right door. Nearly free, and it's the only part of this feature that works when the user is standing on a street corner with no signal and no browser tab open.

### The importer already has the data, mashed together

Real Sessionize export rooms from the seed:

```
AWS JFK27 (12 W 39th St) 200/201 - entrance 39th St & 5th Ave
Jay Suites A & B - 109 W 39th 2nd floor
TimesCenter Theater
```

Organizers are already encoding building, address, and entrance instructions into the room-name field because their tool has nowhere else to put them. The importer can offer to split them: *"Found 3 buildings in your room names — create them?"* That's a migration moment that demonstrates the product's thesis in five seconds: **your old tool made you jam a building into a room name; this one has a place for it.**

---

## 6. Three hero moments

For the walkthrough video, in order of power:

1. **The catch.** Drag a session onto the agenda; a travel conflict fires: *"6 min walk to AWS JFK27, plus 10 min building security. Needs 16 min; has 10."* Nothing else on the market says this.
2. **The portal card.** A speaker's real instruction set — leave-by time, gold doors, ID required.
3. **The overview.** The whole conference across three Midtown buildings, live, with today's load on each pin.

---

## 7. Two hazards worth naming

**Vocabulary collision — "Travel" already means something else.** The speaker task list has *"Travel and accommodation"* (flights and hotels), and the new conflict class was also called **Travel** (walking between buildings). Two meanings, one product, both landing on the same person.

**Ruled 2026-08-10: the conflict class is renamed Transit.** It reads *"Transit — 6 min walk to AWS JFK27, plus 10 min building security. Needs 16 min; has 10."* The speaker task keeps its name. Rename every surface — the conflict object's `kind`, the drawer, the tile flag, the dashboard label, and the API's conflict type — before it sets in emails and the wire contract.

**A wrong pin is worse than no pin.** Zooms 1–2 assert precise numbers ("leave by 10:22") derived from coordinates. That precision is a promise. Coordinates need verifying, and any building without them must degrade to zoom 0 silently rather than guess.

---

## 8. What we deliberately don't build

- **No routing engine, no live transit, no traffic.** Walking-line distance with a grid detour factor is honest and good enough; anything more is a dependency and a lie about precision.
- **No indoor floor plans.** Tempting, enormous, and useless by Wednesday.
- **No geocoding service dependency.** Drop-a-pin authoring plus manual coordinates. Optional geocode later.
- **No sidebar slot.** The overview lives at `#settings/venues`, linked from Settings, the agenda toolbar, and the room panel. The sidebar stays at eight modules.
- **No map on the CFP.** Submitters don't know rooms yet, and asking them to care is noise.
