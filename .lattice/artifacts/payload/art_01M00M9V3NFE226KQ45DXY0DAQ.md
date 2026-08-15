# Code Review: MRQ-200 — branch `mrq-200` (6c9be20b)

Reviewed against the worktree at `Marquee-worktrees/mrq-200`, not only the diff text. Both
changed test files were run (40/40 pass) and `tsc --noEmit` is clean. Selector reach and the
band's consumers were verified in the source, not assumed.

## 1. Verdict

**FAIL (implementation-level)** — the plan is sound and three of the four items land
cleanly, but the CSS guard introduces a specificity regression on the Event Settings page
that is a real, user-visible defect of exactly the class item 3 exists to eliminate. It is
a one-line-per-file fix plus a test-regex update; the task should return to `in_progress`
for that rework, not to planning.

## 2. Summary

The diff retires the members-serializing `openList`, points the People band at
resolve-by-id with a real 404, makes `?list_id=<unknown>` answer 404, scopes facet counts
to the visible population, and guards the shared `.field input` selector against
radios/checkboxes. The API and query work is careful and well-tested — the single-query
`LIVE_LIST_COUNT_SQL` projection, the org-defended 404, and the facet self-exclusion
convention are all correct. The key finding is that `:not([type="radio"]):not([type="checkbox"])`
raises the guarded selectors' specificity from (0,1,1) to (0,3,1), which silently defeats
the pre-existing `[type="color"]` and `[type="file"]` overrides in `settings.css` — the
track-color swatch on Event Settings visibly regresses.

## 3. Issues

**[MAJOR] src/ui/settings/settings.css:17–20 — the `:not()` guard now outranks the color/file overrides**
`:not()` carries the specificity of its argument, so `.field input:not([type="radio"]):not([type="checkbox"])`
is (0,3,1) while `.field input[type="color"]` (line 19) and `.field input[type="file"]`
(line 20) are (0,2,1). Before this change the base selector was (0,1,1) and the type
overrides won; now they lose. Concretely: `EventSettings.tsx:171` renders
`<input type="color">` inside `<label class="field">`, and line 18's `padding: 9px 11px`
now beats line 19's `padding: 3px` — the 42×40 color control's swatch shrinks from ~36px
to a ~20×20 chip. The file input's `padding: 8px 10px` loses the same way. This is the
identical failure mode the ticket describes ("a shared selector reaching controls it
shouldn't"), reintroduced by the fix, and it was not caught because the browser
verification in the plan covered the Evaluation screen but not Settings, whose stylesheet
this diff also edited.
**Fix:** keep the guard at zero added specificity with `:where()`:
`.field input:where(:not([type="radio"]):not([type="checkbox"]))` — apply the same form in
all four stylesheets (components.css:135, evaluation.css, forms.css, settings.css) so the
existing `[type="color"]`/`[type="file"]` overrides win again. Update the structural
assertion in `tests/unit/people.MRQ-131.test.ts` (the new MRQ-200 CSS test matches the
bare `:not(...)` spelling and would fail against `:where()`), and re-verify the Event
Settings tracks row and logo upload in a browser alongside the Evaluation screen.

**[MINOR] src/ui/people/PeoplePage.tsx:148–152 — a deleted-list URL now shows two competing messages**
Item 2's 404 applies to the table fetch too: with a stale `?list=` URL, `fetchPeople`
rejects with `not_found` and lands in the generic error state, so the page renders the
band's honest "This list no longer exists · It was deleted, or the link is from another
organization." directly above a red error box reading a `describeError` sentence with a
support ref. Before this change the same URL showed an empty table. The band is right;
the error box makes a deliberate 404 look like a system failure and offers a "ref" for a
situation the band already explains, with the "Leave this list" remedy sitting right there.
**Fix:** in the people-fetch `.catch`, when `filters.listId` is set and the error is a
`MarqueeApiError` with code `not_found`, render the ready/empty presentation (or a quiet
"missing list" table state) instead of the generic error box, leaving the band as the
single voice for missing-ness.

**[MINOR] src/routes/people.queries.ts:223–262 — `LIVE_LIST_COUNT_SQL` reads raw `config_json` where every other consumer reads it through `parseListConfig`**
`resolveListScope`, `liveCount`, and `recordResponse` all pass the stored config through
zod, which degrades an invalid config (e.g. a `stage` value later removed from
`PIPELINE_STAGE_IDS`) to "no filters". The SQL mirror applies the raw predicates instead,
so for such a row the band's count and the table under it would disagree; truly malformed
JSON would make `json_extract` throw a 500 here while the JS path degrades gracefully.
Unreachable today because configs are validated on write, so this is a drift tripwire
rather than a live bug — the mirror-duplication risk the code comment already owns.
**Fix:** no code change required now; add a parity test that saves one live list per
config field (`q`, `company`, `title`, `stage` — only the `tag` arm is exercised today via
CRM-09) and asserts `GET /org/lists/{id}` `member_count` equals `GET /org/people?list_id=`
`total`, so any future divergence between `filterClauses` and the SQL mirror fails CI.

## 4. Positive Observations

- **Item 1's core constraint is met exactly:** `OPEN_LIST_SELECT` resolves metadata plus
  count in one statement for both kinds — the live count as a correlated subquery over the
  selected row's own `config_json`, so opening a list never becomes metadata-plus-roster
  work. The fixed-count subquery matches `LIST_SELECT`'s, so the detail view and the index
  can never disagree about a fixed list's size.
- **The 404 semantics are safe in both directions:** `resolveListScope` keeps the org
  boundary inside the lookup, so a borrowed id and a nonexistent id are indistinguishable
  (no cross-org existence leak), and the rewritten `lst_alien` test pins the
  membership-row-smuggling case at the new status.
- **The tripwire retirement is handled the way the ticket asked:** the index-completeness
  test is deleted only because the coupling it guarded is gone, and it is replaced by a
  structural test on what the band now depends on (`fetchList` by id, no `fetchLists`
  scan), plus behavioral tests for empty-vs-unknown lists.
- **Facet scoping uses the right convention and documents it:** each facet excludes its
  own field so counts predict what clicking will produce, while list/search/other chips
  stay applied — and the shared `whereClause` guarantees the facets and the table can
  never disagree about the population. The three MRQ-200 facet tests (list-, search-, and
  combined-scope) cover the seams that matter.
- **Blast-radius discipline:** the response-shape break on `GET /lists/{listId}` has
  exactly one consumer (`fetchList`, added in this diff — verified by grep), the removed
  `.scope-check` hand-patch is precisely the one the guard makes redundant (the
  `.round-toggle` flex patch, which is layout rather than un-sizing, correctly stays), and
  no unguarded `.field input` selector remains anywhere in `src` outside the deliberate
  type-scoped overrides.
