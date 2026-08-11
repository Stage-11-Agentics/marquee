Validation evidence:
npm test: pass, 32 Vitest integration/unit files with 183 tests plus 16 Node files with 55 tests; elapsed 13.9s, hermetic true.
Focused request validation: npx vitest run tests/integration/auth-demo.test.ts tests/integration/api/credential-resolver.test.ts tests/integration/public-site.AC-83-86-240-252-253.test.ts: 3 files, 20 tests passed.
Static guard: node --test tests/node/auth-boundary.test.mjs: 1 test passed.
Observed positive and negative flows: demo_mode=0 returns 403/demo_disabled with no Set-Cookie and no auth_sessions row; demo_mode=1 creates one session; cookies carry HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain; magic-link exchange creates one session then rejects replay and expired tokens without another row; valid cookie/bearer authorities agree on grant intersection; direct SSR embed stays 200 with a tampered cookie.
API public embed mismatch was independently reproduced and is recorded in the review artifact; it is not claimed as fixed here.
No browser validation applies: this ticket changes no UI or running-system code.,