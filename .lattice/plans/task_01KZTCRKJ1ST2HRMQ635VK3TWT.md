# MRQ-123: Embeds as an organizer area

EMB-15 (w3; partial floor already cleared — four widget kinds, filters, branding, copyable snippet). STRICT ORDER: (1) sidebar 'Embeds' row -> /embed/config — coordinate with the wave-0 ticket which may have landed it; if so verify and build on it. (2) JSON output format in the builder's picker — the anonymous public API already exists (public.routes.ts:33-110), ~10 lines — plus restore the 'Agenda data' feed link if wave-0 hasn't. (3) iCal output format (doubles as public add-to-calendar). (4) Saved-embed CRUD on the existing deliberately-empty embeds table (read migration 0007's comment first — resolvePublicEmbed currently derives everything from slug+query): naming, enable/disable, saved list on a new admin embeds page. SKIP XML (rubric-chasing nobody consumes). Human lens: a marketer with five embeds across pages eventually needs to turn one off without editing HTML — this is finishing an intended design, the table is waiting. Full spec: section T-K. Register row 40.

## Implementation plan

### Ground truth and constraints

- The current builder lives at `/embed/config` and is anonymous/public by design; public embed routes must never read `mq_session` or vary by identity (SPEC §5.12 / A-5). Keep that boundary. The sidebar `Embeds` row will point to this exact route, while the page's manager panel calls the authenticated API and degrades honestly for anonymous viewers.
- The existing `embeds` table has no runtime writer. Migration 0007 explicitly says it is empty and resolved from slug/query today. Additive migration 0009 will add `name` and `enabled` with safe defaults; no contract docs or AC IDs change.
- Use the existing canonical public API for JSON (`/api/v1/public/embeds/{slug}`), and add a public `.ics` feed route over the same published-only resolved data. Disabled saved rows must 404 and must not fall through to inferred canonical embeds; custom deleted slugs must not become inferred embeds.
- Skip XML, arbitrary custom CSS, and a generalized CMS. The builder retains the existing four widget kinds, track/status filters, speaker layout, and accent controls; output format is a separate picker with styled HTML, JSON, and iCal.

### Files and phases

1. **Discoverability checkpoint:** add the `Embeds` sidebar route row (`/embed/config`) and a route-table contract assertion. Restore/add the builder's visible `Agenda data ↗` public feed link if it is absent on this branch, without changing the public route's auth boundary.
2. **Output checkpoint:** extend the builder's output picker and copy/preview source generation. JSON points at the existing anonymous public API with the selected filters; iCal points at a new anonymous `*.ics` feed. Add `buildPublicCalendarFeed` using RFC 5545 escaping/folding and published session data only. Preserve reserved control space when a format or widget makes a filter inapplicable.
3. **Saved CRUD checkpoint:** add `migrations/0009_saved_embeds.sql`, schema/config types, and `src/routes/embeds.routes.ts` with grant-protected list/create/update/delete endpoints. Store a normalized JSON config (`tracks`, `statuses`, `accent`, `layout`, `output`), generate an opaque unique public slug, include enabled/name/output/code metadata in the response, and compose audit rows in the same D1 batch as every mutation. `resolvePublicEmbed` will honor enabled rows and canonical inferred slugs only.
4. **Organizer surface checkpoint:** add a saved-embeds manager to the existing `/embed/config` page: authenticated list, name-and-save current configuration, per-row Get Code, enable/disable, and honest sign-in/error/empty states. The page remains usable as a public builder, and no anonymous caller receives saved organizer rows.

### Verification

- Add focused integration coverage for migration/application, saved embed auth/scoping and CRUD, disabled/deleted public visibility, JSON output, and iCal content/headers. Extend the existing public embed contract coverage for output pickers and the `/embed/config` manager markup; update schema verification's migration list assertion for 0009.
- Run only targeted Vitest files covering touched code plus route-table/node contract checks; do not run the full `npm test`. Before the gate, inspect `uptime` and defer if 1-minute load exceeds 24. Run `npm run pr-gate -- --ticket MRQ-123` only after targeted tests and exact-head review pass.
- Validation phase will use the real Worker request surface for anonymous JSON/iCal and the c11 embedded browser for the organizer sidebar → `/embed/config` flow, including save, Get Code, and disable. Record observed response/status/body evidence separately from test and inference.

### Risks and non-goals

- The route table is shared with T-Z, D1, F1, K, and N; keep its change additive and rebase if upstream lands a competing row.
- A saved embed is disabled by an explicit boolean and its public URL becomes unavailable; deletion is exposed as API CRUD but is not offered as a casual UI action, avoiding accidental removal of a marketer's live snippet.
- No new public identity or authorization path is introduced. No changes to SPEC/EVALUATION/BUILDPLAN/DESIGN/PHILOSOPHY/USER_STORIES.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **PASS WITH SCOPE NOTE:** `/embed/config` is already the public builder and is the ticket's mandated sidebar destination. The saved organizer list will be a clearly labeled manager on that page, populated only by the grant-protected API after the organizer's session resolves. This is the smallest honest implementation that preserves the binding anonymous embed contract; it is not a second parallel admin route.
- **Resolved migration ordering:** 0008 is already `form_field_dates`; saved embeds use `0009_saved_embeds.sql`, and integration/schema checks will apply/assert it after 0008.
- **Resolved feed restoration:** the missing `Agenda data ↗` link belongs in `PublicAgendaPage` alongside `Get embed code`, targeting the existing anonymous `/api/v1/public/agenda` endpoint.
- **Adversarial checks added:** disabled rows must not fall through to inferred public slugs; deleted custom slugs must not become inferred embeds; API authorization must prove both no-credential rejection and a positive organizer control; iCal must contain only published sessions and safe escaped/folded text.
