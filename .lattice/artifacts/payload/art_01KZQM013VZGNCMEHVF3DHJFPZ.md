Review: MRQ-16 self-review after final rebase
Reviewed HEAD: b95bb4b4fe4b12af2d8bda83555ac44eafe2d92a
Base: forgejo/master @ 6e869881e2fcb5eaaaf65ac2bc4e5101bb0d5cd2
Verdict: PASS
Findings:
- None.

The final rebase changed only commit identities; the reviewed product diff remains the portal route/UI, inherited upload lifecycle extension, image-dimension validation, AC-tagged integration coverage, and MRQ-16 claim map. Session and person/event predicates still constrain every portal read/write to the authenticated speaker. Task payloads remain real acknowledge/form/file surfaces using the shared conditional evaluator; profile/headshot, talk editing/history, status/schedule, handbook, reserved geometry, and read-only decision feedback remain in scope. AC-240 is exercised here while MRQ-11 remains its trace owner. AC-233 is included.

Validation at this exact HEAD:
- npm run pr-gate -- --ticket MRQ-16: PASS; 23.127s; worker/client/test types, production build, design contract, 34 test files / 188 tests, and merged AC trace all passed.
- trace:ac: 212 live criteria, 46 test files, 22 claims, 0 uncovered, 0 errors.
- Local wrangler/curl flow already recorded: anonymous portal 401 with no portal payload; demo speaker login 200; authenticated portal 200 with only the seeded speaker data.

The branch is clean and the remote branch equals this HEAD.