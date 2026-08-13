# Plan Review: MRQ-143

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are minor refinements, none of which warrant returning to planning.

### 2. Summary

Reviewed the four-step plan for fixing first-name ordering on `/speakers` and the missing route back from `/p/:slug`, verified against the actual code on `github/main` (the local checkout's `main` is behind and predates the directory). The plan correctly locates both defects — the directory loader in `src/lib/public-site.ts` sorts `[...speakersById.values()]` by `name.localeCompare`, and `PublicSpeakerPage`'s shell actions carry only `← Agenda` — and its surname-key approach is the only feasible one given that the `people` table stores a single `name` column with no structured given/family fields. The key concern is small: the surname heuristic as stated still mis-keys surname particles and suffixes, and the plan should pin the collation locale so its diacritic-heavy test names are deterministic.

### 3. Issues

**[MINOR] Step 1 — Surname particles and suffixes are not addressed**
The plan handles the comma form, hyphenated surnames, and mononyms, but "final whitespace-delimited token" still keys "Guido van Rossum" on "Rossum" (arguably fine) while keying "John Smith Jr." or "Jane Doe PhD" on "Jr."/"PhD" (clearly wrong). The ticket explicitly warns against splitting on the last token "without thought"; suffixes are the most common real-world case that thought should cover. Particles (van, de, von, bin, …) are a judgment call either way — sorting "van Rossum" under V or R are both defensible — but suffixes are not.
**Recommendation:** Strip a small set of trailing suffixes (Jr., Sr., II–IV, PhD, MD) before taking the final token. Optionally note the particle decision in the key function's comment so the choice reads as deliberate. Keep the list short; this is a heuristic over display names, not a name parser.

**[MINOR] Steps 1–2 and 4 — Collation locale is unpinned, and the test names make that matter**
The existing sort uses bare `localeCompare`, which is host-locale-dependent. The plan's chosen test names (`Łukasz Żółć-Wiśniewski`, `Aïcha Ndiaye-Kovács`) are exactly the inputs where ICU locale differences between a dev machine, the Vitest workers pool, and production workerd could produce different orderings and a flaky assertion.
**Recommendation:** Sort with an explicit collator (e.g. `new Intl.Collator("en")` or `localeCompare(key, "en")`) so the ordering the tests assert is the ordering production produces.

**[MINOR] Whole plan — Files to be modified are not named**
The checklist asks the plan to identify created/modified files. The plan describes surfaces, not files. In practice both defects resolve to two files — `src/lib/public-site.ts` (directory loader sort, ~line 707 on `github/main`) and `src/ui/public/agenda/PublicAgendaPage.tsx` (`PublicSpeakerPage` actions, ~line 1045) — plus test files, so the omission carries little risk for a small ticket, but naming them would have made the plan self-verifying. One trap worth flagging to the implementer: `public-site.ts` contains **two** `name.localeCompare` sort sites — the directory loader and the embed loader (~line 948). The plan correctly scopes to the first; the implementer must not grep-and-replace both.
**Recommendation:** Name the two files and the specific sort site in the plan or the PR description; leave the embed loader's sort untouched as the plan already states.

**[MINOR] Step 3 — Consider extending the return link to the directory's search state**
The plan sends profile visitors back to `/speakers?event=…`, which satisfies the ticket. A visitor who arrived via a search-filtered directory (`?q=…`) will lose their filter. This is genuinely out of scope (the ticket's fix shape asks only for a 'Speakers' link) and chasing it risks scope creep, so treat it as a note for the PR body rather than plan work.
**Recommendation:** No plan change required; mention the limitation in the PR body so it isn't mistaken for an oversight.

### 4. Positive Observations

- **The heuristic is honest about its limits.** "Without pretending the display name contains richer cultural name metadata" is exactly the right framing given the single-`name` schema — the plan resists both the naive last-token split the ticket warns about and the over-engineered alternative (a name-parsing library or a schema migration) that a "small" ticket cannot carry.
- **Deterministic tie-breaking** (surname key, then full name, then id) is a detail plans routinely omit and code reviews routinely catch late. Specifying it up front is good practice.
- **Scope discipline is explicit.** The plan names what it will *not* touch — embed sorting and the already-fixed search — which directly honors the ticket's "do not re-file" note and prevents the two-sort-sites trap from becoming an accidental behavior change.
- **Validation is concrete and matches project rules:** rendered before/after ordering for the PR body, the exact PR gate, and live content checks after deploy — consistent with DEPLOY.md's "merging does not ship" and the evidence norms this board runs on.
- **The test names are well chosen** (diacritics, hyphenation, a mononym) — they exercise the exact fallbacks the key function claims to handle, provided the collation locale is pinned per the issue above.
