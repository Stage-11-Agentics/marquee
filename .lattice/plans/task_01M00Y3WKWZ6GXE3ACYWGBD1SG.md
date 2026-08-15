# MRQ-206: Sessions vs abstracts legibility: kind segment leads the list, board explains the Sessions filter

Per sequence/sidebar-fold-tickets.md §T4. A segmented All · Abstracts · Sessions control leads the submissions list toolbar, replacing the buried kind dropdown; fixed button widths (elements never jump); round-trips through the existing kind query param and saved views. When the program board is filtered to Sessions, a quiet explainer band: 'Sessions are guaranteed — they skip evaluation and enter at Ready to place. The earlier columns are empty by design.' Judges' language ruling: chips stay Abstract/Session. Server-side filtering unchanged (R7); no new query shape. Design contract: prototypes/pipeline-v1.1 submissions + board views (v1.15).

## Plan

1. Inspect the current submissions filter/query and saved-view seams plus board filter rendering; establish the test baseline.
2. Replace the submissions kind dropdown with the prototype-matched fixed-width All / Abstracts / Sessions segment, preserving the existing `kind` URL and saved-view serialization.
3. Add the token-only muted Sessions explainer band to the board and focused regressions for both visible/hidden arms and URL round-tripping.
4. Run targeted tests, `check:design`, the full PR gate, and a local running-app smoke flow; commit, push, and open the first captain-review PR.
