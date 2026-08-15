# MRQ-208 — attendee schedule rounds 2+3 (demand signal, email claim, attendees in CRM, speaker cross-over)

Actor: `agent:mrq208-opus` · worktree `../Marquee-worktrees/mrq-208` off `github/main` (de189c0e).

Contract read in the ticket's order: design §7 in full (R2-1…R2-5, round-2 review rulings,
round 3, round-4 build rulings), prototype v0.3, DESIGN.md + PHILOSOPHY.md, and the round-1
shipped code (`public-schedules.routes.ts`, `src/lib/public-schedules.ts`,
`src/ui/public/agenda/{PublicAgendaPage.tsx,schedule-script.ts}`). This extends all four; it
forks none of them.

## Architecture decisions taken before writing code

1. **The setting lives on `event_settings`, not an org table.** The ticket says "org-level
   public-counts setting". There is no org-settings table in this schema, and the surface it
   governs (one conference's public agenda) and the data it thresholds (one conference's
   sessions) are both event-scoped. So the setting is `event_settings` key
   `public_star_counts` → `{"enabled": false, "threshold": 3}`, using the existing
   read/write pattern (`src/lib/social-platform-setting.ts`). Default OFF, floor 1, default
   threshold 3. **Deviation from the ticket's wording, deliberate; called out in the PR.**
2. **Rooms already carry `capacity INTEGER NOT NULL`** (`migrations/0001_init.sql:73`), so
   D7's "add one if missing" is already satisfied. `capacity = 0` means unknown: those rows
   show the count and an em-dash, never a fake ratio.
3. **The claim request is authenticated by the write key**, presented in the existing
   `X-Schedule-Write-Key` header. Two things fall out: only the device that owns a schedule
   can attach an email to it, and the server composes the sync URL itself rather than being
   handed a URL to mail (which would make the product an open mailer). The write key is used
   transiently to build the mail and is never stored — the row keeps only its SHA-256, as
   today.
4. **Verification is client-driven, because the write key rides the fragment.** The mailed
   link is `…/agenda?event=…&sched=CODE&claim=TOKEN#k=KEY`. A server-side redirect could not
   put the key in the fragment without the server knowing the key. The page script sees
   `claim=`, POSTs it to the verify endpoint, then strips it from the address bar exactly as
   round 1 already strips `#k=`.
5. **Claim state and speaker pins are read with the write key, never from the code alone.**
   `GET /schedules/{code}` with the key returns `claim` (masked email, verified, pins);
   without the key it returns exactly what it returns today. That is what keeps the shared
   read-only link free of "you're speaking" (round-4 ruling) with no second code path.
6. **Pins are derived at render** from the person-match against the published agenda; they
   never enter `session_ids`. The ICS/webcal route derives them from the claim row on the
   code (ruled in); the JSON GET without a key does not (ruled out).
7. **Beacon rate limiting is per-device and per-IP with a venue-scale IP ceiling.** A
   conference is one NAT: the schedules limiter's 30/hr/IP is right for a rare durable write
   and would blackhole an entire room for a control that fires on every star. The durable
   damage from one device is bounded by `(session_id, device_hash)` uniqueness. Ceilings are
   documented in the limiter itself.

## Deliverables → work

**D1 · migration `0017_attendee_schedules.sql`**
- `event_attendances(id, person_id, event_id, source CHECK(import|claim), schedule_code,
  verified_at, created_at, updated_at)`; unique `(person_id, event_id, source)` so an
  imported ticket-holder and their own claim coexist and neither dupes; index on
  `(event_id, source)`.
- `session_star_beacons(event_id, session_id, device_hash, created_at)`, PK
  `(session_id, device_hash)` — idempotent upsert/delete falls out of the PK; index on
  `event_id`.
- `schedule_claims(code PK → public_schedules, event_id, email, token_hash, person_id,
  minted_person, requested_at, verified_at, created_at, updated_at)` — the email↔code
  linkage, pending before verification.
- `ALTER TABLE public_schedules ADD COLUMN device_hash TEXT` (nullable).
- No memberships/roles change, no grants change, no TTL machinery (retention = persist).
- Mirror in `src/db/schema.ts`, `tests/integration/apply-migrations.ts`, `WIPE_ORDER`, and
  the table count in `scripts/schema-verify.mjs` (53 → 56).

**D2 · star beacon** — `src/lib/star-beacons.ts`, `src/routes/public-stars.routes.ts`
- `POST /api/v1/public/stars {eventSlug, sessionId, deviceHash, starred}` — one endpoint,
  both directions, idempotent either way.
