# Plan Review: MRQ-41 (M-48 empty-state pass + M-49 craft sweep)

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

### 2. Summary

Reviewed the MRQ-41 implementation plan for the merged M-48 (empty states on every route) + M-49 (craft sweep) ticket against the task description, `EVALUATION.md`, the AC-claims machinery, and the actual source tree. The plan is strong: every factual claim it makes was verified against the repo (MRQ-40 does own AC-161; the `owns: []` + `exercises` manifest pattern is supported by `trace-ac-core.mjs` and precedented in MRQ-6/23/61; all named route entrypoints exist; `check:design` and `pr-gate` scripts exist; the shared `EmptyState` primitive exists in `src/ui/shell/components.tsx`). The only concern is calibration-level: the plan's proposed node test is a proxy for AC-161's specified oracle (the `e2e:empty` crawler), and the sweep's coverage snapshot should be pinned given in-flight sibling tickets.

### 3. Issues

**[MINOR] Evidence and tests — Node inventory test is a proxy for AC-161's specified oracle**
`EVALUATION.md` (line 549) defines AC-161's method as `auto` via an `e2e:empty` crawler over an empty install: every route renders an empty-state component containing a next-action link, no crash, no 500, no blank page. That crawler does not exist yet (no `e2e:empty` script in `package.json`), and the plan's proposed static `tests/node` inventory test asserts source-level structure, not runtime behavior. This is acceptable because MRQ-41 only *exercises* AC-161 (MRQ-40 owns it), and the plan compensates with a real built-app empty-install walkthrough — but the sweep should be built to the crawler's eventual assertions, not just the inventory test's.
**Recommendation:** In the implementation, treat the crawler's four assertions (empty component present, next-action link present, no crash, no 500/blank) as the per-route definition of done, and say so in the test file's header comment so whoever builds `e2e:empty` inherits a codebase that already passes it.

**[MINOR] Route and state inventory — Sweep snapshot is unpinned against in-flight siblings**
The ticket runs "alongside, not after," and the plan correctly says it sweeps whatever has landed. But it doesn't state how the boundary is recorded. A route or list state that merges to `master` after the sweep's inventory pass but before the PR opens will silently escape both M-48 and M-49 treatment, and audit A-2 keys off this ticket.
**Recommendation:** Record the `master` commit SHA the inventory was taken against in the PR description (and optionally in the AC-claims note), so the orchestrator can see exactly which surfaces the sweep covered and route any later-landing modules to a follow-up rather than assuming coverage.

**[MINOR] Contract and constraints — 6-hour estimate is tight for the enumerated surface**
The admin sweep alone enumerates ~17 surface families and `route-table.ts` carries 28 routes, plus reviewer/portal/embed/public surfaces, plus the shared-primitive geometry work, plus a built-app populated-and-empty walkthrough of every route family. The hours were fixed at mint so this isn't a plan defect, but the plan has no triage order if time runs short.
**Recommendation:** Add a one-line priority order: empty states with next actions first (the only hard AC), then textual state markers (they underwrite a dozen "not colour alone" ACs), then geometry/no-jump polish — so if anything is cut it's the part no AC directly asserts.

### 4. Positive Observations

- **The AC-ownership trap was caught at plan time.** The task description assigns AC-161, but `tests/ac-claims/MRQ-40.json` already owns it, and `trace-ac-core.mjs` hard-errors on duplicate owners. The plan's `owns: []` / `exercises: ["AC-161"]` resolution is exactly right, matches existing precedent, and explicitly refuses to touch MRQ-40's file opportunistically. This alone would have been a code-review bounce; catching it here is the whole point of plan review.
- **Every constraint in the ticket is honored explicitly** — the `tokens.css` prohibition (M-05a ownership), contract-file no-touch list, module-owned styles only, and the public-repo hygiene sweep in self-review.
- **The validation posture is honest about what source reading can't prove.** Requiring a built-app cold walkthrough in both populated and empty states, and declining to "claim visual proof from static source alone," matches both the house smoke-launch rule and the felt checkpoint C3 that reads AC-161 copy aloud.
- **The test design guards against vacuous passes** (positive controls in the inventory test) and the plan keeps the default suite hermetic and inside the repo's test budget.
- **Good decomposition**: shared primitives first so geometry fixes land once, then admin, then public/participant surfaces where the copy constraints differ (no internal field names or status codes) — the sequencing mirrors where the risk actually lives.
