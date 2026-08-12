# Plan Review: MRQ-95 — `date` as a first-class form field type

## 1. Verdict

**FAIL (plan-level)**

The plan is well-researched and technically close to correct, but it contains one
sequencing contradiction that blocks a stated acceptance criterion, and two
factual assertions it treats as settled that were not verified against the thing
that matters (the deployed database, and D1's foreign-key behaviour during a
parent-table rebuild). All three are cheap to fix in the plan and expensive to
discover mid-implementation the night before the deadline.

## 2. Summary

Reviewed the MRQ-95 plan against the task description and the live checkout:
`migrations/0001_init.sql`, `0002`/`0007`, `tests/integration/apply-migrations.ts`,
`src/db/schema.ts`, `src/lib/form-conditions.ts`, `src/routes/forms.routes.ts`,
`public-form.routes.ts`, `src/ui/forms/FormsPage.tsx`, `src/ui/portal/PortalPage.tsx`,
`src/ui/public/form/PublicForm.tsx`, `scripts/seed/`, and the check scripts.
The plan's scope decomposition is accurate — it found the real registries, the
right rebuild precedent, and the right judgment call on historical prose. The key
concern is step 7 vs step 8: the plan promises live-site speaker validation
*before* opening the PR while also leaving deploy to the human, and per `DEPLOY.md`
merging does not ship and a schema change additionally needs
`wrangler d1 migrations apply --remote` plus a remote reseed. As written, that
acceptance criterion cannot be met.

## 3. Issues

**[CRITICAL] Approach steps 7–8 — live-site validation is sequenced before the deploy that would make it possible**

Step 7 says: "use the approved c11 browser surface on the live site as a speaker.
Capture a screenshot showing both native travel date controls and the saved ISO
values after reload." Step 8 then says "push only to `github`, open the GitHub PR
… and leave merge/deploy to the human."

`DEPLOY.md:5-9` is explicit: "**There is no auto-deploy. Merging does not ship.**"
And `DEPLOY.md:52-58`: a migration change additionally requires
`CI=1 npx wrangler d1 migrations apply DB --remote` followed by
`npm run seed -- --remote`. So at the moment step 7 runs, `https://marquee.stage11.dev`
is still serving the pre-change Worker against a pre-change schema — the speaker
will get two text boxes and the screenshot will prove the *old* behaviour. There
is no branch-preview URL in this project's deploy story to fall back on.

This is not a nit: "Validated on the **live deployed site** … screenshot in the
PR" is a named acceptance criterion, and the resolution is an operator-visible
decision (deploying unreviewed code plus a remote schema migration to the
judge-facing site, one day before the 2026-08-12 22:00 PT deadline) rather than
an implementation detail an agent should improvise at 2am.

**Recommendation:** Pick one and write it into the plan explicitly.
(a) The implementer owns the deploy: state that after local gates pass it will
follow the `DEPLOY.md` redeploy sequence from a clean worktree at the branch
commit — `npx vite build` (load-bearing), `npx wrangler deploy`,
`wrangler d1 migrations apply DB --remote`, `npm run seed -- --remote`, then
`curl /health` to prove the build sha — and only then run the speaker flow and
screenshot. Flag that this puts unmerged code live and get that sanctioned before
starting. Or (b) open the PR with local + scratch-D1 evidence, mark the live
screenshot as a post-merge deploy step owned by a named human, and say so in the
PR body. Either is defensible; silence is not.

---

**[MAJOR] Approach step 3 — the "no disabled-FK pragma" claim asserts an outcome without stating the mechanism that makes it true**

The plan says it will "rebuild `form_fields` … and rebuild its sole child,
`submission_answers`, during the same migration so existing answer rows, both
tables' indexes, and the foreign-key graph survive without relying on a
disabled-FK pragma."

The child count is right — `grep 'REFERENCES form_fields'` over `migrations/`
returns exactly one hit (`0001_init.sql:366`), and no trigger or view touches
either table. But rebuilding the child does not by itself make the parent
droppable. D1 enforces foreign keys by default, and `DROP TABLE form_fields`
while `submission_answers` still holds referencing rows is an immediate FK
violation. Only a specific ordering avoids both the violation and a pragma:

