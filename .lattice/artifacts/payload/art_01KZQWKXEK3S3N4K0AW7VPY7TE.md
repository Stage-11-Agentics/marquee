# MRQ-40 validation evidence

Validated commit: 8bb0b309d2455f56ab30cb71eb82ce0df8bda332
Base: forgejo/master e521f50fe362fd11615005f54b9c732e12b7666a

Observed local runtime proof at the validated HEAD:
- Fresh local D1 migrations, deterministic seed, and Wrangler dev/miniflare started successfully.
- GET /health returned {"service":"marquee","status":"ok"}.
- POST /api/v1/auth/demo returned ok for the seeded organizer persona.
- Authenticated GET /api/v1/events/evt_aie-ny-2026/submissions returned a non-zero total.
- A fresh migrations-only D1 rendered the landing copy No demo conference is configured yet.
- Wrangler 4.120.0 migrations required CI=1 to answer the non-interactive confirmation; the README uses that flag.

Required gate:
- npm run pr-gate -- --ticket MRQ-40: PASS, elapsedMs 16707, budgetMs 45000.
- Worker types, client types, test types: pass.
- Production Worker and client builds: pass; only the existing missing RESEND_API_KEY local warning appeared.
- Design contract: pass.
- Hermetic suite: pass, elapsedMs 11808, budgetMs 30000.
- Merged AC trace: pass; live 212, testFiles 60, claims 30, uncovered 0, errors 0.
- Plain Node README contract tests: 3 passed.
- git diff --check: pass.
- npm ci after the rebase: pass, 0 vulnerabilities.

Remote boundary: the scratch Cloudflare deployment required by check:readme was not run. This checkout still has the pre-MRQ-57 command stub and no real account, bindings, domain, or production secrets. That is explicitly documented in README and is an external N/A, not a claim of hosted proof.