# Plan Review: MRQ-23 — Seed and speed check suites

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

Reviewed the MRQ-23 plan against the ticket text, `BUILDPLAN.md` M-22, `EVALUATION.md` §1.3, `SPEC.md` §6/G7, and the landed harness (`scripts/checks/check-seed.mjs`, `check-speed.mjs`, `speed-budgets.mjs`, `lib/command.mjs`, `trace-ac-core.mjs`, `tests/ac-claims/`). The plan has the right shape — it correctly identifies that MRQ-62's venue gate must be extended rather than replaced, that the package scripts are immutable, and that local numbers must never be labelled deployed — but it self-describes as "initial rough form" and leaves the three decisions that determine feasibility unresolved: **how** the browser-level §1.3 budgets get measured, **where** they get measured (the ticket says deployed infra; the plan says local), and **what** the seed check actually asserts (AC-3's own criterion — ≥800 submissions, ≥150 accepted speakers, agenda density > 0 — is never named). It also carries one concrete gate-breaking defect: AC-3 is already `owns`-claimed by MRQ-5, so an MRQ-23 manifest claiming it fails `trace:ac` with `duplicate-owner`.

### 3. Issues

**[CRITICAL] Implementation outline §4 — the measurement instrument for the §1.3 budgets is never named**
`EVALUATION.md` §1.3 specifies a method per budget, and most are browser-level: "cold load → interactive" with fresh context and cache disabled (AC-36, AC-85), "keystroke → results painted" (AC-103), "longest main-thread task ≤ 100 ms" via the **Long Tasks API** (AC-69), "≥20 consecutive advances" median (AC-62), "all 20 ordered pairs" of agenda view switches, "every edge in the route manifest". None of these are measurable with `fetch` timing. Playwright is installed (`playwright.config.ts`, `@playwright/test`) but `tests/e2e/` does not exist and `scripts/checks/run-e2e.mjs` stubs it out to **MRQ-50**. The plan says only "build the speed harness around the same real seed and local runtime" — for a 4-hour ticket that is the entire risk, undefined.
**Recommendation:** Decide in the plan: (a) drive Playwright from `check:speed` and define operationally what "interactive" and "painted" mean (e.g. `PerformanceObserver` LCP/`longtask`, or a route-level instrumentation mark the app already emits), including whether MRQ-50's Playwright scaffolding is a dependency; or (b) explicitly scope this ticket to the budgets measurable without a browser, leave the rest as `verdict: "missing"` entries in `speed-report.json` with named owners, and say so out loud so A-6 and the orchestrator see the descope. Do not leave this to reconnaissance.

**[CRITICAL] Implementation outline §4 — "deployed infra" is silently traded for local, and the existing honest stub may be weakened**
`BUILDPLAN.md` M-22 and `EVALUATION.md` §1.3 both say the harness "records real numbers on **deployed infra** against the ~1,000-row seed", and audit **A-6** attaches `speed-report.json` as gate evidence. The plan measures locally and defers deployed measurement to MRQ-57. Separately, `check-speed.mjs` today already refuses to invent numbers: without `--input` it emits `status: "stub"` and, under `MARQUEE_GATE=1`, exits 2. A local-only harness that emits `status: "pass"` is strictly *less* honest than the stub it replaces — it turns "we have not measured this" into a green report.
**Recommendation:** Preserve the `--input` contract and add a first-class `environment` field (`"local" | "deployed"`) on every entry and on the report envelope, with the rule that `MARQUEE_GATE=1` fails when any AC-sourced budget's environment is not `deployed`. `marquee.stage11.dev` has existed since M-01 — state plainly whether this ticket measures against it, and if not, escalate the descope to the orchestrator rather than burying it in a step.

**[MAJOR] Implementation outline §3 — AC-3's own criterion is not asserted**
AC-3 is this ticket's named AC and `EVALUATION.md:133` gives its exact method: "`seed:` counts over the API — **≥800 submissions, ≥150 accepted speakers, agenda density > 0**". The plan says "required counts/shapes" and never names those three numbers. `SPEC.md` §6 also lists ugliness items the plan omits: one *absurdly* long title, five parallel workshop rooms with expo sessions inside mainstage breaks, and one or two deliberately malformed records (a named speaker with no format).
**Recommendation:** Enumerate the assertion checklist explicitly in the plan — the three AC-3 counts, the B-3 ≥20 unreviewed candidates, and each §6 ugliness item — so nothing drops silently. Note that A′ targets ~150 accepted speakers against AC-3's ≥150 floor; if the landed seed yields fewer, that is a seed defect to escalate (F-2), not a threshold to soften.

**[MAJOR] Implementation outline §5 — claiming AC-3 in `tests/ac-claims/MRQ-23.json` will fail `trace:ac`**
`tests/ac-claims/MRQ-5.json` already has `"owns": ["AC-3", ...]`, and `scripts/checks/trace-ac-core.mjs:77` raises `duplicate-owner` for a second claimant. The plan says only "coverage metadata accepted by `trace:ac`", which reads as if AC-3 will be owned here.
**Recommendation:** State it precisely: `{"ticket": "MRQ-23", "owns": [], "exercises": ["AC-3"]}`. The ticket's line is "AC-3 **evidence**" — evidence is `exercises`, not ownership.

