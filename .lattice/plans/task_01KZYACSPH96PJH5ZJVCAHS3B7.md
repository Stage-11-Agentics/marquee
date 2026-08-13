# MRQ-163: A test fixture mints auth sessions against a frozen clock, so the gate goes red on a date nobody chose

npm run pr-gate is red on main right now, and will stay red on every branch until this is fixed. 22 tests fail. None of them are about the change under test.

The cause is a frozen clock meeting a real one. tests/integration/api/participants-editable.MRQ-139.test.ts:59 pins the fixture's notion of now:

  const now = Date.UTC(2026, 7, 12, 12, 0, 0);

and mints the organizer's session with expires_at = now + 86_400_000 — 2026-08-13T12:00:00Z. But resolveSession (src/lib/auth/auth-sessions.ts:45-57) validates with 'expires_at > ?' bound to the REAL Date.now(). So the fixture session was born already counting down against wall-clock time, and it died at 12:00 UTC today. Every request in the file now answers 401. tests/integration/api/people.MRQ-131.test.ts:92 has the same shape and fails the same way.

That is the whole of it: 8 failures in MRQ-139 plus 14 in MRQ-131 equals the 22. The product is not broken, and neither is the change that happened to be on main when it fired.

Two things make this worth a high priority rather than a shrug:

1. It is not self-limiting. It went red at 12:00 UTC 2026-08-13 and it does not come back. Every agent who runs the gate from now on sees a red suite caused by nothing they did.
2. It teaches the fleet to ignore a red gate, which is the expensive failure. A gate that is red for reasons unrelated to the diff is worse than no gate — it converts the one signal that should stop a merge into noise. This project already merged PR #136 over a REQUEST CHANGES and merged PR #169 on an admittedly stale gate; a permanently-red suite makes that the norm rather than the exception.

Scope. Sixteen test files insert into auth_sessions with an expiry offset. Most compute now from Date.now(), so their sessions are always valid and they are fine. Only the ones that pin a literal date are bombs:

  - participants-editable.MRQ-139.test.ts — Date.UTC(2026,7,12,12,0,0) + 24h — FIRING since 2026-08-13T12:00Z
  - people.MRQ-131.test.ts — same shape — FIRING
  - submission-record-board.AC-118-120-238-240-243-251.test.ts — Date.UTC(2026,9,20,15,30) + 24h — fires 2026-10-21, currently green and will look fine right up until it is not

Acceptance criteria:
1. The gate is green on main with no other change.
2. Fixture sessions cannot expire against the wall clock. Either mint expires_at from Date.now() rather than the fixture's frozen now, or give resolveSession's now a test-injectable value the fixture controls — the first is smaller, the second is more honest about the coupling. Pick one and apply it to all three files, not just the two that are currently red.
3. A check that would have caught this before a date boundary rather than after: no test may insert an auth_sessions row whose expires_at is computed from a literal date. A grep-level check in scripts/checks is enough; it does not need to be clever.
4. Sweep for the same frozen-clock-vs-real-clock shape in other expiry-checked tables — magic_links.expires_at and forms.closes_at are the obvious neighbours.

Files: tests/integration/api/participants-editable.MRQ-139.test.ts (:59, :63-65), tests/integration/api/people.MRQ-131.test.ts (:92), tests/integration/api/submission-record-board.AC-118-120-238-240-243-251.test.ts, src/lib/auth/auth-sessions.ts (:45-57, the real-clock read).

Provenance: found while gating 07dd8870 before a deploy. I first mis-attributed it to PR #157, which was the newest commit; checking out e29d4bd8 — which had gated clean 30 minutes earlier — reproduced the identical 8 failures, which is what ruled the diff out and the clock in.
