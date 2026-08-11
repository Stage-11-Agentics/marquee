# MRQ-22: Public event site, permalinks, and embeds

BUILDPLAN: M-20 + M-21 — Wave 1 (§4) · MERGED at mint (same public-surface module, M-21 depends only on M-20, 5 h + 4 h = 9 h ≤ 10 h)

**M-20 — Public event site + permalinks** (5 h, ACs AC-83 – AC-86, AC-240; files `src/routes/public-agenda.route.tsx`, `src/ui/public/agenda/*`)
Scope (verbatim): Logged-out agenda with times/rooms/tracks/speakers, day + track + search controls, session and speaker permalinks cross-linked, published-only with no URL-guess leakage, scheduled-but-unpublished distinction, 375 px, cold <1 s.
Amendment 11 fold (SPEC.md): public session pages render "Room · Building" (AC-252). AV capabilities and room notes stay **off** public surfaces (AC-253).

**M-21 — Embeds** (4 h, ACs AC-87 – AC-90; files `src/routes/embed.routes.tsx`, `src/ui/embeds/*`)
Scope (verbatim): Config screen → copyable snippet + live preview, agenda and speaker-gallery embeds filterable by track and status, responsive, configured colors, **KV TTL 30 s with explicit purge on publish** so the 60 s budget has headroom.
Recorded decision F-7: embed KV TTL is 30 s against AC-89's 60 s budget.
Open dependency 2 (EVALUATION §6): Discord ruling Q2 on the embeddable gallery. If struck, **AC-87 – AC-90 move to non-goals** and gate 6's embed steps drop. We build them by default; the video overrides the brief's strikethrough.
Guardrail A-5: **embed routes never read `mq_session`.**

ACs (union): AC-83 – AC-90, **AC-240** · **AC-252** (public "Room · Building")
Hours: 9 (5 + 4)
Workflow: sub-agent-full (≥7 h combined — max of the constituents' modes)
Shared files: none — module-local under `src/routes/` and `src/ui/public/`, `src/ui/embeds/`.
Deps: M-19a (M-21's dependency on M-20 is internal to this ticket)
Speed: AC-85 is an AC-sourced budget (public agenda cold interactive p95 ≤ 1000 ms); AC-89 is AC-sourced (embed reflects a source change ≤ 60 s, actual recorded).
Plan: filled in by delegator's plan phase

## Plan — MRQ-22 (authoritative)

### Contract decisions

- Work from the rebased branch head `750ee7260ad02f021a23a59874ce3fc64de74737` (`forgejo/master` at planning time). Do not edit SPEC/EVALUATION/BUILDPLAN/DESIGN/PHILOSOPHY/USER_STORIES.
- Keep public pages server-rendered and anonymous. Mount page routes explicitly from the Worker composition root; keep API routes in a `*.routes.ts` module so the generated manifest and OpenAPI document discover them.
- Use the existing `roomDisplayLabel(room, building)` helper for every public room label. Public queries select only room/building names; AV capabilities, room notes, building access notes, coordinates, private emails, and authenticated session data never enter the public view model.
- Define the public URL slug from the published title/person name with deterministic ID fallback for collisions. Resolve a permalink by first selecting the published agenda/session set; a private or scheduled-but-unpublished record is therefore indistinguishable from a missing record before any private fields are loaded.
- The event selector defaults to the first live event (demo event first) and accepts an explicit event slug for tests/embeds. Public API policies use `auth.kind = public`; embeds never read `mq_session` and cache keys contain no identity dimension.
- Embed cache entries use a 30-second TTL and an exported event/slug purge helper. The helper is the publish seam for the agenda writer; tests exercise it directly until the agenda publish writer lands.

### Implementation sequence

1. **Public data seam and page composition**
   - Add the published-only query/view-model and slug helpers under `src/lib/public-site.ts`.
   - Add SSR Preact surfaces under `src/ui/public/agenda/` for the agenda, session permalink, and speaker permalink, with inline Flight Deck treatment and fixed-width/reserved filter/list geometry at 375px.
   - Add `src/routes/public-agenda.route.tsx` for `/agenda`, `/s/:slug`, and `/p/:slug`. Add generic 404 responses whose body contains no requested slug, ID, title, or abstract.
   - Mount the public page routes in `src/index.ts` and teach `src/ui/app.tsx` to leave SSR public markup in place while still loading shared tokens/component CSS.

2. **Public API and traceable route registration**
   - Add `src/routes/public.routes.ts` with anonymous GET handlers for `/api/v1/public/agenda`, `/api/v1/public/sessions/{slug}`, and `/api/v1/public/speakers/{slug}`. Include published-only data, day/track/search filters, cross-links, and the `Room · Building` label in the response shape.
   - Build and inspect the generated manifest/OpenAPI document to prove every new API path is present and no route bypasses the `*.routes.ts` glob.

3. **Embeds**
   - Add `src/ui/embeds/` surfaces for the configuration screen and compact agenda/speaker-gallery iframe views. The config screen emits a copyable iframe snippet and live preview; track, status, and color controls remain stable while the preview updates.
   - Add `src/routes/embed.route.tsx` for `/embed/config`, `/embed/{slug}`, and the prototype-compatible event/kind alias. Add `/api/v1/public/embeds/{slug}` to the public API module. Filter only the already-published set, apply configured colors, set `Cache-Control: public`, and use KV `expirationTtl: 30`.
   - Export and test the explicit purge helper for all event embed keys; document its intended call from the publish mutation without changing the agenda ticket's files.

4. **AC evidence and self-review**
   - Add AC-tagged tests under `tests/` covering AC-83–AC-90, AC-240, AC-252, and AC-253. The leak tests must assert both status and absence of the unpublished ID, title, and abstract in every response body (HTML and API), including guessed session and speaker permalinks.
   - Add `tests/ac-claims/MRQ-22.json` mapping the auto ACs to the new test files and their runtime/live evidence. Keep claims truthful: a local speed probe is not a deployed cold-load result.
   - Run TypeScript checks, production build, `check:design`, `npm test`, `trace:ac`, and `check:api`; then run `npm run pr-gate -- --ticket MRQ-22` and preserve its result in the completion comment.
   - Bump `in_validation`, run Wrangler dev plus anonymous curl probes for agenda/permalinks/embeds, mutate a published fixture and prove the purge/freshness path, and measure five cold public loads plus a clean-context embed refresh. Attach validation evidence before `pr_open`.

### Non-goals

- No authenticated admin agenda builder, publish mutation, calendar feed, or media/headshot pipeline is implemented here.
- No public AV capability, room-note, access-note, coordinate, email, or session-cookie leakage is acceptable.
- No contract document or seed venue set is edited.
