# MRQ-126: Bound form options and builder ergonomics

8 weighted points (CFP-01 w3, CFP-06 w3, CFP-15 w2) PLUS a live data-loss trap: the server binds format/track by NAME at submit time and hard-rejects on mismatch (public-form.routes.ts:184-213) — rename a format in Settings and every in-flight public form rejects submissions with 'Choose a format from the list' pointing at a dropdown that visibly contains it. (1) First-class bound field: form_fields.config.source = formats|tracks; builder renders 'Options come from Conference settings -> Formats' read-only with a link instead of the comma text box (FormsPage.tsx:149); public form renders live rows; migrate the seeded format/tracks fields; keep free-text options for genuinely custom selects. (2) SAME SURFACE, biggest turn payoff of the whole sweep: collapse the builder's add-a-field loop from ~9-10 agent turns to ~3 — one inline row (type + label + required + options, single save), STABLE element refs across re-renders (run 1: the editor re-render invalidated refs, agent issued select 3x per field; ~30 of 70 turns to add 3 fields; the steps that died at the cap carry ~9 weighted points). Nine turns per field is also nine interactions for a human building a 20-field CFP. Full spec: section T-N2. Register rows 47,51.

---

## What the code actually does today (evidence)

- `scripts/seed/event.ts:267-268` seeds `format` (single_select) and `tracks` (multi_select) with **hand-typed** `config.options` string arrays. Nothing keeps them in step with the `formats` / `tracks` tables edited at `/settings` (`src/ui/settings/EventSettings.tsx:266,271`).
- The public submit path binds by **name**: `referenceId()` (`src/routes/public-form.routes.ts:186-194`) resolves `SELECT id FROM formats WHERE event_id=? AND (id=? OR lower(name)=lower(?))`, and `resolveDomainReferences()` (`:196-213`) pushes `"Choose a format from the list, then try again."` when it misses.
- Validation misses first, actually: `src/lib/form-conditions.ts:264-267` rejects any select answer not present in `config.options` → `"Choose an available option."` → `publicIssueMessage()` (`public-form.shared.ts:314`) → `"Choose an option from the list, then try again."` So a stale option list produces the same lie one layer earlier.
- Field config is schemaless on the wire (`forms.routes.ts:36` `z.record(z.string(), z.unknown())`) — **no migration is needed for the config shape**, only a data migration for the seeded rows.
- Read choke points: `listFormFields(db, formId)` (`forms.queries.ts:192`) feeds **both** the admin detail (`readFormDetail`, `:212`) and the public form (`loadPublicForm`, `public-form.shared.ts:196`) and hence every submit path (`base.fields`).
- Builder add-a-field today: pick type in a select → `addField()` posts a placeholder `"New question"` (`FormsPage.tsx:277-281`) → click the new row → edit key/label/help/required/options in the detail editor → `Save field`. Six-plus interactions, and each `setForm` re-render swaps the editor subtree the agent just addressed.

### Why the rubric makes this a trap, concretely

`CFP-S1` step 4 tells the judge to **reconfigure tracks and formats in Settings** to the fixture set ("Keynote (45 min)", "Talk (30 min)", "Lightning Talk (10 min)", "Workshop (120 min)", "Panel (45 min)"; tracks AI Engineering / Platform & Infra / Developer Experience). `CFP-S2` step 5 then screenshots "the open track, format … dropdowns showing their options" and step 6 submits format **"Talk (30 min)"**, track **"Platform & Infra"**. With hand-typed options the public form still offers the seeded names, so:

- CFP-01 (w3) — the dropdowns do not reflect what the organizer configured.
- CFP-06 (w3) — round-trip carries a format/track the organizer never configured, or the submit is rejected outright.
- CFP-15 (w2) — the accepted session cannot carry "Platform & Infra" through to the agenda.

Run 1 only dodged it because the agent never got far enough to reconfigure settings and submit in the same pass.

## Approach

Two changes on one surface, one PR (the ticket scopes them together; they share `FormsPage.tsx`).

### Part 1 — bound options, resolved at one choke point

New `src/lib/bound-options.ts`:

- `type BoundSource = "formats" | "tracks"`; `boundSourceOf(field)` returns the source only for `single_select` / `multi_select`.
- `resolveBoundOptions(db, eventId, fields)` — if no field is bound, returns `fields` untouched (zero extra queries). Otherwise reads `SELECT name FROM formats|tracks WHERE event_id=? ORDER BY position, id` once per needed table and returns fields with `config.options` **replaced** by the live names, `config.source` preserved.
- `normalizeFieldConfig(config, type)` — write-side: a bound `source` is only legal on select types and only with value `formats`/`tracks`; when bound, `options` is **stripped before persisting** so the DB never carries a stale snapshot that could out-live a rename. Invalid source → 422.

Wire it at the single read choke point: `listFormFields()` resolves internally (it looks up `event_id` via `forms` only when a bound field is present). Every consumer — admin detail, admin field list, reorder, public form GET, and all three submit paths that use `base.fields` — gets live options with no per-caller opt-in, so no future path can forget. Validation (`form-conditions.ts`) and name binding (`referenceId`) then agree by construction: whatever the dropdown offers is what the tables hold.

Write side in `forms.routes.ts`: field create + PATCH run `normalizeFieldConfig`.

