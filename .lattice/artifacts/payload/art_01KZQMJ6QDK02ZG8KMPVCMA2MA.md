# MRQ-15 self-review

Verdict: PASS
Reviewed commit: df7d64385468874b775c330b9c252549f7edeb29
Base: forgejo/master at ad1d0473a831f660ee599445f77676dac61d114c

Scope and guardrails:
- The public draft, autosave, and submit paths delegate answer projection to projectApplicableAnswers through projectPublicAnswers, consume its issues, and persist only projected.answers. The hidden conditional answer is never persisted from the raw request, and no second applicability evaluator exists in this surface.
- The vendor conditional is an ordinary schema-driven field rendered with isFieldApplicable; there is no hardcoded alternate form.
- The integration path proves a hidden conditional POST leaves no submission_answers key/value and produces no hidden-required issue.
- Turnstile gates draft creation, submit, and every public presign before mutation; missing, failed, and replayed challenge tests assert status plus no rows. Autosave deliberately uses resume-token authentication and per-token rate limiting without Turnstile.
- Failure copy gives a remedy for validation, challenge, rate-limit, server, conflict, and connection failures.

Findings:
- None.

Evidence at this exact HEAD:
- npm ci completed after rebase.
- npm run pr-gate -- --ticket MRQ-15: PASS; 34 files and 180 tests passed, trace live 212/testFiles 47/claims 22/uncovered 0/errors 0, elapsedMs 31361.
- Local Wrangler/Miniflare and c11 embedded-browser evidence was previously captured; the browser proof used a real 374px viewport and observed SSR order, conditional reveal, remedy copy, retained values, and no horizontal overflow.

Residual:
- Real Cloudflare Turnstile and production inbox delivery remain explicitly deferred to the MRQ-57 checklist; no live proof is claimed.