**[MAJOR] Implementation outline §4 — the existing budget manifest and classifier are not referenced**
`scripts/checks/speed-budgets.mjs` already encodes all fourteen budgets, the exact 7-acceptance/7-objective split the ticket names (AC-16, AC-36, AC-62, AC-69, AC-85, AC-89, AC-103), the `⚠ OBJECTIVE MISSED` banner, and `shouldFail` semantics including the gate-only failure on missing measurements. The plan describes building that classification as if it were new, which invites a divergent second implementation of the binding split.
**Recommendation:** Say explicitly that `SPEED_BUDGETS` / `classifySpeedMeasurements` are extended in place (adding `environment` and observed-sample metadata), that the fourteen ids remain stable because `speed-report.json` is A-6's artifact, and that the gate-run missing-measurement failure is preserved.

**[MAJOR] Implementation outline §2 — the `.ts` vs `.mjs` file-surface conflict is hedged, not decided**
The ticket's file surface is `scripts/checks/seed.ts` / `speed.ts`; the landed harness is `check-seed.mjs` / `check-speed.mjs`, wired to immutable package scripts (`scripts/checks/README.md`: "Later owners replace the file behind a stub; they do not rename or re-register its package script"). The plan's "add module-specific TypeScript entrypoints only where the existing command contract requires them" is a non-decision that could produce a redundant `.ts` shim.
**Recommendation:** Decide: extend the two existing `.mjs` files, add no new entrypoints, and record the BUILDPLAN-vs-reality filename deviation in the PR description so the auditor is not surprised.

**[MAJOR] Implementation outline §3 — no bootstrap/auth path for an over-the-API seed check, and the ≤30 s budget may not survive it**
`check-seed.mjs` today asserts in-process over `buildSeedRows()` and takes about a second. Moving to "over the public API" requires a seeded local D1 (`scripts/seed/index.ts` shells `wrangler d1 execute --local --file` over ~1,000 upserts), a running Worker, a `demo_mode`-gated `POST /api/v1/auth/demo` login for the organizer persona, and a session/bearer credential before `GET /api/v1/events/{eventId}/reviewer/queue` (`src/routes/review.routes.ts:410`) returns anything. The plan lists all of this as "open details to resolve during reconnaissance", but boot + seed + assert inside 30 s is exactly the thing that decides whether the design works.
**Recommendation:** Time the seed apply and Worker boot **first**, then commit to one of: (i) assert against an already-seeded, already-running environment with that precondition documented and enforced with a clear error; or (ii) reuse `check-api.mjs`'s in-process pattern (`loadWorker()` → `app.fetch(new Request(...), env, ctx)` against a Miniflare-bound D1), which is the established convention for "for real, over the public surface, without a deploy" in this repo. Note that (ii) is a stronger precedent than `wrangler dev` and the plan does not mention it.

**[MODERATE] Implementation outline §3 — "keep the default check hermetic and parallel" misapplies the harness contract**
`scripts/checks/README.md` scopes hermetic-and-parallel to `npm test` and explicitly assigns "scale in `check:seed`" to the separately-invoked slow suite, which is *why* it gets a 30 s budget of its own. The sentence also contradicts the same step's "assertions over public API responses".
**Recommendation:** Drop the hermeticity claim for `check:seed`; state instead that `npm test` remains untouched and that no seed-scale work leaks into it.

**[MINOR] Implementation outline §4 — report path unstated**
The ticket says emit `speed-report.json`; the landed code writes it to the **repository root** (`writeReport("speed-report.json", ...)`) while every other check writes under `artifacts/checks/`. A-6 keys off the artifact.
**Recommendation:** State that the root path is preserved (or, if moved, that A-6's reference moves with it).

**[MINOR] Implementation outline §4 — deferred-owner attribution disagrees with the code**
The plan defers deployed measurement to MRQ-57; `check-speed.mjs` and `run-e2e.mjs` both name **MRQ-50** as the owner of deployed measurement, while `reset-demo.mjs` names MRQ-57 for remote *auth*.
**Recommendation:** Pick the correct owner and make the stub text, the report's follow-up field, and the PR description agree.

**[MINOR] Objective — "MRQ-62's four venue assertions"**
`check-seed.mjs` carries seven assertions (two pinned buildings, non-zero access time, Online present, Online lat null, Online lng null, a live conflict, that conflict being Transit). "Four" understates what must be preserved verbatim.
**Recommendation:** Say "every existing assertion in `check-seed.mjs`" rather than a count.

### 4. Positive Observations

- **Extend, don't replace** is stated up front for MRQ-62's venue gate, and the immutable package-script contract is respected — the two most common ways a check-harness ticket does collateral damage, both pre-empted.
- **Honesty about environment** is the plan's best instinct: "never label local values as deployed" is exactly the right reflex for an artifact an auditor signs, and it is the reason the deployed-vs-local gap is a fixable scoping issue rather than a silent lie.
- **The binding split is carried verbatim** — AC-sourced budgets fail, the seven objective budgets warn with the `⚠ OBJECTIVE MISSED` banner and never exit non-zero — and the plan resists the temptation to reclassify anything.
- **Open questions are listed rather than assumed**, which is genuinely better than a confident plan built on guesses. The revision needed is to *close* the ones that determine feasibility (instrument, environment, bootstrap cost) before implementation, not to remove the section.
- **Verification outline names the budgets it must hit** (≤30 s, ≤4 min) and ends at `pr_open` with `pr-gate` evidence, matching the repo's merge-evidence contract.
