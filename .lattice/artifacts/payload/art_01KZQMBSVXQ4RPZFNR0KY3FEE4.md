# MRQ-15 self-review

Verdict: PASS
Reviewed commit: a519f44f84cb47c0c44f5400a7ad9854a9690409
Base: forgejo/master; branch ancestry verified before review.

Scope reviewed:
- SSR and hydrated public CFP form, generated API routes, drafts, resume links, uploads, confirmation mail, state handling, responsive styles, integration tests, AC claims.
- The public write path calls projectApplicableAnswers through projectPublicAnswers for draft creation, autosave, and submit. Its issues are carried into server-authoritative validation, and only projected.answers reaches submission JSON and replaceProjectedAnswers. No raw body answers or second applicability evaluator is persisted.
- The conditional vendor field is rendered through the shared schema-driven isFieldApplicable path; there is no vendor-specific alternate form branch.
- The integration test POSTs a hidden conditional value, confirms no required issue, and queries submission_answers to assert the hidden key/value was not written.
- Turnstile is required before draft creation, submit, and every presign; missing, failed, and replayed tokens assert both rejection and zero side effects. Autosave deliberately requires a valid resume token and per-token rate limit without Turnstile.
- Public copy supplies a remedy for validation, challenge, rate-limit, server, conflict, and network failures.

Findings:
- None.

Verification already completed at this exact HEAD:
- npx tsc --noEmit: pass
- node --test tests/node/public-form.AC-35-155-157.test.mjs: pass
- targeted integration suite: 7 passed
- npm test: 30 files, 168 tests passed
- npm run check:design: pass
- npm run check:api: pass
- npm run trace:ac -- --ticket MRQ-15: pass; uncovered 0, errors 0
- npm run pr-gate -- --ticket MRQ-15: pass
- Local Wrangler/Miniflare integration exercised the real route and database. c11 embedded browser observed SSR, conditional reveal, remedy copy, preserved values, and a 374px viewport with no horizontal overflow.

Residual/deferred:
- Real Cloudflare Turnstile and production inbox delivery require live infrastructure and remain an explicitly named MRQ-57 checklist item; no live proof is claimed here.
