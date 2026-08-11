# Plan Review: MRQ-49 — Audit, public write surface and upload safety

### 1. Verdict

**FAIL (plan-level)**

The fix is small — cut or re-scope one step — but it must happen before implementation, because the step in question will near-certainly fire and produce work another ticket already owns.

### 2. Summary

Reviewed the MRQ-49 plan against the A-7 contract (BUILDPLAN §5, AC-231/AC-232, EVALUATION.md rows for both ACs, SPEC G8) and the current repo state (M-13 and M-14 code present on `master` at `cfd7e70`, all referenced files and the `pr-gate` script verified to exist). The coverage of the actual A-7 scope — Turnstile gated set, autosave exception, upload lifecycle, caps, serving headers — is thorough and correct. The key concern is that plan step 3 imports the conditional-answer/`projectApplicableAnswers` concern, which is not in A-7's scope, not behind AC-231/AC-232, and is already a documented finding whose remediation is explicitly routed to MRQ-15/MRQ-34 and MRQ-69.

### 3. Issues

**[MAJOR] Step 3 (and its step-1 read list) — Out-of-scope conditional-answer audit that collides with owned remediation work**
A-7's verbatim scope is "Turnstile gating set, upload extension/MIME/magic-byte/caps/serving origin." Conditional-answer persistence appears nowhere in the task description, in AC-231/AC-232, or in MRQ-49's event stream. It does appear in `sequence/code-quality-audit.md` finding #3 (MAJOR — `isFieldApplicable` never invoked on a write path, `src/lib/form-conditions.ts:262`, `src/routes/submission-record.routes.ts:493-496`), whose triage table (line 233) routes the fix to **MRQ-15 + MRQ-34**, with the admin-create half to the ticket that became **MRQ-69** ("wire the applicability guard," currently in backlog). Three consequences:

1. The plan's conditional branch — "If a bypass is found or could recur, add the narrowest machine guard as an AST inventory under `tests/node`" — is not really conditional: the bypass is already known and documented, so this step will trigger and this ticket will author a guard for a defect another ticket owns. Two agents independently writing an applicability guard is exactly the shared-file collision the ticket's contract ("Shared files: none — audit artifact only") exists to prevent.
2. The admin-create path in `submission-record.routes.ts` is an authenticated surface — not the public write surface at all.
3. On a 2-hour fast-track budget, step 3 (fixtures, four consumers, admin paths, possible guard authoring) plausibly consumes a third or more of the ticket, taxing the evidence work AC-231/AC-232 actually require.

**Recommendation:** Delete step 3, and drop `src/lib/form-conditions.ts`, "the four condition consumers," and the admin-create path from step 1's read list. If the auditor wants to acknowledge the concern, a one-line cross-reference in the report to audit finding #3 and its owning tickets (MRQ-15/MRQ-34/MRQ-69) is the right ceiling. No guard is authored by this ticket. The corresponding "If the audit adds a guard, commit it separately" clause in the handoff section should narrow to guards for genuine A-7-scope regressions (Turnstile gating set / upload safety) only — that residual authorization is fine.

**[MINOR] Step 4 / handoff — Deployed-preview legs of AC-232 and AC-231 not distinguished from local probes**
EVALUATION.md assigns two legs to `e2e` on the deployed preview: AC-232's served-upload headers "from a host that is **not** the app host," and AC-231's one pass against real Turnstile. Serving-origin separation is a deployment property that a local dev run may not exhibit, and the plan doesn't say whether these will be probed against the preview or fall into the "explicit N/A" escape hatch. The N/A allowance covers it contractually, but deciding this up front prevents a late scramble or a too-casual N/A on a Tier-A no-waiver criterion's live leg.
**Recommendation:** Name the target for each of these two legs in the plan: deployed-preview URL if one exists at audit time, otherwise a pre-declared N/A with the local-evidence substitute (e.g., serving route sets the headers and the configured serving host differs from the app host in config).

**[MINOR] Step 2 — Valid-token positive control mechanism unstated**
EVALUATION.md's AC-231 row stubs the siteverify client in `test:`. The plan's "valid-token control" against live-driven paths needs a concrete mechanism — the stubbed siteverify, or Cloudflare's documented always-pass test sitekey/secret — and the plan doesn't say which. Small ambiguity, but the positive control is what makes the rejection evidence meaningful.
**Recommendation:** State the mechanism (stub vs. Turnstile test keys) and note it in the evidence so a reader can judge what the positive control actually proved.

### 4. Positive Observations

- **The in-scope coverage is a model audit plan.** Step 2 captures the gated set exactly as EVALUATION.md's AC-231 row defines it — draft creation, submit, every presign — and, crucially, gets the autosave exception right (no Turnstile on `PATCH …/drafts/:token`, resume-token authorization, per-token rate limiting, "per token rather than global"). That intended-shape reading is the exact trap the AC row warns about.
- **Absence assertions and positive controls throughout.** "Zero rows written," before/after counts, HEAD 404 on the deleted R2 object, unrelated identities remaining usable under caps, and a valid-path control for every rejection family — this is evidence discipline, not checkbox testing.
- **Step 4 goes beyond the AC text in the right direction:** caller-controlled key selection, path traversal, alternate prefixes, and cross-submission writes are genuine presign-audit attacks that the AC doesn't spell out but the scope implies.
- **Auditor independence is operationalized,** not just asserted: driving public paths and inspecting rows/objects/headers rather than trusting M-13/M-14's tests, and the observed-proof / test-evidence / code-inference distinction in reporting.
- **The handoff section is complete and in the correct order** — focused suite, full `pr-gate --ticket MRQ-49`, review PASS artifact naming the branch HEAD, `in_validation` with runtime evidence, Forgejo PR before `pr_open`.
