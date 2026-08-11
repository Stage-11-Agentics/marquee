# MRQ-22 running-system validation

Validated exact HEAD `1b037839508ae48b14aeb211fb7af6a791ccef8a`, based on
`forgejo/master @ 7ecbef86375803caac69b029addf8ddb8dccf74d`.

Runtime: `npx wrangler dev --local --local-protocol http --port 18765` with a
fresh disposable persisted state. Applied all three migrations and seeded the
real deterministic demo (`5826` rows).

## Observed HTTP evidence

- `GET /agenda?event=aie-ny-2026` returned 200, 15,045 bytes, and the first
  request completed in `0.193850s`; the HTML contained the event name, venue,
  and SSR filter form.
- Ten additional no-keepalive agenda requests completed in
  `0.006965s–0.019652s`; measured p95/max was `0.019652s`, under the 1-second
  cold-load budget in this local Worker run.
- A session permalink returned 200 and a speaker permalink returned 200, with
  the agenda-derived slugs cross-linking from the SSR page.
- Agenda and speaker embeds returned 200. The agenda response returned
  `Cache-Control: public, max-age=30, s-maxage=30` and rendered the configured
  filtered URL; the public API and embed API returned 200.
- `GET /api/openapi.json` returned 200 and the served document contained
  `getPublicAgenda`, `getPublicEmbed`, `getPublicSession`, and
  `getPublicSpeaker`.
- A guessed unpublished permalink returned 404; its response body contained
  neither the guessed slug nor unpublished marker text.

The runtime was stopped cleanly after the probes. This is local seeded runtime
evidence, not production deployment evidence.

