# MRQ-19: Bulk and record-owned decisions with cascade

BUILDPLAN: M-18 — Wave 1 (§4), walkthrough step 9

Scope (verbatim): Select-all-matching as server selector; bulk accept/reject/waitlist/withdraw, **each transition into `accepted|waitlisted|rejected` writing a `submission_decisions` row (feedback null) so bulk and record decisions share one render path**; per-record results; record-owned Approve/Maybe/Deny confirmation **invoking M-52's decision write** (M-52 owns AC-235/236 end to end — schema use, render-once, portal display, record log — and M-18 calls it); cascade (status → portal → rendered mail → tasks), CFP stays open.

Every bulk path goes through M-07's single chunking helper (S-3's verdict); guardrail G11 and audit A-10 drive 150 and 1,000 records against it (trap 11 — D1's 100-bound-parameter cap).

File surface: `src/routes/submissions-bulk.routes.ts`, `src/routes/submission-decisions.routes.ts`, `src/jobs/cascade/*`

ACs: AC-66 – AC-69, AC-114 – AC-117, **AC-243**
Hours: 6
Workflow: inline-full
Shared files: none — module-local. **Do not fork a second decision-write path**; call M-52's.
Deps: M-11, S-3
Speed: AC-69 is AC-sourced for completion; the ≤100 ms longest-main-thread-task figure is the *proposed instrument* — measured and reported, not a gate.
Audit that keys off this ticket: A-10 (bulk-write audit), after M-18
Plan: filled in by delegator's plan phase
