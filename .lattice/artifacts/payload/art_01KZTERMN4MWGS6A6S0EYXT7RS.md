# Code Review: MRQ-121 — Public speaker directory

Reviewed at `Marquee-worktrees/mrq-121-speaker-directory` @ `98eee1d` (3 commits: `176f730`, `56f609f`, `98eee1d`).

**Verification run during review**
- `npx tsc --noEmit` → exit 0, clean.
- `npx vitest run tests/integration/public-site.AC-83-86-240-252-253.test.ts` → **9 passed**, 11.5s (machine load was 127 at the time; the file still ran comfortably inside budget).

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and almost all of it is executed cleanly. One CSS selector regression shipped in the embed list layout: turning the row into an anchor inside a new `<li>` wrapper made `.embed-speaker-row:last-child` match *every* row, silently deleting all separators from the list-layout speaker embed. It is a one-line fix. Everything else below is minor.

## 2. Summary

Reviewed a new SSR `/speakers` directory (loader, route, page, styles), the embed speaker anchors, and the integration coverage. Quality is high: the loader reuses the existing published/public-audience projection rather than inventing a new enumeration path, the route is a byte-for-byte match with the sibling public routes, and the search/dedupe/event-preservation resolutions from the plan-review cycle are all honored and tested. The key finding is a visual regression in `EMBED_STYLES` caused by the markup change (`li > a.embed-speaker-row` instead of `li.embed-speaker-row`), which no test covers because the tests assert markup, not styling.

## 3. Issues

```
**[MAJOR] src/ui/embeds/EmbedPage.tsx:45 — `:last-child` now matches every list row, erasing all separators**
The list layout used to render `<li class="embed-speaker-row">`, so `.embed-speaker-row:last-child { border-bottom: 0 }` correctly stripped the border from the final row only. Line 170 now renders `<li><a class="embed-speaker-row">…</a></li>`, so every anchor is the only (hence last) child of its `<li>` and the rule fires on all of them. Result: the speaker-list embed loses every row divider — the rule that shapes the whole layout is now dead in the opposite direction. The new test asserts the anchor markup, so it passes while the rendered widget is wrong, and DESIGN.md treats the prototype as binding.
**Fix:** scope the selector to the wrapper — `.embed-speaker-list li:last-child .embed-speaker-row { border-bottom: 0; }`. (Alternative: keep `class="embed-speaker-row"` on the `<li>` and make the anchor a plain `display: contents`/block child — but the selector change is the smaller edit.)
```

```
**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:311 — structural cast defeats the type check on the MRQ-122 seam**
`speaker as PublicSpeakerSummary & { headshotUrl?: string | null }` is the only reason the `<img>` branch compiles: `PublicSpeakerSummary` (src/lib/public-site.ts:42) has no `headshotUrl`, and `parseSpeakers` (:290) never produces one, so on this branch the branch is unreachable and untested. The cast is exactly the construct that would have hidden a naming mismatch with MRQ-122 — as it happens MRQ-122 does land `headshotUrl: string | null` (its `src/lib/public-site.ts:50`), so the two agree, but nothing in the compiler was checking that. Once both merge the cast is dead weight that permits future drift.
**Fix:** declare `headshotUrl?: string | null` on `PublicSpeakerSummary` here and drop the cast, so MRQ-122's producer typechecks against a declared field; or open a follow-up to delete the cast the moment MRQ-122 merges.
```

```
**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:335-341 — the directory search has no submit affordance and no auto-submit**
The agenda form carries `data-public-agenda-filters` and the route injects `PUBLIC_AGENDA_SCRIPT` (:126), giving it 180ms-debounced auto-submit. The directory form has neither, and no submit button. It still works — a single-text-input GET form submits on Enter — but nothing on screen says so, and the two search boxes look identical while behaving differently. Against R7 ("speed is a feature") and the shared `.public-filters` visual language this reads as an unfinished control.
**Fix:** either add `data-public-agenda-filters` to the form and pass `{ title: "Speakers", script: PUBLIC_AGENDA_SCRIPT }` in the route (the script's day-preservation path no-ops safely with no `.public-days` and no `day` param), or add a visible `<button type="submit" class="public-button">Search</button>` to the grid.
```

```
**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:313 — redundant alt text on a decorative headshot**
`alt={`${speaker.name} avatar`}` sits immediately next to an `<h2>` containing the same name, so a screen reader announces "Public Speaker avatar, Public Speaker". The initials fallback on the next line correctly uses `aria-hidden="true"` — the two halves of the same slot disagree about whether the avatar is content.
**Fix:** `alt=""` on the `<img>`, matching the fallback's `aria-hidden`.
```

```
**[MINOR] src/lib/public-site.ts:526-532 — the SQL prefilter and the JS filter fold case differently, so non-ASCII names are unsearchable**
The JS predicate uses `toLocaleLowerCase()` (Unicode-aware); the SQL `speakerMatch` uses SQLite `lower()` + `LIKE`, both ASCII-only. Searching "öde" for a speaker named "Ödegaard" never selects the session at the SQL layer, so the JS filter never sees them — a silent empty result on a page whose entire purpose is name search. This is inherited from the pre-existing agenda search rather than introduced here, but the directory makes name matching the primary interaction.
**Fix:** out of scope for this ticket — worth a follow-up (normalize/`NFD`-strip diacritics into `search_blob`, or add a normalized `people.name_fold` column). Flagging so it is a decision rather than a surprise.
```

