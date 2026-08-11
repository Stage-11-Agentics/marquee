# Plan Review: MRQ-37 (M-41 co-speaker + M-43 mobile submit pass)

## 1. Verdict

**FAIL (plan-level)** — one concrete gap: the plan mints `tests/ac-claims/MRQ-37.json` owning AC-155–AC-157 but never demotes those same IDs in `tests/ac-claims/MRQ-15.json`, which currently owns them. `trace:ac` hard-errors on duplicate owners, so the plan executed verbatim fails its own `pr-gate`. The revision is one sentence; everything else in the plan is sound and should be preserved as-is.

## 2. Summary

Reviewed the delegator plan for the merged M-41 + M-43 ticket against the repository at `8ba82bd` (the plan's stated base, which matches current master). The plan is otherwise strong: all six owned ACs map to explicit steps, the isolation/adversarial test posture is well specified, and the M-39/M-41 dispatch-brief label discrepancy is handled correctly by following the binding repo contract. The key concern is the AC ownership transfer — the ticket's own bolded note ("`trace:ac` needs one owner — **this ticket owns the mobile ACs**") requires an edit to MRQ-15's claims manifest that the plan omits.

## 3. Issues

**[CRITICAL] Step 6 (AC claims) — Ownership of AC-155–AC-157 is not transferred from MRQ-15, guaranteeing a `pr-gate` failure**
`tests/ac-claims/MRQ-15.json` (M-14, the Public CFP form ticket, already done/merged) lists AC-155, AC-156, and AC-157 in its `owns` array. `scripts/checks/trace-ac-core.mjs` pushes a `duplicate-owner` error whenever two claim files own the same criterion, and any error fails `trace:ac` (exit 1), which the plan's own final gate (`npm run pr-gate -- --ticket MRQ-37`) will surface. Step 6 declares MRQ-37's ownership of the mobile ACs but plans no corresponding edit to MRQ-15.json — so following the plan literally either fails the gate or forces the implementer into an unplanned edit of another ticket's manifest, in tension with the plan's "Shared files: none — module-local under `src/ui/public/form/*`" scope framing.
**Recommendation:** Add to step 6: move AC-155–AC-157 from `owns` to `exercises` in `tests/ac-claims/MRQ-15.json` (MRQ-15's existing tests may keep referencing the literal AC titles — coverage is counted from test titles, not ownership, so no MRQ-15 test changes are needed), and amend the scope section to name this one cross-ticket file as an intentional touch. This is exactly the resolution the ticket description's note dictates.

**[MINOR] Step 5 — AC-155's "every field type, including file upload" is not itemized**
AC-155's method in EVALUATION.md is explicit: *every* field type, including file upload, operable at 375px. Step 5 speaks of "usable at 375px" and preserving presign/Turnstile behavior, but doesn't commit to a per-field-type sweep, and the upload control is the field most likely to break at narrow widths.
**Recommendation:** State that the AC-155 test enumerates each field type the form supports, upload control included, at the 375px viewport.

**[MINOR] Verification — the 375px browser check is conditional, but AC-155/AC-156 are `auto`-tagged**
"Use a rendered 375px browser check if the local preview is available" reads as if the mobile assertions might depend on preview availability. AC-155/AC-156 are `auto` `e2e:mobile` criteria; the hermetic tests carrying the literal AC titles must land in `tests/` regardless, with the browser render and the C6 real-device pass as supplementary/operator evidence (the plan's C6 handling — record as operator-only follow-up rather than claim it — is correct).
**Recommendation:** Make explicit that the keyboard-viewport (375×340) and `scrollWidth ≤ clientWidth` assertions live in the hermetic suite unconditionally; the browser check only adds evidence.

## 4. Positive Observations

- **The dispatch-brief discrepancy is handled exactly right.** The brief's "M-39 + M-41" label contradicts the ticket JSON, BUILDPLAN, and USER_STORIES; the plan follows the binding repo contract, refuses to import M-39 scope, and records the discrepancy for the Orchestrator rather than silently picking a side.
- **Complete AC-to-step mapping.** AC-149 (server-side + UI max enforcement, step 2), AC-150 (outbox invitation with who/what/link, step 2), AC-151 (profile surface that cannot touch the abstract, steps 3–4), AC-155/156 (step 5's layout constraints), AC-157 (resume assertion, step 5) — every owned criterion has a home, and the abstract-immutability constraint is asserted, not just avoided.
- **Adversarial isolation coverage (step 4) is unusually well specified:** positive control, cross-submission refusal with an invariant response body leaking neither ID nor title, and before/after row-count invariance — this is the right shape for authorization tests.
- **Reuse discipline.** The plan binds itself to `participations`, the existing magic-link purpose, the mail outbox/render contract, `auth-middleware.ts`, and the R2/Turnstile seams, and explicitly rules out migrations and alternate authority paths — matching the "add files, do not rewrite" constraint on M-14's module.
- **The mobile layout steps encode the no-jump rule** (reserved validation slots, stable submit row) rather than treating 375px as a squeeze-it-in exercise.
- **Honest verification posture:** a recorded pre-implementation baseline (including the existing Node-phase budget overrun, flagged for investigation rather than masking), real-flow validation at `in_validation`, and no claim of the C6 real-device check the agent cannot perform.
