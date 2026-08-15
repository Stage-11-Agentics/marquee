# MRQ-201 implementation plan

Base: fresh `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-201-timezone`
worktree, branch `mrq-201-timezone`, cut from `github/main` at `c2c3da03`.

## Scope

1. Extract the existing DST-aware `zonedStart` and `localParts` pair into
   `src/lib/event-time.ts`, add the conference-zone datetime-local round-trip and zone
   label helpers, and update the two existing call sites without changing behavior.
2. Correct the eight display consumers: form close read-back and labels, public form
   payload/labels, embed deadline, conference-local outbound mail and merge data, and the
   shared timezone option list used by setup and settings. Keep system/audit timestamps in
   the reader's own clock.
3. Correct the three behavior consumers: session placement, CFP close writes, and task
   overdue enforcement at the end of the calendar day in `events.timezone`. Do not rewrite
   stored rows, add migrations, change API shapes, or alter pure instant comparisons.
4. Restate the existing calendar-day contract comments in the four named locations without
   changing their UTC-midnight encoding.

## Verification

- Add regression coverage with the machine zone pinned to `Asia/Tokyo` and a fixture event in
  `America/New_York`; restore `process.env.TZ` in `finally`.
- Cover both 2027 DST transitions, the spring gap, the fall overlap, form/session storage
  and conference-local read-back, plus explicit Worker-side mail strings. Test names use
  `AC-<n> ·` or `CONTRACT ·` prefixes.
- Keep `task-due.MRQ-114`, `abstract-management.MRQ-169`, `conference-dates.MRQ-142`,
  `calendar-ics.AC-95-96-97`, and `attendee-schedule.MRQ-132` unmodified and green.
- Run targeted tests, `npm test`, and the shared-lock `npm run pr-gate`; treat `fail` as a
  blocker, `pass-over-budget` as a warning, and `timeout` as unknown requiring a rerun.
- Perform local-only walkthrough/browser validation if available; never deploy, reset the
  demo, run `loop.sh`, touch `.deploy-freeze`, or use `marquee.stage11.dev`.
- Open a PR from the current branch, obtain an independent exact-head adversarial review,
  then re-gate/review after any push before merging. Report each resulting merge SHA to
  Eval Triage (`workspace:10`, `surface:245`).

## Stop conditions

Do not touch `migrations/`. If investigation shows existing session rows need repair, stop,
raise a c11 flag, and ask the operator to decide; this task only fixes edge interpretation
and future writes.
