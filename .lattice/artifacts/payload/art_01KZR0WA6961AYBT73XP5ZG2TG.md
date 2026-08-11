MRQ-45 validation evidence
Validated commit: a364d72
Verdict: PASS

Observed checks:
- npm test: PASS, 31 files / 177 tests, elapsedMs=13547, budgetMs=30000, hermetic=true.
- Mail integration: PASS, 19/19; observed MRQ-45 demo matrix: outbox_rows=8 suppressed=8 sent=0 provider_batches=0 provider_singles=0.
- Public-form integration: PASS, 7/7; with no stored template override, the submitted typed address was recorded with send_policy=always_live and the exact typed recipient.
- Node source guard: PASS; 144 src modules scanned, only src/jobs/mail/consumer.ts references api.resend.com, no Resend import declarations, exactly two AST-recognized always_live writes in src/jobs/mail/outbox.ts.
- check:seed: PASS, local Wrangler/D1 runtime, event_id=evt_aie-ny-2026, 1000 submissions, 60 accepted submissions, 1 live Transit conflict.
- tests/ac-claims/MRQ-45.json: absent by design; MRQ-45 owns no auto ACs.

Validation scope is deterministic runtime/source evidence; no browser/UI validation applies to this audit-only ticket.