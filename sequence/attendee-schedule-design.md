# Attendee Personal Schedule — Design

**Status:** RATIFIED — design loved (Atin, 2026-08-12, "I love this design"). The prototype `prototypes/attendee-schedule/index.html` is the **binding visual contract** for this feature; the build reproduces it one-to-one. Shipping as ONE full ticket with an expert plan (operator ruling: single ticket, Opus delegator).
**Register:** rows 37, 38 · section T-J (`eval-response-tickets.md`)
**Rubric:** EMB-10 + EMB-11 ≈ 1.14 overall points — irrelevant. This is **product**, for real AIE NYC attendees. Sessionize's most-loved attendee feature, built the Marquee way.
**Process (as ruled):** this doc → full HTML prototype → build tickets → delegator fleet. **Nothing builds until the prototype is loved.**

---

## 1. Decisions as ruled

| # | Question | Ruling |
|---|----------|--------|
| 1 | Identity / persistence | **localStorage + shareable URL** (option b). No accounts, no auth, no PII. Magic-link accounts are out of this feature entirely; if attendee accounts ever come, they adopt this state format. |
| 2 | Where the star lives | **Agenda rows + session detail pages.** My Schedule is a **filter view of `/agenda`** (toggle chip), not a separate page. Speaker-page session lists: later. |
| 3 | Timing / ambition | **Build now.** Basic starring is in scope. Sequenced after MRQ-120's card hooks merge (its PR is open). |
| 4 | Export | **(c) staged, all of it.** Single-session ICS on `/s/:slug` ships first and independently. The starred set gets one-shot ICS download *and* a live webcal subscribe feed. The share mechanism is a **server-side short code** (not URL-encoded state) precisely so the webcal feed falls out of the same primitive. |
| 5 | Conflicts | **Yes, but subtle and small.** A quiet muted chip ("overlaps ⟨title⟩"), never a warning, never a modal, never a confirm. Double-starring is a legitimate conscious act — undecided picks, fallbacks. The system notes; it does not nag. |
| 6 | Wildcard | **Deep agent-friendliness is a first-class design goal** — an agent should be able to read the agenda, build a schedule, and hand its human a link/feed, entirely through documented anonymous endpoints. Matches PHILOSOPHY.md's "agent-native by design". |

### Prototype round-1 rulings (Atin, 2026-08-12, live iteration)

Prototype: `prototypes/attendee-schedule/index.html`. Rulings from the first working session, all implemented and verified there:

- **"At a glance" time-block panel** at the top of My Schedule: three day columns on a real 09:00–18:00 time axis, starred sessions as positioned blocks, overlapping picks side-by-side in half-width lanes, NEXT highlighted. The list answers "what's next"; the blocks answer "what does my Wednesday look like" — gaps and clusters become visible.
- **Star card placement: leading-edge rail.** The star is the first column of every agenda row (Gmail pattern) — a scannable vertical rail, clear of the chips, thumb-reachable on a phone. (Supersedes an earlier "centered under the chips" iteration, which read as awkward.)
- **Current-time line on the glance panel:** a red NOW rule with a time tag across today's column (calendar convention). Real clock in production; the prototype uses its simulated Wed 13:40 clock.
- **Starred state must be unambiguous:** starred = gold ★ on an ink-dark button; unstarred = quiet ☆ outline on white. Brief 110ms scale pulse on starring. Header ★ warms to gold once anything is starred.
- **"Getting there" links to Google Maps directions** (building name + address as the destination) on session detail.
- **Header is a two-button segmented view switch — "Conference agenda | ★ My schedule (n)"** — not a toggle. Unchecking a toggle to get back to the agenda is unintuitive; two labeled buttons make the current view and the way back both legible. The active segment fills; on a session detail page the segment of the originating view stays lit.
- **Glance blocks get a styled hover card** (also on keyboard focus): day/time, title, room + building, speakers, and the overlap chip when applicable — not the browser's native tooltip. Positioned adjacent to the block, viewport-clamped.
- **"Open on your phone" is a top-level button** in the My Schedule export row (first position), opening its own QR + private-sync-link sheet. The phone is *the* agenda device; cross-device must not hide inside the share sheet. The share sheet keeps subscribe + share-with-a-friend.
- **Mobile (≤460px):** header becomes brand row + full-width two-segment view switch; filter bar compacts to day tabs + 2-up selects + search; agenda cards keep the leading star rail with all content in the second column. Verified at 390px.
- **Back-navigation preserves origin:** session detail opened from My Schedule returns to My Schedule (labeled "← My schedule"), never dumps the attendee back on the full agenda.
- **"Brief your agent"** in the My Schedule export row: one click generates a paste-ready text block — picks inline (works with zero fetches), noted overlaps phrased as intentional either/ors, venue walking context, and the live JSON/webcal/program URLs so the agent can re-check and act. The human-side complement of the For-agents API loop.

