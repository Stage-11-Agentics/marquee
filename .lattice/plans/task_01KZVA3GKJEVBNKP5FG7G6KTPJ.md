# MRQ-132 · Attendee personal schedule — expert build plan

**Author:** agent:itinerary-design (design interviewer + prototype author), 2026-08-12.
**Builder:** the Opus delegator assigned to this ticket (`agent:delegator-mrq-132`).
**Status of design:** RATIFIED. Operator: "I love this design." Do not re-litigate ruled decisions; questions of taste were settled in the prototype rounds.

## Binding artifacts — read all three before writing code

1. `sequence/attendee-schedule-design.md` — every decision as ruled, including the "Prototype round-1 rulings" list. It is the contract.
2. `prototypes/attendee-schedule/index.html` — the **binding visual contract**. Open it in a browser and click every flow before starting. The build reproduces it one-to-one: gold-on-ink star vs outline star, leading star rail, segmented "Conference agenda | ★ My schedule (n)" header, at-a-glance panel with NOW line and hover cards, subtle overlap chips, sheets (phone/share/brief/agents), origin-preserving back-nav, mobile layout. Where prototype and this plan disagree on a visual detail, the prototype wins.
3. `DESIGN.md` + `src/styles/tokens.css` — Flight Deck. The prototype already uses the public-site palette; carry its extensions over verbatim.

## Ground rules (non-negotiable)

- **Never work in the primary checkout** (`deployments/Marquee`). Create a worktree:
  `git -C /Users/atin/Projects/Stage11/deployments/Marquee worktree add ../Marquee-worktrees/mrq-132-attendee-schedule -b mrq-132-attendee-schedule github/main`
