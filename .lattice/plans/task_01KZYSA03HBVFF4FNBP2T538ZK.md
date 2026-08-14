# MRQ-182 implementation plan

1. Trace the central files library's deliverable/session data from the route query through its view model and confirm whether the missing association is lost at write time or omitted at read time.
2. Preserve an explicit task session when present; otherwise derive a session only when the deliverable speaker has exactly one accepted session for the conference. Keep an honest, informative empty/ambiguous state.
3. Render history timestamps with date and time in a stable-width, tabular-numeral presentation and verify chronological ordering uses the underlying millisecond values.
4. Add regression tests with `CONTRACT · MRQ-182 · ...` titles that fail against current `github/main` and pass on this branch.
5. Verify targeted tests, then the serialized `npm test` and `npm run pr-gate`; run the scoped browser/runtime path if the local instrument is available. No migration or deployment.
