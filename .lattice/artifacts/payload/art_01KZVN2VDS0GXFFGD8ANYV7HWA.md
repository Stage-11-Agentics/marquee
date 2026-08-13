# Plan Review: MRQ-90

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

I reviewed the submitted plan for MRQ-90 (public-form autosave rate-limit test is flaky by construction) against the task description and the actual code at `src/routes/public-form.routes.ts:144`, `src/lib/r2/rate-limit.ts`, and `tests/integration/api/public-form.AC-25-42-155-157-231-234.test.ts:263-311`.

The plan is a **verbatim copy of the task description** — byte-for-byte identical from "FOURTH timing-dependent test defect" through the constraints list. It restates the diagnosis (which is correct and well-evidenced) but makes no plan: it does not choose among the three options, name a file, describe a step, or state how the fix will be verified. Beyond that procedural gap, the description's own preferred option rests on a premise the code contradicts, and the codebase already contains the canonical solution to this exact problem in `src/lib/r2/rate-limit.ts` — which neither the description nor the plan mentions.

## 3. Issues

**[CRITICAL] Whole plan — The plan is the task description, copied. No decision, no steps, no files.**
Lines 69–123 of the review packet are identical to lines 14–67. Nothing was added: the three options are still presented "in preference order" with none selected; no file paths are listed as created or modified; there are no implementation steps; there is no test plan and no verification criteria. An implementer handed this receives exactly what the ticket author already wrote, and every real decision — which seam, where `now` comes from, whether a helper gets exported, whether the assertion moves out of its AC-titled test — is silently pushed into implementation, which is where this ticket explicitly says defects get expensive. This alone requires a return to `in_planning`.
**Recommendation:** Rewrite as an actual plan: (a) pick one option and say why the other two were rejected; (b) list every file to be modified with the specific change; (c) state the verification protocol; (d) state the outcome of the "also worth checking" sweep as a concrete, bounded task. The sections below are the decisions that plan has to make.

**[CRITICAL] Scope, option 1 — "The route already threads context" is false for a clock; option 1 as stated means adding a test backdoor to an anonymous public write path.**
Two facts from the code. First, `draftTokenAllowed(cache, token, now = Date.now())` (`src/routes/public-form.routes.ts:144`) **already takes an injectable clock** — the option-1 work is not "let the limiter take a clock," it is "give the caller a clock to pass." Second, the caller cannot: the sole call site is `await draftTokenAllowed(context.env.CACHE, token)` (`:530`) inside `autosaveDraft`, which derives its own time from a bare `Date.now()` at `:537`. The Hono `Context<ApiEnv>` carries `env` and `req`, not a clock. So option 1 requires inventing a new clock seam on an unauthenticated public route — and the obvious cheap versions (a request header, a query param, an `env` override readable in production) are exactly a way to make the limiter say "the window just reset," which collides head-on with the plan's own binding constraint: *"Do not weaken the limiter itself. It is a real guard on an anonymous public write path."* A plan that picks option 1 without resolving this is planning to violate its own constraint.
**Recommendation:** If option 1 is chosen, the plan must state precisely where `now` originates and prove it is not attacker-reachable — e.g. threaded from a value the route already computes internally, or injected only through a test-only binding that the Worker never populates in a deployed build. Name the mechanism and the file. If no safe mechanism exists in one pass, choose option 3 instead.

**[MAJOR] Scope — The codebase already solves this exact problem, and the plan does not reference the pattern.**
`src/lib/r2/rate-limit.ts` implements the same fixed-window shape (`Math.floor(nowMs / 1000 / policy.windowSeconds) * policy.windowSeconds`, `:42`, `:70-74`) as an **extracted module taking an explicit `nowMs` parameter**, threaded from the route where `Date.now()` is called once and passed down (`src/routes/uploads.routes.ts:278`, `:295`, `:299`). That is the house convention for a KV-backed limiter here, and the autosave limiter is an inline duplicate of it that never got the same treatment. A plan that reaches for a novel clock seam while an established, already-tested pattern sits one directory over is inventing a fourth way to do this.
**Recommendation:** Make aligning with `src/lib/r2/rate-limit.ts` the explicit baseline — hoist `draftTokenAllowed` into a small exported limiter that takes `nowMs`, and thread `now` from `autosaveDraft` where it is already computed at `:537` (note this also fixes a latent inconsistency: the limiter and the write path currently read the clock at two different instants). If the plan rejects that in favour of something else, it should say why.

