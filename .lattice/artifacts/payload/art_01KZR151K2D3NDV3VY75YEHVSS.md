MRQ-45 final self-review
Reviewed commit: e997ef81e6776117d912e808b3770e53c87ecde5
Verdict: PASS. No containment finding.

Scope: audit-only changes in tests/node/comms.AC-250.test.mjs and tests/integration/mail.test.ts; no product implementation, migration, or contract changes.

Independent evidence:
- Whole-tree source scan covered all 144 src .ts/.tsx modules. No production module imports a Resend client; only src/jobs/mail/consumer.ts references the production Resend endpoint. The standalone spikes/s2-ics-clients/send.mjs operator oracle is not imported by Worker production code.
- AST guard finds exactly three insertOutbox calls with arities [1,2,2], and exactly two precise string-literal insertOutbox(input, "always_live") calls, both at src/jobs/mail/outbox.ts:129 and :134. Normal enqueueOutbox uses the default demo_safe policy at src/jobs/mail/outbox.ts:53-56 and :118-119.
- Demo matrix drove all seven TRIGGER_TEMPLATE_KEYS at src/jobs/mail/templates.ts:6-14 plus one bulk recipient. Observed output: MRQ-45 demo matrix: outbox_rows=8 suppressed=8 sent=0 provider_batches=0 provider_singles=0. The row assertions require demo_safe and demo_mode_not_allowlisted.
- The sanctioned public-form exception remains constrained: src/routes/public-form.routes.ts:469-476 uses the fail-open absent/unset enabled gate and passes the same request address as toEmail and typedAddress; src/jobs/mail/outbox.ts:126-129 enforces equality before the live write. Existing public-form integration evidence observed always_live for typed@example.com.
- tests/ac-claims/MRQ-45.json is intentionally absent because this audit owns no auto ACs.

Coverage note, not a containment finding: src/jobs/mail/schedule.ts:74-117 defines overdue candidates, while src/jobs/mail/consumer.ts:282-287 currently schedules only pre-close reminders; no live-mail leak was found and this audit did not alter feature wiring.

Checks already passed at this commit: targeted mail integration 19/19, public-form integration 7/7, node guard pass, npm test 31 files/177 tests, trace:ac merged scope (live 212, testFiles 66, claims 34, uncovered 0, errors 0), and npm run check:seed (evt_aie-ny-2026, demo_mode=1, 1000 submissions, 60 accepted, 1 transit conflict).