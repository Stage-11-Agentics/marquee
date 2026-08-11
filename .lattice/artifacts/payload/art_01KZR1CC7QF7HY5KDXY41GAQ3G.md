MRQ-45 post-rebase self-review
Reviewed commit: a9d40725623113cc6d1fafa009059e87d13b94a3
Verdict: PASS. No containment finding.

Scope: audit-only changes in tests/node/comms.AC-250.test.mjs and tests/integration/mail.test.ts; no product implementation, migration, or contract changes.

Independent evidence:
- Whole-tree source scan covered all 144 src .ts/.tsx modules. No production module imports a Resend client; only src/jobs/mail/consumer.ts references the production Resend endpoint. The standalone spikes/s2-ics-clients/send.mjs operator oracle is not imported by Worker production code.
- The AST guard finds exactly three insertOutbox calls with arities [1,2,2], and exactly two precise string-literal insertOutbox(input, "always_live") calls, both at src/jobs/mail/outbox.ts:129 and :134. Normal enqueueOutbox uses the default demo_safe policy at src/jobs/mail/outbox.ts:53-56 and :118-119.
- Runtime demo matrix drove all seven TRIGGER_TEMPLATE_KEYS at src/jobs/mail/templates.ts:6-14 plus one bulk recipient. Observed output: MRQ-45 demo matrix: outbox_rows=8 suppressed=8 sent=0 provider_batches=0 provider_singles=0. Row assertions require demo_safe and demo_mode_not_allowlisted.
- The sanctioned public-form exception remains constrained: src/routes/public-form.routes.ts:469-476 passes the same request address as toEmail and typedAddress, while src/jobs/mail/outbox.ts:126-129 enforces equality before the live write. The public-form integration passed 7/7.
- tests/ac-claims/MRQ-45.json is intentionally absent because this audit owns no auto ACs.

Coverage note, not a containment finding: src/jobs/mail/schedule.ts:74-117 defines overdue candidates, while src/jobs/mail/consumer.ts:282-287 currently schedules only pre-close reminders; no live-mail leak was found and this audit did not alter feature wiring.