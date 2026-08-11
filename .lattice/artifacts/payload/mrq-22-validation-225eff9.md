# MRQ-22 final-head running-system validation

Validated exact HEAD `225eff9c30a898b88b01b133a88e79d85831e509`, based on
`forgejo/master @ a05a015da45d3c9379b99ef1e48d5b291e127c32`, with the already
seeded disposable local D1/KV state and the production Worker bundle rebuilt
by the final PR gate.

- `GET /agenda?event=aie-ny-2026`: 200, 15,045 bytes, `0.045831s`.
- `GET /embed/aie-ny-2026-agenda?...accent=%23ff00aa`: 200, 24,026 bytes,
  `0.028558s`, with `Cache-Control: public, max-age=30, s-maxage=30`.
- `GET /s/definitely-not-published-secret-title?event=aie-ny-2026`: 404,
  `0.011799s`; body contained neither the guessed slug nor unpublished marker
  text.
- `GET /api/openapi.json`: 200, 142,690 bytes; served document contained all
  four public operation IDs (`getPublicAgenda`, `getPublicEmbed`,
  `getPublicSession`, `getPublicSpeaker`).

Worker was stopped cleanly after the final-head probes. This is local seeded
runtime evidence, not production deployment evidence.

