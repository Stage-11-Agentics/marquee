# MRQ-87: Public conference site prints every speaker twice

ON CAMERA IN THE WALKTHROUGH. Found by MRQ-81 (surface:268) while walking the full loop from a real public submission — the first time anyone has run that path end to end. Not MRQ-81's files, so filed rather than fixed.

## Symptom

The public conference site renders the speaker name twice, as 'Robin Alvarez · Robin Alvarez'. The API returns the same person id as BOTH Speaker and Submitter for a submission where one person is both — which is the ordinary case for a public CFP submission, so this is the default appearance, not an edge case.

## Why this is critical rather than cosmetic

The walkthrough video IS the evaluation rubric (project CLAUDE.md), and the public conference site is where the 11-step loop ends — it is the payoff shot. A judge sees a duplicated name on the public-facing artifact before they see anything else that was fixed tonight. It is also the single most screenshot-able surface in the product.

It became newly reachable tonight: until PR #30 no public submission could be created at all, so nobody had ever seen a real submitter-is-also-speaker record render on the public site.

## Scope

- One person appearing in two roles on the same submission renders ONCE on the public site.
- Decide deliberately what the public site should say when submitter and speaker genuinely DIFFER — the public site is an audience-facing surface and the submitter is arguably not audience information at all. State the ruling in the PR.
- Check the same duplication does not appear on the agenda, session detail, embeds, or ICS attendee lists — the join is likely shared. A fix that repairs one surface and leaves the embed wrong is worse than none, because the embed is what gets pasted elsewhere.

## Where

src/routes/submissions.queries.ts (the participations join returning the same person id twice) and the public site render path. Cross-check src/ui/public/*.

## Constraints

- Do not dedupe in the view layer alone if the query is returning a duplicate row — fix the source, or the next consumer inherits it.
- Corrected fleet gate: 3x tsc --noEmit, npx vite build, check:design, check:api, trace:ac, plus your diff's own test files. NO full npm test, NO pr-gate; say so in the PR body and let GitHub CI run the suite.
- Test titles must begin 'AC-<n> · ' or 'CONTRACT · '. test.each() fails trace:ac — write tables longhand.
- main is behind a manual merge gate (CODEOWNERS + 'main: manual merge gate'). Open a PR; a human merges.

## Verification

Reproduce on a REAL submission created through /f/cfp (possible as of PR #30), not a seeded one, and confirm the public site, agenda and any embed all render the person once.
