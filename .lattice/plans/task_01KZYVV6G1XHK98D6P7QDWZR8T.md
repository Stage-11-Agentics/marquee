# MRQ-186: No check script may red on wall clock alone: check:seed's status is a stopwatch

check-seed.mjs derives its status from elapsed time, not from findings, so contention on a busy box presents as a red — the one signal the fleet was told to trust unconditionally.

VERIFIED IN SOURCE (github/main, scripts/checks/check-seed.mjs):
  const budgetMs = 30_000;
  status: elapsedMs <= budgetMs ? 'pass' : 'fail',
  if (result.status === 'fail') process.exitCode = 1;
No verdict/warn split and no hard-limit tier. Measured 29638ms against the 30000ms budget on #198 (362ms of headroom) and 31142ms on the follow-up branch, so on a loaded box it is a coin flip. Most of the 30s is withLocalRuntime booting wrangler.

WHY IT MATTERS: run-test.mjs and pr-gate.mjs both split verdict from status — over budget is 'warn' / 'pass-over-budget', loud and passing, and only HARD_LIMIT_MS (600_000) converts slowness into a red. check-seed contradicts that contract while looking identical from the outside. An agent following the fleet rule 'a red is load-invariant, believe it' will investigate a defect that does not exist, or worse, dismiss the rule after being burned once.

FIX: give check-seed the same verdict/warn split run-test.mjs already has. Over budget prints loudly and passes; only a genuine hang (a hard limit well above the budget) fails. Keep emitting elapsedMs and budgetMs so the number stays readable.

AUDIT OF ALL CHECK SCRIPTS (merge captain, 2026-08-13; check-seed independently verified by intake):
  check-seed.mjs   REDS ON TIME  — pure stopwatch, no warn tier. This ticket.
  check-speed.mjs  REDS ON TIME  — by design (product speed is a graded feature, R7), but still
                                   load-sensitive when run locally. Leave the behaviour; consider
                                   labelling the local run as non-authoritative.
  run-test.mjs     no — warn tier; only HARD_LIMIT_MS 600_000 reds
  pr-gate.mjs      no — warn tier, status pass-over-budget
  check-clocks, check-repo, check-routes, check-schema, check-shell-truth, check-deploy,
  trace-ac, verify-design-contract — all derive status from findings

TRIAGE NOTE WORTH KEEPING IN THE SCRIPT'S OWN COMMENT: a content failure in check:seed throws from an assert and produces no report; a stopwatch failure emits a well-formed report with status 'fail'. So if you have a seed.json report at all, every assertion passed and you were timed out, not broken.

Raised by the merge captain (surface:125) after #198 hit it; minted by intake per single-writer rule.
