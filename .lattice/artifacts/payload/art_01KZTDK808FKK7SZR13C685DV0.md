# Plan Review: MRQ-126 — Bound form options and builder ergonomics

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. Three minor issues below are worth folding in during implementation; none requires a planning round-trip.

## 2. Summary

Reviewed the two-part plan (bound `config.source` options resolved at the `listFormFields` choke point; inline ~3-turn add-a-field row with stable refs) against the actual code. Every load-bearing evidence claim checks out: `referenceId`/`resolveDomainReferences` bind by name exactly as described (`public-form.routes.ts:184-214`), `listFormFields` (`forms.queries.ts:192`) is genuinely the single read path feeding both `readFormDetail` and the public form, the duplication path reads raw rows (`forms.routes.ts:447`) so internal resolution can't leak back to the DB, the formats rename API exists (`event-settings.routes.ts:301`), drafts with resume tokens exist to make the stale-answer note meaningful, and the seeded hand-typed options are exactly where the plan says. The key concern is small: the migration is numbered `0009` while the repo tops out at `0007` and at least four sibling live plans also claim `0009` — survivable, but the plan should treat the number as a placeholder.

## 3. Issues

**[MINOR] Files / Data migration — Migration number `0009` collides with at least four sibling plans**
The repo currently has migrations through `0007_embed_widget_kinds.sql`. One live sibling plan claims `0008_form_field_dates.sql`, and at least four others claim `0009` (`person_custom_fields`, `file_comments`, `criterion_kinds`, `cold_start`) alongside this plan's `0009_bound_form_options.sql`. The collision is survivable — wrangler applies by filename, duplicate-prefixed files touching disjoint objects both run, and the explicit-import list in `tests/integration/apply-migrations.ts` will conflict loudly rather than silently — but the plan hardcodes `0009` in three places with no acknowledgement, while a sibling plan explicitly flags this exact risk.
**Recommendation:** Treat `0009` as a placeholder; at implementation time (and again at rebase before PR), take the next free number after fetching latest `main`, and rename the file, the `apply-migrations.ts` import, and the file-table entry together.

**[MINOR] Part 1 — Empty bound source list is undefined**
If an event has zero rows in `formats` (or `tracks`), a bound select resolves to an empty option list: the public form renders a required dropdown with nothing to choose, and the builder's read-only box shows nothing. The seeded event always has rows, but a fresh event whose organizer binds a field before configuring Settings hits this immediately — and the CFP-S1 judge flow (delete/reconfigure formats in Settings) can transit through an empty state.
**Recommendation:** Define the empty-list rendering: in the builder, the read-only box shows "No formats configured yet" with the same Settings link; on the public form, a required bound select with zero options should surface a clear message rather than an empty dropdown that can only fail validation.

**[MINOR] Part 2 — The inline add row has no `key` input; derivation is unstated**
`form_fields` enforces `UNIQUE(form_id, key)` (`0001_init.sql:783`), and keys are semantically load-bearing — `resolveDomainReferences` keys off `format`/`tracks`, and conditions reference `fieldKey`. The current `addField` generates `field_${Date.now().toString(36)}` (`FormsPage.tsx:277`). The plan's one-POST add row (`[type][Label][Options][Required][Add]`) omits the key, so the implementation must generate one, and the plan doesn't say how or whether the detail editor remains the place to set a meaningful key afterward.
**Recommendation:** State the key derivation (slugified label with the existing timestamp pattern as collision fallback is the natural choice) and confirm the detail editor still allows renaming the key for fields that need domain or condition semantics.

## 4. Positive Observations

- **Evidence-first and honest.** Every file/line citation in the "what the code actually does today" section verified against the tree — including the subtle ones: the validation layer (`form-conditions.ts:264-267`) failing *before* the domain resolver with a near-identical message, and the schemaless config wire format meaning no schema migration is needed. This is what a plan should look like.
- **The choke-point design is genuinely sound.** I independently confirmed that `readFormDetail`, `loadPublicForm`, and hence all submit paths flow through `listFormFields`, that reorder writes positions only, and that form duplication reads raw rows and so cannot persist resolved options. The cycle-1 self-review resolution on the duplication path (#1) is correct as written. Resolution-at-read plus write-side stripping means validation and name-binding "agree by construction" — the strongest possible shape for closing the trap.
- **The regression test is aimed at the actual bug.** Test 2 (rename via the settings API → public GET offers new name → new name accepted, old name rejected with a field-anchored issue) is precisely the test that would have caught the live data-loss trap, and the rename API it depends on exists.
- **Scope discipline.** The names-vs-ids storage refactor is flagged and deferred rather than smuggled in; free-text options stay first-class (correct — "Audience level" in the fixture needs them); the `PublicForm.tsx` touch is kept to one additive block with explicit awareness of T-H's file ownership.
- **Fleet- and rubric-aware.** Targeted vitest under the 45s budget rule, explicit `apply-migrations.ts` registration (a real silent-failure footgun, caught in cycle 1), and the concrete CFP-S1/S2 walkthrough showing exactly which weighted points the trap forfeits.
- **House UI rules internalized.** The always-rendered disabled options control and fixed-width Add button honor "elements never jump" without being asked.
