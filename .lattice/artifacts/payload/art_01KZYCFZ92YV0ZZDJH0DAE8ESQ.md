# Plan Review: MRQ-163

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The "Plan" submitted for review is a verbatim copy of the Task Description — same paragraphs, same sentence order, nothing added. It restates the problem well but makes zero implementation decisions: it doesn't pick between the two AC2 options, doesn't design the AC3 check, and doesn't re-verify its own file/line scope against current `main`. Direct inspection of the codebase surfaces two things the plan needed to know and doesn't mention: a `scripts/checks/check-clocks.mjs` already exists, is already wired into `pr-gate.mjs`, and is already silently missing exactly this bug class due to a same-line matching gap; and the third file the scope list names as a future landmine no longer contains the described pattern on `main`.

## 3. Issues

```
**[CRITICAL] Whole document — the "Plan" is the Task Description, not a plan**
The Plan section handed to this review (lines 46-77 of the prompt) is character-for-character
identical to the Task Description (lines 14-43), with only a title line added. It contains no
chosen approach, no file-by-file steps, no verification plan, and no acknowledgment of anything
found by actually reading the code. There is nothing here to evaluate as an implementation
strategy — restating the ticket is not planning it.
**Recommendation:** Return to planning. A real plan must state, for each AC: which of AC2's two
options was chosen and why, what AC3's check will actually look for (see next finding — one may
already exist and be broken), what the AC4 sweep will touch, and how AC1 will be verified
(re-run `npm run pr-gate`).
```

