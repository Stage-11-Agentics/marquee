# MRQ-59 running-system validation

Validated commit: 404fe67 (rebased onto forgejo/master f2efc9f)

Runtime: `npx wrangler dev --local --local-protocol http --port 18764`

Evidence:

- `GET http://127.0.0.1:18764/api/openapi.json` returned 200 and the parsed
  served document contained all five upload/media paths:
  `/api/v1/public/uploads/sign`,
  `/api/v1/public/uploads/{id}/complete`,
  `/api/v1/me/uploads/sign`,
  `/api/v1/me/uploads/{id}/complete`, and `/api/v1/media/{key}`.
  Total served paths: 8.
- `POST /api/v1/me/uploads/sign` without credentials returned 401 with the
  shared `unauthenticated` envelope and matching `X-Request-Id`/`request_id`,
  proving the manifest route is live behind the current credential pipeline.
- The development server was stopped cleanly after the probe.

Supporting checks:

- Full `npm test`: 16 files, 81 tests passed.
- `npx tsc -p tsconfig.json --noEmit` and test types both passed.
- `npm run check:api`: pass; served JSON/docs parity live, eight operations,
  no findings; CLI registry skipped by the existing M-38 activation rule.
