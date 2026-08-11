# MRQ-48 end-to-end validation

Task: MRQ-48
Validated commit: 73ec6c57e61bba6f0a4558c1e2c15116810f7702
Validator: agent:auditor-mrq-48
Verdict: PASS

## Running-system evidence

The speed command built the production assets, applied local D1 migrations,
seeded a fresh private D1 directory, started the real Worker with Wrangler
dev/miniflare, and exercised the browser paths with headless Chromium. It
completed with exit status 0:

```text
MARQUEE_GATE=1 npm run check:speed
status: pass
environment: local-wrangler-dev / wrangler dev/miniflare
deployed: false
acceptanceFailures: []
objectiveWarnings: [admin-route-transition, observed p95 10921.83ms, banner ⚠ OBJECTIVE MISSED]
shouldFail: false
check_speed: 65867ms / 240000ms
```

The attached `speed-report.json` contains the complete samples and methods.
The seven acceptance observations are AC-16 85.70ms p95 (n=10), AC-36
69.17ms p95 (n=5), AC-85 48.36ms p95 (n=5), AC-62 29.54ms median (n=20),
AC-103 156.92ms p95 (n=10), AC-89 30115.07ms max (n=1), and AC-69 completed
`true` for 150 explicit ids. No acceptance failure or missing measurement was
reported.

## Gate evidence

```text
npm run pr-gate -- --ticket MRQ-48
{ "command": "pr-gate", "ticket": "MRQ-48", "status": "pass", "elapsedMs": 25094, "budgetMs": 45000 }

Hermetic suite: 34 files, 189 tests passed, 16.77s, budget 30s
Merged AC trace: pass; live 212, testFiles 81, claims 43, uncovered 0, errors 0
```

`git diff --check` also passed. The report's `deployed: false` is intentional:
there is no live Cloudflare deployment in this ticket. MRQ-57 must repeat the
same checks against the real deployment before any hosted or device claim is
made.
