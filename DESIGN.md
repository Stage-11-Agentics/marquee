# Marquee — Design Language

**Status:** Converged, client-loved, binding. Minted 2026-08-09 at the close of tone-prototype.
**Binding visual contract:** `prototypes/pipeline-v1.1/index.html` at **v1.7** (the v1.4 converged structure reskinned to Flight Deck at v1.5, a real cold start at v1.6, geography at v1.7). The build reproduces it one-to-one; every designed control ships. Divergences are legal only where SPEC marks them `[beyond … prototype — acknowledged divergence]`.

## The direction, and how it was found

Three UX paradigms were built and driven (Chase: ops board home · Pipeline: lifecycle home · Marquee: agenda canvas home). The client chose **Pipeline as the spine** and the strongest organs were grafted in: the Chase board lives at the Onboarding stage, the track swimlane is the agenda's track view, and a read-only program board gives the Kanban overview. Iterations v1.2–v1.4 completed every screen, killed every stub, and folded the client's live rulings (no board drag — consequential actions live on the detail screen; reviewer opens the full submission; Approve·Maybe·Deny as the primary review path).

Then a skin round (House Lights · Press Room · Flight Deck) ran on the frozen structure. **The client picked Flight Deck.**

## The aesthetic — Flight Deck

*The ops person's cockpit in daylight: a hairline instrument grid, monospaced figures and micro-labels, zero shadow and zero ornament — every number reads like a gauge and the whole panel scans in one pass.*

- **Tokens:** the canonical block lives in `prototypes/skins/skin-c.html`'s header comment and lifts verbatim into `src/styles/tokens.css`. Ground `#eaeef2`, instrument-face white surfaces, ink `#101820`, instrument teal accent `#0b6a72`, status trio ok/warn/alarm, eight track colors, 8px graph-paper grid. All pairs carry their measured contrast ratios; nothing below 4.5:1 for text.
- **Type:** grotesque for prose and labels; **monospaced tabular figures for every count, time, and ID** — numbers are gauges.
- **Surfaces:** hairline rules over shadows; recessed cells over floating cards; density with air — the grid carries the structure so ornament doesn't have to.
- **Motion:** none decorative. State changes render instantly; drag (agenda only) feels physical; 120ms fades at most.
- **Light-mode primary** — judges demo in daylight. No dark mode by Wednesday.

## Voice

Confident, warm, concise, operational. The interface narrates state ("Wave 2 closes Friday — 214 abstracts still need review in Agents") and never chirps. Buttons say what they do: "Accept 37 abstracts," never "Submit." No exclamation marks. The judges' vocabulary is law: Abstract · Session · Speaker · Submitter · Evaluation plan · Round · Scorecard · Committee · Portal · Task · Agenda · Break · **Maybe** (the waitlist's display name) · Event site.

## Craft rules (binding, from PHILOSOPHY)

- **Elements never jump.** Reserve space for swapped text; fixed-width toggles; "—" over removed rows; tabular numerals.
- One obvious primary action per screen; every module one click from home; honest empty/loading/error states everywhere.
- Real-ugly data always: long diacritic names, truncating titles, 1,000-row lists. A screen that only works with pretty data doesn't work.
- Speed is part of the design: if a surface feels slow, the design is wrong there, whatever the numbers say.

## Provenance

`prototypes/` retains the full lineage: three directions (`chase/`, `pipeline/`, `marquee/`), the converged iterations (`pipeline-v1.1/`, v1.1→v1.7 in git history), and the skin round (`skins/`). `sequence/run-state.md` logs every design ruling with dates. The venue-map design reasoning lives in `sequence/venue-map-ux.md`.
