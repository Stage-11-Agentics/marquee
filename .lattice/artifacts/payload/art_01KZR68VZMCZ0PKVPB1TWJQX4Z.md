# Plan Review: MRQ-39 — Cycle 2

Reviewer: Claude (plan review). Claims verified against the working tree at `bfa055d` — the ticket record (`.lattice/tasks/task_01KZJHMB1JN77G754W68R9NBCJ.json`), its event log, `sequence/run-state.md`, `EVALUATION.md` AC rows, `BUILDPLAN.md` §5 cut-line rules, `tests/ac-claims/*`, the existing reviewer module, and the e2e harness.

### 1. Verdict

**FAIL (plan-level)** — on a single, cheaply fixable issue: the plan cuts M-47 on the delegator's own authority, and no record of an orchestrator or operator cut decision exists anywhere in the repository. Everything else in the plan is sound; with an authorization touchpoint (or a scope reversal) recorded on the ticket, this becomes a PASS.

### 2. Summary

The plan correctly resolves the boot-prompt/ticket mismatch in favor of the ticket record (M-44 + M-47, confirmed against the Lattice task JSON), lays out a thorough, module-local mobile pass with layout-stability and blind-review invariants, and handles AC ownership correctly (MRQ-18 owns AC-158/AC-159; `owns: []` + `exercises` is a precedented manifest shape — MRQ-23, MRQ-42, MRQ-50 all use it). The key concern is authority: the plan converts the ticket's *conditional* cut-line note ("**if** cut…") into a decided cut, using a local budget rationale rather than the capacity calculation BUILDPLAN §5 reserves that decision for.

### 3. Issues

**[CRITICAL] "Scope authority and decision" — M-47 is cut without an authorized cut-line decision**
The ticket assigns both halves (6 h, ACs AC-158/159 + AC-167–169). The cut-line note is conditional: "**If cut**, the merged ticket ships its M-44 half…" — it pre-writes the *mechanics* of a cut, not the *decision*. BUILDPLAN §5 is explicit about who decides and how: "When the line moves is a calculation, not a mood" — remaining-band agent-hours vs. fleet capacity, run at the Wave 2 capacity checks ("**the cut line is set here**", D+58), with the §5 warning that a looser trigger "leaves the decision to whoever notices first." A delegator deciding in its own plan phase is exactly "whoever notices first." I searched for a sanctioning record and found none: the ticket has zero comments, its event log contains only status/assignment events, `run-state.md` never mentions MRQ-39/M-47/AC-167–169, and no artifact payload references the cut. The plan's rationale (protecting the ticket's validation budget for the 375px flow) is a reasonable *recommendation*, but it is a local argument, not the §5 calculation — and the plan's own step 6 only informs the orchestrator at completion, after the cut is a fait accompli.
**Recommendation:** Before implementation, surface the cut as a *proposal* to the orchestrator on the Lattice ticket and get an explicit authorization comment (this is one message; the orchestrator may well already know the band's capacity position and approve instantly). Then proceed exactly as planned. Alternatively, if authorization can't be obtained promptly given the deadline, restructure the plan to build M-44 first and treat M-47 as a trailing increment the orchestrator can drop at the capacity check — which keeps the decision where §5 puts it. Either way, the plan's cut-naming mechanics (US-32, AC-167–169, reason in PR body and handoff) are correct and should be kept.

**[MINOR] "Self-review and validation" — browser-approval request should be initiated now, not left pending**
The plan scopes the browser validation well (c11 embedded browser, ephemeral local server, 375×812, no credentials or external actions) but leaves approval as a passive precondition ("pending operator approval"), with N/A as the fallback. The operating guidance for this environment is to request scoped browser approval *during planning*, precisely so a validator isn't blocked or forced to N/A later. AC-158's EVALUATION proof mode is `e2e:mobile`; with `tests/e2e` still MRQ-50's stub, this ticket's rendered evidence is the only runtime proof available, so an avoidable N/A is a real evidence loss.
**Recommendation:** Attach the scoped approval request to the Lattice ticket now (same touchpoint as the cut authorization above — one round-trip covers both). Keep the N/A fallback as written.

**[MINOR] "Add focused proof" — say explicitly where AC-158's terminal e2e proof lands**
AC-158/159 are `auto` with `e2e:` proof modes in EVALUATION, plus real-device confirmation at checkpoint C6. The plan's unit/source-contract tests plus conditional browser evidence are the right contribution for this ticket, and the existing `tests/unit/reviewer-surface.AC-61-158-159.test.ts` confirms the pattern — but the handoff should state that the e2e-mode proof is deferred to the MRQ-50 harness and C6, so the completion report can't be read as claiming AC-158 is terminally proven by this ticket.
**Recommendation:** Add one sentence to the claims-manifest note and the completion-report checklist naming MRQ-50/C6 as where the `e2e:mobile` proof mode is satisfied.

### 4. Positive Observations

- **The scope-authority resolution is exemplary.** The boot prompt said M-43 + M-44; the plan checked the ticket record, identified M-43 as MRQ-37's scope, followed the record, and routes the mismatch back to the orchestrator without touching contract docs. Verified correct against the task JSON.
- **Boundary discipline is precise and verifiable.** Module-local to `src/ui/review/*` per the ticket's shared-files clause; the blind-review fail-closed invariant, the MRQ-50 null-identity guard, and the MRQ-18/MRQ-28 seams are all named as things to preserve, with the sharp rule "markup and focus management only" from the cycle-1 resolutions.
- **AC-claims handling is correct.** MRQ-18's manifest does own AC-158/159; `owns: [], exercises: [...]` is the established shape for exercising without duplicate ownership, and the plan explicitly refuses to claim the cut ACs.
- **Layout-stability planning reads the house rules.** Reserved space for stateful regions, fixed control positions across state changes, and the scrollWidth/clientWidth overflow check operationalize the "elements never jump" rule rather than gesturing at it.
- **Evidence honesty.** The plan separates observed runtime evidence from static tests and inference, and commits to recording N/A rather than implying rendered proof — the exact discipline that keeps validation artifacts trustworthy.
- **Baseline hygiene.** Fresh base SHA recorded, `npm ci` after rebase, baseline suite timed (14.8 s, within the 30 s budget), pr-gate named with its 45 s budget.
