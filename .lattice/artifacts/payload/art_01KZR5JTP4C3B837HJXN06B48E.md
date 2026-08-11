Verdict: PASS
Reviewed commit: 167c428d41ac0866c9b793e532629c756da934c1
Findings: none.
Scope: tests/node/prototype-badge-invariant.test.mjs.
Checks: product roots are rejected when they contain badge class/copy or uppercase PROTOTYPE markers; matching files are allowed only under prototypes/; the binding pipeline-v1.1 prototype is positively required to retain prototype-badge and Prototype · mock data; no line-number coordinates are asserted.