- Board lives in the primary checkout; `LATTICE_ROOT` is set in your environment. Update your own ticket only (status, comments, plan notes); actor `agent:delegator-mrq-132`.
- Base on current `github/main` — **MRQ-120 merged (PR #86)**: cards already emit `data-public-session-id/-slug/-start/-day`, format+room facets exist, day/time group headers exist. Do not rebuild any of that.
- `npm test` ≤ 45s suite budget; `npm run pr-gate` before the PR (120s budget). A red suite must mean a real defect.
- Public repo rules: nothing secret; this is product code for the public site.
- **Zero Preact on public surfaces.** Public pages are SSR strings + small vanilla scripts. All client behavior ships as one new script (pattern: `PUBLIC_AGENDA_SCRIPT` in `src/ui/public/agenda/PublicAgendaPage.tsx`).
- **Elements never jump** (DESIGN.md craft rule): SSR reserves every slot the script later fills (star buttons, count badge, glance container, export row). Hydration flips state; it never inserts layout-shifting content above the fold.
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main` — title `MRQ-132 · Attendee personal schedule`. Merging does NOT deploy (DEPLOY.md); do not deploy unless the operator asks.

## Architecture

### State model (client)

localStorage key `marquee:schedule:<eventSlug>`:
```json
{ "v": 1, "sessionIds": ["ses_…"], "code": "MQ-…", "writeKey": "…" }
```
`code`/`writeKey` absent until first sync. Starring mutates localStorage synchronously; if a code+writeKey exist, debounce-push a PUT (fire-and-forget; localStorage stays the device's source of truth).

### Server: D1 + anonymous API

Migration `public_schedules`:
```sql
CREATE TABLE public_schedules (
  code TEXT PRIMARY KEY,            -- "MQ-" + 13 base32 chars (≥64 bits)
  event_id TEXT NOT NULL REFERENCES events(id),
  session_ids TEXT NOT NULL,        -- JSON array of public session ids
  write_key_hash TEXT NOT NULL,     -- SHA-256 hex of the write key
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Routes (all anonymous, Zod-typed, registered like `src/routes/public.routes.ts`):
- `POST /api/v1/public/schedules` `{eventSlug, sessionIds[]}` → 201 `{code, writeKey, urls:{share,sync,webcal,ics}, overlaps}` — validate sessions exist + published + belong to event; cap 200 ids; modest rate limit (per-IP, KV or in-memory per-isolate is acceptable for v1 — note the choice in the PR).
- `GET /api/v1/public/schedules/{code}` → `{code, event, sessions:[full public session objects], overlaps:[[idA,idB],…]}` — reuse the public session projection; compute overlaps server-side (same interval math as the client).
- `PUT /api/v1/public/schedules/{code}` (header `X-Schedule-Write-Key`) → replace `session_ids`; 403 on hash mismatch.
- `GET /api/v1/public/schedules/{code}.ics` → live VCALENDAR of the set (see ICS below). `webcal://` is the same URL, different scheme — nothing extra to build.
- Unknown code → 404 JSON (and a valid-but-empty VCALENDAR is NOT correct for 404 — 404 the feed too).
- Write key: 128-bit random, returned once at POST, stored only as SHA-256. Codes and keys from `crypto.getRandomValues`.

### ICS (two deliverables, one builder)

Reuse `src/jobs/calendar/ics.ts` (escaping, folding, VEVENT assembly, Google/Outlook links). Extend with a multi-VEVENT `VCALENDAR` assembler if the invite path only does single events — keep `METHOD:PUBLISH`, `X-WR-CALNAME: My <event name> schedule`, TZID from the event's timezone, `UID: <sessionId>@marquee.stage11.dev`, `URL` → `/s/:slug`, `LOCATION` → room, building.
1. `GET /api/v1/public/sessions/{slug}.ics` — single session download for `/s/:slug`'s "Add to calendar (.ics)" + Google/Outlook link buttons (links built server-side into the SSR page).
2. The `{code}.ics` feed above.

### Public UI changes (SSR side)

- `PublicShell`: replace the single "Organizer demo" action area with the segmented pair **Conference agenda | ★ My schedule (n)** (count span SSR'd empty with fixed width; script fills). Keep "Organizer demo" link somewhere sensible (footer is fine) — do not delete an existing affordance silently.
- Agenda rows: add leading star column (fixed 40px slot, SSR'd `aria-pressed="false"`), add `data-public-session-end`. Grid mirrors the prototype (`40px 118px 1fr chips`), mobile per prototype's media queries.
- `/s/:slug`: star button + Add-to-calendar row (ics/Google/Outlook) in a `detail-actions` row; "Getting there" becomes a Google Maps directions link (building name + address; addresses are in the venue/buildings data).
- **My Schedule is a client-rendered view of `/agenda`**: SSR ships (a) an empty glance-panel container, (b) an empty summary/export container, (c) the normal agenda list. The script, when the "My schedule" segment is active (`?view=mine` in the URL so it's linkable; script intercepts the segment click and pushState), hides non-starred rows, renders glance panel + summary + export row + overlap chips, shows the empty state when nothing is starred. Day/time group headers of empty days hide in mine-view.
- Sheets (open-on-phone with QR, subscribe/share, brief-your-agent, for-agents): static SSR'd `<dialog>`-or-div sheets, script toggles. QR: generate a real QR client-side — a tiny dependency-free QR encoder function is acceptable INLINE in the script (or SSR an `<img>` via a data-URI produced at request time — builder's choice, no external hosts, CSP stays intact).
- Brief-your-agent: client-generated text per the prototype's `buildBriefing()` — picks inline, overlaps as intentional either/ors, venue walking context, live JSON/webcal/program URLs.
- For-agents doc: a small SSR page (e.g. `/agenda/agents` or footer-linked static section) enumerating the public endpoints + the schedule loop + the card `data-*` contract. Copy from the prototype's agents sheet.
- NOW line + NEXT chip: real clock (event timezone), not the prototype's simulated one.
- Hover card on glance blocks: port from prototype (mouseover + focusin, viewport-clamped).

### Import & sync flows

- Share URL `/agenda?sched=<code>`: script fetches the code's JSON, shows an import banner ("N sessions — import a copy into my schedule"); import unions into localStorage (no code adoption — their stars stay theirs).
- Sync URL `/agenda?sched=<code>#k=<writeKey>`: same fetch, but the fragment key is stored: this device now edits the same code. Never send the fragment anywhere; strip it from the address bar after capture (`history.replaceState`).
- "Open on your phone", "Download .ics", "Subscribe / share", "Brief your agent" buttons in the export row, in that order. Download with no code yet → POST first, then download (and keep the returned code/key).

## Test plan

- **Unit/integration** (own file, e.g. `tests/integration/attendee-schedule.MRQ-132.test.ts`): schedule CRUD happy path + 403 wrong key + 404 unknown code; session validation (unpublished/foreign session rejected); overlap computation (touching ≠ overlapping); ICS validity single + multi + empty-set + escaping torture (commas, semicolons, newlines, diacritics); code/key entropy format; rate-limit path; `data-public-session-end` present on cards and detail.
- **Playwright e2e** (`npm run e2e` project conventions): star → count updates → reload persists; segment switch → mine view filters + glance renders + empty state; conflict pair shows chips in mine only; back from detail returns to origin view; share/import banner flow (two contexts simulating two devices via storage isolation).
- Respect the 45s suite budget — the heavy flows belong in e2e, not the default suite.
- `tests/ac-claims/MRQ-132.json` if the convention requires a claims file — mirror MRQ-120's (`owns: []`, exercises public-site ACs).

## Validation gate (in_validation — required before pr_open)

Drive the real dev server (`npx vite dev`) with browser automation, as the user: star three sessions including the ruled conflict pair, open My schedule, verify glance + NOW line + overlap chips + hover card, run open-on-phone and share sheets, download both ICS artifacts and lint them, GET the JSON + feed with curl, run the brief-your-agent copy. Attach evidence (`lattice attach MRQ-132 --role validation` — screenshots + curl transcripts). "I saw it work," not "it should work."

## Sequencing (commit per phase; one PR at the end)

1. ICS lib extension + `/s/:slug` add-to-calendar + tests (independent, lands even if later phases slip).
2. SSR skeleton: star slots, `-end` hook, segmented header, containers, detail-page actions + Maps link.
3. Client script: state, hydration, mine-view, glance + NOW + hover, chips, sheets, briefing.
4. D1 migration + schedules API + feed + import/sync flows.
5. For-agents page, polish pass against the prototype side-by-side (pixel-level look, mobile at 390px), e2e, pr-gate, PR.

Board rhythm: `in_progress` on start, comment at each phase boundary, `in_validation` with evidence, `pr_open` with the PR URL, then `lattice complete` with a full review after merge readiness is confirmed. Flag `needs-human` only for genuine operator decisions; the design is settled.

## Reset 2026-08-12 by agent:delegator-mrq-132