```
**[MINOR] src/lib/public-site.ts:277 — speaker slugs have no collision suffix, and the directory is what makes that visible**
`publicSpeakerSlug()` is name-only. `toPublicSessions` (:468-471) dedupes colliding *session* slugs with an id suffix; speakers get no equivalent, and `loadPublicSpeaker` (:562-567) resolves by first match. Two speakers named "John Smith" therefore render two cards in the grid with identical `href`s, both landing on the same profile. Pre-existing, but a directory that enumerates every speaker is precisely the surface where it becomes systematic and clickable.
**Fix:** out of scope here (it changes existing `/p/:slug` URLs). File the follow-up; the fix mirrors the session-slug dedupe already in `toPublicSessions`.
```

```
**[MINOR] tests/integration/public-site.AC-83-86-240-252-253.test.ts:170 — the privacy assertion after the mutation is vacuous**
Line 158 repoints `par-private` at `person-public`, so `person-private` no longer participates in anything; `expect(directoryBody).not.toContain(PRIVATE_SPEAKER)` at :170 can no longer fail for the reason it names. The genuine published-only check is the :151-154 block (unpublished agenda item, `q=Private Co`), which is good — but the unfiltered directory is never asserted against an unpublished speaker.
**Fix:** add one line before the mutation: request `/speakers?event=${EVENT_SLUG}` and assert it contains "Public Speaker" and not `PRIVATE_SPEAKER`. That is the real privacy contract, and it costs one request.
```

```
**[MINOR] tests/integration/public-site.AC-83-86-240-252-253.test.ts:182,187 — assertions couple to JSX attribute order**
`'class="embed-speaker" href="/p/public-speaker?event=public-conf"'` breaks if anyone reorders the props on the anchor, which is not behavior. The `href` alone (already asserted for the directory at :168) carries the contract.
**Fix:** assert `'href="/p/public-speaker?event=public-conf"'` plus, if the layout distinction matters, a separate `toContain('class="embed-speaker-row"')`.
```

```
**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:325,366 — the directory is a one-way door**
`/speakers` links out to `/agenda`, and `/agenda` links in — but `/p/:slug` and `/s/:slug` still back-link only to Agenda. A visitor who arrives at a profile from an embed speaker card (the new anchor this ticket adds) has no path to the directory at all. The plan committed only to the agenda link and explicitly deferred a modal, so this is within the letter of the scope; it is still a discoverability gap in the flow this ticket created. Separately, `/speakers` is absent from the cold-page list in `scripts/checks/speed.ts:325`, so the new surface has no R7 budget.
**Fix:** consider `← Speakers` on `PublicSpeakerPage` (or a second action button beside `← Agenda`), and add `/speakers?event=aie-ny-2026` to the speed check's cold-page sample. Both are cheap; neither blocks the PR.
```

## 4. Positive Observations

- **The privacy resolution is real, not asserted.** `loadPublicSpeakerDirectory` builds on `sessionRowsQuery`, so it inherits `ai.is_published = 1`, `s.status NOT IN ('rejected','withdrawn')`, and `participantAudienceFilterSql(..., "public")` for free. No new `people`-table enumeration path exists — which is the single most important thing about adding a public directory, and the diff gets it right by construction rather than by remembering to filter.
- **The `speakerOnly` branch is the minimal correct change.** Factoring `speakerMatch` out and reusing it in both arms keeps the agenda's search semantics byte-identical (verified: the non-`speakerOnly` clause and its five bindings are unchanged) while making the directory's honesty guarantee — a title match cannot surface an unrelated speaker — a property of the SQL rather than a convention.
- **Two-layer search is correct and non-obvious.** The SQL narrows to sessions containing *a* matching public participant; the JS pass then drops that session's non-matching co-speakers. Either layer alone would be wrong (SQL alone over-includes co-speakers; JS alone would scan everything). The diff does both without commenting on it, and it holds.
- **Event preservation is threaded end to end** — directory cards, the embed cards, and the embed list all carry `?event=`, and the tests assert the literal hrefs. The multi-live-event failure the plan-review flagged genuinely cannot happen through these paths.
- **The route is indistinguishable from its siblings** — same `assetShell` → `notFoundDocument` → `no-store` → `renderPublicDocument` sequence as `/agenda`, `/s/:slug`, `/p/:slug`. A reader who knows one knows this one. `wrangler.jsonc`'s `run_worker_first` and `app.tsx`'s `isPublicPage` were both updated, which is the pair of registrations that is easy to half-do and would have produced a confusing SPA-hydration bug on the live site only.
- **The empty states are truthful and distinct** — "No published speakers match" with an event-preserving one-click reset vs. "No published speakers yet" pointing at the agenda. That distinction is exactly the taste rule PHILOSOPHY.md asks for, and it is tested.
- **Test naming carries its contract** (`CONTRACT · MRQ-121 · EMB-05/12/13/14 · …`), and the dedupe case is exercised through a real DB mutation rather than a hand-built fixture.
