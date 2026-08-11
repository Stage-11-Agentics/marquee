# MRQ-40 final-head validation evidence

Validated commit: eaacb17505d5cdfdbd6370c73d7f16781024dcd0
Base: forgejo/master 3be1909c41dbc395e7fef6c7845870b312c6fb81

Observed exact-head local runtime:
- Fresh local D1 migrations and deterministic seed completed; Wrangler 4.120.0 local Worker started.
- GET /health returned {"service":"marquee","status":"ok"}.
- Demo organizer login returned ok with event_id evt_aie-ny-2026.
- Authenticated submissions list reported a non-zero total.
- Fresh migrations-only D1 rendered No demo conference is configured yet.

Mandatory gate output:
- npm run pr-gate -- --ticket MRQ-40: PASS, elapsedMs 16459, budgetMs 45000.
- Worker types, client types, test types: pass.
- Production Worker and client builds: pass; existing missing RESEND_API_KEY warning only.
- Design contract: pass.
- Hermetic suite: pass, elapsedMs 12073, budgetMs 30000.
- Merged AC trace: pass; live 212, testFiles 60, claims 30, uncovered 0, errors 0.
- git diff --check: pass.
- npm ci after the final rebase: pass, 0 vulnerabilities.

Remote boundary: check:readme scratch deployment was not run. The checkout still has the pre-MRQ-57 command stub and no real Cloudflare account, bindings, domain, or production secrets. README documents this as unavailable external proof.