# MRQ-103: Theme system: Day default plus selectable themes — three night-mode candidates and Vaporwave in the prototype, winner + machinery to the app

Operator directive 2026-08-12 (overrides DESIGN.md's 'no dark mode by Wednesday' ruling — deliberately; ~22h runway acknowledged; aesthetic nice-touch, must not disturb the live fleet: all work in a linked worktree).

WHAT: A multi-theme system for Marquee. Day (current Flight Deck) stays the default and is untouched. Themes are palette-token overrides under html[data-theme=...] — structure tokens (spacing, radius, hairline, type, shadow:none) are theme-invariant in every theme. Adding a theme = one CSS block + one row in a small THEMES registry that the switcher renders. Persistence via localStorage; no prefers-color-scheme auto-switch (Day unless explicitly chosen).

PHASE 1 — PROTOTYPE (the design gate, binding): in prototypes/pipeline-v1.1/index.html, build the theme machinery + a fixed-width instrument-style theme switch in the top bar (elements never jump), and FOUR themes beyond Day:
  1. Three distinct NIGHT candidates, each resting on a different aesthetic bet (e.g. blue-black re-lit instrument w/ luminous accent; amber/red-shift cockpit night-vision; neutral graphite). Operator picks ONE — the others are deleted before the app fold.
  2. VAPORWAVE — a fun theme proving arbitrary-theme extensibility; palette-only vaporwave (deep indigo/magenta/cyan) still obeying every Flight Deck craft rule.
All palettes contrast-measured like Day (ratios in comments; nothing under 4.5:1 for text). The 8 track colors get per-theme octaves where needed. Agenda canvas relationship re-tuned per theme. ~85 raw hex outside :root in the prototype get tokenized as encountered.

PHASE 2 — APP (after operator picks the night winner): lift machinery + Day/Night/Vaporwave into src/styles/tokens.css + switcher; tokenize the ~36 raw hex in src and 8 in components.css; extend check:design with a no-raw-hex-outside-tokens.css rule (small allowlist) so themes cannot rot.

Branch/worktree: mrq-themes via Marquee-worktrees. Do not merge near the submission window without operator go-ahead.
