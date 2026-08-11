Verdict: PASS
Reviewed commit: cd25b18b206cf3d72c21330b296480ec5973a057
Scope: MRQ-11 M-10 program dashboard (AC-14, AC-15, AC-16, AC-240 dashboard surface).
Findings: None. The dashboard route uses the required *.routes.ts name; stage, metric, track, format, wave, and task links all delegate to the submissions route filters backed by the same predicates as the gauges; Scheduled and Published use the exact required copy; all gauges have tabular-number styling.
Evidence: git diff --check forgejo/master...HEAD passed; client TypeScript check passed; tests/integration/api/dashboard.AC-14-15-240.test.ts passed (3 tests). Full pr-gate and fresh seeded Worker validation are next.
Review mode: inline self-review, because headless code review is suspended.