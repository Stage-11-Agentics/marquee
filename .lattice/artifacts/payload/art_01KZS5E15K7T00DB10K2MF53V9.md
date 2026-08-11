Verdict: PASS. Exact reviewed HEAD: 9e9f62c after rebase onto github/main 8664387 and npm ci.

The implementation remains limited to the additive organization membership seed row, reset fixture/count/guard updates, and MRQ-78 integration plus node tests. No migration, token authorization widening, forbidden route/UI file, submission status, or seeded volume change.

The seed row makes requireTokenAdmin satisfiable for the demo organizer while event-scoped memberships remain event-scoped. Tests cover organizer list/issue/revoke, reviewer/speaker/anonymous refusal and no disclosure/count side effects, scoped bearer current-event success versus unheld-event refusal, and post-revoke invalidation.

Checks reviewed: git diff --check passes; prior exact source run had tsc, focused tests, standalone node 91/91, and live Worker/browser evidence. The latest main rebase changed only upstream files outside this diff.