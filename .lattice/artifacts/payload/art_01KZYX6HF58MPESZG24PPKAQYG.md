# Plan Review: MRQ-182

### 1. Verdict

**FAIL (plan-level)** — The plan is a verbatim copy of the task description, not a plan. It adds no investigation results, no implementation approach, no file list, and no test strategy — and its constraints section silently drops or rewrites several fleet rules from the task, one of which (gate serialization) it replaces with an instruction that would violate the rule it paraphrases.

### 2. Summary

I reviewed the MRQ-182 plan against the task description (CNT-13 session association in the files library, plus time-of-day rendering in the submission HISTORY panel). The two product changes are well-scoped and feasible — the task description itself is excellent — but the "plan" reproduces that description word-for-word and answers none of the questions the description explicitly poses (write-time vs read-time, where the derivation lives, how search picks up the derived association). The key concern is that an implementer following this document has been given a goal, not a route, and has additionally been given a gate-lock instruction that diverges from the fleet's actual lock.

### 3. Issues

**[CRITICAL] Whole plan — No planning content: the plan restates the task instead of answering it**
Lines 1–142 of the plan are byte-identical to the task description. The description explicitly directs the planner to start by determining "whether the link is missing at write time or only at read time" (given MRQ-140 already fixed a write-time path) — the single fork that determines the entire shape of the fix — and the plan does not resolve it, or even acknowledge it as an open question. Nothing states where the fallback derivation will live (SQL in the files-library query vs. application code vs. UI), whether the per-session Files tab and session search share that code path, or how "unambiguous accepted session" is computed (one accepted participation for this event — what query defines it?).
**Recommendation:** Return to `in_planning`. The revised plan should: (a) report the write-time/read-time determination with the file and line where the association is (or isn't) written and read — the relevant surfaces include `src/ui/files/FilesPage.tsx:84` (which renders the "no session attached" state) and `src/routes/speaker-files.queries.ts`; (b) state where the derivation lives, preferring the server-side list query so the SESSION column, per-session Files tab, and session search all read one derived value (the CLAUDE.md "one list query" rule points the same way); (c) define "unambiguous" as a concrete query condition; (d) specify the ambiguous-case rendering (the description requires listing the candidate sessions, which needs its own small UI decision and space reservation).

**[CRITICAL] Plan "Gate serialized" constraint — Replaces the fleet lock with a private lock that defeats serialization**
The task mandates routing every `pr-gate`/full-`npm test` run through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh` (verified present). The plan instead instructs a hand-rolled `fcntl.flock` on `/tmp/marquee-gate.lock` — a different lock file. A lock only serializes its participants: an agent flocking `/tmp/marquee-gate.lock` runs concurrently with every fleet agent holding the real lock, which is exactly the unserialized-run failure mode the task warns about (timeouts indistinguishable from reds).
**Recommendation:** Delete the python one-liner and restore the verbatim `gate-lock.sh` instruction from the task's constraints.

**[MAJOR] Plan "Constraints" section — Fleet constraints silently dropped from the task's list**
The plan's constraints section omits: cut the branch from `github/main` (never stale local `main`) and the freshness check; the instrument-confirmation rule (`lsof`/`curl /health` with `build_sha` before believing a negative browser result, plus the taken-ports list); the test-title convention (`CONTRACT · ` or `AC-<n> · ` prefix enforced by `scripts/checks/trace-ac-core.mjs:44` — stated to have cost three CI cycles already); and the load-check-before-believing-a-red rule. The implementer works from the plan, so every dropped rule is a rule the implementer won't follow — the test-title one alone guarantees a wasted gate cycle.
**Recommendation:** Carry the task's constraints block into the plan intact, or reference it explicitly rather than re-listing a subset.

**[MINOR] Part 1 — No stated approach for making session search find the derived association**
"The library's session search must find the file by its talk title once the association renders" is an acceptance criterion, not an implementation detail that falls out automatically: if search filters on a stored `session_id`/title column, a derived-at-read association won't match unless the search path applies the same derivation. The plan should say which it is.
**Recommendation:** In the revised plan, name the search code path and state whether it inherits the derivation from the shared list query or needs its own change.

**[MINOR] Part 2 — Timestamp rendering details left unspecified**
The plan doesn't state the time format, the timezone, or where the formatting helper lives (the codebase presumably has an existing date formatter that should gain a with-time variant rather than a parallel one). It also doesn't name the file rendering the HISTORY panel. These are small, but they are exactly what a plan is for; the tabular-numerals requirement is at least carried over from the description.
**Recommendation:** Name the HISTORY panel component and the formatter to extend; specify the rendered format (e.g. "Aug 13, 2026 · 14:32") and that sorting keys on the underlying millisecond timestamp, not the rendered string.

**[MINOR] Acceptance — No test placement or shape**
"Regression tests for both" and "a test that fails on `main`" are restated, but the plan names no test files, no fixture approach (e.g. seeding a speaker with one accepted session and a file-request task with the selector skipped), and doesn't note that the Part 1 test must cover the three-way rendering (explicit session / derived session / genuinely ambiguous).
**Recommendation:** List the test files to touch or create, the fixtures needed for the unambiguous and ambiguous cases, and titles carrying the required `CONTRACT · ` prefix.

### 4. Positive Observations

- The task grouping is sound and the plan preserves it: both findings are the same failure class ("the system has the information and the surface does not carry it"), small, and independent enough to land in one PR without entangling.
- The derivation policy for Part 1 — explicit selection wins, unambiguous accepted session as fallback, honest ambiguity with candidates listed — is carried over verbatim and is the right product behavior; nothing in the plan distorts it.
- The plan retains the verbatim rubric `pass_criteria` and the judge's reasoning, so the eventual implementer can verify against the actual acceptance surface rather than a paraphrase.
- Scope discipline is good: no scope creep beyond the two findings, no speculative schema changes, and the no-migration and no-deploy rules are retained.
