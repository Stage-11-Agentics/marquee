# MRQ-48 running-system validation — final head

Task: MRQ-48
Validated commit: 11d7a1972c82dc0145927de0a85935719f72de4c
Validator: agent:auditor-mrq-48
Verdict: PASS

`MARQUEE_GATE=1 npm run check:speed` built the production assets, applied local
D1 migrations, seeded a fresh private D1 directory, started the real Worker via
Wrangler dev/miniflare, and exercised the touched paths with headless Chromium.
It exited 0 with `status: pass`, `deployed: false`, seven acceptance passes,
zero missing measurements, and `shouldFail: false`. The check-speed harness
observed 54,836 ms against 240,000 ms.

The final speed report is attached separately. Its environment is explicitly
`local-wrangler-dev` / `wrangler dev/miniflare`; no deployment or device claim
is being made. Its follow-up assigns production remeasurement to MRQ-57.

Final gate output:

```text
npm run pr-gate -- --ticket MRQ-48
{ "command": "pr-gate", "ticket": "MRQ-48", "status": "pass", "elapsedMs": 17156, "budgetMs": 45000 }

Hermetic suite: 34 files, 189 tests passed, 13,666ms / 30,000ms
Merged AC trace: pass; live 212, testFiles 81, claims 43, uncovered 0, errors 0
```

`git diff --check` passed. The branch is clean and based on current
`forgejo/master` before the PR push.
