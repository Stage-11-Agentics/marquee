# Plan Review: MRQ-149 — ABS-14 agent evaluator score, reasoning, and persistent override

### 1. Verdict

**FAIL (plan-level)** — the task should return to `in_planning` for revision.

### 2. Summary

I reviewed the plan submitted for MRQ-149 against the task description and the current state of the repository. The "plan" is a verbatim copy of the task description with a `# MRQ-149: …` title line prepended — it contains zero planning content of its own. Every investigation the task explicitly mandates *before* building (the (a)/(b)/(c) gap analysis against MRQ-134, verification of the "do we claim AI review" conditional, locating the binding design) is unstarted, and the plan names no files, no approach, and no test strategy. Additionally, my own repo check surfaced a landmine the planner must resolve: the binding design doc the task points to does not exist on `main`.

### 3. Issues

**[CRITICAL] Entire plan — The plan is a copy of the task description, not a plan**
Lines 1–end of the plan are byte-for-byte the task description (I diffed them; only the title heading was added). A plan review exists to catch plan-level gaps before implementation; here there is no plan to evaluate. None of the checklist categories (completeness, feasibility, file identification, AC coverage, risk) can be assessed because the planner has added no information beyond what the ticket already said.
**Recommendation:** Return to `in_planning`. The revised plan must be the planner's own work product: findings from reading MRQ-134's artifacts, a gap list, an approach per gap, files to touch, and a verification plan.

**[CRITICAL] Missing gap analysis — The task's mandatory pre-read of MRQ-134 was not done**
The description says in capitals: "READ ALL OF THAT FIRST, then determine honestly which of the three rubric requirements MRQ-134 already satisfies." The plan is the natural artifact where that determination lands — which of (a) score + attributed reasoning, (b) visible AI/human distinction in results, (c) persistent, distinguishable admin override already exist, and which must be built. The plan records no determination for any of the three. Without it, the ticket's size ("medium, could be small") is unresolved and the implementer will either rebuild what exists or miss what doesn't — exactly the failure the description warns against.
**Recommendation:** The revised plan must state, per (a)/(b)/(c): EXISTS (with the file/route/AC that proves it) or GAP (with the concrete change proposed). This section is the core of the plan.

**[CRITICAL] Missing input — The binding design doc is not on `main`**
The task points to `sequence/agent-evaluator-design.md` as MRQ-134's binding design. That file does not exist on `main`: it was committed in `aadffd68` ("MRQ-134 intake: open evaluation as an agent seat — design, US-87, AC-288–293"), which is **not an ancestor of `main`** — it lives only on unmerged branches (`mrq-134-agent-evaluator`, `capture/unbacked-design-docs`, and others). The referenced ACs (AC-288–293 in EVALUATION.md §2.5) ride the same unmerged commit. An implementer branching from `main` will not find the binding design, and a plan that doesn't notice this will be executed against an incomplete picture of what MRQ-134 shipped. Note that `src/lib/reviewer-scope.ts` *does* exist on `main`, so MRQ-134's code landed while its design/AC intake apparently did not — the plan must reconcile which parts of "MRQ-134 is DONE" are actually on `main`.
**Recommendation:** The plan must state where it read the design from (e.g., `git show mrq-134-agent-evaluator:sequence/agent-evaluator-design.md`), reconcile what MRQ-134 actually merged to `main` versus what sits on the unmerged branch, and flag the unmerged intake commit to the orchestrator — it may need to land as part of or alongside this ticket.

**[MAJOR] Missing verification — The conditional clause ("only if the clone claims AI review") is unverified**
The description flags this as decisive: if Marquee does not claim AI review anywhere in UI or marketing, the honest score is N/A and whether the ticket is worth doing at all is an operator call. The plan neither verifies the claim nor records the evidence (which UI surface or copy constitutes the claim). This is a stop-the-line branch point, and the plan doesn't acknowledge it exists.
**Recommendation:** The plan's first step should be: enumerate where the product claims AI/agent review (badge, seeded evidence, marketing copy), cite the specific surfaces, and conclude "judgeable" or "STOP — raise operator flag" per the description's instruction.

**[MAJOR] Missing scope decisions — No files, no fixture strategy, no test plan, no overclaim guardrail**
Even setting aside the gap analysis, the plan makes none of the concrete commitments a reviewable plan needs: which files/routes/migrations change; how the specific fixture submission "Taming 40-Minute CI" comes to carry the evidence (seed change vs. runtime action — a meaningful choice given the judge reloads to test override persistence); how the override's persistence and distinguishability will be tested (unit vs. e2e, within the 45s suite budget); and how the shipped copy stays truthful about *what* is doing the scoring, given MRQ-146 exists precisely because the API overclaimed once already.
**Recommendation:** Add sections for: files to modify, seed/fixture approach for "Taming 40-Minute CI", test plan (including a reload-persistence check for the override), and the exact attribution language that satisfies ABS-14 without overclaiming a built-in AI reviewer.

### 4. Positive Observations

There is nothing to credit in the plan itself, since it contains no original content — but it is worth saying that the *task description* it copies is unusually strong: it pre-locates the prior art, decomposes the rubric into (a)/(b)/(c), pre-authorizes a stop-and-flag path for the N/A branch, names the fixture record, and carries an explicit anti-overclaim guardrail with a citation to the prior incident (MRQ-146). A planner who simply executes the description's own instructions — read MRQ-134's artifacts, verify the claim, close only the gaps — will produce a strong plan with little additional invention required. The raw material for a PASS is all here; the planning work just hasn't been done yet.