## 2. The shape of the thing

An attendee (or their agent) stars sessions. Stars live in localStorage instantly — zero friction, no round-trip. When they want their schedule on another device, shared with a friend, or in their calendar, one action ("Sync & share") promotes the local set to a **short code** on the server. The code is the universal handle: share URL, webcal feed, JSON API — all the same primitive.

### State model (client)

- localStorage key: `marquee:schedule:<eventSlug>` → `{ v: 1, sessionIds: string[], code?: string, writeKey?: string }`
- Starring/unstarring mutates localStorage synchronously. If a `code` exists and the device holds the `writeKey`, the module pushes the update to the server (debounced, fire-and-forget; localStorage remains the source of truth for this device).

### Short code + write key (server)

- `POST /api/v1/public/schedules` `{ eventSlug, sessionIds }` → `{ code, writeKey, urls: { share, sync, webcal, ics } }`
- **Code = read. Key = write.** Two URLs over one code:
  - **Share URL** (`/agenda?sched=<code>`) — code only. Opening it offers "Import these N sessions into my schedule" (a copy; the viewer's stars are their own).
  - **Sync URL** (`/agenda?sched=<code>#k=<writeKey>`) — key rides the fragment (never hits server logs). Shown privately ("open on your phone", QR in the prototype). The phone hydrates localStorage *with* the writeKey, so both devices push to the same code.
- `PUT /api/v1/public/schedules/{code}` (writeKey in header) replaces the session set.
- `GET /api/v1/public/schedules/{code}` → JSON: the session set with full public session objects embedded (agents get everything in one call).
- `GET /api/v1/public/schedules/{code}.ics` → live VCALENDAR of the set. `webcal://` points here. Restar on your laptop; your phone's subscribed calendar updates.
- Storage: **D1 table** (`public_schedules`: code, event_id, session_ids JSON, write_key_hash, created/updated). Not KV — the feed joins session rows from D1 anyway, and one store beats two. Codes are unguessable (≥64 bits, base32). No PII anywhere in the row.
- Rate-limit creation modestly; cap set size (e.g. 200) — vandalism economics, not auth.

### The star module (client contract vs MRQ-120)

Public pages are SSR strings with no Preact runtime — the star feature is **one small vanilla script module** (pattern: `PUBLIC_AGENDA_SCRIPT`), riding MRQ-120's contracted per-card hooks:

- **Binds to:** `article[data-public-session-id]`, reading `data-public-session-slug`, `data-public-session-start`, `data-public-session-day` (all contracted in MRQ-120's plan §hooks).
- **One addition we need:** `data-public-session-end` (MRQ-120 adds `PublicSession.endTime` to the projection but doesn't emit it as a card attribute). One-line change, made in *our* ticket after MRQ-120 merges — the conflict chip needs intervals, not instants.
- **The star button is server-rendered** as an empty, state-unknown control in a fixed slot on every card and on `/s/:slug` (aria-pressed="false", visually quiet until the script hydrates state from localStorage). Nothing jumps, ever: the slot is reserved in SSR, the script only flips state (house rule: elements never jump).
- **My Schedule view:** a toggle chip in the agenda filter bar (also SSR'd, script-activated). Active → non-starred cards hide client-side, a count renders ("7 sessions · Tue 4 / Wed 3"), conflict chips appear, and the export row (Download .ics / Subscribe / Share) shows. Empty state: "No sessions starred yet — tap ☆ on any session." on the same page where fixing it is one tap.
- **Conflict chips:** client-side interval math over start/end attributes of the starred set. A small muted chip on each member of an overlapping pair: "overlaps ⟨other title⟩". No color alarm, no blocking. (The transit-aware server engine is a later, differentiating upgrade — v1 plants the flag honestly.)
- **No dependency on MRQ-120's render internals** — attributes only. If a card re-renders differently, the module doesn't care.

### ICS story (staged)

1. **Ships first, independent:** "Add to calendar" on `/s/:slug` — single-session `.ics` download (+ Google/Outlook links, which `src/jobs/calendar/ics.ts` already generates). ~30 lines reusing the invite VEVENT builder. No dependency on MRQ-120, on the star module, or on anything above. Also the honest partial-credit answer to EMB-11 if it lands pre-deadline — but it ships because a real attendee wants it.
2. **With the schedule feature:** "Download my schedule (.ics)" — the starred set as one VCALENDAR, client-triggered (POSTs the set if no code exists yet, then downloads `{code}.ics`).
3. **The crown:** "Subscribe in your calendar" — `webcal://marquee.stage11.dev/api/v1/public/schedules/{code}.ics`. Live-updating. Falls out of the short-code primitive for free.

### Agent-native design (ruled in, first-class)

The full loop an agent can run for its human, no auth, no browser:

1. `GET /api/v1/public/agenda?event=aie-nyc-2026` — the whole program as JSON (exists today).
2. Pick sessions (by track, speaker, time, its human's stated interests).
3. `POST /api/v1/public/schedules` — get back code + every URL that matters.
4. Hand the human: "Here's your Tuesday: ⟨share URL⟩ — subscribe: ⟨webcal⟩."

Design rules that make this real, not incidental:

- **Every schedule endpoint is anonymous JSON with typed Zod schemas**, in the same route manifest as the existing public API — discoverable, documented, versioned.
- **The POST response is self-describing:** code, writeKey, and a `urls` object with share/sync/webcal/ics fully formed. An agent never string-builds a URL.
- **Session identity is stable and public** (id + slug both accepted in `sessionIds`) so agents can key off either the API or scraped page hooks.
- **The card `data-*` hooks are documented public contract** — a computer-use agent driving the real UI finds the same stable handles a script module does.
- **A public agent guide** — `/agenda` (or the public shell footer) links a short "For agents" doc enumerating the public endpoints and the schedule loop above. Cheap, honest, on-brand; exact surface to be settled in the prototype.
- **Conflict data in the JSON:** `GET /schedules/{code}` includes computed `overlaps: [[idA, idB], …]` so agents don't re-derive interval math.

## 3. Minimum-viable cut

If everything else burned down, the feature is still real with: **star on agenda cards (localStorage) + My Schedule filter view + one-shot ICS download of the set.** No code, no share, no webcal, no conflict chips. That cut is ~1.5 days and entirely client-side except one download endpoint. Everything in §2 beyond it is additive and independently shippable — which is exactly how the tickets are sliced below.

## 4. Effort estimate

| Slice | Contents | Estimate |
|-------|----------|----------|
| S0 | `/s/:slug` single-session Add to calendar (ICS + Google/Outlook links) | 0.5 day |
| S1 | Star module + localStorage + My Schedule view + SSR button slots | 1 day |
| S2 | Short-code backend (D1 migration, POST/GET/PUT, share/sync URLs, import flow) | 1 day |
| S3 | Set-level ICS download + webcal feed | 0.5 day |
| S4 | Conflict chips + agent guide + `overlaps` in JSON + docs polish | 0.5–1 day |

≈ **3.5–4 delegator-days** total; S0 is independent of everything and can ship today; S1 waits only on MRQ-120's merge; S2–S4 stack on S1.

## 5. Build tickets — ready to mint (post-prototype)

> Minting is orchestrator-only. Final ACs get pinned after the prototype is approved; descriptions below are complete otherwise. Suggested tags: `attendee-schedule`, plus `eval-response` on T-SCHED-0 only.

**T-SCHED-0 · Single-session "Add to calendar" on `/s/:slug`** — *small, independent, can mint now.*
Add an "Add to calendar" control to the public session detail page: `.ics` download plus Google/Outlook quick links, reusing `src/jobs/calendar/ics.ts` (escaping, VEVENT, link builders all exist). New anonymous route `GET /api/v1/public/sessions/{slug}.ics`. Timezone from event; location = room + building. Tests: ICS validity, escaping, TZ, 404 on unpublished. Register row 38; honest partial EMB-11. ~30 lines + tests.

**T-SCHED-1 · Star + My Schedule view (localStorage)** — *depends: MRQ-120 merged; prototype approved.*
Vanilla script module (no Preact on public surfaces) binding to MRQ-120's card hooks (`data-public-session-id/-slug/-start/-day`); add `data-public-session-end` to the card and `/s/:slug` (one line, coordinate if MRQ-120 still open). SSR a fixed-slot star button on every agenda card and session detail page (aria-pressed, reserved space — nothing jumps). localStorage state `marquee:schedule:<eventSlug>` `{v:1, sessionIds, code?, writeKey?}`. "My schedule" toggle chip in the filter bar: client-side filter, starred count, empty state. Star state survives filter/day navigation. Tests: module unit tests + Playwright (star, persist across reload, toggle view, empty state).

**T-SCHED-2 · Schedule short codes: share, sync, import** — *depends: T-SCHED-1.*
D1 migration `public_schedules` (code, event_id, session_ids JSON, write_key_hash, timestamps). Anonymous API: `POST /api/v1/public/schedules` → `{code, writeKey, urls:{share,sync,webcal,ics}}`; `GET /schedules/{code}` → set with embedded public session objects + computed `overlaps` pairs; `PUT /schedules/{code}` (writeKey header). Code ≥64-bit base32; writeKey hashed at rest; set-size cap; modest rate limit. Client: "Sync & share" action promotes local set; share URL `/agenda?sched=<code>` offers import-as-copy; sync URL carries `#k=<writeKey>` fragment and hydrates writeKey; debounced push on later edits. Tests: API contract, write-key enforcement, import flow, fragment never logged.

**T-SCHED-3 · Schedule ICS: download + webcal** — *depends: T-SCHED-2.*
`GET /api/v1/public/schedules/{code}.ics` — live VCALENDAR of the set via the existing builder; correct METHOD/SEQUENCE for subscription semantics; webcal URL surfaced in the My Schedule export row next to "Download .ics". Tests: multi-VEVENT validity, updates reflected on re-fetch, empty-set feed valid.

**T-SCHED-4 · Conflict chips + agent surface** — *depends: T-SCHED-1 (chips), T-SCHED-2 (agent surface).*
Client-side overlap detection over starred intervals; a small muted "overlaps ⟨title⟩" chip on each member of a pair, My Schedule view only — subtle by ruling; overlapping picks are legitimate. Publish the "For agents" doc (public endpoints + the read-agenda→POST-schedule→hand-back-links loop) linked from the public shell; document the card `data-*` contract in it. Tests: overlap math (touching ≠ overlapping), chip renders, doc route serves.

## 6. Open items for the prototype stage

- Star affordance and placement on the card (MRQ-120's new anatomy is the canvas); the export row layout; the import-as-copy moment; QR vs plain link for the sync handoff; where "For agents" lives. All visual/UX — exactly what the prototype exists to discover.
- Prototype should mock: starring, the My Schedule toggle with count, a conflict pair, the share/sync sheet, and the export row — on realistic AIE NYC seed data, in the Flight Deck skin (`DESIGN.md`; tokens in `prototypes/skins/skin-c.html`).

---

## 7. Round 2 — post-competition rulings (Atin, 2026-08-14)

**Context.** Round 1 shipped whole (MRQ-132, PR #102) and is live on marquee.stage11.dev. This round answers "does this need accounts / a magic link?" for the real AIE NYC 2026 (Oct 12–14), and adds two surfaces the first round deliberately left out: a star-count demand signal and attendee entry into the CRM.

### Rulings

| # | Question | Ruling |
|---|----------|--------|
| R2-1 | Accounts / login | **No accounts — reaffirmed.** Anonymous localStorage + short code stays the spine. No attendee login, no sessions, no membership role, no seat on the auth rails. |
| R2-2 | Email claim | **Yes, opt-in.** "Save your schedule with your email" attaches an email to a schedule code and sends the sync URL; re-sendable later ("email me my link"), which closes the lost-write-key recovery gap. The claim UI says plainly that the organizer can see your picks — ruled fine. |
| R2-3 | Attendees in the CRM | **Yes — as `people` rows, never a separate database.** An attendee is an org-scoped person plus an event-scoped attendance row. A separate attendee DB was considered and ruled against: it re-creates the parallel-people-table anti-pattern and blinds the CRM to attendee→speaker continuity — this year's attendee is next year's speaker prospect. |
| R2-4 | Star counts | **Tracked, valuable in both directions.** The organizer sees per-session counts as an advance-demand signal (room planning before doors open). Attendee-visible counts are an organizer **setting**; when on, a count shows only once a session has ≥ n stars (default n = 3). |
| R2-5 | Ticketing import | **Agent-native, not bespoke integrations.** No per-platform importers. The operator's agent bridges from wherever tickets were sold, guided by the skill file; the web app offers a "this is a task for your agent" copy-paste prompt. |

### Design (proposed to fit the rulings; prototype before build)

- **Star-count beacon.** A random device ID minted in localStorage; star/unstar upserts/deletes an `(event_id, session_id, device_hash)` row; count = distinct devices. Idempotent, unstar decrements honestly, zero PII. Own KV rate limiter per the schedules pattern (the shared buckets are a no-op, `allowAllRateLimiter`). Spoofable by a determined script — it is a *signal, not a vote*, and that framing is part of the design. Organizer surfaces show exact counts including tiny ones; the public agenda shows counts only when the org setting is on **and** count ≥ n. Public setting defaults **off** — popularity display carries speaker-feelings and rich-get-richer dynamics, so the organizer chooses it.
- **Claim = attach, not account.** Claiming creates/updates the org-scoped person (upsert by email), writes the attendance row with the schedule code, and sends one transactional mail carrying the sync URL. No session is created; nothing to log into. Turnstile-gated, own rate limiter.
- **Attendance join.** `participations` is deliberately NOT reused — it is submission-scoped (person ↔ submission, speaker roles), and attendees have no submission. New event-scoped join, working name `event_attendances`: `person_id`, `event_id`, `source` (`import` | `claim`), `schedule_code` when claim-sourced, timestamps. Human properties stay on `people`; this-event facts on the join — the CRM doctrine holds. Because attendees never touch `memberships`, there is **no roles CHECK-rebuild and no grants change**. The 0012 people machinery (notes, tags, lists) applies automatically; a live person-list "attendees of ⟨event⟩" is the consuming surface with zero new UI.
- **Privacy posture (binding).** Anonymous stars stay anonymous forever. Identity exists only at the explicit claim, and the claim moment says what it shares. **No silent linkage** of star data to imported ticket-holders. Aggregate counts carry no identity.
- **Agent import affordance.** Rails: the existing people CSV import (`org-imports.routes.ts`) and documented API, extended to write attendance rows (idempotent by email — re-running an export never dupes a person). Skill-file chapter: export → map → bulk upsert → verify counts. Web affordance on the People surface: a "task for your agent" block with a pre-filled copy-paste prompt (event slug, API base, where to mint a scoped token, the idempotency contract). This is the product's general answer to the integrations treadmill: stable rails + a taught agent loop, not N connectors.

### Constraints

- **Resend free tier, 100/day, is a hard cap** (ruled 2026-08-11). Claim mail is launch-gated on a paid tier before the real event — conference-week claim volume from 1k–3k attendees collides with speaker comms, which is the product's core mail. Build ≠ enable.
- Every new anonymous endpoint brings its own limiter (schedules' 30/hr/IP KV pattern) and Turnstile where it accepts an email.

### Scope bands

- **Now (prototype first):** star-count beacon + organizer counts + public-display setting with threshold; opt-in email claim (recovery + CRM entry); `event_attendances` + import affordance + skill chapter.
- **Later:** starring inside embeds (iframe-partitioned storage needs code-based hydration or postMessage; embeds are publicly cached 30s); transit-aware conflict engine; year-over-year CRM views; attendee comms/segments — needs the consuming-workflow answer below.
- **Not:** attendee login/accounts/sessions; a separate attendee database; ticketing/payments (R33 skip); an attendee app; silent star-to-ticket linkage.

### Open

- **Consuming workflow:** who at AIE opens the attendee list and what do they do next (next-year CFP outreach? sponsor reporting?). Shapes which fields and analytics matter. Person-lists give the surface; the workflow is unruled.
- **Retention:** schedule codes and webcal feeds currently live indefinitely. Proposed default: persist after the event — a feed that goes quiet beats a calendar that breaks. Unruled.
- **n:** fixed 3 vs org-configurable — a prototype question.

### Prototype first

Extend `prototypes/attendee-schedule/index.html` (Flight Deck tokens): star-count chips at threshold on the public agenda; an organizer demand view (counts by session); the claim sheet with its plain-language disclosure; the "task for your agent" import block on the People surface. Nothing builds until this is loved (Tone rules).
