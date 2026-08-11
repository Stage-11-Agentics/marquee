# MRQ-22 final-head running-system validation

Validated exact HEAD `43a1f4785c3af7514f2793a5e09eb8ce9acbb71a`, based on
`forgejo/master @ f8e824dc5baeb09e45d25b7b05f2cb3abc1caa4a`, with a disposable
local persisted D1/KV state seeded from the deterministic demo and the Worker
bundle rebuilt by the final PR gate.

- `GET /agenda?event=aie-ny-2026`: 200, 15,045 bytes, `0.037694s`; HTML
  contained the event, Sheraton venue, and SSR filter form.
- `GET /embed/aie-ny-2026-agenda?...accent=%23ff00aa`: 200, 24,026 bytes,
  `0.018621s`, with `Cache-Control: public, max-age=30, s-maxage=30`.
- `GET /s/definitely-not-published-secret-title?event=aie-ny-2026`: 404,
  `0.008560s`; body contained neither the guessed slug nor unpublished marker
  text.

Worker was stopped cleanly after the final-head probes. This is local seeded
runtime evidence, not production deployment evidence.