1. `CREATE TABLE form_fields_new (…date arm…)`; copy rows.
2. `CREATE TABLE submission_answers_new (… field_id REFERENCES form_fields_new(id) …)`; copy rows.
3. `DROP TABLE submission_answers` (now childless).
4. `DROP TABLE form_fields` (now unreferenced).
5. `ALTER TABLE form_fields_new RENAME TO form_fields` — this rewrites the FK
   clause inside `submission_answers_new`, which is the step the whole ordering
   turns on and which depends on `legacy_alter_table` being off.
6. `ALTER TABLE submission_answers_new RENAME TO submission_answers`.
7. Recreate all four indexes — `uq_form_fields_form_key`,
   `idx_form_fields_form_position` (`0001_init.sql:783-784`),
   `uq_submission_answers_submission_field`,
   `idx_submission_answers_field_submission` (`0001_init.sql:818-821`).
   `DROP TABLE` takes indexes with it; nothing recreates them implicitly.

Note that `0007_embed_widget_kinds.sql` — the precedent the plan and the task
both point at — is *not* a precedent for this: its comment says `embeds` "carries
zero rows in every environment," so it never had to solve the FK or the data
problem. (`0002_venue_geography.sql`, which the task description names as the
pattern, is a plain `ALTER TABLE ADD COLUMN` and is no precedent at all.)

**Recommendation:** Write the statement order and the index-recreation list into
the plan, and state the fallback (`PRAGMA defer_foreign_keys`) if the scratch
migrate shows the ordering does not hold under `wrangler d1 migrations apply`.
The plan's promised scratch run "with pre-existing fields, answers, indexes, and
foreign keys" is exactly the right oracle — keep it, and make it assert index
existence and `PRAGMA foreign_key_check` afterwards, not just row counts.

---

**[MAJOR] Approach step 3 / Judgment calls — "the demo database has no seeded hotel answers" is true of the seed and unverified of the deployed database**

The plan's data decision rests on this claim. It is correct about the seed:
`scripts/seed/event.ts:314-333` creates the three hotel fields and no
`submission_answers` rows for them, and `scripts/seed/_sql.ts:19-29` confirms
every row is `INSERT … ON CONFLICT(id) DO UPDATE SET`, so a reseed genuinely
does flip the two deterministic field rows from `short_text` to `date`. That part
of the plan holds.

What it does not establish is the state of the *deployed* D1 instance. The task
was born from the operator "exercising the live site" and finding the two free-text
boxes — which is precisely the activity that produces exactly the prose answers
task item 7 asks about. Item 7 says: "The demo database is the one that matters
here; say what you did in the PR." Reasoning from the seed file answers a
different question than the one asked.

Two consequences the plan should also name, because they are visible to a judge:
a stored non-ISO value renders `<input type="date">` as an **empty** control, and
both fields are `required: 1`, so a speaker's completed hotel task can silently
revert to looking incomplete.

**Recommendation:** Before deciding, run a read-only check against the real DB —
`wrangler d1 execute DB --remote --command "SELECT a.value FROM submission_answers a
JOIN form_fields f ON f.id = a.field_id WHERE f.key IN ('arrival_date','departure_date')"`
— and record the actual count in the PR. Then state the decision on that evidence
(convert what parses / leave what does not / reseed), and state the empty-control
and required-field consequences.

---

**[MINOR] Approach step 6 — the fixture and registration surface is described generically where it is enumerable, and one item in it fails loudly**

"Update migration registration/check fixtures wherever the repository requires the
new migration" covers the right idea but names nothing. The concrete list:

- `tests/integration/apply-migrations.ts:3-9,67-75` — every migration is imported
  and replayed **by explicit name**. Miss this and the entire integration suite
  runs against a schema whose CHECK still rejects `date`; every new test fails on
  a constraint error rather than on the thing it tests. This is the one that bites.
- `tests/integration/api/forms.AC-17-33.test.ts:144` — "the field registry accepts
  and returns **all eight** field types," with a `toEqual(types)` assertion. It
  will not break, but it will silently stop meaning what its name says. It should
  become nine.
- `tests/node/public-form.AC-35-155-157.test.mjs:31` — same eight-type loop
  asserted against the routes source.
- `tests/unit/r2/uploads-routes.test.ts:71` — a hand-copied `form_fields` CHECK
  constraint in the fixture schema.
- `tests/node/reset-wipe-order.test.mjs` replays DDL and already understands
  create/drop/rename, so the two transient `_new` names are handled — no change
  needed, but worth confirming rather than assuming, since this migration creates
  two transient names where `0007` created one.

