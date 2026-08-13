Merged as 0b116387 via PR #123 (Stage-11-Agentics/marquee), main CI green on it.

Change: canonicalFacet() in src/lib/public-site.ts resolves each incoming facet
(day, track, format, room) against its catalog by id or case-insensitive name inside
loadPublicAgenda, so the values the controls render are the ids the <option>s and day
tabs carry. The embed reuses the agenda's resolved values instead of its own raw ones.
The filter SQL is untouched -- ?track=Agents and ?track=trk_agents both still filter.

Premise correction on the ticket: the id form was never broken (preact-render-to-string
already resolves <select value> into a selected option), and the embed did not "get it
right" -- it carried the same defect. The real bug was the NAME form on both surfaces.

Regression coverage: tests/integration/public-agenda-filter-state.MRQ-136.test.ts,
4 tests, all failing pre-fix and passing after.

Review standing: the lattice code-review agent timed out twice at 600s under machine
load ~200 and is moot post-merge. Coverage came from CI fast-gate on an unloaded runner
(worker/client/test types, production build, shell truth, design contract, API contract,
route map, fixture clocks, full hermetic suite, merged AC trace) plus running-server
validation by curl and browser DOM read, recorded in the validation comments.