- Own KV limiter (device + IP), the schedules pattern, no shared bucket.
- `sessionDemandCounts(db, eventId)`: distinct beacon devices **plus** distinct
  `public_schedules` rows with `device_hash IS NULL` containing the session (`json_each`).
- `POST/PUT /schedules` accept an optional `deviceHash` so a synced web code de-dups against
  its own beacon rows; agent-created codes (no hash) count as one.

**D3 · public counts** — quiet `★` chip in `CardMeta` beside format/track, never under the
star; slot reserved at threshold/off so nothing jumps; detail-page inline count; copy
"N schedules include this session" with sr-only text. Counts computed server-side at render,
only when the setting is on (zero cost when off — R7).

**D4 · claim flow (request → verify)** — `src/lib/schedule-claims.ts`,
`src/routes/public-claims.routes.ts`, `src/lib/attendee-claim-mail.ts`
- `POST /schedules/{code}/claim` — write key + Turnstile + own limiter → mints token, upserts
  the claim row, enqueues **one** mail behind the `ATTENDEE_CLAIM_MAIL` flag. **No CRM write.**
- `POST /schedules/{code}/claim/verify {token}` — person upsert by email, attendance row
  (`source=claim`, `schedule_code`, `verified_at`), identity flip. Records whether the claim
  minted the person.
- `DELETE /schedules/{code}/claim` — write key. Deletes the linkage always, the claim-sourced
  attendance row, and the person **only** if the claim minted it and nothing else references
  it. The reference inventory in `org-imports.routes.ts` is lifted to
  `src/lib/person-references.ts` and gains `event_attendances`; import-sourced rows are never
  touched.
- Pending copy "Check your email — link sent to …"; Resend; unlink copy exactly
  "Unlinked — your email and picks are removed from the organizers' records."
- Flag off is an honest state, not a dead end: the page says email links are not switched on
  for this conference rather than pretending to send.

**D5 · identity legibility** — agenda intro "No sign-in…" line; the My Schedule identity line
in both states at a fixed height, server-rendered and script-filled; the "Get it by email"
row in the share sheet per the prototype.

**D6 · speaker cross-over** — `src/lib/speaker-pins.ts`: match the verified claim email to a
person, derive their published sessions at this event, render pins in the list, glance panel
(ink-filled), briefing ("I'M SPEAKING at this one"), ICS/webcal set, and overlap detection.
Absent from the shared link; removed by unlink.

**D7 · demand panel, Agenda module** — `GET /api/v1/events/{id}/agenda/demand` and
`PUT …/agenda/demand/settings`; `src/ui/agenda/DemandPanel.tsx` beside `PublicationPanel`.
Exact counts including sub-threshold, ranked; bar = % of room capacity with a hairline 100%
tick and status-token fill past it; "bigger room?" chip over capacity; stats row
(imported / synced / via agents / claimed / advance picks) that reconciles with the board;
the public-counts setting and threshold beside it. Tokens only, no literals.

**D8 · attendee import + agent affordance** — `POST /api/v1/org/imports` accepts an optional
`event`; when passed, it writes the attendance rows itself, idempotently by email. People
list gains `kind=attendee` on the *same* builder as the roster (one query, three entrances).
Attendee-import brief on the People surface through the existing `AgentBriefPanel`, with the
real endpoints. SKILL.md People chapter gains the export → map → bulk upsert → verify loop.

**D9 · for-agents doc** — demand-signal disclosure and a current endpoint enumeration on
`PublicAgentsPage`.

## Tests

`tests/integration/attendee-schedule-rounds23.MRQ-208.test.ts` (seeded event, real routes):
beacon idempotence; the aggregate's two halves and the device-hash de-dup; threshold/off
rendering including the reserved slot; claim send writes no person; verify writes person +
attendance; unlink's three rules including the untouched import row; the shared link carrying
no pins while the ICS does; import with `event` writing attendances idempotently.
Unit tests for the demand maths, the person-reference inventory, and mail rendering.

## Validation (hard gate before `pr_open`)

Local `wrangler dev` against seeded data: browser automation for star → chip at threshold and
its absence under it, the claim send → pending → verify → identity flip → speaker pins, unlink
copy, and the demand panel reconciling; curl for the agent loop (POST without a device hash
raises the aggregate by one; with one, de-dups), the ICS pin set, and the shared-link
exclusion. Evidence attached to the ticket.

## Process

Suite baseline captured before the first change. PR to `Stage-11-Agentics/marquee` `main`,
non-author review, merge on green + review. No deploy.
