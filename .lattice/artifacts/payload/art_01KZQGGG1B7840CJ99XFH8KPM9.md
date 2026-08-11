# MRQ-20 running-system validation (exact head)

Validated commit: a470ea4839d0316ff5f0551c6d2c38b081bc3313
Base: forgejo/master @ a3b55b332bc93d11b301dcdd3d4074cec2473352
Verdict: PASS

Validation mode: local Wrangler Worker over HTTPS with an isolated local D1
fixture seeded from the committed migrations and seed. Browser/computer-use
validation was not run because no browser approval was granted; this artifact
is API/runtime evidence.

Observed proof:

- `GET https://localhost:8791/health` returned 200 with `{"service":"marquee","status":"ok"}`.
- `POST /api/v1/auth/demo` as organizer returned 200, a session cookie, and `event_id=evt_aie-ny-2026`.
- `GET /api/v1/events/evt_aie-ny-2026/agenda` returned 200 with 10 rooms, 25 scheduled sessions, 36 unscheduled submissions, and 6 visible conflicts. The first room rendered `Metropolitan Ballroom · Sheraton New York Times Square`.
- `POST /api/v1/events/evt_aie-ny-2026/agenda/items` placed the first pool submission and returned 201 with a strong ETag and the format default duration of 90 minutes.
- A subsequent agenda read removed that submission from the pool and returned the placed session with its date/time, room, building, and source title.
- `DELETE /api/v1/events/evt_aie-ny-2026/agenda/items/:id` with the returned `If-Match` returned 204; the next agenda read restored the submission to the pool and retained the 6 visible conflicts.
- `npm run check:api` passed on this exact head with 59 OpenAPI operations and no findings.
- `npm run pr-gate -- --ticket MRQ-20` passed on this exact head in 22.961s.

Validation boundary: the local runtime proves the API lifecycle and agenda
projection against seeded D1; no public AV/notes surface or building seed was
changed, and venue/geography ownership remains with MRQ-62.
