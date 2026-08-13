# MRQ-145 implementation plan

## Scope

- Update only `src/routes/landing.route.tsx` to add discoverable, anonymous doors to `/agenda` and `/speakers`.
- Reuse the existing landing-page visual language and binding Flight Deck tokens; preserve the existing four doors and layout stability.
- Leave the GitHub URL byte-for-byte unchanged. Publication remains an operator decision and is explicitly out of scope.

## Implementation

1. Read `sequence/run-state.md`, `DESIGN.md`, `PHILOSOPHY.md`, `DEPLOY.md`, the differentiation-matrix live-defect evidence, and the landing/public route implementations.
2. Run relevant baseline tests and inspect the current landing markup and existing link/card conventions.
3. Add the two public-site doors at the smallest stable seam in the landing render, with clear labels and no new styling system.
4. Run focused checks plus `npm run pr-gate -- --ticket MRQ-145`.
5. Start the local Worker and capture content evidence showing landing hrefs for both routes and real rendered content on `/agenda` and `/speakers`; record byte counts and distinctive body markers.
6. Commit and push the implementation, then open a GitHub PR against `main` with local evidence, the gate result, and the unchanged GitHub-link note.

## Acceptance evidence

- Landing markup contains `href="/agenda"` and `href="/speakers"`.
- Local `/agenda` and `/speakers` responses contain real server-rendered content, not only the catch-all SPA shell.
- Existing landing links, including the GitHub URL, are unchanged.
- `npm run pr-gate -- --ticket MRQ-145` passes at the exact PR head.
- PR body includes the required verification commands/results and states that no deploy was performed; post-deploy verification remains the operator's separate check.

# MRQ-145: The landing page hides the public conference and links to a 404

The deployed landing page (src/routes/landing.route.tsx) offers exactly four doors: /f/cfp, /portal?demo=speaker, /reviewer?demo=reviewer, /submissions?demo=organizer — plus a link to https://github.com/Stage-11-Agentics/marquee, which returns 404 to everyone outside the org.

TWO DEFECTS, ONE FILE:

1. THE PUBLIC SEAT HAS NO DOOR. /agenda (65KB of real server-rendered sessions) and /speakers (25KB) are live, anonymous and healthy, and nothing on the landing page links to either. Same failure class as the reviewer-seat-with-no-door that cost ~24.7 eval points. Public Widgets carries area_weight 20, and a scenario agent that never reaches a surface scores cannot_judge, which drags toward the 60% coverage cliff where the headline score is WITHHELD ENTIRELY.

2. THE OPEN-SOURCE LINK IS A DEAD END. The competition requires an open-source repo. Verified: curl -sIL https://github.com/Stage-11-Agentics/marquee -> 404.

SCOPE: add discoverable doors to /agenda and /speakers in the same visual language as the existing four (Flight Deck per DESIGN.md; elements never jump). Do NOT change the GitHub URL here — publication is an operator decision tracked separately. If it has not resolved when this is ready, leave the link untouched and say so in the PR.

VERIFY AFTER DEPLOY: curl -s https://marquee.stage11.dev/ | grep -oE 'href=.[^"]*.' must include /agenda and /speakers.

Evidence: sequence/research/DIFFERENTIATION-MATRIX.md, Live defects D0 and D4.
