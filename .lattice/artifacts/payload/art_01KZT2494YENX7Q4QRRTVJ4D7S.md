# Code Review: MRQ-93 — render subjects in speaker tasks

## 1. Verdict

**FAIL (implementation-level)**

The approach is right and the talk half is well built. Two things keep it from
passing: the bio/profile half of the ticket is unreachable at runtime (no
"Finalize bio & photos" task is ever created, so the new surface can never
render and cannot be validated live), and nothing tests the one line that makes
the whole feature work — the dispatch in `TaskSurface`. Both are small fixes.

## 2. Summary

Reviewed commit `41ca682` (`src/routes/portal.routes.ts`, `src/ui/portal/PortalPage.tsx`,
`src/ui/portal/portal.css`, one integration test, one node contract test) against
the ticket and the delegator plan. The chosen approach — a presentation-level
specialization of `acknowledge` keyed on `template_id`, with `TalkEditor` and
`ProfileForm` factored out of `TalkCard`/`ProfileEditor` and reused verbatim — is
the correct call and is executed cleanly: one write path per subject, the
existing `talk_editable` gate honoured, generic acknowledge untouched. I verified
`npm test` (94 node + vitest, **pass, 25.1s / 45s budget**), `tsc --noEmit`
(clean), and `npm run check:design` (pass).

The key finding: `Finalize bio & photos` exists only as a `task_templates` row
with `auto_assign = 0` (`scripts/seed/event.ts:354`). The only code that ever
inserts a `speaker_tasks` row is `reconcileTaskSet`
(`src/jobs/cascade/decisions.ts:362`), which filters on `tt.auto_assign = 1`, and
the demo seed creates finalize-**description** tasks only
(`scripts/seed/ugliness.ts:123-142`). So `ProfileTaskSurface` is dead code in
every environment including the deployed site.

## 3. Issues

**[MAJOR] src/ui/portal/PortalPage.tsx:469 (and scripts/seed/ugliness.ts:123) — the bio/profile half can never render**

No `Finalize bio & photos` speaker task exists anywhere. The template is
`auto_assign = 0`, `reconcileTaskSet` only materialises `auto_assign = 1`
templates, no route inserts into `speaker_tasks`, and the ugliness seed creates
only the finalize-description task. `ProfileTaskSurface`, `ProfileForm(compact)`,
and `.portal-profile-task` are therefore unreachable — which also means the
ticket's "fix it the same way" acceptance and the live-site screenshot cannot be
demonstrated for that half, and ~250px of reserved-but-empty layout
(`portal.css:89`, `min-height: 470px` against a ~215px collapsed state) has never
been looked at.

A second, smaller edge of the same problem: `subjectTaskKind` (line 57) requires
`task.submission_id !== null` for **both** variants, but a bio/headshot task's
subject is the person, not a submission — the profile branch is gated on data it
does not use.

**Fix:** seed the bio task alongside the description task in
`scripts/seed/ugliness.ts:123-142` (same shape, `submission_id: submissionId`,
`template_id: TEMPLATE_IDS.finalizeBio`) so the surface is real, screenshot it
live, and tune the 470px reserve against what actually renders. Drop the
`submission_id` requirement from the profile branch (keep it for `"talk"`, which
genuinely needs it). If seeding the task is out of scope, say so explicitly in the
PR and revert the profile surface rather than shipping an unreachable branch.

**[MAJOR] tests/node/mrq-93-portal-task-subjects.test.mjs:22 — no test covers the dispatch that makes the feature work**

All three tests match regexes against the *source text* of `PortalPage.tsx` and
`portal.css`. Delete the routing lines in `TaskSurface`
(`PortalPage.tsx:241-243`) and every assertion still passes: the constants, the
guard, and the copy strings are all still present in the file. The integration
test only proves the API now returns `template_id`. So the behaviour the ticket
is about — a finalize-talk task renders its title and abstract — is untested.

The repo already has the better pattern: `tests/unit/agenda-track-board.AC-78-81.test.ts`
renders exported components with `preact-render-to-string`.

**Fix:** export `TaskSurface` (or the two subject surfaces) from `PortalPage.tsx`
and add a vitest unit test asserting: (a) a task with
`template_id: "tpl_finalize-talk-description"` renders the submission title and
abstract plus "I have reviewed this talk title and abstract."; (b) a generic
`acknowledge` task still renders "I have read and acknowledge this task."; (c)
with `talk_editable: false` the closed note renders and the edit button is
disabled.

**[MINOR] src/ui/portal/PortalPage.tsx:51-53 — template IDs are hand-copied literals with nothing tying them to the seed**

`"tpl_finalize-talk-description"` / `"tpl_finalize-bio-and-photos"` duplicate
`seedId("tpl", …)` in `scripts/seed/event.ts:61-62`. They match today (verified
against `slugify`), but a seed rename silently reverts the task to the bare
checkbox the ticket exists to remove — with the whole suite green, since the node
test only pins the literal on the UI side.

**Fix:** derive them — `seedId("tpl", "finalize-talk-description")` from
`src/lib/ids.ts` (already in `src/`, so no script/app boundary crossing) — or add
a test that imports `TEMPLATE_IDS` and asserts equality with the portal
constants.

