# MRQ-75: Public widgets: sessions + CFP embed kinds, speaker layouts, and the protected re-band

## Context

Collaborator flagged that the competition rubric weights **Public Widgets** as a joint-heaviest
area while embeds sat in the cuttable Tier B band. Client ruling 2026-08-11: protect and widen.
Binding prototype **v1.10** (`prototypes/pipeline-v1.1/index.html`, `showEmbedModal()` around
line 2832) already shows the four-format dialog; `sequence/USER_STORIES.md` Amendment 18 already
mints AC-217/218 into live scope and AC-273/274 onto US-58 — both are read-only inputs, not
touched here.

Builds on MRQ-22 (merged): `src/routes/embed.route.tsx`, `src/ui/embeds/EmbedPage.tsx`,
`src/lib/public-site.ts` embed layer, `/embed/:slug`, `/embed/config`, the legacy
`/:eventSlug/:kind/embed` route, `/api/v1/public/embeds/:slug`, KV 30s TTL + purge-on-publish.

## Prototype dialog contract (read from `showEmbedModal()`, prototypes/pipeline-v1.1/index.html:2832-2862)

- Four-format segment, equal flex widths: `Agenda | Sessions | Speakers | Call for speakers`
  (`kind` values `agenda|sessions|speakers|cfp`).
