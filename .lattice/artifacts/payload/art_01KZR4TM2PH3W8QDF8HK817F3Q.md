PASS — exact final post-rebase HEAD 83938501b136989d3099edeef9f63a1cb6e37f0f (PR #52).

Final rebase target: forgejo/master 5f39f7c12f8c9fc3018bda2167c567901e0c2d33. Master advanced during the recovery, so the branch was rebased again before the final validation. All rebase passes were clean; the .lattice/** conflict in the first pass was resolved by taking upstream per COMMON.md, and the final branch diff contains no .lattice/** paths.

Final verification: npm ci completed successfully with zero vulnerabilities; the requested approximately 20-second settle was observed after this final rebase; npm run pr-gate -- --ticket MRQ-41 PASS in 17.612s against the 45s budget. Worker, client, and test types passed; production build passed; design contract passed; hermetic suite passed with 33 files and 186 tests; merged AC trace passed with live=212, testFiles=76, claims=40, uncovered=0, errors=0.

Delivery: pushed with an explicit force-with-lease from remote head 7b28e84b37a7d26a526465c8e294192d8baf4cae and verified forgejo/mrq-41-craft equals 83938501b136989d3099edeef9f63a1cb6e37f0f. forgejo/master 5f39f7c12f8c9fc3018bda2167c567901e0c2d33 is an ancestor. The internal MRQ-8 marker is absent from src/ui; the communications heading remains Server-side list contract. Protected seams, shared tokens, and contract docs are unchanged.

Review outcome: PASS for the rebased exact final head. PR #52 is open against master for orchestrator merge.