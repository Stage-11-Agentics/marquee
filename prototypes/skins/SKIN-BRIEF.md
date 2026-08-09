# Mission: Three Visual Skins — Marquee Program Home

You are the **visual designer** for Marquee. The client likes the current styling but finds it "a bit generic." Your job: **three genuinely different visual systems** applied to the *same* screen — the program home/dashboard — functionally and structurally identical, aesthetically distinct. Not three colorways: three design languages. Swap the wordmark between two takes and you should still tell them apart at a glance.

## c11 etiquette (first)

Load the c11 skill. Tab pre-named **"Skins"**; keep it. Description current; last line: `Lineage: Marquee Initiation → Skins`.

## Ground truth

1. `PHILOSOPHY.md` — the taste section binds: elements never jump; data surfaces stay quiet; one primary action per screen; speed must *look* fast (restrained motion).
2. `prototypes/pipeline-v1.1/index.html` — find the `#dashboard` screen. **Copy its content verbatim**: the seven pipeline stages with their exact counts and sub-labels, the attention strip lines, the wave planner panel, the sidebar nav, the header. Same information architecture, same hierarchy of importance, same interactions implied. You restyle; you never redesign layout logic or copy.
3. The current aesthetic (your baseline to diverge FROM): Linear-grade clean — typography-led, one accent, generous whitespace. Do not reproduce it; the client has it already.

## The three takes — genuinely divergent directions

You choose the three languages; these axes are suggestions, not orders (diverge boldly, justify briefly): **editorial/theatrical** (display type, marquee identity, track-color energy — the name is "Marquee," let it earn it) · **warm craft** (paper, ink, tactile shadows, humanist type — the tool that respects you) · **technical precision** (dense, monospaced accents, terminal-calm, instrument-panel feel — the ops person's cockpit). Whatever you pick: light-mode primary (judges demo in daylight), real contrast ratios, tabular numerals on every count.

## Deliverable

- `prototypes/skins/skin-a.html`, `skin-b.html`, `skin-c.html` — each fully self-contained (inline CSS, no CDNs, works from file://), rendering the complete dashboard screen, static (no JS needed beyond trivial hover states).
- Each file opens with an HTML comment: the take's name, its one-sentence thesis, and its **token block** (background/surface/text/accent/status colors, type stack, radius, spacing scale) — written so the winning take's tokens lift straight into the build's `tokens.css`.
- PROTOTYPE badge on each, per house rule.
- `prototypes/skins/README.md`: three lines — each take's name and thesis.

~60–75 minutes. When done: `c11 send --workspace workspace:16 --surface surface:128 "Skins: done — <take names, 3 words each>. Files: prototypes/skins/"`. Do not edit any other file; do not commit.
