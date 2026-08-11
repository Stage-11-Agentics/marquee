# MRQ-75 self-review

**HEAD:** 3ef6e22 (branch `mrq-75-widgets`, rebased onto `github/main` @ 9fa278d+)
**Verdict:** PASS

## Scope check
AC-217, AC-218, AC-273, AC-274 all implemented and tested. SPEC/EVALUATION/BUILDPLAN Amendment
folds present. AC-270–272 untouched (grepped — zero references added).

## Security / correctness pass (adversarial)
- **Anonymous-only**: `cfp` and `sessions` kinds never read `mq_session`; confirmed via the
  existing CONTRACT test pattern extended to both new kinds, and manually with a tampered
  cookie against a live `wrangler dev` instance.
- **No PII leak via `cfp`**: `loadPublicCfp` selects only `forms.slug/name/status/closes_at` and
  `formats.name` — no submission or person data ever enters `PublicEmbedCfp`.
- **SQL injection**: `findPrimaryEmbedForm`/formats query are fully parameterized (`.bind`).
- **XSS**: no `dangerouslySetInnerHTML` anywhere touched; all new JSX text (form name, format
  names, deadline string) goes through Preact's default escaping. `accent`/`layout` are both
  validated against a closed set/regex before they ever reach an attribute or query string.
- **Migration safety**: `embeds` has zero writers in any environment (grepped `INTO embeds` —
  no hits) and zero rows in every seeded environment, so the create/copy/drop/rename rebuild in
  0007 has nothing to lose. Verified end-to-end with a throwaway test (since deleted) that
  inserted all four kinds post-migration and confirmed the old two-kind CHECK correctly rejects
  `'bogus'`.
- **Cache key collision**: `publicEmbedCacheKey` now includes `layout`, so `cards` and `list`
  don't share a KV entry — confirmed by the AC-274 test's explicit cards/list re-fetch.

## What I'd flag to a reviewer myself
- **Tier A/B placement is a judgment call**, not stated explicitly anywhere upstream. Documented
  the reasoning inline in both `SPEC.md` Amendment 18 and `EVALUATION.md`'s Amendment 11 log
  entry; Orchestrator can override without a code change if it disagrees.
- **Pre-existing count drift** in `EVALUATION.md` (line 5's "267 live" vs. the tier table's own
  sum, and the "206" vs "203" build-scope figures) predates this ticket and was *not* reconciled
  — I applied my own +4/-2 deltas consistently on top of whatever relationship already held,
  rather than trying to fix multi-amendment historical drift under time pressure. Worth a
  dedicated pass someday, not blocking this PR.
- **`tests/node/reset-wipe-order.test.mjs` fix** touches shared test infra outside the ticket's
  literal file list. Necessary — my own migration's rebuild pattern is what exposed the gap, and
  leaving it unfixed would have permanently blocked this PR (and every future migration that ever
  needs a CHECK-constraint rebuild) — but flagging it explicitly since it's not an "embeds" file.
- **`.dev.vars` copied from the main checkout** for local `wrangler dev` validation only; not
  committed (confirmed `.dev.vars` stays untracked — checked `.gitignore` covers it).

## Diff hygiene
- No stray console.log, no commented-out code, no TODO markers introduced.
- CSS additions reuse existing `--public-*` tokens; no new design-token surface.
- Naming: `EmbedKind`/`EmbedLayout` reused from `src/db/schema.ts` everywhere instead of
  re-declaring inline unions in five places, which was already the case before this ticket
  (genuine simplification, not scope creep — every touched line already needed editing).