Data migration `migrations/0009_bound_form_options.sql`: point the seeded `format` / `tracks` fields at their sources (`json_set(json_remove(config,'$.options'), '$.source', …)`), keeping `minItems` on tracks. Scoped by `key IN ('format','tracks')` + matching select type — defensible because the server *already* treats answers under exactly those keys as domain references (`resolveDomainReferences` keys off `answers.format` / `answers.tracks`), so binding them makes the field agree with behaviour that already exists. `scripts/seed/event.ts` seeds the bound form directly.

**Honest handling of an already-stale draft.** Binding closes the window for new answers but cannot rescue a resumed draft holding a name that was since renamed. Today that submitter sees "Choose an option from the list" against a dropdown that no longer contains their answer, with no explanation. The public form will render an inline note naming the dead value ("*Workshop* is no longer offered — choose a current option") for bound selects whose stored answer is absent from the live list. Not selectable — selecting it would only fail again at the server.

### Part 2 — add a field in ~3 turns, with refs that survive re-render

One inline add row in the fields step, **above** the list so its DOM position never moves as fields are added:

`[type ▾] [Label] [Options / source] [☐ Required] [Add field]` → one POST that creates the field fully formed. Three interactions for the CFP-S1 fixture fields: type the label, pick the type (default `short_text` needs no turn for "Key takeaway"), click Add. The dropdown case adds one turn for the options text.

Ref stability, the actual run-1 failure:

- Every control carries a stable `id` (`new-field-label`, `new-field-type`, `new-field-options`, `new-field-required`, `new-field-submit`) plus `data-field-add` hooks, so a selector resolves to the same element before and after a re-render.
- The add row's own state lives in `FormsPage`, and the row renders at a fixed position in a fixed subtree — no key churn, no conditional mount, so Preact diffs in place rather than remounting.
- Adding a field no longer re-targets the detail editor (it does not steal `selectedFieldId`), so the subtree under the add row does not swap out from beneath a queued interaction.
- House rule (elements never jump): the options control is **always rendered**, disabled with an explanatory placeholder for non-select types, so switching type never reflows the row; the Add button keeps a fixed width across its idle/saving labels.

Bound-source editing for existing fields lands in `FieldValidationEditor` (`FormsPage.tsx:149` is the comma box it replaces): an options-source select (Custom list / Conference formats / Conference tracks). When bound, the comma box is replaced by read-only live values plus "Options come from Conference settings → Formats" linking to `/settings#formats`. `EventSettings.tsx` gains `id="formats"` / `id="tracks"` anchors on the two cards so the link lands on the section, not the top of the page.

## Files

| File | Change |
|---|---|
| `src/lib/bound-options.ts` | new — source constants, `resolveBoundOptions`, `normalizeFieldConfig` |
| `src/routes/forms.queries.ts` | `listFormFields` resolves bound options |
| `src/routes/forms.routes.ts` | normalize/validate config on field create + PATCH |
| `src/ui/forms/FormsPage.tsx` | inline add row; bound-source editor; stable ids |
| `src/ui/forms/forms.css` | add-row layout, reserved widths, bound-source box |
| `src/ui/public/form/PublicForm.tsx` | stale-answer note for bound selects |
| `src/ui/settings/EventSettings.tsx` | `id` anchors on the Formats / Tracks cards |
| `migrations/0009_bound_form_options.sql` | new — bind the seeded `format` / `tracks` fields |
| `scripts/seed/event.ts` | seed the two fields bound |
| `tests/unit/bound-options.MRQ-126.test.ts` | new |
| `tests/integration/api/bound-form-options.MRQ-126.test.ts` | new |

## Tests

1. **Resolver unit** — bound field gets live names in table order; unbound field keeps its literal options; no bound field ⇒ no extra query; `normalizeFieldConfig` strips `options` when bound and rejects a bad source.
2. **The trap, as a regression test** (integration): seed a bound format field → rename a format via the settings API → the public form GET offers the **new** name → a submit carrying the new name is accepted and resolves to the right `format_id`; a submit carrying the old name is rejected with a field-anchored issue. This is the test that would have caught the live bug.
3. **Round-trip** (CFP-06): a submission through a bound field lands with the format/track resolved to real ids.
4. **Builder** — a single POST with type+label+required+options creates a usable field that renders on the public form (CFP-01's shape).

Targeted vitest only (fleet load rule); full `pr-gate` once before the PR, load-checked.

## Risks / non-goals

- **Not** switching answer storage from names to ids. That is the deeper fix for renames, but it reaches `submission_answers`, admin display, exports and the agenda handoff — far outside this ticket, and the bound list closes the live trap without it. Flagged here rather than smuggled in.
- Free-text options stay first-class for genuinely custom selects ("Audience level" in CFP-S1 is exactly that) — binding is opt-in per field.
- Migration is scoped to the two domain keys; a custom select named `format` would be rebound, which is the correct outcome given `resolveDomainReferences` already binds that key by name.
- `EventSettings.tsx` and `PublicForm.tsx` are lightly touched (anchors, one note). Section 4 assigns neither to another ticket; `PublicForm.tsx` is T-H's file — the change there is one additive note block, kept small to rebase cleanly.

## Sequence

1. Plan committed + pushed (first commit).
2. Resolver + write normalization + migration + seed, with unit/integration tests.
3. Builder UI (add row, bound-source editor) + CSS + settings anchors.
4. Self/headless review over the diff, triaged.
5. `pr-gate`, live validation against `vite dev` in the c11 browser, PR.
