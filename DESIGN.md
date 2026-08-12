# Marquee — Design Language

**Status:** Converged, client-loved, binding. Minted 2026-08-09 at the close of tone-prototype.
**Binding visual contract:** `prototypes/pipeline-v1.1/index.html` at **v1.11** (v1.11 adds the theme system: Day default + Night, machinery for arbitrary themes) (the v1.4 converged structure reskinned to Flight Deck at v1.5, a real cold start at v1.6, geography at v1.7, the Sessionboard gap-analysis fold at v1.8, the Amendment 14 venue set at v1.9). The build reproduces it one-to-one; every designed control ships. Divergences are legal only where SPEC marks them `[beyond … prototype — acknowledged divergence]`.

## The direction, and how it was found

Three UX paradigms were built and driven (Chase: ops board home · Pipeline: lifecycle home · Marquee: agenda canvas home). The client chose **Pipeline as the spine** and the strongest organs were grafted in: the Chase board lives at the Onboarding stage, the track swimlane is the agenda's track view, and a read-only program board gives the Kanban overview. Iterations v1.2–v1.4 completed every screen, killed every stub, and folded the client's live rulings (no board drag — consequential actions live on the detail screen; reviewer opens the full submission; Approve·Maybe·Deny as the primary review path).

Then a skin round (House Lights · Press Room · Flight Deck) ran on the frozen structure. **The client picked Flight Deck.**

## The aesthetic — Flight Deck

*The ops person's cockpit in daylight: a hairline instrument grid, monospaced figures and micro-labels, zero shadow and zero ornament — every number reads like a gauge and the whole panel scans in one pass.*

- **Tokens:** the canonical block lives in `prototypes/skins/skin-c.html`'s header comment and lifts verbatim into `src/styles/tokens.css`. Ground `#eaeef2`, instrument-face white surfaces, ink `#101820`, instrument teal accent `#0b6a72`, status trio ok/warn/alarm, eight track colors, 8px graph-paper grid. All pairs carry their measured contrast ratios; nothing below 4.5:1 for text.
- **Type:** grotesque for prose and labels; **monospaced tabular figures for every count, time, and ID** — numbers are gauges.
- **Surfaces:** hairline rules over shadows; recessed cells over floating cards; density with air — the grid carries the structure so ornament doesn't have to.
- **Motion:** none decorative. State changes render instantly; drag (agenda only) feels physical; 120ms fades at most.
- **Day is primary and default** — judges demo in daylight. **Night** is opt-in, and the OS preference is deliberately not consulted: nobody should get a palette they did not choose.

## Themes

The aesthetic has two lightings, and the machinery takes more. A theme is **one `html[data-theme="…"]` block in `tokens.css` plus one row in `src/ui/shell/theme.ts`** — palette only. Spacing, radius, the hairline, the type stacks and `--shadow: none` are **theme-invariant**; that constraint is what makes Night a re-lit instrument instead of a generic dark mode.

- **Day** — the cockpit in daylight, exactly as specified above.
- **Night** — *the quiet server room.* Strictly neutral greys with chroma held back for status and a restrained teal. The agenda canvas stays **darker than the page**, preserving the figure-ground relationship Day establishes. Chosen by the client 2026-08-12 over two alternatives (a blue-black "Midnight Ops" and an amber night-vision "Red-Shift").

**Register themes (theme-round experiment, 2026-08-12).** A second theme class now sits beside the palette themes: **register themes** may also move type, chrome, and layout tropes, scoped to the shell plus the program home — every other route gets the register's palette tokens only. They live in `src/styles/themes/<id>.css` with every rule scoped under `html[data-theme="…"]`, so palette themes remain exactly what MRQ-103 shipped. Each registry row carries `kind: "palette" | "register"`, and the per-register chrome (search glyph, nav labels, dashboard renderers, decorations) is typed config in `src/ui/shell/register.ts`, never ad-hoc theme checks in components. The three registers — **latent.space** (gradient-on-black, Syncopate over the Substack serif, VAE-bottleneck pipeline), **AI Engineer** (strict monochrome, terminal chrome), **swyxy** (swyx.io indigo minimalism, post-index feeds, an explicit `dark` word toggle that persists as one theme choice) — are the design contracts in `prototypes/themes/`. Register themes answer to the same binding rules below: every color a token, contrast measured with a 4.5:1 floor, theme stamped before first paint, scope the admin shell.

Binding rules for any theme, present or future:

- **Every color is a token.** A literal color is invisible to the theme system: right in Day, silently wrong in Night. `check:design` fails on any literal color in `components.css`, and on any color token Day introduces that Night does not redefine.
- **Contrast is measured, not eyeballed.** Every text pair carries its ratio; nothing below 4.5:1. Night's floor is 6.3:1.
- **Track colors are never rewritten.** They are the organizer's data, and they paint borders and dots rather than text, so they carry no contrast duty. (The prototype's *seeded* tracks do carry night octaves — that is demo data, not authored data.)
- **Theme is stamped before first paint** (inline script in `index.html`). Resolving a palette after hydration flashes white on every load — the jump the craft rules forbid.
- **Scope is the admin shell.** The public agenda, embeds, and API docs own their palettes on purpose: an embed inherits its host page, and an attendee's page must not be re-lit because an organizer picked Night.

## Voice

Confident, warm, concise, operational. The interface narrates state ("Wave 2 closes Friday — 214 abstracts still need review in Agents") and never chirps. Buttons say what they do: "Accept 37 abstracts," never "Submit." No exclamation marks. The judges' vocabulary is law: Abstract · Session · Speaker · Submitter · Evaluation plan · Round · Scorecard · Committee · Portal · Task · Agenda · Break · **Maybe** (the waitlist's display name) · Event site.

## Craft rules (binding, from PHILOSOPHY)

- **Elements never jump.** Reserve space for swapped text; fixed-width toggles; "—" over removed rows; tabular numerals.
- One obvious primary action per screen; every module one click from home; honest empty/loading/error states everywhere.
- Real-ugly data always: long diacritic names, truncating titles, 1,000-row lists. A screen that only works with pretty data doesn't work.
- Speed is part of the design: if a surface feels slow, the design is wrong there, whatever the numbers say.

## Provenance

`prototypes/` retains the full lineage: three directions (`chase/`, `pipeline/`, `marquee/`), the converged iterations (`pipeline-v1.1/`, v1.1→v1.7 in git history), and the skin round (`skins/`). `sequence/run-state.md` logs every design ruling with dates. The venue-map design reasoning lives in `sequence/venue-map-ux.md`.
