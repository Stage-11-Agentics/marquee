# MRQ-59 running-system validation (final rebased head)

Validated commit: b5bb074, based on forgejo/master 2054c429.

Runtime: `npx wrangler dev --local --local-protocol http --port 18765`

Evidence from the live local Worker:

- `GET http://127.0.0.1:18765/api/openapi.json` returned 200. Parsing the
  served response found all five upload/media paths:
  `/api/v1/public/uploads/sign`,
  `/api/v1/public/uploads/{id}/complete`,
  `/api/v1/me/uploads/sign`,
  `/api/v1/me/uploads/{id}/complete`, and `/api/v1/media/{key}`.
  Total served paths: 8.
- An unauthenticated `POST /api/v1/me/uploads/sign` returned 401 with the
  shared `unauthenticated` envelope and matching `X-Request-Id`/`request_id`.
- The Wrangler server was stopped cleanly after the probe.

Final support: `npm run check:api` passed with eight operations and no findings;
the M-38 CLI-registry skip notice remains expected.
