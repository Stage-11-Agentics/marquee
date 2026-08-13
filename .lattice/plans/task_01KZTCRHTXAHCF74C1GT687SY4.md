# MRQ-120: Public session cards, facets, agenda framing

EMB-01 (w3), EMB-09 (w2), EMB-03 (w2), de-risks EMB-06 (w3). NO new data needed except Format. (1) Card anatomy on public agenda + embed session/agenda kinds: SERVER-TRUNCATED 2-3 line description snippet (speed budget AC-85 pins agenda-cold-interactive — do not ship full abstracts) with details-element Show more (pages are SSR strings; zero JS); speaker job title/company (already in the projection, pure render); FORMAT — the public data model does not carry it at all; add the formats join + field to PublicSession (without Format, EMB-01 caps at partial). (2) Facets: Format + Location/room selects beside Track (two WHERE clauses in sessionRowsQuery; rooms already joined). Inline selects satisfy the rubric — NO facet modal. (3) Agenda framing: default to day 1 (or sticky time-group headers under All days) — EMB-06 PASSES on a time-slotted list per its own pass_criteria; the room-column grid earns ZERO and is out of scope. (4) Emit stable per-card hooks (data-public-session-id exists) as the contract for any future client module. Full spec: section T-I. Register rows 33,34,39.

---

## Plan (delegator, 2026-08-12)

Working against `github/main @ 23a06b0`. Worktree `../Marquee-worktrees/mrq-120-public-cards`, branch `mrq-120-public-cards`.

### Ground truth read

- Rubric YAML `.eval-kit/specs/06-public-widgets.yaml`: EMB-01 (w3, needs title + truncated description + Show more expanding **in place** + date/time + room + speaker with job title and company + **Format and Track**), EMB-03 (w2, Track facet passes; **full credit requires Format and Location/room too**), EMB-06 (w3, "a clearly time-slotted list is acceptable"), EMB-09 (w2, "day tabs **or day sections**… time-group headers are ideal", cards carry the complete speaker list with titles and companies), EMB-08 (w2, session detail must show Format and Track).
- Code: `PublicSession` (src/lib/public-site.ts:52) carries `abstract`, speakers with `title`/`company`, `tracks`, `roomLabel` — but **no format and no room id**. `sessionRowsQuery` (:309) already joins `rooms`; `formats` is joined nowhere on the public path. Agenda cards (`PublicAgendaPage.tsx:246`) render title + speaker names + track chips only — no description, no titles/companies, no format.
- Seed: `formats` has four rows (Stage Talk / Workshop / Lightning / Online, `scripts/seed/event.ts:101`); `submissions.format_id` is set for all but the last two pool rows (`scripts/seed/pool.ts:287`, deliberate malformed rows) — so **null format must render honestly, not crash or lie**.

### Decision 1 — agenda framing: day/time section headers, NOT a day-1 default

The ticket offers either. I take the **headers** branch, because the all-days default is a *ratified* prior decision with a contract test:
`tests/integration/public-site.AC-83-86-240-252-253.test.ts:170` — "CONTRACT · MRQ-94 · the public agenda defaults to all days". Flipping the default would delete a merged contract to buy framing I can get without it. Sticky **day-group headers plus time-group headers** give EMB-06 its "clearly time-slotted list", give EMB-09 its literal "day sections" alternative, keep deep links stable, and keep the existing day tabs (EMB-07) working. Flagged in the PR body as the branch taken.

### Decision 2 — bounded expansion, not full abstracts

AC-85 pins `agenda-cold-interactive` p95 ≤ 1000 ms and the register says do not ship full abstracts. Real seeded abstracts come from conference source data and are unbounded. So: server-side `snippetOf(text)` → `{ head, rest, truncated }` with `head` ≈ 180 chars at a word boundary and `rest` capped so head+rest ≤ 640 chars. `<details><summary>Show more</summary>` holds `rest` — expansion is in place and zero-JS, satisfying EMB-01. When the abstract exceeds the cap, the expanded body ends with a "Read the full abstract →" link to `/s/:slug` rather than silently presenting a truncation as the whole thing (honest-over-cheap: the judge and a human both see where the text stops).

### Work

**A. Data (`src/lib/public-site.ts`)**
1. `PublicFormat { id, name }`; `PublicSession.format: PublicFormat | null`; `PublicSession.roomId: string`; `PublicSession.endTime: string` (EMB-08 wants a full start–end range; `durationMin` already exists).
2. `sessionRowsQuery`: `LEFT JOIN formats fmt ON fmt.id = s.format_id AND fmt.event_id = s.event_id`; select `fmt.id`, `fmt.name`, `ai.room_id`. Two new WHERE clauses — format (`s.format_id = ?` OR `lower(fmt.name) = lower(?)`) and room (`ai.room_id = ?` OR `lower(room.name) = lower(?)`), mirroring the existing track clause's id-or-name tolerance so a human-typed URL works.
3. `loadFormatCatalog` / `loadRoomCatalog` beside `loadTrackCatalog`; `PublicAgendaData.formats` / `.rooms`; `filters.format` / `filters.room`. Room labels respect the existing venue-disclosure rule (`roomDisplayLabel` only when the comparison is shown) — no operator venue data leaks (AC-253).
4. `PublicAgendaFilters` gains `format`, `room`. `loadPublicEmbed` accepts and forwards them; `publicEmbedCacheKey` includes them (a facet not in the key serves the wrong list from cache).
5. Exported `publicAbstractSnippet(text)` helper.

