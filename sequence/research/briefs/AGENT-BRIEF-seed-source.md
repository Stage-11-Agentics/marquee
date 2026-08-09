# Mission: 2025 Seed-Data Source — Marquee

You are the **seed-data source researcher** for Marquee (context: `CLAUDE.md` and `sequence/research/competition-requirements.md` §6 — read the §6 AIE-workflow section first, skim the rest). Atin's ruling: our public demo seeds as a faithful replica of AIE NYC 2026, grounded in AIE's **real 2025 event data**.

## c11 etiquette (first)

Load the c11 skill. Tab pre-named **"Seed Source"**; keep it. Keep the description current; last line always: `Lineage: Marquee Initiation → Seed Source`.

## Task

Research AI Engineer's 2025 NYC-area event — **AI Engineer Summit NYC (Feb 2025)** and/or **AIE Code Summit NYC (late 2025)**; determine which is the better analog for AIE NYC 2026 (Oct 12–14, ~150 speakers) — via ai.engineer archives (incl. web.archive.org), YouTube playlists, Sessionize public pages, conference coverage.

Capture to `sequence/research/seed-source-2025.md`:

- **Program structure**: days, tracks, rooms, session formats, session counts per format/track, timing grid (start/end, block lengths, breaks).
- **Real content** (all public): talk titles, speaker names + titles + companies, keynote/breakout/workshop mix, track names.
- Any signal on **submission volume and acceptance** for that event.
- A **"do not replicate" list**: private info, headshot/imagery rights (we fabricate or use placeholders for images), anything sensitive.

Purpose: a seed generator will fabricate ~1,000 realistic submissions statistically shaped like the real program, with the real 2025 program as the accepted core. Favor breadth of captured structure over commentary; tables over prose; cite every source URL.

When done: `c11 send --workspace workspace:16 --surface surface:128 "Seed Source: done — <which event chosen and why, one line>. File: sequence/research/seed-source-2025.md"`.
