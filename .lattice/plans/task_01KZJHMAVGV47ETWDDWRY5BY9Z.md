# MRQ-37: Co-speaker flow and the mobile submit pass

BUILDPLAN: M-41 (rank 22, US-21) + M-43 (rank 24, US-18) — Wave 2 (§5) · MERGED at mint (4 h + 3 h = 7 h; identical dependency set {M-14}, same public-form module)

**M-41 — Co-speaker** (4 h, ACs AC-149 – AC-151, dep M-14)
Scope (verbatim): max enforcement, notification, own-profile completion.
AC-151: the co-speaker supplies bio and headshot via their link **without the abstract becoming editable**.

**M-43 — Mobile submit pass** (3 h, ACs AC-155 – AC-157, dep M-14)
Scope (verbatim): mobile submit pass.
AC-156's method: `scrollWidth ≤ clientWidth` at every step; the on-screen keyboard is modelled as a 375×340 visual viewport and the focused field's box must stay inside it. Real-device confirmation at **C6**, which is the tiebreaker if the two disagree.

ACs (union): AC-149 – AC-151, AC-155 – AC-157
Hours: 7 (4 + 3)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local under `src/ui/public/form/*` (M-14's module; add files, do not rewrite).
Deps: M-14
Note: AC-155 – AC-157 are also claimed in M-14's AC list (the plan assigns the mobile pass its own ticket at rank 24). `trace:ac` needs one owner — **this ticket owns the mobile ACs**; M-14 owns the desktop path.
## Plan

### Scope and binding decisions

- Actor: `agent:delegator-mrq-37`; worktree branch: `mrq-37-cospeaker`; base refreshed to `forgejo/master` at `8ba82bd3d87547464bb181acc297542a0438a3bf`.
- Implement the six owned automatic ACs: AC-149–AC-151 (co-speaker max, notification, and profile completion) and AC-155–AC-157 (375px public CFP form, keyboard-safe layout, and draft resume).
- The ticket JSON, `CLAUDE.md`, `BUILDPLAN.md`, and `sequence/USER_STORIES.md` bind these criteria to M-41 + M-43. The dispatch brief labels the work “M-39 + M-41”; that label contradicts the repository contract, so this plan follows the binding AC ownership and records the discrepancy for the Orchestrator. No M-39 clean-agent work will be added.
- Do not edit contract documents, add a migration, create an alternate authority path, or change the generated route manifest. Reuse `participations`, the existing auth middleware, `cospeaker_profile` magic-link purpose, R2 upload protocol, form condition projection, one decisions writer, and existing outbox/render seams. The only intentional cross-ticket edit is the AC ownership transfer in `tests/ac-claims/MRQ-15.json`.

### Implementation

1. Trace the existing public form, speaker portal, magic-link, upload, and membership seams at the rebased master head. Keep participant records as `participations` rows and make the co-speaker’s authorization an exact `(person, submission, participation)` grant.
2. Complete the co-speaker invitation flow in the public-form and portal route modules: enforce the configured participant maximum server-side and in the form UI; enqueue one useful invitation containing who added the person, the conference/submission context, and a single-use profile-completion link; make retries idempotent and keep the invitation inside the existing mail outbox/render/merge-data contract.
3. Add or tighten the co-speaker profile surface so a link holder can read and update only their own profile fields (bio and ready headshot) for the exact participation/submission. Reuse the existing per-role confirm/decline behavior; do not let the profile path update the submission abstract/title or expose another submission. Preserve cookie/bearer org filtering through `auth-middleware.ts` rather than adding divergent checks.
4. Add adversarial integration coverage for isolation: a positive request reaches the invited submission, a request for a different submission is refused with the invariant response body containing neither the other ID nor title, and participation/related row counts are identical before and after the refused request. Include a positive control and cover the credential forms relevant to the shared middleware. Verify profile updates change only the person/profile attachment state and leave the abstract unchanged.
5. Make the existing `src/ui/public/form/*` usable at 375px without rebuilding the form: reserve a stable validation-message slot under each field, preserve the submit row/button position when errors appear, prevent horizontal overflow at every form step, keep focused controls visible in the 375×340 keyboard viewport, and provide actionable empty/loading/error copy. Preserve conditional projection so hidden answers are neither required nor persisted and preserve single-use Turnstile/presign behavior. Add/update hermetic tests that enumerate every supported field type (short text, long text, single select, multi-select, URL, email, number, and file upload), assert `scrollWidth ≤ clientWidth` and focused-field containment, plus the AC-157 resume assertion.
6. Declare ownership in `tests/ac-claims/MRQ-37.json` (`owns`: AC-149–AC-151 and AC-155–AC-157; `exercises`: only criteria directly exercised, otherwise an explicit empty array). Transfer AC-155–AC-157 out of `tests/ac-claims/MRQ-15.json` into its `exercises` array; MRQ-15's existing test titles remain valid, but only MRQ-37 owns the auto criteria. Add tests with literal AC titles so `trace:ac` has one owner for the mobile criteria.

### Verification and handoff

- Baseline recorded before implementation: Vitest 35 files / 191 tests passed; the existing Node phase exceeded its 30-second hermetic budget and reported `check-repo.test.mjs` pending at 29.01s.
- Run targeted node and integration tests for co-speaker isolation, mail, public projection, mobile layout, and portal profile behavior; then run `npm test` and investigate any timeout or regression rather than masking it.
- Enter `in_validation` and exercise the real local API flow with a running Worker plus curl/TestClient. The hermetic tests unconditionally assert the 375×340 keyboard viewport and `scrollWidth ≤ clientWidth`; add a rendered 375px browser check when the local preview is available as supplementary evidence. If a real-device C6 check is unavailable to this agent, record that as operator-only follow-up rather than claiming it.
- Self-review the final diff adversarially, attach a PASS review artifact naming the exact branch HEAD, run `npm run pr-gate -- --ticket MRQ-37`, paste its result into the Lattice completion comment, push `forgejo/mrq-37-cospeaker`, open the Forgejo PR against `master`, attach its URL, and finish at `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Review artifact `art_01KZR9179W70ENGME9BM1DX9FH` verdict: FAIL because AC-155–AC-157 would have had duplicate owners in `trace:ac`. Accepted. This plan now explicitly transfers those IDs from MRQ-15 `owns` to MRQ-15 `exercises`, and names that claims manifest as the only intentional cross-ticket edit.
- Accepted the minor request to enumerate all public field types, including file upload, in the mobile hermetic test scope.
- Accepted the minor request to make the 375×340 focused-field and `scrollWidth ≤ clientWidth` checks unconditional in tests; rendered browser and C6 checks remain supplementary/operator evidence.
