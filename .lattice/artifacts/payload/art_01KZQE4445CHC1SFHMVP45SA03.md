Verdict: PASS

Reviewed HEAD: 953deb3291f1b406ea0e5833d389bc62c3746f6e
Base: forgejo/master @ d16523c64a41fd2e8097548bbe8e615249aa8bcd
Scope reviewed: conference details, formats, tracks, in-place save, and the full-row Venues handoff card.
Venue boundary: no changes under src/ui/venues, no /settings/venues route changes, no venue endpoints or venue editor controls in MRQ-10; MRQ-62 owns buildings, rooms, geography, and Amendment 14 behavior.
Findings: none.
Evidence: npm test (118 passed); npx tsc --noEmit; npm run check:api (pass, 52 operations); npm run trace:ac -- --ticket MRQ-10 (pass); git diff --check (pass).
Validation note: running-system validation remains the next lifecycle phase.