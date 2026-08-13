# Plan Review: MRQ-121 — Cycle 2

### 1. Verdict

**PASS** — Implementation can proceed, with the one major amendment below folded into step 1 (it is a small, localized addition to the loader the plan already creates).

### 2. Summary

Reviewed the cycle-2 plan for the public `/speakers` directory (EMB-05/EMB-12/EMB-13, register row 36, spec T-I2) against the actual codebase. Every factual claim checks out: `sessionRowsQuery` exists at `src/lib/public-site.ts:309` with the speaker name/company search branch at lines 343–348, `PublicShell` is exported from `PublicAgendaPage.tsx:128` and already used by `EmbedPage.tsx`, `/p/:slug` is live at `public-agenda.route.tsx:93`, the embed speaker renderers at `EmbedPage.tsx:154–168` genuinely emit no anchors, `PublicSpeaker` already carries `slug` so embed links are constructible without data changes, and the integration fixtures the plan names exist. The cycle-1 resolutions are sound. The one remaining concern is a co-speaker leak in the search design that the cycle-1 "search honesty" resolution does not fully close.

### 3. Issues

**[MAJOR] Implementation plan step 1 / Cycle-1 "Search honesty" resolution — Session-level search predicate leaks non-matching co-speakers**
The plan filters *sessions* via a speaker-only branch of `sessionRowsQuery`, then flattens and dedupes the surviving sessions' speaker lists. But the existing predicate (`public-site.ts:343–348`) matches a session when *any* public participant matches `q` — and the projection then returns *all* of that session's public speakers. So `q=Acme` matching speaker A (Acme) also surfaces A's co-presenter B from a different company in the directory results. This is exactly the class of dishonest match the cycle-1 resolution set out to eliminate; it survives because the resolution only addressed the title/abstract branch.
**Recommendation:** In the new directory loader, after deduplicating by person id, apply the same lowercase name/company `LIKE`-equivalent predicate to each individual speaker in JS (or query matching person ids directly) so only speakers who themselves match `q` render. The session-level SQL branch remains useful as a pre-filter; the per-speaker post-filter is the honesty gate. Add one test: a two-speaker session where `q` matches only one speaker's company must return exactly one card.

**[MINOR] Implementation plan step 1 — Day filtering must be explicitly bypassed**
`loadPublicAgenda` defaults `selectedDay` to `event.startsOn` unless `allDays: true` is passed (`public-site.ts:481`). A directory built on the default projection would silently show only day-one speakers. The embed loader already passes the equivalent; the plan doesn't state it.
**Recommendation:** State explicitly that the directory loader uses the all-days projection (as `loadPublicSpeaker` and the embed path already do), and cover a speaker whose only session is on day 2 in the tests.

**[MINOR] Implementation plan step 4 — Anchor target inside the iframe is undecided**
Embed pages render inside a customer-site iframe. A plain `<a href="/p/...">` navigates *within* the iframe, rendering the full `PublicShell` profile page in a small embedded viewport; `target="_top"` (or `_blank` with `rel="noopener"`) navigates the host page away from the customer's site. Either is defensible under EMB-13's "back-nav acceptable" ruling, but the plan should pick one deliberately rather than inherit the default.
**Recommendation:** Decide and record the target in the implementation (a `target="_top"`-style breakout to the full profile is the conventional embed behavior and pairs naturally with the event-preserving link); assert the chosen attribute in the embed link test.

### 4. Positive Observations

- **Every load-bearing claim was verifiable in the code.** The plan cites real files, real line-level behavior (the missing anchors at `EmbedPage.tsx:154–168`, the existing search branch), and correctly identifies that search is "a missing input, not a missing capability."
- **The cycle-1 resolutions are written as binding, checkable statements** — privacy scoping, dedupe key, event-preserving links — rather than vague intentions, which made this cycle's verification fast.
- **Scope discipline is exemplary:** no modal, no headshot serving, no new public API, explicit deference to T-I3, and the initials fallback is correctly framed as intentional.
- **Verification respects fleet rules:** targeted tests only, load check before the gate, curl-based evidence at `in_validation`, stop at `pr_open` — all consistent with the Marquee suite/gate budgets.
- Reusing the published-agenda projection for the directory means the privacy invariants (live event, published items, public audience, non-rejected/withdrawn) are inherited rather than re-implemented — the right architectural instinct.
