# Plan Review: MRQ-75 — Public widgets widened and protected

## 1. Verdict

**FAIL (plan-level)**

The gaps are concrete and enumerable — this is a targeted revision, not a redesign. Every
issue below was verified against the checked-out tree, not inferred.

## 2. Summary

Reviewed the MRQ-75 plan (two new embed kinds `sessions`/`cfp`, `layout=cards|list` on
`speakers`, the four-format dialog, and the SPEC/EVALUATION/BUILDPLAN folds) against
`src/lib/public-site.ts`, `src/routes/embed.route.tsx`, `src/ui/embeds/EmbedPage.tsx`,
`src/routes/public.routes.ts`, `migrations/0001_init.sql`, `scripts/checks/trace-ac-core.mjs`,
and the three contract docs. The plan is unusually well-grounded — it reads the real
implementation, names real line numbers, flags its one judgment call honestly, and specifies
driven validation rather than green-tests-only. Two defects would ship a broken feature
(`inferEventSlug` is never widened, so the canonical snippet URL 404s for both new kinds; and
replacing the kind `<select>` with a button segment silently breaks the existing
`EMBED_CONFIG_SCRIPT` wiring), and four of the contract-fold edits the ticket explicitly asks
for are missing or wrong.

## 3. Issues

---

**[CRITICAL] Code changes → `src/lib/public-site.ts` — `inferEventSlug` is never widened, so
`/embed/{event}-sessions` and `/embed/{event}-cfp` will 404**

The plan extends `inferEmbedKind` to the two new suffixes but says nothing about
`inferEventSlug` (`src/lib/public-site.ts:563-566`), which is the other half of the same
fallback:

```ts
function inferEventSlug(slug: string): string | null {
  if (slug === "agenda" || slug === "speakers") return null;
  return slug.replace(/-(?:agenda|speakers)$/, "") || null;
}
```

For `aie-nyc-2026-sessions` the regex does not match, so it returns the whole slug unstripped,
`findLiveEvent` misses, and `resolvePublicEmbed` returns `null` → `context.notFound()`.

This is not a theoretical path — it is *the* path. The plan itself confirms zero `INTO embeds`
writes anywhere (I re-verified: no matches in `src/` or `scripts/`), so the DB-row branch of
`resolvePublicEmbed` never fires and every request falls through to `inferEmbedKind` +
`inferEventSlug`. And `snippet()` in `EmbedPage.tsx:150` emits exactly
`https://marquee.stage11.dev/embed/{eventSlug}-{kind}` with **no** `?event=` param — so the
copied iframe, the thing AC-273/AC-274 are about, is the broken case.

Worse, the plan's own tests would not catch it. The existing fixture style it models on
(`tests/integration/public-site.AC-83-86-240-252-253.test.ts:203`) hits
`/embed/${EVENT_SLUG}-agenda?event=${EVENT_SLUG}` — with the explicit `event` param that masks
the bug. `/embed/config` also passes `eventSlug` explicitly, so the preview would work while
the shipped snippet 404s.

**Recommendation:** Add `inferEventSlug` to the change list — widen both the early-return guard
(`slug === "agenda" | "speakers" | "sessions" | "cfp"`) and the strip regex to
`-(?:agenda|sessions|speakers|cfp)$`. Better: derive both from `EMBED_KINDS` so a future kind
cannot desync the two functions again. Add an explicit test that fetches
`/embed/{slug}-sessions` and `/embed/{slug}-cfp` **without** the `?event=` param, mirroring what
`snippet()` actually emits.

---

**[CRITICAL] Code changes → `EmbedConfigPage` / `EMBED_CONFIG_SCRIPT` — a button segment breaks
the existing FormData wiring, and `disabled` never toggles client-side**

The plan replaces the `Surface` `<select name="kind">` with "a 4-button equal-width segment" and
adds a Layout segment, but treats `EMBED_CONFIG_SCRIPT` as needing only param-rule changes. The
script (`EmbedPage.tsx:57-83`) does two things that both break:

```js
const values = new FormData(form);
const kind = String(values.get('kind') || 'agenda');
...
form.querySelectorAll('select, input').forEach((c) => c.addEventListener('input', update));
```

- `<button>` elements do not contribute to `FormData` outside a submit, so `values.get('kind')`
  returns `null` and the snippet/preview silently pin to `agenda` forever.
- The listener query is `select, input` — buttons are not bound at all, so clicking a segment
  fires no `update()`.

