# MRQ-24 running-system validation

Validated commit: `3ecba5fd97d93d856ef489ec086e66c7a83d73f`
Runtime: real local Wrangler Worker / Miniflare with a fresh D1 migration and `scripts/seed/index.ts` fixture.

Focused API flow:

- Organizer demo session → `GET /api/v1/events/aie-ny-2026/onboarding`: HTTP 200, 153 owed speaker rows, 153 incomplete speakers.
- Same organizer → `GET /api/v1/events/aie-ny-2026/onboarding/speakers/{row.person.id}`: HTTP 200, 6 task projections, 0 message-history rows.
- Speaker demo session → `GET /api/v1/me/portal?eventId=aie-ny-2026`: HTTP 200, one file task; its shared policy payload advertised `pdf`, `pptx`, and `key`, with `maxBytes: 26214400`.

The Worker was stopped and the temporary D1 directory was removed cleanly after the probe. No external mail or R2 object was created.
