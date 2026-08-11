MRQ-36 implementation self-review: PASS
HEAD: 143c62a (forgejo/mrq-36-cli)
Scope: cli/, SKILL.md, tests/node/cli.AC-138-141-250.test.mjs, tests/node/skill.AC-142-144.test.mjs, tests/ac-claims/MRQ-36.json.
Checks: git diff --cached --check passed before commit; npm test passed; targeted AC tests passed; npm run check:api passed; real disposable wrangler-dev bearer-token probe passed.
Security/scope: bearer Authorization only; no session cookie or direct provider fetch; no public internal hostnames or orchestration vocabulary; shared registry drives help and SKILL generation.
AC-145: intentionally not claimed locally; it remains the external clean-agent oracle requiring model credentials and the running-instance check:skill-agent path.
Verdict: PASS for implementation self-review; proceed to in_validation.