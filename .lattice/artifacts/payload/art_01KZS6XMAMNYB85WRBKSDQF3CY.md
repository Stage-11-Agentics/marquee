# Code Review: MRQ-75 — Public widgets widened (sessions + cfp kinds, speaker layouts, protected re-band)

Reviewed at `mrq-75-widgets` @ `0b3fedf` (MRQ-75 commits `004ad2c` + `0b3fedf`, i.e. `fc44cd8..HEAD`).
Verification run locally in the worktree: `npx tsc --noEmit` (clean), the new
`public-embed-widgets.AC-217-218-273-274` suite plus `public-site.AC-83-86-240-252-253`
(11 tests, green), `npm run trace:ac` (0 uncovered, 0 errors), and one throwaway probe test
to confirm issue #1 empirically (removed afterwards; worktree left clean).

---

### 1. Verdict

**FAIL (implementation-level)** — one reproducible functional defect on the embed config
screen. The plan is sound and inherited correctly; the rest of the diff is high quality and
the fix is small and local.

---

### 2. Summary

Reviewed the four-kind embed widen: migration `0007`, the `EmbedKind`/`EmbedLayout` reuse
through `public-site.ts`, the route layer, the reproduced dialog in `EmbedPage.tsx`, the new
AC-tagged integration suite, and the SPEC/EVALUATION/BUILDPLAN folds. The work extends
MRQ-22's surfaces rather than forking them, the disable-never-hide rule is implemented in both
the SSR render and the inline script with reserved note height, and the contract arithmetic
(207/210/106/53) is internally consistent.

The blocking finding: `/embed/config?kind=cfp` renders the Track select with **zero options**,
because the `cfp` branch of `loadPublicEmbed` returns `tracks: []` and the config page takes its
track list from that same preview payload. Since the format segment switches kind client-side
with no page reload, the Track control is then re-enabled — but permanently empty — for every
other format for the rest of the session. That is exactly the control AC-273 says must filter.

---

### 3. Issues

**[MAJOR] src/routes/embed.route.tsx:83-85 (with src/lib/public-site.ts:655-670) — the config screen's track list is empty whenever it is entered on `kind=cfp`**

`/embed/config` derives its `tracks` prop from the preview payload:

```tsx
const preview = await loadPublicEmbed(context.env.DB, resolved, { track, status, accent, layout });
… <EmbedConfigPage … tracks={preview.tracks} … />
```

but the new early return in `loadPublicEmbed` hard-codes `tracks: []` for the `cfp` kind. The
four-format segment is `type="button"` and re-renders client-side only — nothing reloads the
page — so once the screen is served with an empty `tracks` array, `paintControls()` happily
re-enables `#embed-track` for `agenda`/`sessions`/`speakers` and the operator is left with a
select containing only "All tracks". The snippet and preview then can never carry a `track`
param for the rest of the session.

Verified empirically against the ticket's own fixture (probe test, since removed):

```
agenda   -> ["track-agents", "track-evals"]
sessions -> ["track-agents", "track-evals"]
speakers -> ["track-agents", "track-evals"]
cfp      -> []                                  ← control is present, enabled on switch, and hollow
```

`/embed/config?kind=<x>` is a first-class deep link — the route parses `kind` from the query
and the new AC-217 test exercises `?kind=cfp` directly — so this is a supported entry path that
is half-wired, and it undercuts the one AC ("filterable by track/status like the agenda kind")
the widened dialog exists to serve.

**Fix:** make the config screen's track list independent of the previewed kind. Cheapest form —
in the `/embed/config` handler, load the track list from a non-`cfp` load (or query `tracks`
for `event.id` directly) and pass that as the `tracks` prop, keeping `preview` for the iframe
only. Then extend the AC-217 test with an assertion that `/embed/config?kind=cfp` still renders
every track `<option>` — the disable-never-hide rule applied to the select's *contents*, not
just its presence.

---

**[MINOR] BUILDPLAN.md:418 (M-64 row) — cites a migration path that does not exist**

The M-64 row lists `migrations/0006_embed_widget_kinds.sql`. The file shipped in this PR is
`migrations/0007_embed_widget_kinds.sql`; `0006` is `0006_audit_log_request_id.sql`, which
landed first. The code renumbered correctly (`apply-migrations.ts` imports `0007`); only the
contract doc kept the plan's original number.

