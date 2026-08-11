HEAD 2869b6ebc88368f16ad3b2ee5165747515ed588d (rebased onto current github/main).

Worker: npx wrangler dev --config dist/marquee/wrangler.json --local --persist-to .wrangler/mrq78-validation --local-protocol http --var LOCAL_VALIDATION_TOKEN:mrq78-local-validation --port 8803.

Browser surface:258/259 opened /settings/api as the demo organizer. The UI issued a real token named MRQ-78 live scoped proof with program:read and one-conference restriction. Bearer proof against the live Worker: current evt_aie-ny-2026 returned 200; unheld evt_not-held returned 403 without event data. The UI revoke action completed and showed Revoked; the same bearer then returned 401.

Reset: LOCAL_VALIDATION_TOKEN=mrq78-local-validation npm run reset:demo -- --url http://127.0.0.1:8803 queued job a78f0a13-80c4-4c74-9075-7287341bd282 and completed in 2675ms. A fresh organizer session then loaded /settings/api and showed the normal No API tokens yet state.

Focused proof: MRQ-78 seed guard passed; token-route integration and reset-demo integration passed; standalone node --test tests/node/*.test.mjs passed 91/91. The first pr-gate attempt reached 22 Worker files / 162 tests passed and timed out only in the hermetic Node phase; the second had the same hard-budget timeout under concurrent machine load. npm run check:seed independently confirmed 1000 submissions and 60 direct accepted submissions but reported the pre-existing pipeline-derived mismatch (accepted 36, scheduled 1), owned by MRQ-76 and outside this ticket scope.