**B. Routes** — `public-agenda.route.tsx` passes `format`/`room` through; `public.routes.ts` adds `format`/`room` to `publicQuery` and forwards on agenda + embed. Payload schema is `z.any()`, so added fields are non-breaking. No new route modules → no `check:api` surface change.

**C. Agenda render (`src/ui/public/agenda/PublicAgendaPage.tsx` — T-I owns this file per §4 rule 5)**
- Card: time column shows **day + start–end + room** (the day label always renders now, not only under "All days" — a fixed slot, so nothing jumps between filter states). Title link unchanged. Speakers become `Name — Title, Company`. New: snippet paragraph + `<details>` Show more. Chip row: **Format chip first, then track chips** (`—` when format is null).
- Facets: Track + Format + Location selects, inline in the existing SSR GET form. No modal. Search unchanged. Day tabs unchanged.
- Sections: day group header (only meaningful in the multi-day/all-days view) and time-group headers inside each day.
- Per-card hooks: keep `data-public-session-id`; add `data-public-session-slug`, `data-public-session-start`, `data-public-session-day`. This is the documented contract a future star/personal-schedule module binds to (T-J), so that work is a script module rather than an edit to this tree.
- `hasFilters` learns about format/room so the empty-state stays truthful.
- Session detail page: Format joins the meta line (EMB-08) and start–end replaces the bare start.
- Elements-never-jump: reserve `min-height` for the snippet block and the chip row; the facet row keeps fixed grid columns at every breakpoint; `<details>` expansion is the user's own action on that card.

**D. Embed render (`src/ui/embeds/EmbedPage.tsx`)** — agenda and sessions kinds get the same anatomy (snippet + Show more, speaker title/company, Format chip, room). Embed control row gains Format and Location selects beside Track/status.

**E. Tests** — new file `tests/integration/public-cards-facets.MRQ-120.test.ts` (own file; no collision with the shared AC-83–86 file, which I leave alone except where an assertion is genuinely invalidated). Coverage: format joins and renders; null format renders `—` and does not crash; snippet truncation + `<details>` present and the untruncated case has no Show more; speaker title/company on cards; format facet and room facet each narrow the list, by id and by name; combined facets; day + time group headers; hooks present; empty state honest under a facet; embed cache key varies by format/room. Plus `tests/ac-claims/MRQ-120.json` (`owns: []` — no new AC minted; `exercises` the public-site ACs).

### Risks

- The AC-85 assertions in the existing test file pin literal CSS strings (`min-height: 430px`, `@media (max-width: 460px)`); keep both rules present.
- MRQ-94's contract test asserts `class="public-day">Mon, Oct 12</span>` under the default view — the day label stays in that element with that class.
- Fleet load: targeted vitest only; `uptime` check before the gate.

### Self-review of this plan

Adversarial read of my own plan, before implementing:
1. *Does anything here let a caller reach unpublished data?* The two new WHERE clauses are additional restrictions on an already published-only query, and the new catalogs are event-scoped taxonomy (`formats`, `rooms`), never session content. Room catalog must be built from the same venue-disclosure rule as the labels, or the facet becomes a channel that leaks a building name the labels are suppressing — explicitly handled in A.3.
2. *Does the snippet leak the private abstract?* No — truncation happens after the published-only filter; AC-86's leak assertions still bind and the new test re-asserts them under a facet.
3. *Is the cache-key change complete?* `publicEmbedCacheKey` is the only key builder and `purgePublicEmbedCache` purges by prefix `public-embed:<eventId>:` — adding trailing key parts stays inside that prefix, so purge still sweeps every variant.
4. *Does the format facet lie when `format_id` is null?* Selecting a format excludes null-format sessions, which is correct; the "All formats" default includes them, and the card renders `—`. No silent disappearance.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **MAJOR — rendered embed route omitted:** Accepted. `src/routes/embed.route.tsx` is part of the route work: `format` and `room` are parsed and forwarded on `/embed/config`, `/embed/:slug`, and the legacy `/:eventSlug/:kind/embed` path. The implementation test will exercise a filtered rendered embed, not only the cache-key helper.
- **MINOR — generated API registry hash:** Accepted. Adding `format` and `room` to `publicQuery` changes the served OpenAPI document hash even though the operation list is unchanged. Regenerate `cli/api-registry.json` with `node cli/generate-api-registry.mjs`; never hand-edit the generated artifact.
- **MINOR — helper naming:** Accepted. `publicAbstractSnippet` is the single exported helper name used by agenda and embed renderers and their tests.

## Reset 2026-08-12 by agent:codex-mrq-120-land