**Fix:** `0006_` → `0007_` in the M-64 row.

---

**[MINOR] src/lib/public-site.ts:611-620 — `findPrimaryEmbedForm` can promote a non-CFP form as the call for speakers**

```sql
SELECT * FROM forms WHERE event_id = ? AND status <> 'draft'
 ORDER BY (status = 'open') DESC, opens_at DESC, id ASC LIMIT 1
```

`forms.kind` is `abstract | session`, and the query ignores it. An event running a closed
abstract CFP alongside an open session-details form will render "Call for speakers is open"
with a `Submit a proposal →` link pointing at the session-details form, because `status='open'`
outranks everything else. The `opens_at DESC` tie-break is also weak — `opens_at` is nullable
with no default, so multi-form events with unset open dates fall through to `id ASC` (oldest
ULID wins), which is deterministic but arbitrary rather than "most recent".

**Fix:** add `AND kind = 'abstract'` (or an explicit `ORDER BY (kind = 'abstract') DESC` ahead
of the status clause) and cover it with a two-form fixture.

---

**[MINOR] src/ui/embeds/EmbedPage.tsx:172-182 — a call that has not opened yet reads as "closed … once the call reopens"**

`isFormClosed` returns true for `opens_at > now`, so a form scheduled to open next week renders
`Call for speakers is closed` plus *"Submissions are closed. This block updates automatically —
no republish — once the call reopens."* A call that has never opened cannot reopen, and the
organizer's-language rule in `PHILOSOPHY.md` makes this the kind of copy that reads wrong on a
customer's site.

**Fix:** give `PublicEmbedCfp.status` a third value (`"scheduled"` / `"upcoming"`) derived from
`opens_at > now`, with copy along the lines of "Call for speakers opens {date}". If a third
state is out of scope for the deadline, at minimum drop "once the call reopens" from the closed
copy so it is true in both cases.

---

**[MINOR] src/lib/public-site.ts:625-631 — `isFormClosed` duplicates `publicFormIsClosed` with nothing binding them**

The copy is byte-identical to `src/routes/public-form.shared.ts:174` and the comment explains
why it was not imported (avoiding route-layer deps — `forms.queries`, `form-conditions`,
`sha256Hex`). The reasoning is fine; the risk is that AC-218's whole claim rests on this
predicate and a future change to the public form's open/closed semantics will silently not
reach the embed.

**Fix:** move the predicate into a dependency-free leaf (e.g. `src/lib/forms/is-closed.ts`) and
have both call sites import it, or — if the duplication is deliberate — add a unit test that
asserts the two functions agree across the boundary cases (`opens_at` future, `closes_at` past,
`status !== 'open'`).

---

**[MINOR] src/lib/public-site.ts:735-746 — the layout dimension is added to the cache key for all four kinds**

`publicEmbedCacheKey` appends `list`/`cards` unconditionally, but `layout` only affects the
`speakers` render. `/embed/x-agenda?layout=list` and `/embed/x-agenda` therefore occupy two KV
entries with byte-identical payloads, and `/api/v1/public/embeds/x-agenda?layout=list` does the
same (the API route forwards `query.layout` raw, unlike `readEmbed`, which already normalises
`"cards"` → `null`). Harmless correctness-wise; it doubles the key space of three of the four
kinds against a param they ignore, and it is a free anonymous-traffic cache-fragmentation lever.

**Fix:** normalise `layout` to `null` unless the resolved kind is `speakers` — in `readEmbed`
and in `getPublicEmbed` — before it reaches the cache key.

---

**[MINOR] src/ui/embeds/EmbedPage.tsx:290-330 — two `<label>` elements now label nothing, and `aria-pressed` is inconsistent between the segments**

`<label>Format</label>` and `<label>Layout</label>` replaced `<label for="embed-kind">` but wrap
no control and carry no `for` — invalid label usage, and screen readers get nothing from them.
The kind buttons set `aria-pressed`; the layout buttons do not, so a keyboard user gets
selection state on one segment and not the other. (Both segments do carry `role="group"` +
`aria-label`, so this is cosmetic rather than blocking.)

**Fix:** render the two headings as `<span class="embed-field-label">` (styled like the label)
and mirror `aria-pressed={layoutApplies && layout === …}` onto the layout buttons, including in
`paintControls()`.

---

