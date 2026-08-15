# Code Review: MRQ-163

## 1. Verdict

**PASS**

## 2. Summary

Reviewed the actual branch diff against `github/main` (the prompt's embedded diff was truncated at 5,000 of 81,291 lines and included unrelated already-merged history, so I diffed the live worktree directly). The real change is nine files: `check-clocks.mjs` is split into a pure `clock-policy.mjs` (rules) plus a thin CLI walker, the rule engine is rewritten to parse prepared statements instead of single lines (the exact gap that let four sessions expire silently on 2026-08-13), a new `auth-session-expiry-from-literal-date` rule closes both doors a session can be dated through (a literal-date column and `createSession({ now: <literal> })`), six fixture files get either a real fix or a justified `clock-check: allow` escape hatch, and a new 8-case regression suite (`tests/node/check-clocks.test.mjs`) pins the guard against exactly the shape that slipped through before. I ran `npm run check:clocks`, the new node test suite, and the full `npm run pr-gate` locally — all green. All four acceptance criteria are met, and AC4's sweep for `magic_links`/`forms.closes_at` is independently verifiable: no test inserts into `magic_links` directly (every `createMagicLink`/`mintMagicLink` call rides `Date.now()`), and the one `forms.closes_at` bomb the sweep found (`delivery-health.MRQ-74.test.ts`) is fixed in this diff.

## 3. Issues

No issues found.

## 4. Positive Observations

- **Root-caused correctly, not just patched.** The commit history (`0c1bd28f`) shows the author found the actual reason the old guard missed the 2026-08-13 incident — a per-line regex that required the column name and the offset arithmetic on the same line, when real INSERTs split them across `.prepare(...)` and `.bind(...)`. The fix (`preparedStatements`/`closeOf` in `clock-policy.mjs`) reads the whole statement as one unit, with a hand-rolled bracket walker that correctly ignores parens inside string literals (verified with a synthetic `COUNT(*)`/escaped-quote case — it doesn't false-terminate).
- **The guard now has a regression suite for itself.** `tests/node/check-clocks.test.mjs` encodes the verbatim statement shape that slipped through on 2026-08-13 as source (not prose about source), plus negative controls for over-matching. This is exactly the kind of test that would have caught the original guard's blind spot before it shipped.
- **The self-exemption for the guard's own suite is justified and I confirmed it's load-bearing.** I ran `clockFindings` directly against `tests/node/check-clocks.test.mjs`'s own source and it produces 10 findings against its quoted fixture strings — without the `RULES_OWN_SUITE` exclusion, the guard would flag its own test file. The comment explaining why a `clock-check: allow` marker can't be used instead (it would exempt the fixture from its own assertions) is correct.
- **Every escape hatch carries a specific, checkable reason**, and I spot-checked two against the actual source rather than taking them on faith: `agent-evaluator.MRQ-134.test.ts`'s claim that no code compares `evaluation_rounds.opens_at/closes_at` to a clock holds (`grep` across `src/routes` shows those columns are only ever stored and echoed back); `cascade-reversal.AC-121-123.test.ts`'s claim that its due dates are read only via an injected `NOW` handed to `enqueueOverdueTaskReminders` also holds.
- **AC3's grep-level check is more than grep-level without becoming fragile** — it added exactly one new, narrowly-scoped rule (`auth_sessions` may carry no calendar date, full stop) rather than trying to generalize Rule 1's judgment call, and covers the "second door" (`createSession` handed a pinned `now`) that a statement-only rule structurally cannot see.
- Gate is green end-to-end: `pr-gate` (tsc ×3, vite build, all `check:*`, full test suite, merged AC trace) passed in 55.8s against a 120s budget; the inner test suite finished slightly over its 45s objective (50.5s) but that's an explicitly non-blocking warning per this repo's own contention-tolerant budget design, not a defect introduced by this change.
