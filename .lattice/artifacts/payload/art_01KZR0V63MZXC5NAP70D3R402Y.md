MRQ-45 self-review
Reviewed commit: a364d72
Verdict: PASS

Scope checked: tests/node/comms.AC-250.test.mjs and tests/integration/mail.test.ts only; no product implementation or contract files changed.
Findings: none.

Evidence:
- Whole-tree provider scan: only src/jobs/mail/consumer.ts uses the production Resend endpoint; the standalone spikes/s2-ics-clients/send.mjs is the sanctioned operator oracle.
- AST guard scans 144 src modules, finds exactly three insertOutbox calls with arities [1,2,2], exactly two string-literal always_live writes, both in src/jobs/mail/outbox.ts.
- Demo matrix observed outbox_rows=8, suppressed=8, sent=0, provider_batches=0, provider_singles=0 for all seven trigger keys plus bulk.
- npm test PASS: 31 files, 177 tests, 13.547s; targeted mail integration PASS: 19/19; public-form integration PASS: 7/7; check:seed PASS against evt_aie-ny-2026.
- tests/ac-claims/MRQ-45.json is intentionally absent because this ticket owns no auto ACs.

Review conclusion: the implementation is contained under the audited claims; the added guards protect the exact call inventory and demo suppression matrix.