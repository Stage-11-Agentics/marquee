# MRQ-39: Mobile reviewer pass and optional AI first pass

## Scope authority and decision

The authoritative ticket description from lattice show MRQ-39 --json is M-44 (rank 25, US-27) plus M-47 (rank 28, US-32), not the boot prompt's M-43 + M-44 parenthetical. M-43 is the separate mobile submit pass on MRQ-37. This plan follows the ticket record and ticket map; it does not touch the public form.

This ticket will ship the M-44 mobile reviewer pass and explicitly cut M-47. The mobile pass is the real deliverable. The AI first pass is the bottom-ranked optional constituent; implementing it would expand a reviewer-module surface while the 375px flow still needs rendered proof and would spend the ticket's remaining suite/validation budget. No partial AI surface, flag, route, model stub, or misleading claim will be added. The PR body and final Lattice handoff will name US-32 and AC-167–AC-169 as cut, with the reason.

## Authority, boundaries, and seams

- Binding authority: this ticket description, SPEC §5.8, EVALUATION rows for AC-158/159 and AC-167–169, BUILDPLAN §5, DESIGN.md, PHILOSOPHY.md, and the existing merged reviewer module.
- Do not edit SPEC.md, EVALUATION.md, BUILDPLAN.md, DESIGN.md, PHILOSOPHY.md, or sequence/USER_STORIES.md; do not mint AC IDs.
- Implementation stays module-local: src/ui/review/ReviewerPage.tsx and src/ui/review/review.css, with reviewer-focused tests and the MRQ-39 claims manifest. No API, route, auth, shell, identity, database, or package changes.
- Preserve the MRQ-18/MRQ-28 seams: the reviewer queue and comparison mode remain data/API driven, the current queue index remains the return point, and save/advance keeps its existing endpoint and status semantics.
- Blind review remains fail-closed. Do not read or render SubmissionDetail.identity, add an identity query, or create a mobile-only identity path. MRQ-50's null-identity guard and single identity-query invariant must continue to pass.

## Base and baseline

- Worktree: /Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-39-mobile
- Branch: mrq-39-mobile
- Refreshed base: forgejo/master @ ca3f61e82f684bcc852c69b994177bffd3cbd17d
- Dependency refresh: npm ci completed after the rebase.
- Baseline: npm test passed with 34 Vitest files and 189 tests; elapsed report 14.761s, with only the existing absent-local-secrets warnings.

## Implementation plan

1. Make the reviewer queue and record usable at 375px with a thumb.

   - Keep the reviewer surface as its own shell with no admin navigation or admin links.
   - Add a stable mobile layout contract for the topline, queue heading, feedback/notice area, responsibility strip, submission card, recommendation controls, optional score, comment field, save-and-next action, comparison cards, and full-submission detail.
   - Reserve space for stateful feedback and action regions so loading, save/advance, error/notice, selection, and comparison updates do not move the controls a reviewer is reaching for. Keep the current queue card and score card in the same mobile order on every item.
   - Make the primary touch targets comfortable at phone width, keep the score/recommendation groups inside the 375px content box, and prevent long titles, IDs, track chips, notes, file names, and alert copy from creating horizontal overflow.
   - Keep the full-submission affordance obvious and reachable by thumb. Opening detail must preserve queue position; closing it must restore focus to the originating control. The detail view remains a full-height mobile sheet with a stable close/return action and scrollable body.
   - Preserve comparison mode as a stacked, one-handed flow: each of the three cards remains independently openable, rank controls remain touchable, ties remain possible, and the save-comparison action stays in a stable final slot.
   - Use existing Flight Deck tokens and shared primitives. Copy remains organizer-facing and uses “conference”; no ticket IDs, internal hostnames, or Stage 11 language enters the shipped UI.

2. Add focused proof for the mobile and reviewer-boundary invariants.

   - Extend the reviewer unit/source contract with AC-158 + AC-159 assertions for the responsive module, stable mobile control hooks, no admin chrome, and no identity access.
   - Add tests/ac-claims/MRQ-39.json with owns: [] and exercises: ["AC-158", "AC-159"]; note that MRQ-18 remains the owner and that MRQ-39 owns no auto AC. Do not claim or test the intentionally cut AI ACs.
   - Keep tests invariant-based: assert selectors/attributes/target geometry contracts and absence of identity/admin paths, not line numbers or brittle coordinate snapshots. Any absence assertion has a positive control where applicable.

3. Self-review and validation.

   - Review the diff as an adversary for horizontal overflow, conditional layout shifts, nested/unclear touch targets, focus loss, accidental admin reachability, and any identity reintroduction.
   - Run focused reviewer tests, npm test, production type/build/design checks as applicable, and npm run pr-gate -- --ticket MRQ-39. Keep the default suite under the 30s budget and the whole gate under 45s.
   - Browser validation is pending operator approval. If approved, use only the c11 embedded browser against an ephemeral local server at 375x812: load the reviewer queue, read the abstract, open/close full detail, choose a recommendation, type a note, save/advance, exercise comparison mode, and inspect scrollWidth/clientWidth plus stable control positions before and after state changes. No external domains, credentials, real addresses, or consequential external actions.
   - Record observed runtime evidence separately from static tests and inference. If browser approval is not granted, record validation as N/A with that explicit reason rather than implying rendered proof.

## Lifecycle and handoff

1. After this plan is written, self-review it; append an authoritative resolution block for every finding before implementation. Commit and push this plan first from the guarded worktree.
2. Transition planned, verify the ticket, then transition in_progress. At each phase boundary fetch forgejo and record the exact base SHA.
3. Commit meaningful implementation/test units and push each one. Before every commit verify the repository top-level is exactly this worktree.
4. Transition review, attach a post-review PASS artifact naming the reviewed HEAD, then transition in_validation and attach runtime/N/A validation evidence.
5. Run the mandatory PR gate and paste its result into the completion comment and PR body. Open one Forgejo PR against master, attach its URL, transition to pr_open, and stop there.
6. Completion reporting must tell the Orchestrator that M-44 shipped, M-47/US-32/AC-167–AC-169 were explicitly cut, and identify the M-43 scope mismatch without changing the contract docs.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Self-review verdict: PASS-WITH-NITS. The plan is intentionally mobile-first and cuts the optional AI half; it names the cut and all affected ACs as required by gate 19.
- NIT — browser approval: validation is explicitly conditional and scoped to an ephemeral local c11 surface at 375x812, with no credentials or external actions. A missing approval will be recorded as N/A, never as rendered proof.
- NIT — AC ownership: MRQ-18 already owns AC-158 and AC-159, so MRQ-39 exercises them without duplicate ownership. The claims manifest will say this explicitly and will not add an empty claims file.
- NIT — identity: the implementation may adjust markup and focus management only; it must preserve the existing null-selected blind payload and must not introduce any identity read or alternate query.