**[MINOR] src/ui/portal/PortalPage.tsx:362-363 — duplicate DOM ids when both talk editors are open**

`TalkEditor` uses `talk-title-${submission.id}` / `talk-description-${submission.id}`
in both instances. Expand the finalize-talk task, click "Edit talk", then click
"Edit talk" in the `TalkCard` for the same submission further down: the document
now has two elements per id and both labels resolve to the first, so clicking the
`TalkCard` labels focuses the task's inputs. `ProfileForm` already solved exactly
this at line 455-456 with a `compact` id prefix.

**Fix:** mirror `ProfileForm` — `const titleId = compact ? \`task-talk-title-${submission.id}\` : \`talk-title-${submission.id}\`` and likewise for the description.

**[MINOR] src/ui/portal/portal.css:87-91 — the no-jump reserve is content-dependent, and one rule is dead**

`min-height` only prevents shift while the content stays under the floor.
`.portal-talk-description` and the profile bio preview are unclamped, so a long
abstract makes the collapsed view *taller* than the 212px editor reserve and the
rows below still move when edit mode opens. Note `.portal-talk h3`'s
`-webkit-line-clamp` does not apply inside the task (the ancestor there is
`.portal-talk-editor`, not `.portal-talk`), so titles clamp in `TalkCard` and run
free in the task. Separately, `.portal-subject-task { min-height: 360px }` (line
87) never applies: both call sites add `.portal-talk-task` or
`.portal-profile-task`, same specificity, later in the file.

**Fix:** clamp the read-only subject preview the way `.portal-talk h3` already
does, size the reserve to that bounded worst case, and delete the unused 360px
base rule (or move the shared `display: grid; gap: 14px` out of it and drop the
`min-height`).

**[MINOR] tests/node/mrq-93-portal-task-subjects.test.mjs:39-43 — tests pin exact pixel values**

`min-height: 360px / 310px / 470px / 212px` are asserted literally, so tuning the
reserve (which issue #1 and #5 both require) turns the suite red with no
behaviour change — and one of the four pins a rule that does nothing.

**Fix:** assert that a reserve exists (`/\.portal-talk-task[^\n]*min-height:/`) or,
better, replace these with the rendering test from issue #2 and keep the CSS free
to move.

**[MINOR] src/ui/portal/PortalPage.tsx:241 — silent fallback to the defective surface**

If a finalize-talk task's `submission_id` is not among `snapshot.submissions`, the
component falls back to `GenericTaskSurface` — the exact bare checkbox this ticket
removes, with no signal that anything is missing. Today `listSubmissions`
(`portal.routes.ts:621`) returns every submission the person participates in
regardless of status, so this should not fire; it is a robustness note, not a live
defect.

**Fix:** render the subject card with a "we could not load this talk" note instead
of silently degrading, or leave as-is and note it.

**[MINOR] src/ui/portal/portal.css:90 — `TalkCard` gains an unrequested 184px floor**

`.portal-talk-editor` is used by both instances, so every card in "Your talks" now
has a minimum height it did not have before. Defensible under the same no-jump
rule, but it is a visual change to a panel the ticket did not ask to touch.

**Fix:** confirm it in the live-site screenshot; if the panel now reads loose,
scope the floor to `.portal-talk-editor-compact` only.

**[DELIVERY] Acceptance criteria not yet met at review time**

No PR exists on `Stage-11-Agentics/marquee` for `mrq-93`
(`gh pr list --head mrq-93` → empty), so the live-site validation at
https://marquee.stage11.dev and the screenshot are still outstanding, as is the
one-sentence justification of the specialization choice in the PR body (it
currently lives only in the plan file). The talk half is validatable today; the
bio half is not until issue #1 is resolved.

## 4. Positive Observations

- **The right call, cleanly executed.** Presentation-level specialization keyed on
  `template_id` avoids the schema CHECK constraint, the zod enums, and a seed
  migration on the day before the deadline. The plan states the decision and the
  reason in one sentence, as the ticket asked.
- **Genuine reuse, not a fork.** `TalkEditor` and `ProfileForm` were extracted and
  both original call sites now consume them, so there is exactly one
  `PATCH /talk` and one `PATCH /profile` call in the file — and the node test
  pins that count, which is the one implementation-detail assertion here that
  earns its keep.
- **The compact profile save respects the route's partial semantics.** Sending only
  `{bio, headshot_attachment_id}` is safe: `updateProfile`
  (`portal.routes.ts:1155-1158`) preserves `title`, `company`, and `social_links`
  on `undefined`. Easy thing to get wrong; it was checked.
- **`template_id` was already selected by the query** (`portal.routes.ts:745`) and is
  `NOT NULL` in the schema (`migrations/0001_init.sql:603`), so the new
  `template_id: string` field is honest and cost nothing at the data layer.
- **Closed-CFP behaviour is preserved by construction** rather than reimplemented —
  the disabled "Closed" button and the new plain-language reason both come from
  the shared editor, so `TalkCard` and the task can't drift.
- **Copy does the ticket's work:** "I have reviewed this talk title and abstract." /
  "Confirm abstract" reads as confirming the thing, not the task, and matches the
  product's voice.
- Suite stayed well inside budget (25.1s of 45s) and typecheck and the design
  contract check are both clean.
