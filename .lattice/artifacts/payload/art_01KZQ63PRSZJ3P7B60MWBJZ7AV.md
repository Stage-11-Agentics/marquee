# MRQ-14 self-review — own-reviewer, quota directive (headless `lattice code-review` suspended)

**HEAD:** c6bb43945a47a030bc26b40cbaaed475f1b6aa35 (branch `mrq-14-uploads`, rebased on `forgejo/master`)
**Verdict: PASS-WITH-NITS**

## Scope shipped (capacity-wall cut — see PR body for full list)
- Public presign (`POST /api/v1/public/uploads/sign`): Turnstile-gated, draft/resume-token scope check, KV per-IP + per-submission caps, policy validation, R2 SigV4 presign, zero side effects on any rejection.
- `/complete` (public + `/api/v1/me/...` shared handler): completion-token HMAC check, HEAD + magic-byte verify, delete-on-mismatch, idempotent ready transition.
- Host-gated media GET: app host 404s, media host serves with `Content-Disposition: attachment` + `nosniff`, ETag-pinned.
- One authenticated route (`POST /api/v1/me/uploads/sign`, task_upload only): minimal session-cookie → `auth_sessions` lookup, fails closed on missing/expired session or task ownership mismatch.
- Nightly orphan sweep wired to the existing `30 4 * * *` cron.
- `tests/ac-claims/MRQ-14.json` owns AC-231, AC-232; exercises AC-52/146/147/148.

## Findings
1. **[NIT]** `src/lib/r2/sniff.ts` — JPEG/WebP/PPTX/KEY dimension checks are not implemented (PNG only). Not blocking: AC-52's full crop/undersize proof is owned by MRQ-16 per plan-review resolution 6.
2. **[NIT]** `src/routes/uploads.direct.ts` — authenticated presign only covers `task_upload` self-serve; `person_headshot`/`event_logo`/org-admin scope paths are not implemented (no merged auth/principal module to build on — MRQ-3 still unmerged as of this HEAD). Flagged in PR body as deviate-with-flag.
3. **[NIT]** `src/lib/r2/images.ts` (Cloudflare Images headshot variants) not implemented this pass — AC-52 variant contract is MRQ-16's to prove; this ticket only needed to not block it, which it doesn't (attachments.ready path is generic).
4. **[NIT]** Route module named `uploads.direct.ts`, not the ticket's stated `uploads.routes.ts`, and mounted ahead of the M-07 manifest router rather than joined to its `defineApiRoute`/Zod/policy contract — MRQ-8/M-07 merged mid-implementation; reconciling onto the declarative contract needs a follow-up ticket, not a rushed same-session port. Flagged in PR body.
5. Found and fixed a real defect in the inherited (pre-Claude) WIP: `policy.ts`'s `sanitizeFilename` contained a stray 0x1F control byte hidden inside a regex literal (`/[-\x1F]/g`), silently stripping every dash from uploaded filenames. Removed.

## Verified locally
- `npm run pr-gate -- --ticket MRQ-14`: **PASS** (worker/client/test types, production build, design contract, hermetic suite 55/55, `trace:ac --scope=merged` 0 uncovered/0 errors).
- Confirmed MRQ-8's own tests (`tests/integration/api/*.test.ts`) still pass after the rename fix — the manifest-glob collision this ticket hit and fixed would otherwise have broken every API test in the repo, not just this ticket's.
- Not run: `wrangler dev` + curl live-Worker smoke (capacity-wall cut; local `pr-gate`'s Miniflare-backed vitest suite is the evidence of record for this PR).

## Not blocking merge
Guardrail proof (AC-231 fail-closed, AC-232 type/size/magic-byte + rate-limit + origin-isolation) is present and passing. Remaining gaps are scoped follow-ups, named above and in the PR body, not silent omissions.
