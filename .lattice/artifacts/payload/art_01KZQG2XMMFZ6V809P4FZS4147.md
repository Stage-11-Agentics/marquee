Validation: MRQ-13
HEAD: 7e9501ef8022e928fd1dd7e2bde2f57c8024c733
Base: forgejo/master 40bfda68c860518de86c51714e7c8b92681c3dae
Verdict: pass

Commands and observed results:
- npm ci: PASS; 114 packages installed, 0 vulnerabilities.
- npm run pr-gate -- --ticket MRQ-13: PASS; worker/client/test types, production build, design contract, hermetic suite, and merged AC trace.
- Hermetic suite: 26 Vitest files, 140 tests passed; 32 Node checks passed.
- npm run check:api: PASS; OpenAPI 3.1, served JSON/docs parity, 71 operations, no findings. CLI parity is skipped because cli/ does not exist yet (M-38).
- trace:ac merged ticket MRQ-13: PASS; live=212, testFiles=36, claims=16, uncovered=0, errors=0.
- git diff --check forgejo/master...HEAD: PASS.
- git merge-base --is-ancestor forgejo/master HEAD: PASS.
- git rev-parse HEAD equals git rev-parse forgejo/mrq-13-forms: PASS.

Required behavior evidence:
- AC-132/AC-133 tests prove a hidden conditional field is not required when hidden and a submitted hidden value is omitted from persisted projected answers.
- AC-tagged API, evaluator, and seed tests cover the owned builder/catalog/evaluator criteria and seeded conditional vendor field.

Disposition: ready for PR; no merge performed.