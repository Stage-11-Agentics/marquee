# MRQ-7: Public landing page with live pipeline preview

BUILDPLAN: M-05b — Wave 0 (§3)

Scope (verbatim): **Public landing with both demo entries** and the live pipeline preview carrying **real counts from the seed** — §5.1 has no loading state because the counts are server-rendered, and AC-2 requires both demo buttons to land on a populated screen. Split from M-05a (F-16) because the seed is M-04a/b, the demo login is M-03, and the first populated screen is M-08: built against M-01 alone, this ticket merges green against zeros and asserts AC-1/AC-2 on a page that cannot yet be true.

Felt checkpoint C1 runs against this surface at CP-1: a stranger opens the URL cold and answers three questions (what is this, how do I get in, whose tool is it) inside 10 s with no help.

File surface: `src/routes/landing.route.tsx`

ACs: AC-1, AC-2, AC-4
Hours: 2
Workflow: fast-track (≤2 h)
Shared files: none — module-local route file.
Deps: M-03, M-04a, M-05a+M-06
Plan: filled in by delegator's plan phase

## Implementation plan (authoritative)

Working against `forgejo/master @ 84a84b80d99e611fae7898f875d68661b5ebc65c` after rebasing the untouched worktree and running `npm ci`. Baseline `npm test`: PASS (15 Vitest files, 76 tests, 21.6s; the required local-secret warnings are non-fatal).

### Scope

- Add `src/routes/landing.route.tsx` as the public SSR landing module. Query the first `demo_mode = 1` conference in D1 and aggregate real pipeline counts from its submissions, open speaker tasks, agenda rows, and track assignments. Render one stable Flight Deck layout with the exact prototype hero copy, six preview cells, footer, and honest error fallback.
- Keep the organizer noun as `conference` in visible landing copy. Keep the existing `/api/v1/auth/demo` wire path untouched. Demo anchors will POST the existing organizer/speaker roles, then navigate to `/submissions`, the populated M-08 screen; their hrefs remain crawlable fallback links.
- Mount the SSR route in `src/index.ts` and preserve its rendered root in `src/ui/app.tsx` so the client bundle supplies the token/component CSS without replacing the server-rendered landing. These are required composition-root seams for the named page module; no shared design tokens, shell, API, or contract docs will be changed.
- Add focused AC-tagged integration coverage for live count aggregation, server-rendered hero/preview, both demo destinations, and forbidden placeholder copy. Add `tests/ac-claims/MRQ-7.json` with MRQ-7 ownership/exercise mapping.

### Non-goals

No new auth behavior, API route, submission-list behavior, dashboard module, speaker portal, public CFP, seed mutation, contract-doc edit, or design-token change. No loading state for the server-rendered counts; interaction failure gets an in-place reserved status line.

### Validation

Run focused landing tests, then `npm test`, `npm run pr-gate -- --ticket MRQ-7`, and a real `wrangler dev` + curl pass for `/` (complete HTML, non-zero seeded counts, both demo POSTs, and populated `/submissions` redirect). Self-review the final diff and verify no contract copy says `event` in the landing module. Push `mrq-7-landing`, create the Forgejo PR against `master`, attach its URL, bump `pr_open`, and send the completion line to workspace:9/surface:60.