**Recommendation:** Enumerate these five in the plan so the implementer treats
them as work, not discovery.

---

**[MINOR] Approach step 5 — "reuse existing field classes" does not discharge the elements-never-jump constraint**

The task is specific: the control "must not be visibly taller or shorter than its
neighbours." `<input type="date">` does not inherit height from a text input's
class for free — it carries a UA-supplied inner layout and a `mm/dd/yyyy`
placeholder, and renders at a different intrinsic height in Safari than in
Chrome. The plan asserts reuse and stops.

Also worth noting the two renderers store their styling differently: the portal
uses a stylesheet (`src/ui/portal/portal.css`) while the public form's styles
live in `src/ui/public/form/styles.ts` — the plan's "reuse existing field classes"
reads as though both are the same move.

**Recommendation:** Add an explicit step: normalize the date control's box in both
surfaces (`appearance`, explicit `height`/`line-height`, matching padding) and
verify visually side-by-side with a neighbouring `short_text` field — the
`notes` long-text field sits right below both date fields in the hotel form, so
the comparison is free.

---

**[MINOR] Approach step 3 — `0008` is a guess about what the rest of the fleet does**

Several agents are working this repo concurrently, and migration files are
claimed by filename. Step 8 rebases on latest `github/main` and re-gates, which
would catch a collision, but the plan does not say what happens then.

**Recommendation:** One sentence: if another migration lands as `0008` before
merge, renumber to the next free integer and update the import in
`tests/integration/apply-migrations.ts` accordingly.

---

**[MINOR] Approach step 4 — the condition-operator limitation should be stated in the PR, not just decided**

Keeping the existing vocabulary is the correct call — `FORM_CONDITION_OPERATORS`
(`src/lib/form-conditions.ts:10-17`) is `equals / not_equals / contains /
not_contains / answered / not_answered`, with no ordering operators, and adding
before/after would be exactly the gold-plating the constraints forbid. But it
means "conditional logic keyed on a date field behaves correctly" resolves to
string equality and substring matching over ISO values — real and useful
(`contains "2026-08"` is a month match), and also less than a reader of that
acceptance criterion might assume.

One implementation detail the plan should pin while it is in this file: the
generic tail of `validateField` (`form-conditions.ts:226-240`) applies
`minLength`/`maxLength`/`pattern` to *any* string value regardless of type. If
`date` is not excluded there, a stale config on a converted field can reject a
valid ISO date. The plan says "avoid text-length/pattern rules for `date`" in the
builder (step 5); the server-side half needs the same treatment.

**Recommendation:** State the operator semantics in the PR body, and make the
`date` exclusion from the text-rule tail an explicit server-side step, with a
test that a `date` field carrying a leftover `maxLength: 5` still accepts
`2026-08-14`.

## 4. Positive Observations

- **The registry sweep is real, not assumed.** The plan independently names
  `src/db/schema.ts` — which the task description does not mention and which is
  the actual root: `FormFieldType` derives from `FORM_FIELD_TYPES` there and
  flows into `forms.queries.ts`, `public-form.types.ts`, and downstream. It also
  caught that `FormsPage.tsx` keeps its own duplicate union. Missing either would
  have produced a type error wall or a silent gap.
- **The historical-data judgment call is the right one and is stated as a
  judgment call.** Refusing to guess at "Tues morning" — rather than writing a
  parser that turns ambiguous prose into a confident wrong date on a hotel
  booking — is correct, and saying so out loud is what item 7 asked for.
- **Migration evidence is treated as a real run, not a read.** "Perform a real
  scratch D1 migrate with pre-existing fields, answers, indexes, and foreign keys"
  is exactly the oracle this class of change needs, and matches the task's
  "verify against a real migrate run, not just a read of the SQL."
- **Scope discipline holds under pressure.** No ranges, no time-of-day, no
  timezone handling, no custom calendar, no date-specific text rules — the
  constraints are honoured explicitly rather than drifted past.
- **The dirty-checkout hazard was spotted before it caused damage.** The supplied
  checkout is a live MRQ-93/91 branch with uncommitted Portal and venue work;
  planning a clean worktree from `github/main` and naming it "a safety boundary,
  not a scope expansion" is precisely right in a fleet this size.
