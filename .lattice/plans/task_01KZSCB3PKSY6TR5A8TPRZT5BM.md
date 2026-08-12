# MRQ-88: Submission record shows a file answer as raw JSON

Found by MRQ-81 (surface:268) while walking the loop from a real public submission. Not MRQ-81's files, so filed rather than fixed.

## Symptom

On the submission record, a file answer renders as RAW JSON under the 'Headshot' heading instead of a filename, a link, or a thumbnail. The organizer sees the storage payload rather than the thing the speaker uploaded.

## Why it matters

This is on the organizer's most-used screen and it is the direct result of the step the whole product asks a speaker to complete. It also sits one step into the walkthrough loop, so it is likely on camera.

It became newly reachable tonight for the same reason as MRQ-87: before PR #30 no public submission could be created, so no real file answer had ever rendered here.

## Scope

- A file answer renders as something a human recognises — filename at minimum; a thumbnail for images is the obvious win given the field is a headshot and its own label promises a crop preview.
- Handle the absent case honestly: a required file that was never uploaded should read as missing, not as empty JSON or a broken image.
- Check the same rendering on any other surface that shows answers (reviewer detail, the portal's own view of what was submitted). A file answer is not special to one screen.

## Where

src/ui/submissions/* (the record's answer rendering) and whatever shapes the answer payload in src/routes/submission-record.routes.ts.

## Constraints

- ELEMENTS NEVER JUMP — if you add a thumbnail, reserve its space so the record does not reflow as images load.
- Flight Deck tokens per DESIGN.md; check:design stays green.
- Do not weaken the upload path's authorization to render a preview. Media is served from a separate origin with Content-Disposition attachment and nosniff by design.
- Corrected fleet gate: 3x tsc --noEmit, npx vite build, check:design, check:api, trace:ac, plus your diff's own test files. NO full npm test, NO pr-gate; say so in the PR body and let CI run the suite.
- Test titles must begin 'AC-<n> · ' or 'CONTRACT · '. test.each() fails trace:ac.
- main is behind a manual merge gate. Open a PR; a human merges.

## Verification

Use a REAL submission created through /f/cfp with a genuine image (possible as of PR #30), not a seeded fixture.