**[MINOR] tests/integration/public-embed-widgets.AC-217-218-273-274.test.ts — three widened surfaces have no coverage**

The legacy `/:eventSlug/:kind/embed` route was widened from a two-way ternary to all four kinds
and is never requested by a test; the `cfp`-with-no-form empty state (`"Call for speakers has
not opened yet"` in `cfpBody`) is unreachable in the suite because every cfp test seeds a form;
and the new `layout` enum on `publicQuery` is only exercised through the SSR route, never
through `/api/v1/public/embeds/:slug?layout=list` (which is where the zod schema actually
gates it, and where the raw-`layout` cache-key note above applies).

**Fix:** three short additions to the existing file — a `/{slug}/sessions/embed` + `/cfp/embed`
request, one cfp request against an event with no non-draft form, and one API request asserting
`filters.layout` round-trips.

---

**[MINOR] tests/node/reset-wipe-order.test.mjs:8-38 — the duplicate-definition guard now accumulates transient rebuild names**

The scanner rewrite is the right call (`existing` correctly tracks DROP/RENAME so `embeds_new`
never reaches `WIPE_ORDER`), but the duplicate assertion moved to `created`, which is every
`CREATE TABLE` name across all migrations forever. The moment a second migration rebuilds a
table using a `_new` suffix that has been used before — the same SQLite-documented pattern this
migration follows — the test fails with `duplicate schema table definitions` for a schema that
is perfectly valid.

**Fix:** key the duplicate check on names that are live at the end of each migration, or on
`${file}:${name}`, so transient scaffolding can't collide across migrations.

---

### 4. Positive Observations

- **Extends, does not fork.** All five inline `"agenda" | "speakers"` unions in `public-site.ts`
  collapse onto `EmbedKind` from `src/db/schema.ts` — the already-existing, previously-unused
  type. The route layer, the API layer and the UI all now widen by editing one const. The two
  `kind === "speakers" ? … : "agenda"` ternaries in `embed.route.tsx` became
  `EMBED_KINDS.includes(...)` checks rather than growing into four-way chains.
- **The migration is done properly.** Correctly renumbered to `0007` after `0006_audit_log_request_id`
  landed underneath it, the canonical SQLite create/copy/drop/rename rebuild, both indexes
  recreated by name, wired into `apply-migrations.ts`, and — rather than special-casing the new
  file — the `WIPE_ORDER` contract scanner was taught to replay DDL. That last move is the
  difference between a fix and a workaround.
- **"Elements never jump" applied literally, in both renderers.** `.embed-field-note` reserves
  `min-height: 28px` so the applicable/not-applicable copy swap cannot shift the page, the
  segments use `flex: 1 1 0` for genuinely equal widths, and `paintControls()` mirrors the SSR
  disabled/active state exactly — disabled with `cursor: not-allowed`, never removed from the
  DOM. The AC-217 test asserts the *absence* of removal (`data-embed-kind="agenda"` still
  present while on `cfp`), which is the right shape of assertion for that rule.
- **The URL contract is stated three times and the three agree.** `snippet()`, the extracted
  `previewSrc()` and the inline `EMBED_CONFIG_SCRIPT` each implement "omit `track`/`status` for
  `cfp`, emit `layout=list` only for speakers+list" identically. Extracting `previewSrc()` also
  retired a genuinely unreadable inline `URLSearchParams` ternary in the JSX.
- **AC-218 is proven the hard way.** The test flips `closes_at` with a direct D1 `UPDATE`, purges
  the cache, and re-fetches — no admin write, no republish endpoint touched — which is exactly
  the claim the AC makes, rather than the easier assertion that some republish path produces the
  closed state. The `CONTRACT ·` anonymity test extending A-5 to the two new kinds with a
  tampered `mq_session` cookie is the right instinct too.
- **The contract folds are careful.** Counts move coherently (203→207 build, 206→210 in-scope,
  102→106 Tier A, 55→53 post-competition, 27→28 stories), the pre-existing 203-vs-206 drift is
  left alone rather than silently "fixed", §7's "only contiguous ID range" claim is carved out
  instead of left self-contradicting, §6 dependency 2 closes with a stated reason, and AC-270–272
  are visibly reserved. The Tier A rationale is written down in all three documents in the same
  words, which is what makes it overridable by the Orchestrator without archaeology.
