# MRQ-156: V2-7: public speakers, finished; and honest outbox copy

Source: .briefs/eval-gap-v2-human-lens.md section 4, authored by Fable (Eval V2 Audit, surface:55). Operator-approved 2026-08-12. Read that section for the full human-problem framing before starting. (V2-7, ~45 min. Small, real, attendee- and judge-facing.)

SEQUENCE AFTER #132 MERGES (MRQ-143, speaker directory) — same files.

1. /speakers gains a Gallery / List toggle, the list being a genuinely distinct compact layout (rows: name, title · company, session count; no photos), reusing the embed's existing list layout. Fixed-width toggle, no jump — DESIGN.md craft rule: elements never jump. (EMB-12, w2 partial — the rubric wants 'a second surface to be distinct from'.)
2. Speaker profile: bio clamps to about 5 lines with a Show more control, and the sessions header becomes 'Sessions (N)'. (EMB-13, w1 partial remainder.)
3. Outbox status chip: 'suppressed · demo mode' becomes 'held in demo outbox · would send in production' (CommsScreen.tsx:378). This is the truth the product already means. (CFP-14, w2 partial.)
4. One line: a manually-closed portal stops printing a FUTURE close date beside 'CLOSED'. Show the closure state's own date, or nothing. (CFP-04 residue.)

VERIFY. Toggle between gallery and list on /speakers with no layout shift; a long bio clamps and expands; the outbox chip reads the new copy; a manually closed portal shows no future date.

## Implementation plan

- Merge the current `github/main` into the assigned worktree after the MRQ-143 sequencing gate.
- Keep speaker data loading and surname ordering in `src/lib/public-site.ts`; pass a URL-backed directory view into the existing SSR public speaker page.
- Add a fixed-width Gallery/List control. Gallery keeps the existing cards; List uses the compact embed treatment without avatars and includes each speaker's published-session count.
- Render the profile bio full by default for no-JS clients, then progressively enhance long bios into a five-line clamp with a reserved-line Show more control; label the session section with its count.
- Update the demo-safe outbox status copy and suppress only the contradictory future close date on closed public forms.
- Add `CONTRACT ·` tests for list rendering and closed-state copy, run the relevant suite and PR gate, then validate the four flows in the c11 right-pane browser before pushing and opening `MRQ-156: ...`.
