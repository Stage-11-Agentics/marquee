# Code Review: MRQ-143 — Speaker directory surname ordering + route back from profile

## 1. Verdict

**PASS** — Implementation is correct and meets acceptance criteria.

## 2. Summary

Reviewed the two-part fix: a surname-keyed comparator for the public `/speakers` directory and a `← Speakers` link in the public profile header. The implementation matches the plan exactly, the surname heuristic is appropriately modest (comma-form honored, last token otherwise, mononyms whole), and both changes are covered by tests that verify rendered output rather than internals. I ran the new unit test and the touched integration test in the worktree: 2 files, 11 tests, all green in 3.2s — well inside the 45s suite budget. I also verified the two scoping concerns the plan called out: the embed's separate name sort (`src/lib/public-site.ts:998`) is untouched as intended, and the directory page has no letter-group headers, so surname ordering cannot visually conflict with any grouping.

## 3. Issues

No critical or major issues found. Two minor observations, neither blocking:

**[MINOR] src/lib/public-site.ts:113 — Comma heuristic treats suffix commas as "Family, Given"**
A display name like `Jane Smith, MD` or `Robert Downey, Jr.` parses as family name `Jane Smith` / `Robert Downey`, filing the speaker under their given name's initial. This is an inherent ambiguity of the comma form — `Ndiaye-Kovács, Aïcha` and `Jane Smith, MD` are indistinguishable without richer name metadata, which the ticket explicitly says not to pretend exists. The misfire is also benign: the speaker files under "J" instead of "S", but remains findable via the working search box, and no current roster name uses a suffix comma.
**Fix:** Nothing required now. If real roster data ever surfaces a suffix-comma name, a small suffix blocklist (`Jr`, `Sr`, `PhD`, `MD`, roman numerals) checked against the post-comma segment would disambiguate. Not worth building speculatively.

**[MINOR] src/lib/public-site.ts:147 — `localeCompare` without an explicit locale**
The comparator inherits the runtime's default locale, so ordering of `Ł`/`Ż`/accented names is theoretically environment-dependent (e.g., a Swedish default locale collates differently). In practice this is a non-issue: the Cloudflare Workers runtime and the workers-pool test environment both use full ICU with a root/en default, the unit test's assertions are stable under both, and the bare-`localeCompare` form is the established convention throughout this file (the embed sort at line 998 and the prior directory sort both used it).
**Fix:** None needed — matching the codebase convention is the right call here. If deterministic collation ever becomes a requirement, pass an explicit locale everywhere at once, not in one comparator.

## 4. Positive Observations

- **The surname heuristic honors the ticket's hardest instruction.** "Do not just split on the last token without thought" — the implementation handles the explicit `Family, Given` form, keeps mononyms whole, collapses internal whitespace, and deliberately leaves hyphenated and diacritic surnames intact as single keys (`Ndiaye-Kovács`, `Żółć-Wiśniewski`). The doc comment states precisely what the heuristic does and doesn't claim, which is the right register for a display-name-only data model.
- **Deterministic tie-breaking.** The comparator falls through surname → full name → id, so equal surnames (and even equal full names) produce a stable order. This matters on a multi-render public page.
- **The unit test verifies the surface, not the function.** Beyond asserting comparator output, it renders `PublicSpeakerDirectoryPage` to HTML and extracts the `<h2>` sequence, proving the *page* presents surname order — exactly the level the defect was filed at. The edge-case roster (two hyphenated diacritic names, a mononym, and names whose given/family initials invert under the new sort, e.g. **A**arush **S**elvan vs **A**parna **D**hinkaran) is well chosen to fail under the old first-name sort.
- **Scope discipline.** The embed's speaker sort and the already-fixed search were both explicitly left alone, matching the plan and the ticket's "do not re-file" note. The profile header change preserves the existing `← Agenda` action and threads the `event` query through both links, so conference context survives the round trip.
- **The integration assertion is precise.** `toContain('href="/speakers?event=public-conf">← Speakers</a>')` pins the full href including the event query, not just the link text.

## Verification performed

- Read the surrounding code in the worktree: `loadPublicSpeakerDirectory`, the embed loader's separate sort, `PublicShell`, `PublicSpeakerDirectoryPage`, `PublicSpeakerPage`.
- Confirmed the directory page renders a flat grid (speaker names are the `<h2>`s; no alphabetical group headers to contradict the new order).
- Ran `npx vitest run tests/unit/public-speaker-directory.MRQ-143.test.ts tests/integration/public-site.AC-83-86-240-252-253.test.ts` — **2 files, 11 tests, all passed, 3.17s**.
- Hand-checked the expected ordering against ICU en collation, including `swyx` between `Selvan` and `Yaron` (case is tertiary) and `Ż` after `Y`.
