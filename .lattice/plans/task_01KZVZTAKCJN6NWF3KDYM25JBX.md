# MRQ-157: V2-8: agenda grid placement at 15-minute increments

Source: .briefs/eval-gap-v2-human-lens.md section 4, authored by Fable (Eval V2 Audit, surface:55). Operator-approved 2026-08-12. Read that section for the full human-problem framing before starting. (V2-8, ~45 min.) OPERATOR DIRECTIVE, 2026-08-12 — not an eval item.

PROBLEM. Sessions can currently start only on the hour (TIME_SLOTS, track-board.tsx:7). Real conferences start sessions at :15, :30 and :45.

GOOD LOOKS LIKE. Placement targets at 15-minute resolution by default, with a builder setting for 30 or 5. Hour labels keep the gauge-like axis, with micro-ticks for sub-hour rows — Flight Deck, not clutter (DESIGN.md is binding). The API already stores arbitrary starts_at, so THIS IS GRID UI ONLY — no schema or API work.

CLOSES NO EVAL ITEM. It is product quality by operator ruling. Weigh that honestly against the deadline: if the eval-scoring tickets are still open when you would start this, say so rather than taking it first.

SEQUENCING — IMPORTANT. This is the third link in a chain on the same file: MRQ-148 (in flight) -> MRQ-141 (click-to-place) -> this. Do not run blind alongside either. It composes with MRQ-141's 'Place at {time}' buttons, which simply exist at finer resolution once this lands.

VERIFY. Place a session at :15 and at :45; both persist across reload and render in the correct row; the axis stays legible at the finer resolution.

## Implementation plan

1. Keep `AgendaPage.tsx` and `track-board.tsx` unchanged until MRQ-141's PR exists. Rebase
   this worktree onto the latest `github/main` and then merge MRQ-141's branch/PR before the
   final integration pass.
2. Add a standalone pure grid module that owns the supported granularity vocabulary
   (`5 | 15 | 30`), the default (`15`), normalization, placement-target time generation
   (`09:00` inclusive through `21:00` exclusive), and event-scoped local-storage helpers for
   the builder preference. Keep persistence best-effort like the existing columns preference.
3. Keep snap resolution separate from axis resolution: generate every placement target for
   the selected granularity, but expose twelve hour axis rows with only the `HH:00` labels and
   lighter sub-hour micro-tick metadata. This prevents a 5-minute setting from turning the
   gutter into 144 repeated labels while allowing the board to render all 144 targets.
4. Add `CONTRACT ·` tests for normalization/defaults, counts and ordering at 5/15/30,
   hour-label/micro-tick invariants, event-scoped preference persistence and malformed-storage
   fallback. Do not add schema or route work; `starts_at` already accepts arbitrary instants.
5. After MRQ-141 lands, integrate the module into `autoPlaceSlots`, drag targets, click-to-place
   buttons, and the visual board. Preserve exact `starts_at` rendering for sessions at odd
   minutes independent of the selected snap setting, then run the local gate and the required
   real-browser 15/30/5 placement/reload screenshots before opening the MRQ-157 PR.
