# Plan Review: MRQ-145

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed, incorporating the recommendations below (especially the branch-base and regression-test items).

### 2. Summary

Reviewed the MRQ-145 plan to add landing-page doors to `/agenda` and `/speakers` while leaving the GitHub link byte-for-byte unchanged. The plan is tightly scoped to the single file the ticket names, mirrors the task's scope carve-out correctly (no GitHub URL change, no deploy), and its acceptance evidence maps cleanly onto the ticket's verification commands. The key concern is environmental, not conceptual: the primary checkout's `main` is ~109 commits behind `github/main`, and `landing.route.tsx` has materially changed upstream (the reviewer door, a conditional `/signin` link, relabeled pipeline stages) — implementing against a stale base would silently clobber the reviewer door, the exact defect class this ticket exists to prevent.

### 3. Issues

**[MAJOR] Implementation §1–3 / §6 — Plan does not pin the branch base, and the local checkout is badly stale**
Local `main` (22e4a75f) is 109 commits behind `github/main` (1058ed23, which is also the deployed sha). On the stale base, `landing.route.tsx` has only *three* doors — no `/reviewer?demo=reviewer`, no conditional Sign in link, and "Accepted" instead of "Ready to place." The plan's own scope bullet says "preserve the existing four doors," which is only possible against current `github/main`. If the worktree is cut from the local checkout's `main`, the change would revert the reviewer door and fail `tests/integration/landing.test.ts` (which asserts `href="/reviewer?demo=reviewer"` at lines 52–53) — or worse, pass locally against old tests and regress on merge.
**Recommendation:** Add an explicit step: fetch and branch from up-to-date `github/main` in a linked worktree (`git worktree add ../Marquee-worktrees/mrq-145-landing-doors …` per repo rules — no code work in the primary checkout). Note that a `mrq-145-landing-doors` branch already exists based at 1058ed23; verify and reuse it rather than minting a second base. Before editing, confirm the file in the worktree contains the reviewer door.

**[MAJOR] Acceptance evidence — No regression test for the new doors; the repo convention is one assertion per door**
`tests/integration/landing.test.ts` asserts every existing door's href (`/f/cfp`, `/portal?demo=speaker`, `/reviewer?demo=reviewer`, `/submissions?demo=organizer`, the GitHub URL). The plan's evidence relies on a one-time grep of local render output, which protects nothing after merge — the reviewer-seat-with-no-door failure this ticket cites is precisely what an asserted href would have caught. The plan says "run relevant baseline tests" but never updates them.
**Recommendation:** Add a step to extend `tests/integration/landing.test.ts` with `expect(html).toContain('href="/agenda"')` and `expect(html).toContain('href="/speakers"')`, following the existing pattern. (Note: `pr-gate --ticket MRQ-145` only *warns* on a missing ac-claims manifest — `missing-current-ticket-manifest` is a warning, not a failure — so an ac-claims entry is optional, but the test assertions are not.)

**[MINOR] Implementation §3 — New doors must be plain anchors, not demo-role links**
The landing script intercepts every `[data-demo-role]` anchor, `preventDefault()`s, and POSTs to `/api/v1/auth/demo` before navigating. `/agenda` and `/speakers` are anonymous public surfaces; if the new links copy the demo-door markup wholesale they would trigger a pointless demo-auth POST and, on failure, block navigation entirely — invisible to any SSR-grep check, and fatal to a scenario agent that clicks rather than curls. The plan doesn't call this out.
**Recommendation:** State explicitly that the new doors are plain `<a href>` elements with no `data-demo-role` attribute, so they work with JavaScript disabled and for agent crawlers alike.

**[MINOR] Implementation §3 — "Smallest stable seam" leaves door placement undecided against the elements-never-jump rule**
`hero-actions` is a `flex-wrap` row; two more buttons will wrap to a second line at common widths, and the mobile media query already hides the first `landing-links` button below 800px. This is static SSR content so nothing jumps *across state changes*, but the plan should acknowledge it's making a placement decision (hero action row vs. a distinct "explore the public program" group vs. nav) rather than discovering it mid-edit.
**Recommendation:** Name the intended seam in the plan — e.g., a labeled pair alongside "View public CFP" in `hero-actions` (the existing anonymous door), reusing `.button ghost`/`.button` classes with no new CSS — and verify the ≤800px and ≤520px breakpoints still render both new doors.

### 4. Positive Observations

- **Scope discipline is exact.** The plan reproduces the ticket's carve-out faithfully: GitHub URL byte-for-byte untouched, publication explicitly out of scope, and the PR will say so — matching the ticket's "leave the link untouched and say so in the PR" instruction precisely.
- **The deploy boundary is handled honestly.** The ticket's verification command targets the live site, which the implementer cannot satisfy (merging does not ship, per `DEPLOY.md`). The plan's acceptance evidence correctly substitutes local-Worker verification plus an explicit "no deploy performed; post-deploy check is the operator's" note, rather than pretending or overreaching into a deploy.
- **Evidence is content-shaped, not just status-shaped.** Requiring real server-rendered content, byte counts, and distinctive body markers on `/agenda` and `/speakers` — not merely HTTP 200s — guards against the catch-all-SPA-shell false positive the plan itself names.
- **Orientation reading list is right-sized:** `run-state.md`, `DESIGN.md`, `DEPLOY.md`, and the differentiation-matrix evidence are exactly the binding documents for this change.
