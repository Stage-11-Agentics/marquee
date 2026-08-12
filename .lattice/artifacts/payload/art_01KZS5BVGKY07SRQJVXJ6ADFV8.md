Verdict: PASS. Reviewed exact branch HEAD 2869b6ebc88368f16ad3b2ee5165747515ed588d after rebase onto current github/main and npm ci.

Scope: seed adds exactly one organization-scoped owner membership; reset fixture mirrors that additive row; reset expected count and guard cover the row; no migration and no forbidden files changed. Token route authorization remains membership-backed and unchanged.

Security: organization owner satisfies requireTokenAdmin; event-scoped membership is not widened; integration coverage refuses reviewer, speaker, and anonymous callers on list, issue, and revoke, checks no disclosure and unchanged token counts, and covers bearer scope current-event 200 versus unheld-event 403 plus post-revoke 401.

Verification: focused token/reset integration passed; seed guard passed; tsc passed; standalone node suite passed 91/91; full Worker phase passed 22 files/162 tests. git diff --check github/main...HEAD passes.