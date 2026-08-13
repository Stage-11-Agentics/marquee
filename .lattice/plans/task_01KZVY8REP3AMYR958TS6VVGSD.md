# MRQ-150: Judge walkthrough: submitter portal dead-ends, OpenAPI overclaims ETag, CFP close date implausible

Three defects found walking the competition walkthrough live.

1. CRITICAL — public CFP confirmation link dead-ends. /f/cfp confirmation offers 'Open your speaker portal'; the magic link authenticates the new submitter, then GET /api/v1/me/portal 404s 'conference not found' because speakerEvent() requires a memberships row with role='speaker'. A public submitter holds a participations row with role='submitter' and no membership. Fix is SPEC.md:625's ruled answer — one honest empty state for a submitter, NOT a speaker membership grant.

2. /api/openapi.json info.description claims 'Mutations carry strong ETag/If-Match optimistic concurrency.' Only 2 of 203 routes declare concurrency if-match (agenda item update and remove). Narrow the sentence to what is true.

3. /f/cfp advertises a CFP close of Apr 30 2027 for an Oct 12-14 2026 conference. NOT a seed artifact: scripts/seed/event.ts has only ever held CFP_CLOSES = 2026-09-13T03:59:59Z (Sep 12 end-of-day ET). The live D1 row was mutated after the last seed. Fix is live data, not code.