Separately, the plan specifies `disabled={kind === "cfp"}` and `disabled={kind !== "speakers"}`
as **server-rendered** attributes. But switching kind in this screen is client-side (the script
only rewrites `code.value` and `preview.src`; it never reloads). So the controls would render
with whatever `disabled` state matched the initial URL and never change — which fails the plan's
own validation step 4 ("click through all four, confirm Track/Layout controls disable at the
right moments") and fails the AC-217 test as written ("assert Track/Layout controls are
`disabled` (not absent)") for every kind reached by clicking rather than by URL.

**Recommendation:** Specify the mechanism, not just the markup. Concretely: back each segment
with a hidden `<input name="kind">` / `<input name="layout">` that the buttons write (keeping
`FormData` as the single read path), bind `click` on `[data-embed-segment] button` in addition
to the existing `input` listeners, and have `update()` own the `disabled` toggling for the track
and layout controls plus the note-text swap. State that the server render and the script must
agree on the same disable predicate so the pre-hydration frame is already correct.

---

**[MAJOR] Contract folds → `EVALUATION.md` — the `auto` count the ticket explicitly names is
never touched**

The ticket says "header live in-scope **and `auto` counts** +4." The plan updates line 7
(`203 → 207`) and line 119 (`206 → 210`), but the only place an `auto` count actually lives is
**line 33**, which the plan never mentions:

> **Counts across all 197 in-scope live criteria:** **187 `auto` · 1 `op-assist` · 5 `oracle` ·
> 4 `felt`.**

So there are *three* mutually inconsistent in-scope totals in this file (197, 203, 206), and the
plan's "bump both by +4 preserves whatever relationship already held" reasoning silently skips
the third — leaving the `auto` tally, the one number `trace:ac` semantics care about, stale.

**Recommendation:** Add line 33 to the fold list: `197 → 201` in-scope and `187 → 191` `auto`.
Since the plan is already declining to reconcile the pre-existing drift, say so explicitly in the
amendment-log entry (all three totals bumped +4; reconciliation deferred and named) so the next
reader knows it was seen rather than missed.

---

**[MAJOR] Contract folds → `EVALUATION.md` §2 — the Tier A section heading is not updated,
though the plan inserts a new story block under it**

The plan inserts a brand-new `**US-16 · Promote the call with a live block**` block into §2
Tier A and appends two rows to US-58. The §2 Tier A heading (line 126) reads:

> ### Tier A — the walkthrough loop (27 stories · 96 live ACs; AC-233 rides on US-39 but is
> cut-line, not Tier A)

Adding a story block makes it 28 stories, and the four ACs make it 100 live ACs. Neither is in
the plan's edit list. The same 27/96 pair also appears in `USER_STORIES.md` §"Scope at a glance"
(line 25) — which is read-only here, and that mismatch is exactly the subject of the next issue.

**Recommendation:** Add the §2 Tier A heading to the fold list (`27 → 28 stories`, `96 → 100
live ACs`), conditional on the Tier A ruling standing.

---

**[MAJOR] Tier ruling — declaring Tier A in `EVALUATION.md` contradicts that file's own stated
authority, which this ticket cannot edit**

`EVALUATION.md` line 8 is explicit:

> **`sequence/USER_STORIES.md` §"Scope at a glance" is the authority on tier membership**; this
> file follows it and never re-derives it from ID arithmetic.

That table (`USER_STORIES.md:25`) lists Tier A as `AC-1 – AC-90, AC-231, AC-234, AC-240,
AC-244–246` — 96 ACs, no AC-217/218/273/274. `USER_STORIES.md` is a read-only input for this
ticket (ticket text: "do not re-edit"), and Amendment 18's own text (lines 1002-1012) promotes
US-16 to live scope and mints AC-273/274 **without stating a tier**. So writing Tier A into
`EVALUATION.md` puts the file in direct violation of its own line 8 the moment the PR lands,
with no way to fix the upstream authority inside this ticket's scope.

The plan flags the Tier A/B choice as a judgment call — correctly, and the reasoning (protect ≠
cuttable; grouping-not-arithmetic; Amendment 10 precedent) is sound. But it frames the risk as
"the Orchestrator can override afterward," which understates it: this is not a reversible label,
it is a documented contract conflict between two artifacts, one of which is frozen for this
ticket.

**Recommendation:** Escalate this to the Orchestrator **before** implementation rather than
noting it in the completion comment. If Tier A stands, the amendment note must explicitly record
that `USER_STORIES.md` §"Scope at a glance" is stale as of Amendment 18 and that `EVALUATION.md`
is carrying the tier ahead of it, with a named follow-up to reconcile — otherwise line 8 becomes
a lie the auditor will trip over.

---

**[MAJOR] Contract folds → `EVALUATION.md` gate 18 — the no-waiver set is not widened despite
the Tier A ruling**

Gate 18 (`EVALUATION.md:648`) enumerates the no-waiver set by hand:

> **AC-1 – AC-90 plus AC-231, AC-234, AC-240, and AC-244–246** all green.

The plan mentions gate 18 only to say it is "unaffected." It is not: under a Tier A ruling,
AC-217/218/273/274 are binding-no-waiver but appear nowhere in gate 18's list, so they would be
Tier A in the table and silently waivable at the gate. The precedent the plan itself cites
(Amendment 1) did exactly this widening — "gate 18's no-waiver set widened to include AC-231."

(Note: gate 18 also already omits AC-264–269, which the tier table includes. That is
pre-existing drift and not this ticket's to fix, but it means gate 18 cannot be assumed to
track the table automatically.)

**Recommendation:** Add gate 18 to the fold list — append `AC-217, AC-218, AC-273, AC-274` to
the no-waiver enumeration, conditional on the Tier A ruling. If the Orchestrator rules Tier B
instead, gate 19's cut-line language is the surface that needs the edit instead; either way one
of the two gates must move.

---

**[MAJOR] Code changes → `src/lib/public-site.ts` — the `cfp` payload's relationship to
`PublicEmbedData` is unspecified**

The plan introduces `PublicEmbedCfp` and a `loadPublicCfpEmbed` branch, but never says how the
new shape reaches consumers. `PublicEmbedData` is a fixed interface with required `tracks`,
`sessions`, `speakers`, and `filters` fields, and it is the type of three things at once: the
`EmbedPage` prop, the KV cache envelope payload (`PublicEmbedCacheEnvelope.data`), and the
`GET /api/v1/public/embeds/:slug` response body. If the cfp branch returns a different shape,
the cache envelope and the public API contract fork; if it returns `PublicEmbedData` with the
cfp data bolted on, the plan needs to say where.

**Recommendation:** State it explicitly — `PublicEmbedData` gains `cfp: PublicEmbedCfp | null`
(null for the other three kinds), so one shape flows through the cache, the API, and the
renderer unchanged. Also confirm what `tracks` holds for the cfp kind, since `/embed/config`
feeds `preview.tracks` straight into the Track `<select>` options
(`embed.route.tsx:82`) — an empty array there would empty the dropdown on a cfp-initial load
even though the control is disabled.

---

**[MINOR] Contract folds → `EVALUATION.md` — "Amendment 11 … mirroring the Amendment 9/10
style" is wrong; there is no Amendment 10 in this file**

`EVALUATION.md`'s amendment log (lines 707-715) contains exactly three entries — Amendments
**1, 9, and 8**, in that (non-sequential) order. The highest is 9; there is no Amendment 10 to
mirror, and numbering is per-file and already divergent across the four artifacts (SPEC at 17,
BUILDPLAN at 10, EVALUATION at 9, USER_STORIES at 18).

**Recommendation:** Use `Amendment 10` in `EVALUATION.md` (next free in that file), and have the
entry name its `USER_STORIES.md` Amendment 18 lineage in the body so the cross-file mapping is
readable. The BUILDPLAN "Amendment 11" and SPEC "Amendment 18" numbers in the plan are both
correct — I verified BUILDPLAN's highest is 10 and SPEC's is 17.

---

**[MINOR] Contract folds → `EVALUATION.md` line 6 — the upstream pointer's AC ceiling goes stale**

Line 6 reads "`sequence/USER_STORIES.md` (267 live criteria through AC-269; AC-239 struck)."
After Amendment 18 the live set runs through AC-274. The plan's fold list does not touch it.

**Recommendation:** Bump it in the same pass ("through AC-274"), or state that the count itself
is USER_STORIES' to own and only the ceiling moves.

---

**[MINOR] Existing implementation → `EmbedKind` is described as "already unused"**

The plan justifies reusing `EmbedKind` partly on it being "already exists, already unused." It
is used — `src/db/schema.ts:613` types a row field with it. The consolidation is still the right
call (all five inline unions are being touched anyway); only the justification is off. Worth
correcting because it means widening `EMBED_KINDS` also widens that row type, which is a real —
and desirable — downstream effect the plan should acknowledge rather than discover.

**Recommendation:** Restate as "declared and used once in `schema.ts:613`, never reused across
the module boundary," and note that widening `EMBED_KINDS` propagates to `schema.ts:613` as
intended.

---

**[MINOR] Tests / validation → the "publish purge" framing overstates what exists, and AC-218
has a TTL window the plan does not name**

Two related points:

1. `purgePublicEmbedCache` has **zero callers in `src/`** — only the two test call sites in
   `public-site.AC-83-86-240-252-253.test.ts`. Its docstring ("Call this from the agenda publish
   mutation") is aspirational. So the plan's AC-273 assertion that "publish-purge clears it" is
   really an assertion about the helper, matching the existing AC-89 test. That is fine and
   correct to mirror — but the plan should say so, not describe it as the publish path, or a
   later reader will believe a wiring exists that does not.
2. AC-218's auto-flip is computed at load time and then cached for 30s
   (`EMBED_CACHE_TTL_SECONDS`). The plan's unit test purges the cache before re-fetching, which
   is right, but validation step 3 ("flip `closes_at` via `wrangler d1 execute` and reload with
   no republish") will show the *old* state for up to 30 seconds against a live KV binding. An
   agent seeing stale output will reasonably conclude the feature is broken.

**Recommendation:** Reword the AC-273 test bullet to name `purgePublicEmbedCache` as the helper
under test rather than a publish path. For validation step 3, state the expected ≤30s staleness
window and either wait it out or purge explicitly, and record that the flip is proven by the
absence of any write to `forms.status` — that is what "no republish" actually means here.

---

**[MINOR] Tests — the test-title convention is stricter than the plan's prose implies**

`scripts/checks/trace-ac-core.mjs:41` requires titles to match
`/^((?:AC-\d+(?:\s*[,+]\s*AC-\d+)*)|CONTRACT)\s+·\s+/` — a middle dot `·`, with multiple IDs
joined by `,` or `+` only. The plan writes its test descriptions with an em dash ("**AC-273** —
seed 2 published sessions"). Almost certainly just prose shorthand, but `invalid-title-prefix`
is a hard `trace:ac` failure, so it is worth pinning.

**Recommendation:** Note the exact separator in the plan's test section: `"AC-273 · …"`,
`"AC-217, AC-218 · …"`, `"CONTRACT · …"`.

---

**[MINOR] Code changes → `readEmbed` call sites for `layout`**

The plan says "`readEmbed`: accept `kind: EmbedKind`, pass `layout` through" but does not name
the three call sites that must now forward `query.layout` — `/embed/:slug`
(`embed.route.tsx:87`), the legacy `/:eventSlug/:kind/embed` (line 107), and the config-page
preview URL builder. Easy to half-do, and the failure mode is quiet (layout silently ignored on
the legacy route only).

**Recommendation:** Enumerate them, and note that the config page's server-rendered preview
`src` (`EmbedPage.tsx:180`) builds its query string independently of `snippet()` and needs
`layout` added there too — that is a third place the param rules are duplicated, not two.

## 4. Positive Observations

- **It read the code, not just the ticket.** Line-level references (`schema.ts:103`,
  `0001_init.sql:693`, `showEmbedModal()` at 2832) all check out. The `0006` migration number,
  the SPEC Amendment 18 / BUILDPLAN Amendment 11 next-free numbers, and the "zero `INTO embeds`"
  claim are each independently correct.
- **The screen-vs-modal call is handled exactly right** — identified as a prior accepted ruling
  (AC-87's "config **screen**" verification text predates this ticket), inherited rather than
  re-litigated, and documented so a reviewer does not flag it as prototype infidelity. That is
  the correct instinct on a one-to-one-reproduction project.
- **The `EmbedKind` consolidation is genuinely justified rather than smuggled** — the plan
  anticipates the scope-creep objection and answers it (every one of those five lines is being
  touched anyway). That is the right bar for opportunistic cleanup.
- **The tier question was surfaced rather than silently decided.** The reasoning is well
  constructed (protect ≠ cuttable; grouping-not-arithmetic per §2's own rule; the Amendment 10
  precedent), it names itself as the one real judgment call, and it correctly identifies that §7
  needs a carve-out *regardless* of which way the tier goes. My objection above is to the
  timing of the escalation, not the analysis.
- **Validation is driven, not asserted.** Step 3 in particular — flipping `closes_at` by direct
  D1 write and reloading with no republish — is exactly the right way to prove AC-218's "no
  republish" claim end-to-end rather than at the unit level only. Likewise the 375px/1440px
  resize pass for AC-274. This is the "green tests ≠ working product" discipline applied without
  being asked.
- **The prototype contract was extracted as a spec, not a vibe** — the param-omission rules
  (`track` omitted for cfp; `layout=list` only for speakers-list, cards unparameterized) are
  stated precisely enough to test against, and the disable-never-hide reading is correctly tied
  to the "elements never jump" rule.
- **Order of work is genuinely dependency-ordered** — data layer → routes → UI → tests → folds,
  with the reason the folds come last stated explicitly. Placing the folds before `pr-gate` is
  also correct, since `trace:ac` parses `EVALUATION.md` for the live criteria set and would
  raise `unknown-criterion` on the new AC IDs if the rows were not yet in place.