**[MAJOR] Scope, option 3 — Requires an unstated export, and moves an assertion out of an AC-owned test without addressing `trace:ac`.**
`draftTokenAllowed` is module-private; option 3 ("assert `draftTokenAllowed()` directly as a unit") cannot be done without exporting or relocating it, which the plan never mentions. More consequentially, the flaky assertion is not a standalone test — it is the tail of `test("AC-40 + AC-41 + AC-42 · draft resume restores answers and autosave needs only its resume token")` at `tests/integration/api/public-form.AC-25-42-155-157-231-234.test.ts:263`, loop at `:305-310`. `tests/ac-claims/MRQ-15.json` records that MRQ-15 **owns** AC-40, AC-41, and AC-42. Splitting the rate-limit assertion into a unit test touches AC ownership and coverage, and `trace:ac` is in the stated gate. The plan says nothing about which AC the rate-limit assertion actually claims, whether a new ac-claims entry is needed, or what title the new test carries under the `AC-<n> · ` / `CONTRACT · ` rule.
**Recommendation:** State the export change explicitly. Identify which AC the rate-limit assertion serves, name the exact new test title, and state whether `tests/ac-claims/*.json` needs an edit — then confirm `trace:ac` is run before the PR, as the gate requires.

**[MAJOR] Scope, option 2 — Presented as "deterministic, no production change," but it is neither cheap nor reliably deterministic.**
Waiting for a fresh minute bucket costs up to 60s of real sleep in a suite whose stated budget is 45s (`scripts/checks/run-test.mjs`) — option 2 can blow the budget on its own. And it does not remove the race it claims to: the 35 sequential PATCHes each perform a full D1 read/write cycle through the route, so under the same load that causes the flake today, the loop can still outrun the 60-second window even when started at a boundary. It converts a random flake into a load-dependent one, which the ticket's own rule ("makes the flake rarer, not absent") rejects.
**Recommendation:** Strike option 2, or keep it only with the sleep cost and the residual load dependency stated. It should not be the chosen path.

**[MINOR] Scope, the sweep — The stated premise is half-wrong, and the task is unbounded.**
"The same fixed-window shape is used for the turnstile-token replay key" is not accurate. The turnstile replay keys (`src/routes/public-form.routes.ts:137`, `src/routes/uploads.routes.ts:72`) are one-shot presence keys with a flat `expirationTtl: 300` and **no window component** — they cannot straddle a boundary and have no equivalent defect. The genuine second instance is `src/lib/r2/rate-limit.ts`, which is already `nowMs`-parameterized at the module level; what is worth checking there is whether its *integration* callers (`tests/integration/api/pipeline.test.ts`, `tests/integration/api/public-upload-presign.MRQ-81.test.ts`) assert limit behaviour against a real clock the same way this test did.
**Recommendation:** Replace the sweep item with the corrected, bounded version: drop the turnstile item as not-applicable (one line in the PR description), and check exactly the two named integration files for wall-clock-dependent limit assertions. State the expected finding so the sweep terminates.

**[MINOR] Constraints — No verification protocol for a flake fix, which is the one thing that proves the fix.**
For a defect whose signature is "passes on a re-run with zero code changes," "the suite is green" is not evidence. The plan needs the two-sided proof: the test is green repeatedly, *and* it still fails when the guard it protects is broken.
**Recommendation:** Commit to (a) running the target test file N times consecutively (20 is enough) with all passes green, ideally with a pinned clock deliberately set to straddle a minute boundary — the exact condition that fails today; and (b) a mutation check: temporarily raise `limit` well above 35, confirm the test goes red, revert. Note also that the current loop `break`s on the first 429, so it never asserts *where* the limit trips; with a pinned clock the assertion can tighten to "request 31 is the first 429," which is strictly stronger.

**[MINOR] The family / standing rule — Named as worth doing, assigned to no one and no file.**
The description closes with "worth a standing rule in the test conventions," and the plan repeats it without deciding whether it is in scope. There is no obvious conventions file in `tests/` for it to land in. Left ambiguous, it either silently doesn't happen (fourth incident of a kind, lesson uncaptured) or becomes unplanned scope creep in a PR that should stay tight.
**Recommendation:** Decide explicitly. Either name the destination file and treat it as a deliberate, small part of this PR, or defer it to a follow-up ticket and say so — but do not leave it floating.

## 4. Positive Observations

The **diagnosis** underneath this ticket is genuinely excellent, and it is worth separating that from the plan's failure. It:

- Identifies the mechanism precisely and cites the code — `Math.floor(now / 1000 / windowSeconds)` at `src/routes/public-form.routes.ts:143` — and I confirmed every claim about it against the source.
- **Proves** rather than suspects: main at `7baf74f` failed, then passed on re-run with zero code changes. That is the right standard of evidence for a flake claim.
- Explains why the fix is worth more than a re-run, with the real cost stated (a full diagnosis cycle spent suspecting three innocent PRs) and the second-order cost named (training the re-run reflex that hides real failures).
- Pattern-matches to a family of three prior incidents and extracts the generalizable lesson — wall-clock, sample-size, and ambient-environment assertions are landmines with random fuses.
- **Pre-rejects the tempting bad fix** ("do not raise the request count or add retries — that makes the flake rarer, not absent"), which is exactly the guardrail an implementer under time pressure needs.
- Protects the production behaviour explicitly: the limiter is a real guard on an anonymous public write path, and the defect is in the test, not in the guard's existence.

That material is a strong ticket. What is missing is the layer on top of it: a decision among the options, the files, the steps, and the proof. Add that and this becomes a straightforward, well-scoped PR.