```
**[CRITICAL] AC3 — the requested check already exists, is already in the gate, and is silently broken**
`scripts/checks/check-clocks.mjs` already implements almost exactly what AC3 asks for: it's
registered in `package.json` as `check:clocks`, wired into `pr-gate.mjs` (`["fixture clocks",
"npm", ["run", "check:clocks"]]`), and its own docstring describes this exact incident shape
one day earlier (2026-08-12T15:00Z, "a fixture that says `const NOW = Date.UTC(...)`... eleven
suites minting `auth_sessions` rows"). Running it right now (`node scripts/checks/check-clocks.mjs`)
passes cleanly — 0 findings — despite both currently-red files carrying the exact pattern it was
built to catch. The gap: Rule 1 requires the time-compared column name (e.g. `expires_at`) and the
anchor-offset expression (e.g. `now + 86_400_000`) to appear **on the same line**
(`if (!column.test(code) || !offsetFromAnchor.test(code)) return;`, scanned line-by-line). In both
`participants-editable.MRQ-139.test.ts` (column on line 63, offset on line 65 — the multi-line
`db.prepare(\`INSERT...\`).bind(...)` chain the check's own comment warns is a real hazard) and
`people.MRQ-131.test.ts` (column on line 92, offset on line 93), the SQL template and the
`.bind()` call sit on different lines, so the same-line check never links them.
A plan that doesn't know this exists will most likely author a second, parallel check — which
either duplicates `check:clocks` (two things enforcing the same rule, one of them still broken)
or gets bolted on without fixing the actual detector that's already wired into the gate and
already failed to prevent this exact incident twice in two days.
**Recommendation:** AC3 should be "fix `check-clocks.mjs`'s Rule 1 to associate an anchor with a
time-compared column across the statement/bind pair, not just within one line" — not "add a new
check." Concretely: track the column list from the `INSERT`/SQL line and match it against the
`.bind(...)` argument line(s) that follow (or a wider match window scoped to one statement),
instead of a single-line regex pair. After fixing it, `check:clocks` should itself flag both
currently-red files, and running it should be the acceptance test for AC3.
```

```
**[MAJOR] AC2 — the plan doesn't choose an option, and the codebase already tips the scale**
`resolveSession` (`src/lib/auth/auth-sessions.ts:45-57`) already accepts an optional `now`
parameter and defaults to `Date.now()` — so at the function level, "test-injectable clock" is
already half-built. But the actual request path never uses it: `auth-middleware.ts:78` calls
`resolveSession(db, sessionId)` with no override, and integration tests exercise this through
`SELF.fetch()` — real Cloudflare Workers request dispatch, not a direct function call. Making the
fixture control that clock would mean threading a fake-now through the whole worker's request
handling (env binding, request header, or similar), which is materially more invasive than the
"mint `expires_at` from `Date.now()`" option the task itself flags as smaller. The plan should
make this call explicitly rather than leaving both options open — a delegator implementing this
blind, choosing between the two options AC2 lays out with no steer, could easily land on
the more invasive of the two.
**Recommendation:** State in the plan: "Option 1 (anchor `expires_at` to `Date.now()` in the
fixture, keep the fixture's frozen `now` for everything else) — chosen because Option 2 requires
plumbing a fake clock through `SELF.fetch()`'s real request dispatch, which the current
`resolveSession(db, sessionId, now = Date.now())` signature doesn't reach from the API surface."
```

```
**[MAJOR] Scope — the third file in the "Scope" list no longer matches the description**
`submission-record-board.AC-118-120-238-240-243-251.test.ts` is named as a currently-green future
bomb ("`Date.UTC(2026,9,20,15,30)` + 24h — fires 2026-10-21"). Reading the file's actual fixture
setup (`seedFixture`, line 42) shows `const now = Date.now();` — the real clock, not a literal
anchor — and both `auth_sessions` inserts (lines 48, 60) derive `expires_at` from that real-clock
`now`. The only `Date.UTC(2026, 9, 20, ...)` occurrences in the file (lines 143, 237) are
`starts_at` values in a session-scheduling POST body, unrelated to any expiry check and not
compared against the real clock. This file does not currently exhibit the described bomb. It's
plausible this file was already remediated by whatever produced `check-clocks.mjs` on 2026-08-12
and the task's scope list is stale, or the real third landmine is a different file the author
mis-cited. Either way, an implementer who trusts the file/line list at face value and "applies the
fix to all three files" will spend effort on a file that needs none, and may miss whichever file
actually carries the third bomb.
**Recommendation:** Add a step to re-run the scope-finding sweep against current `main` before
touching any file (e.g. `grep -rn "Date.UTC" tests/ | grep -B2 -A2 "expires_at\|closes_at"` or,
once AC3's fix lands, just run the corrected `check:clocks` and use its findings as the real
scope list instead of the task's).
```

```
**[MINOR] AC4 — sweep scope is nontrivial and undersized in the plan**
A dozen-plus test files reference `closes_at` alongside `Date.UTC` somewhere in the file (e.g.
`submitter-portal.MRQ-150.test.ts`, `evaluation.test.ts`, `co-speaker.AC-149-151.test.ts`,
`category-routing.AC-135-137-234.test.ts`, among others), and `magic_links` appears with
`Date.UTC` in `cold-start.AC-275-286.test.ts` and `reset-demo.test.ts`. Most of these are likely
fine (calendar dates used for display/ordering, not compared against the real clock — the check's
own docstring makes this distinction), but "sweep for the same shape" as a bare instruction gives
no method for telling which of a dozen-plus files are real bombs versus benign calendar data.
**Recommendation:** Once AC3's check is fixed to also catch cross-line anchor/column pairs, its
`TIME_COMPARED_BINDINGS` list already includes `closes_at`, `opens_at`, and `due_at` — running the
corrected check across the full test tree *is* the AC4 sweep, and is a cheaper, more reliable
substitute for a hand sweep. The plan should say so explicitly rather than leaving "sweep" as a
manual, unscoped task.
```

```
**[MINOR] AC1 — no explicit verification step**
Neither the task nor the plan states how AC1 ("the gate is green on main with no other change")
will be confirmed before calling this done.
**Recommendation:** Add an explicit step: after the fix, run `npm run pr-gate` on a clean tree and
confirm 0 failures, and diff `git diff main` to confirm no unrelated files changed.
```

## 4. Positive Observations

The task description itself (which the plan reuses) is genuinely strong: it correctly diagnoses
the root cause (frozen fixture clock vs. real-clock comparison in `resolveSession`), correctly
separates the two currently-red files from the one static-analysis-only third file, gives an
honest account of how the diagnosis was reached (bisecting via `e29d4bd8`), and reasons well about
why this deserves priority (a permanently-red gate teaches the fleet to ignore red gates — a sharp,
well-argued point). The acceptance criteria are the right shape for this bug: fix now, fix the
class, add a preventer, sweep neighbors. None of that diagnostic work is in question — the gap is
entirely that no planning happened on top of it before this went out for review.
