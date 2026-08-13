# Code Review: MRQ-143 — Public speaker directory ordering + profile navigation

Reviewed against the worktree at `Marquee-worktrees/mrq-143-speaker-directory` (commits `396b743b`, `806ab658`). Both touched test files were run locally and pass (11/11, well under the 45s suite budget).

## 1. Verdict

**PASS** — Implementation is correct and meets acceptance criteria.

## 2. Summary

The diff fixes both defects exactly as planned: `/speakers` now sorts by a modest, explicit surname heuristic (`publicSpeakerSurname` + `comparePublicSpeakerDirectoryEntries` in `src/lib/public-site.ts`), and the public speaker profile header gains a `← Speakers` link that preserves the `event` query. The scope discipline is good — the embed loader's name-sort at `src/lib/public-site.ts:998` is deliberately untouched per the plan, search filtering is applied before the sort so it composes correctly, and the directory grid has no letter-grouping headers that would conflict with surname order. I verified the tests pass and found only minor, accepted-tradeoff-level issues.

## 3. Issues

**[MINOR] src/lib/public-site.ts:113 — Comma heuristic captures credential suffixes**
A display name like `"Jane Smith, PhD"` takes the comma branch and yields the sort key `"Jane Smith"` — effectively first-name ordering for that entry, silently. This is the flip side of honoring `"Family, Given"`, and the doc comment already frames the heuristic as modest, so this is an accepted tradeoff rather than a bug; no such names exist in the current 32-speaker set.
**Fix:** No change required now. If it ever bites, a cheap hardening is to only take the comma branch when the pre-comma segment is a single token (real `Family, Given` forms are overwhelmingly one-token families in this data; multi-token pre-comma strings are usually `Name, Credential`). Worth a one-line note in the comment at most.

**[MINOR] src/lib/public-site.ts:147 — `localeCompare` with runtime-default locale**
The comparator inherits whatever ICU locale the runtime defaults to, so ordering of diacritics (`Ż`, `Ï`) could in principle differ between the Workers runtime and a future test environment. In practice this matches the pre-existing pattern used everywhere else in this file (including line 998), the workers-pool tests exercise the same runtime as production, and the unit test pins the expected order — so drift would be caught, not silent.
**Fix:** Nothing needed. If determinism ever becomes a concern, pass an explicit locale (e.g. `localeCompare(other, "en")`) in one place, the comparator.

No critical or major issues found.

## 4. Positive Observations

- **The heuristic is honest about its limits.** The doc comment on `publicSpeakerSurname` states exactly what it does and does not claim (no normalization, no guess at cultural name order, mononyms stay whole) — this is precisely the "do not just split on the last token without thought" the ticket asked for, without over-engineering a name-parsing library into a 32-card page.
- **Deterministic total order.** The comparator ties break on full name and then id, so equal-surname speakers render stably across requests — a small thing that prevents flaky diffs in rendered-output tests later.
- **Correct layering.** Sorting lives in the loader (`loadPublicSpeakerDirectory`), not the component, matching how the file already works; the UI change is a pure header addition that reuses the existing `public-button` idiom and the `eventQuery` pattern, so conference context survives the round trip.
- **Tests verify behavior at two levels.** The unit test checks both the comparator's ordering (with genuinely hard names: hyphenated diacritics, `Ł`-initial, a mononym) and the *rendered* directory order via `renderToString` + h2 extraction — proving the sort actually reaches the page, not just the array. The integration test asserts the exact rendered `← Speakers` href including the event slug.
- **Scope restraint.** The already-fixed search defect was left alone as instructed, and the embed's separate sort was consciously preserved rather than "helpfully" unified.
