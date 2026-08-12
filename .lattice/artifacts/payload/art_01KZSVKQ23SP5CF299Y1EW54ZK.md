Shipped and merged as PR #33, squash cb0bc3c on main, carrying Aditya's two commits with authorship preserved.

VERIFIED RATHER THAN TAKEN ON TRUST:
- Nothing outside the landing reads ?demo=. The only consumer of demo intent in src/ is LANDING_SCRIPT reading the data-demo-role ATTRIBUTE, then POSTing /api/v1/auth/demo. The query string is decorative. So the landing/agenda asymmetry in this fix is correct: the landing works because it carries the attribute and ships the script; the agenda did not, and was a plain navigation into AppShell (excluded from isPublicPage in src/ui/app.tsx) and therefore the 401. One-instance bug, one-instance fix — nothing was missed.
- /f/cfp is a real, genuinely public route: publicFormRoutes.get('/f/:slug'), seed creates slug 'cfp', and /f/ is inside isPublicPage.

THE BEST FIND WAS THE TEST, NOT THE BUG. AC-4's href="/submissions" assertion was passing BECAUSE of the broken CFP link — the only bare href="/submissions" in the document. Proved it: restoring the old assertion against the fixed code fails with 'expected ... to contain href="/submissions"'. A test that passes because of a defect is worth more than the defect.

KYS-3 from the original PR #24 was deliberately excluded — it duplicated the LOCAL_UPLOAD_SHIM door that merged twenty minutes earlier in #30 (same purpose-tagged local-put HMAC, same /api/v1/uploads/local/{id} route, same file) and broke trace:ac with a non-AC test title. Reviewed on its merits and NOT a backdoor: flag-gated, HMAC-checked, 404s when unset, flag set nowhere. PR #24 is closed in favour of #33.

.lattice/ids.json resolved keeping both counters. Gate: 3x tsc, vite build, check:design, check:api, trace:ac 216 live / 0 uncovered / 0 errors, 13/13 targeted tests, CI fast-gate SUCCESS.

OPEN CAVEAT: /f/cfp was itself broken by MRQ-81 at the time of review; that fix merged separately as #30. And merging does not deploy — these are the judge's public doors and they reach nobody until someone redeploys.