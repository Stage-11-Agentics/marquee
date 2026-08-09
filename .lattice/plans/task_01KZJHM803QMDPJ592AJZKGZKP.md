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
