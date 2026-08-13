# Plan Review: MRQ-119 — Cycle 2

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are minor and resolvable during implementation; none requires returning to planning.

## 2. Summary

Reviewed the plan for MRQ-119 (spec section T-H: truthful draft saving in `PublicForm.tsx`) against the live code. Every factual claim in the plan checks out: the false status renders at `PublicForm.tsx:468` exactly as described, `ensureDraft()` (line 294) hard-requires `answers.speaker_email` and is called only from `handleFile`, the autosave effect (lines 264–272) gates on `resume_token`, and the pr-gate invocation with `--ticket` matches what `scripts/checks/pr-gate.mjs` actually requires. All five ticket items map to a concrete plan step. The one substantive gap is that the plan asserts the footer button "remains available for a resumed draft as an explicit save affordance" without a mechanism — `ensureDraft()` returns early once a token exists, so that path needs a decision.

## 3. Issues

**[MINOR] Implementation step 2 — Post-token "Save draft" click has no save mechanism**
`ensureDraft()` short-circuits at line 295 (`if (state.resume_token && state.draft_id) return state;`), so once a draft exists the footer action as planned is a silent no-op. The debounced autosave (750ms) usually covers the gap, but a button labeled "Save draft" that does nothing on click is a small instance of exactly the untruthfulness this ticket exists to kill — and if `busy` was true when the autosave timer fired, `autosave()` returns early and the status can sit on "Saving…" with no retry until the next edit.
**Recommendation:** When a token exists, have the footer action flush through the PATCH path (call `autosave()` directly, bypassing the debounce) instead of `ensureDraft()`. That makes the explicit affordance truthful in both phases and incidentally covers the dropped-autosave edge.

**[MINOR] Implementation step 3 — Copying the "absolute backend URL" can copy a foreign origin**
The existing contract test (`tests/node/public-form.AC-35-155-157.test.mjs`) asserts `href={resumeLinkPath(state.resume_url)}` and explicitly rejects the absolute `state.resume_url`, with a comment explaining why: under local validation the backend's absolute URL points at the deployed host. Copying `state.resume_url` verbatim reintroduces that mismatch on the copy path — a judge or local validator copies a link that leaves the surface they're on.
**Recommendation:** Construct the copied value as `new URL(resumeLinkPath(state.resume_url), location.origin).toString()` (or equivalent) so the copied link always matches the origin the person is using, consistent with the existing href contract.

**[MINOR] Scope mapping — The "up to four participants" copy is computed, not a string literal**
The offending sentence at line 468 is derived from `state.form.min_speakers`/`max_speakers` (schema default `max_speakers = 4`), and the actual public form collects exactly one optional co-speaker via the `co_speaker_name`/`co_speaker_email` answer keys regardless of those values. "Replace the inaccurate statement" is the right call, but the plan doesn't say whether the replacement stays data-driven or describes what the form really renders.
**Recommendation:** Make the copy describe what the form actually collects (you plus one optional co-speaker), not a re-derivation from `max_speakers` — the form's rendering, not the DB column, is the ground truth. Leave `max_speakers` untouched, consistent with the plan's own no-backend-changes non-goal.

**[MINOR] Implementation step 1 — Ambiguity between the inline prompt and the form's own email field**
The plan "reveals and focuses an inline contact-address field" writing through `answers.speaker_email`. If the form also renders its own `speaker_email` field among the visible fields, there are then two inputs bound to one answer. Shared state keeps them consistent, so this is a UX decision, not a correctness bug — but the current code path (scroll-to-field with a page error) shows the ambiguity is real.
**Recommendation:** Decide explicitly: if a `speaker_email` field is visible on the form, focus it with a non-error inline hint; render the footer-adjacent prompt only when no such field exists. State the choice in the PR description.

## 4. Positive Observations

- **The plan is grounded in the actual code, and honestly so.** Every mechanism it names — `ensureDraft()`'s email precondition, `handleFile` as its only caller, the autosave effect's token gate, the existing resumed banner and mail — exists exactly as described. This is a plan written after reading the code, not before.
- **The eval trap is handled head-on.** The title-only scenario (CFP-S2) is addressed by asking for the address at the moment of saving rather than surfacing the backend's required-email response as an error, and the plan correctly keeps server validation authoritative rather than duplicating it client-side.
- **The non-goals section does real work.** Refusing localStorage, refusing to claim a save before the create response, and keeping the returned draft payload as the only authoritative saved state is precisely the truthfulness contract the judge flagged — the plan encodes the principle, not just the fix.
- **Geometry discipline is planned, not retrofitted.** Reserving the status span's space with a hidden empty state matches both the house rule (elements never jump) and the existing style patterns the contract test already asserts (`min-height`, `visibility: hidden`).
- **Verification is fleet-aware and correctly specified.** Targeted tests instead of the full suite under load, the load-check before the gate, and `npm run pr-gate -- --ticket MRQ-119` — which matches the script's actual required `--ticket MRQ-N` argument — show the verification section was checked against reality too.
