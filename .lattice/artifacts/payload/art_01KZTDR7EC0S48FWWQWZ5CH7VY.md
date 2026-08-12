# Plan Review: MRQ-120 — Public session cards, facets, agenda framing

Reviewed against the plan's declared baseline `github/main @ 23a06b0` (note: the primary checkout's working tree is behind that baseline; every citation below was verified against `github/main`, not the local tree).

## 1. Verdict

**PASS** — Implementation can proceed. Two findings below (one major, one minor) are correctable with small plan amendments during implementation; neither undermines the approach, the decomposition, or the rubric coverage.

## 2. Summary

The plan translates EMB-01/03/06/09 (and adjacent EMB-08) into a data-join + SSR-render change with a well-argued decision to keep the ratified all-days default and add day/time group headers instead of flipping to a day-1 default. Every ground-truth claim I spot-checked verifies exactly: `PublicSession` (public-site.ts:52) carries no format or room id; `sessionRowsQuery` (:309) inner-joins `rooms` and joins `formats` nowhere on the session path; the MRQ-94 contract test ("the public agenda defaults to all days", asserting `class="public-day">Mon, Oct 12</span>`) exists at tests/integration/public-site.AC-83-86-240-252-253.test.ts:147; the AC-85 CSS pins (`min-height: 430px`, `@media (max-width: 460px)`) are at :212–213; the seed has four formats and two deliberate null-format pool rows (`malformedNoFormat`, pool.ts:258/287); `purgePublicEmbedCache` purges by `public-embed:<eventId>:` prefix so trailing key parts are purge-safe. The key concern is a file-list omission: the rendered-embed route module (`src/routes/embed.route.tsx`) is not named in section B, and it is the surface EMB-03 actually judges.

## 3. Issues

**[MAJOR] Section B (Routes) — `src/routes/embed.route.tsx` is missing from the file list**
Section B names only `public-agenda.route.tsx` and `public.routes.ts`, but the rendered embed is served by a third module: `embed.route.tsx`. Its `readEmbed` helper parses `track`/`status`/`accent`/`layout` from the query, builds `publicEmbedCacheKey`, and calls `loadPublicEmbed` (:32–50); the `/embed/:slug` route (:90) and the legacy `/:eventSlug/:kind/embed` route both flow through it, and `/embed/config`'s preview call (:84) passes filters explicitly. If `format`/`room` aren't threaded through `readEmbed` and these routes, the new Format/Location selects in the embed control row (section D) render but don't narrow anything — and since `readEmbed` computes the cache key from its own filter object, the wrong-list-from-cache hazard the plan itself flags in A.4 recurs on exactly this surface. This is the widget surface EMB-03 grades, so the gap sits on the rubric-critical path. The plan's intent clearly covers it ("`loadPublicEmbed` accepts and forwards them"), but the named-files list is what an implementer executes against.
**Recommendation:** Add `src/routes/embed.route.tsx` to section B: extend `readEmbed`'s request/filter object with `format`/`room`, forward from `/embed/:slug` and the legacy embed route, and pass them into the `/embed/config` preview call. Add one integration assertion that `GET /embed/:slug?format=…` narrows the rendered cards (not just that the key builder varies).

**[MINOR] Section B — "no `check:api` surface change" is wrong at the hash level**
Adding `format`/`room` to `publicQuery` changes the served OpenAPI document, and `check:api` fails on `cli-registry-hash-mismatch` whenever `cli/api-registry.json`'s `documentSha256` differs from the served digest (scripts/checks/check-api.mjs:174–180) — even with the operations list unchanged. MRQ-94 hit exactly this and needed a registry-sync commit (`4f331ad`). An implementer trusting the plan's claim gets a red gate they weren't told to expect.
**Recommendation:** Amend the plan: the operations list is unchanged but `documentSha256` must be re-synced in `cli/api-registry.json` as part of the change (the same one-line sync MRQ-94 shipped).

**[MINOR] Sections A.5 / Decision 2 — snippet helper named inconsistently**
Decision 2 calls the helper `snippetOf(text)`; A.5 exports `publicAbstractSnippet(text)`. Same helper, two names — trivial, but worth unifying before the test file references one of them.
**Recommendation:** Pick one name (the exported `publicAbstractSnippet` reads better beside the other `public*` exports) and use it throughout.

## 4. Positive Observations

- **Ground truth is real, current, and precisely cited.** Every file:line, rubric quote, seed fact, and contract-test claim I checked verifies against the declared baseline sha. The plan even pins its baseline explicitly ("`github/main @ 23a06b0`"), which is what made this review's verification tractable — the local checkout is stale, and without the pinned sha the plan's citations would have looked fabricated.
- **Decision 1 is exactly the right call, argued from a contract, not taste.** The ticket offers day-1 default *or* headers; the plan chooses headers because flipping the default would delete the merged MRQ-94 contract ("defaults to all days," :147). It also correctly reads that the contract asserts the day label's *presence* under the default view but doesn't forbid it in single-day view, so "always render the day label" is compatible — and it satisfies the elements-never-jump rule at the same time.
- **The adversarial self-review is substantive, not decorative.** All four items check out on inspection: the LEFT-JOIN format clause correctly excludes null-format rows only when a format is selected; the purge-prefix argument for trailing cache-key parts is verifiably correct against `purgePublicEmbedCache` (:783); the room-facet venue-disclosure leak channel is a genuinely subtle catch (the facet catalog could name a building the labels suppress).
- **Rubric literacy.** The plan quotes each EMB pass_criteria and builds to the letter of it — "clearly time-slotted list is acceptable" (EMB-06), "day tabs or day sections" (EMB-09), in-place expansion via zero-JS `<details>` (EMB-01) — while explicitly declining the zero-credit room-column grid. Honest truncation with a "Read the full abstract →" escape hatch is a nice honesty-over-cheapness touch.
- **Risk section names the two brittle literal assertions** (AC-85 CSS pins, MRQ-94's `public-day` markup) that a careless render refactor would break, plus fleet-load awareness on the test budget. The null-format seed rows are treated as a feature to render honestly, not a nuisance to patch.
