# MRQ-95 implementation plan

## Contract

Add `date` as a first-class form field type, stored and compared as strict
ISO `YYYY-MM-DD` values. Cover the D1 schema, every route/type registry,
shared validation/conditional projection, public and speaker renderers, the
form builder, the demo seed, migration evidence, tests, and local speaker-flow
evidence. `DEPLOY.md` is authoritative: do not deploy; the live site remains a
read-only reference and deployment is a human-owned post-merge step.

## Approach

1. Preserve the unrelated dirty work already present in the supplied checkout
   (it is an MRQ-93 branch with Portal/venue changes). Create a clean MRQ-95
   feature worktree from the current `github/main` ref before implementation;
   keep all Lattice state and this plan in the authoritative checkout.
2. Baseline the clean branch with the repository's node/package state and
   record any pre-existing gate failures before changing source.
3. Add migration `0008_form_field_dates.sql`. Rebuild `form_fields` with the
   `date` CHECK arm and rebuild its sole child, `submission_answers`, during
   the same migration so existing answer rows, both tables' indexes, and the
   foreign-key graph survive without relying on a disabled-FK pragma. The
   migration will not reinterpret arbitrary historical answer text. The demo
   database has no seeded hotel answers; its deterministic reset/reseed will
   update the two deterministic hotel field rows to `date`.
4. Register `date` in `src/db/schema.ts`, the two form-builder route schemas,
   the public-form body schema, and every discovered UI/client field union.
   Add strict calendar validation and canonical projection in the shared
   `form-conditions` helper so malformed direct API values produce a clear
   issue and valid values round-trip unchanged. Keep the existing condition
   operator vocabulary; ISO date equality/negative equality then has stable
   date-only semantics without introducing range/timezone scope.
5. Render native `<input type="date">` controls in the public form, speaker
   form task, and builder preview. Reuse existing field classes and avoid
   text-length/pattern rules for `date`; the builder exposes the organizer
   label `Date`.
6. Change the hotel seed's arrival/departure fields to `date`, sweep all seed
   field definitions for other semantic dates, and add focused tests for
   seed shape, route acceptance/rejection, projection/conditions, rendering,
   and migration preservation. Update migration registration/check fixtures
   wherever the repository requires the new migration.
7. Run the exact suite within the 45s objective (and the relevant static/gate
   checks), perform a real scratch D1 migrate with pre-existing fields,
   answers, indexes, and foreign keys, then run the app locally and use the
   approved c11 browser surface as a speaker. Capture a local screenshot
   showing both native travel date controls and the saved ISO values after
   reload. Read the live `/health` endpoint only if needed to identify the
   deployed baseline; never deploy from this branch.
8. Commit meaningful checkpoints, rebase the feature branch on the latest
   `github/main`, reinstall dependencies if the rebase changes the lock/tree,
   re-gate the exact HEAD, push only to `github`, open the GitHub PR against
   `Stage-11-Agentics/marquee` `main`, and leave merge/deploy to the human.

## Judgment calls

- Historical arbitrary prose in `submission_answers` is preserved rather than
  guessed at or silently rewritten. New `date` writes are strict; the seeded
  demo is reset/reseeded so its travel fields are typed dates and there are no
  stale seeded travel answers to migrate.
- A native date control is the only new interaction. No ranges, times,
  timezone handling, custom calendar, or date-specific text rules are added.
- The current checkout's unrelated MRQ-93 edits are not part of this PR;
  the clean feature worktree is a safety boundary, not a scope expansion.

## Evidence handoff

The Lattice task will receive status/comments at planning, implementation,
local validation, deployment-deferred, and PR-open transitions. The PR body will
name the historical-data decision, scratch migration proof, exact test/gate
results, local URL flow, screenshot artifact, and the fact that deployment is
pending after human merge.
