# MRQ-120 running-system validation

Validated commit/build: 4bd50674b185b9baf688b5061e6b5a6eb760b031 / 4bd50674b185
Environment: local Wrangler Worker with fresh migrated and deterministic seeded D1; not deployed evidence.

Observed:
- GET /health returned 200 with service marquee, status ok, and build 4bd50674b185.
- GET /agenda?event=aie-ny-2026 returned 200 and rendered Format, Location, bounded Show more descriptions, stable data-public-session-id hooks, day headers, and time-slot headers.
- Room facet narrowed seeded agenda cards from 23 unfiltered to 4 by room id and 4 by room name.
- GET /embed/aie-ny-2026-sessions with format and room filters returned 200 and rendered the flat-list hook, Format/Track labels, Show more, and stable session hooks.

Cleanup: Worker stopped, port 18720 verified closed, and the temporary local D1 was moved to Trash.