- Track select **always rendered**; `disabled` only for `cfp` ("Not applicable — the block
  promotes the whole call"). Never removed from the DOM.
- Layout segment (`Cards | List`) **always rendered**; `disabled` unless `kind === "speakers"`.
  Never removed from the DOM. This is the "elements never jump" rule from `DESIGN.md`/global
  CLAUDE.md applied literally — the prototype disables, never hides, both controls.
- Snippet query params: `track` omitted when `kind === "cfp"`; `layout=list` included only when
  `kind === "speakers" && layout === "list"` (cards is the unparameterized default).
- Per-kind live preview text differs in shape, not just content: agenda is time-led
  (`HH:MM · Title`), sessions is title-led with a track name and day/time
  (`Title · Track · Day HH:MM`) and deliberately omits room/speakers, speakers renders
  cards or a name–affiliation list depending on layout, cfp renders open/closed state + formats
  + a submit CTA.

## Existing implementation to extend (not fork)

- `embedSlug(event, kind)` / `snippet()` in `src/ui/embeds/EmbedPage.tsx` — canonical snippet URL
  is `/embed/{eventSlug}-{kind}` (already an intentional divergence from the prototype's literal
  `/{event}/{kind}/embed` text, preserved only as a back-compat route). Extend both to the two
  new kinds and to `layout`.
- `PublicEmbedConfig.kind` / `ResolvedPublicEmbed.kind` / `PublicEmbedData.kind` in
  `src/lib/public-site.ts` are inline `"agenda" | "speakers"` unions in five places — widen all
  five to reuse `EmbedKind` from `src/db/schema.ts` (already exists, already unused — genuine
  simplification, not scope creep, since every one of those lines is touched anyway).
- `EMBED_KINDS` const in `src/db/schema.ts:103` — widen to
  `["agenda", "sessions", "speakers", "cfp"]`.
- `embeds.kind` CHECK constraint in `migrations/0001_init.sql:693` — `CHECK (kind IN ('agenda',
  'speakers'))`. The table is never seeded/written by any current code path (grepped — zero
  `INTO embeds` in `scripts/`), so this is inert today but is a real latent bug for whenever an
  admin config surface starts writing rows, and SPEC's own field-with-no-writer rule (§3 preamble)
  argues for keeping the schema honest now rather than later. New migration
  `0006_embed_widget_kinds.sql` rebuilds the table (SQLite can't ALTER a CHECK constraint) —
  standard create-new/copy/drop/rename, safe given zero rows exist in any environment.
- Existing route surfaces to extend, not duplicate: `embed.route.tsx`'s `/embed/config`,
  `/embed/:slug`, and `/:eventSlug/:kind/embed`; `public.routes.ts`'s
  `GET /api/v1/public/embeds/:slug`.

## Design-fidelity call (documented, not re-litigated)

The binding prototype's dialog is a client-side JS modal overlay on the public agenda SPA route.
The **shipped product's public routes are server-rendered with hydrated islands** (SPEC §2.2), and
MRQ-22 already chose a full navigable page (`/embed/config`) over a modal — already accepted
upstream: `EVALUATION.md` AC-87's verification text says "config **screen**", written before this
ticket. This ticket reproduces the dialog's *controls, states, and URL contract* one-to-one
(four-format segment with equal widths, disable-never-hide track/layout, exact query-param rules,
per-kind live preview) inside that same screen rather than reopening the screen-vs-modal choice.
Not a deviation — inheriting a prior ruling.

## Tier ruling for the four new ACs (deviate-with-flag candidate — see below)

`EVALUATION.md` §7 states AC-170–224 is "the only contiguous ID range that maps cleanly to a
tier" (post-competition). AC-217/218 sit inside that range but Amendment 18 explicitly promotes
US-16 to live in-scope — so §7's claim needs a carve-out edit regardless of tier choice, or it
becomes self-contradictory the moment this PR lands.

For where AC-217/218/273/274 land (Tier A vs Tier B): neither the ticket text nor
`USER_STORIES.md`'s "Scope at a glance" table (frozen at 2026-08-08 consolidation, already stale
by several amendments) states it explicitly. Reasoning to Tier A:
- The client ruling is literally "protect and widen" — Tier B is "cut from the bottom, a cut
  must be named" (EVALUATION.md line 12), i.e. still cuttable. Landing the new criteria in Tier B
  would leave the *widened* half of the widget family exactly as cuttable as before the ruling,
  contradicting "protect."
- AC-87–90 (US-58's original criteria) are already Tier A by numeric range (`AC-1–90`) and the
  ticket text says to note them "protected (no-cut)" in SPEC. Grouping (not ID arithmetic) is
  EVALUATION.md's own stated membership rule (§2 preamble) — AC-273/274 append to the same US-58
  story block, so they inherit its section placement physically.
- Precedent: Amendment 10 promoted AC-264-269 (webhook/task-cancellation states) to Tier A with
  an explicit one-line "Rank" justification ("US-80 and US-81 are Tier A ... closes behaviour an
  existing Tier A criterion already required") rather than defaulting new criteria to Tier B.

**Flagging this as the ticket's one real judgment call.** Contract conflicts are the Orchestrator's
to resolve, not mine (COMMON.md) — I'm implementing Tier A for all four, will say so plainly in
the completion comment, and the Orchestrator can override without touching build code if it
disagrees (this is a contract-doc-only reclassification).

## Contract mechanical folds

### `SPEC.md` — Amendment 18 (next free number; last is Amendment 17)
- §3.10 `embeds` row: widen `kind ∈ agenda\|speakers` to `agenda\|sessions\|speakers\|cfp`.
- §5.12: rewrite the embed-dialog paragraph for the four formats + track/layout params; keep the
  anonymous-only paragraph verbatim (still true, still asserted under A-5).
- Append `## Amendment 18` section at file tail: four formats, layout param, anonymous-only
  reaffirmed, **AC-87–90 explicitly named protected/no-cut now MRQ-22 is merged**, AC-217/218/
  273/274 declared Tier A with the reasoning above, pointer to `USER_STORIES.md` Amendment 18 and
  this ticket.

### `EVALUATION.md`
- Tier table (lines 9-14): Tier A row's AC list gains `AC-217, AC-218, AC-273, AC-274`; count
  102 → 106. Line 7 "203 live criteria" → 207. Line 119 "206 live in-scope criteria" → 210 (both
  header counts +4, per ticket text; pre-existing 203-vs-206 drift between the two lines is not
  mine to reconcile — bumping both by the same +4 preserves whatever relationship already held).
- New `**US-16 · Promote the call with a live block**` block inserted into §2 Tier A, directly
  after the existing `**US-58 · Embed the schedule and speaker gallery**` block (before the Tier B
  header) — two `auto` rows, AC-217/AC-218.
- US-58's existing table gains two rows appended after AC-90: AC-273, AC-274 (`auto`).
- §6 row 2 (Discord Q2): change "Open." to "**Closed, resolved-built** — MRQ-22 merged, MRQ-75
  widened the family to four kinds and protected all of it from the cut line; Q2's strikethrough
  is overridden by the shipped video." Tier A no-waiver set is unaffected by removing this row's
  openness since AC-87-90 were already in that set by range.
- §7: the post-competition paragraph's "only contiguous ID range" claim gets a one-clause carve-
  out: "...except AC-217–AC-218, promoted to live scope by Amendment 18."
- Amendment log: append `**Amendment 11 — public widgets widened, 2026-08-11, client-directed.**`
  mirroring the Amendment 9/10 style (exact before→after counts, ACs folded, tier justification
  one-liner, ticket reference).

### `BUILDPLAN.md` — Amendment 11 (next free; last is Amendment 10)
- One milestone, next free M-number (M-64; highest used is M-63), ~5h, dep `M-21` (embeds,
  MRQ-22 merged). Table row mirrors the M-57..M-63 style: ticket description, AC list
  (AC-217, AC-218, AC-273, AC-274), hours, deps.
- "Rank" paragraph: same reasoning as the EVALUATION Tier ruling above, one line.

## Code changes

### `migrations/0006_embed_widget_kinds.sql`
Rebuild `embeds` table with `CHECK (kind IN ('agenda','sessions','speakers','cfp'))`; preserve
both indexes.

### `src/db/schema.ts`
`EMBED_KINDS = ["agenda", "sessions", "speakers", "cfp"] as const`.

### `src/lib/public-site.ts`
- Import/reuse `EmbedKind` from `../db/schema` everywhere the inline union currently appears
  (`PublicEmbedConfig`, `ResolvedPublicEmbed`, `PublicEmbedData`, `EmbedRow`, `parseEmbedConfig`,
  `inferEmbedKind`, `resolvePublicEmbed`'s request type).
- `inferEmbedKind`: add `-sessions` / `-cfp` slug suffixes (and bare `sessions`/`cfp`).
- `PublicEmbedConfig`/`PublicEmbedData`: add `layout: "cards" | "list" | null`.
- New `PublicEmbedCfp` interface: `{ formSlug, formName, status: "open"|"closed", closesAt,
  formats: string[], url }`.
- `loadPublicEmbed`: branch early on `resolved.kind === "cfp"` → new `loadPublicCfpEmbed` (queries
  the event's primary non-draft form — `status='open'` preferred, else most recent — plus
  `formats` catalog; reuses `publicFormIsClosed` already exported from
  `src/routes/public-form.shared.ts` for the auto-flip); everything else (`agenda`, `sessions`,
  `speakers`) keeps calling `loadPublicAgenda` unchanged, adding a `layout` passthrough only
  relevant to `speakers`.
- `sessions` kind reuses the exact same session/track query as `agenda` (ticket text: "same
  KV cache/purge path") — the only difference is presentational (EmbedPage), not data-layer.
- `publicEmbedCacheKey`: include `layout` in the key tuple so cards/list don't collide.

### `src/routes/embed.route.tsx`
- `readEmbed`: accept `kind: EmbedKind`, pass `layout` through to `loadPublicEmbed`/cache key.
- `/embed/config`: accept `kind=sessions|cfp` in addition to `agenda|speakers`; default preview
  wiring unchanged.
- `/:eventSlug/:kind/embed` legacy route: widen the kind match from `speakers|agenda` to all
  four.

### `src/routes/public.routes.ts`
- `publicQuery` zod schema: add `layout: z.enum(["cards","list"]).optional()`.
- `getPublicEmbed`: pass `layout` into `filters`.

### `src/ui/embeds/EmbedPage.tsx`
- `embedSlug`/`snippet`: widen `kind` type; snippet omits `track` param for `cfp`, includes
  `layout=list` only for `speakers` + list (mirrors prototype's param-omission rules exactly).
- `EmbedPage` (the rendered iframe body): add a `sessions` branch — flat rows of
  title/track-chip/time only (no room, no speakers) — and a `cfp` branch — open/closed state line,
  formats list, `Submit a proposal →` CTA linking to `/f/:slug` when open, closed copy with no CTA
  when not. `speakers` branch gains a `layout` check: existing card grid when `cards`/default, a
  compact name–affiliation list (`<ul>`) when `list`.
- `EmbedConfigPage` (the "dialog" screen): replace the single `Surface` `<select>` with a 4-button
  equal-width segment (`agenda|sessions|speakers|cfp`, labelled `Agenda|Sessions|Speakers|Call for
  speakers`); Track `<select>` gets `disabled={kind === "cfp"}` plus the swapped note text
  (min-height reserved so the note swap doesn't shift layout — global CLAUDE.md "elements never
  jump" rule); add a Layout segment (`Cards|List`) with `disabled={kind !== "speakers"}` and its
  own note swap, same fixed-position treatment.
- `EMBED_CONFIG_SCRIPT`: extend the client-side snippet/preview-URL builder for the two new kinds
  and `layout`, matching the server-side `snippet()` param rules exactly (single source of param
  logic conceptually, duplicated only because one runs in a `<script>` string and one in Preact —
  matches the existing pattern for agenda/speakers already in this file).
- New CSS: `.embed-format-segment` (flex row, equal-width buttons, same visual language as
  `.public-days button` in `PublicAgendaPage.tsx` — border/background swap on `.active`, disabled
  state dims + `cursor: not-allowed`), reusing `--public-accent`/`--public-rule` tokens already in
  scope via `PUBLIC_SITE_STYLES`.

### `src/ui/public/agenda/PublicAgendaPage.tsx`
No change to the "Get embed code" link itself (still `/embed/config?...`) — confirmed inherited
from the screen-vs-modal ruling above.

## Tests (AC-tagged, hermetic — apply-migrations harness, no live network)

New file `tests/integration/public-embed-widgets.AC-217-218-273-274.test.ts`, modeled directly on
`tests/integration/public-site.AC-83-86-240-252-253.test.ts`'s fixture/harness style (D1 inserts,
`FakeEmbedCache`, `app.request`):
- **AC-273** — seed 2 published sessions across 2 tracks; hit `/embed/{slug}-sessions` and
  `/api/v1/public/embeds/{slug}-sessions`; assert flat list shape (title + track + time present,
  room/speaker markup absent), track filter narrows the set, `status` filter behaves like the
  agenda kind, and the response reuses the same 30s `Cache-Control`/KV path (assert cache key
  collision with a manually-computed `publicEmbedCacheKey` call, and that publish-purge clears it
  — same assertion style as the existing AC-89 test).
- **AC-274** — seed 2 published speakers; hit `/embed/{slug}-speakers?layout=list` and
  `?layout=cards` (and the default with no param); assert list renders name–affiliation rows
  without card markup and cards renders the existing grid; assert the snippet URL from
  `/embed/config?kind=speakers` carries `layout=list` only when list is selected (default omits
  the param); reuse the existing 375px/1440px responsive assertions.
- **AC-217** — seed an open form with `closes_at` in the future and 2 formats; hit
  `/embed/{slug}-cfp`; assert deadline, both format names, and a link to `/f/{slug}` are present;
  assert Track/Layout controls are `disabled` (not absent) in `/embed/config?kind=cfp`.
- **AC-218** — same fixture, then `UPDATE forms SET closes_at = <now - 1h>`; purge cache; re-fetch
  `/embed/{slug}-cfp`; assert closed copy renders and the submit CTA is gone, with **no republish
  action taken** (assert via direct re-fetch after cache purge, not via any admin write) — proves
  the flip is computed from `closes_at`, not stamped.
- One CONTRACT-style test (mirrors the file's last test) asserting the `cfp` and `sessions` embed
  routes stay anonymous with a tampered `mq_session` cookie, per SPEC §5.12 / A-5.

`tests/ac-claims/MRQ-75.json`: `{"ticket": "MRQ-75", "owns": ["AC-217","AC-218","AC-273","AC-274"],
"exercises": ["AC-87","AC-88","AC-89","AC-90"]}`.

## Validation (real, driven — not just green tests)

`wrangler dev` + c11 embedded browser (c11-browser skill):
1. Sessions kind filtered by track — open `/embed/config?kind=sessions`, switch track filter,
   confirm the live preview iframe updates.
2. Speakers in both layouts at 375px and 1440px — resize the c11 browser surface, screenshot both.
3. CFP kind open state, then flip the seeded form's `closes_at` into the past via a direct D1
   write (`wrangler d1 execute` against the dev DB) and reload the embed with no republish/redeploy
   step, to actually prove AC-218's "no republish" claim end-to-end rather than only at the unit
   level.
4. Four-format segment: click through all four, confirm Track/Layout controls disable (not
   disappear) at the right moments and nothing else on the page shifts position.

## Order of work

1. This plan → commit → push (first commit, per COMMON.md).
2. Migration + schema.ts + public-site.ts data layer (foundation everything else sits on).
3. Route layer (embed.route.tsx, public.routes.ts).
4. UI layer (EmbedPage.tsx kinds + EmbedConfigPage dialog reproduction).
5. Tests + ac-claims.
6. Contract folds (SPEC/EVALUATION/BUILDPLAN) — last, since exact counts depend on final AC
   placement decisions above, but the decisions themselves don't depend on code.
7. `npm run pr-gate -- --ticket MRQ-75`.
8. Validation pass (wrangler dev + c11 browser).
9. PR.
