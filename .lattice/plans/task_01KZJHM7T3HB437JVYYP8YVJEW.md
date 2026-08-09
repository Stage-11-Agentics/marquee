# MRQ-5: Seed generator — pool, evaluation, and deliberate ugliness

BUILDPLAN: M-04b — Wave 0 table (§3), runs in parallel with Wave 1's opening tickets

Scope (verbatim): The 940-row rejected/pending pool including ~40 incomplete Drafts, multi-track distribution (≥15%; ≥3 scheduled), participations, tasks, evaluations/recommendations, agenda with **two live double-bookings**, and the deliberate ugliness list. **Seeds the *demo organizer* persona a `reviewer` membership on the demo event, `reviewer_track_scopes` covering every track, and round-1 `round_assignments` over ~40 unreviewed submissions** — so the Review queue the admin sidebar links opens populated instead of on "no matching track scope", and AC-62's 20-advance speed run has material (B-3). Runs in parallel with M-09/M-10; off the CP-1 chain.

Deliberate ugliness (§1.1 / `check:seed`): a speaker on 3 submissions, a 4-person panel, an overdue task set, a live double-booking.
Amendment 5 fold: multi-track distribution ≥15% with ≥3 accepted-and-scheduled two-track sessions, asserted by `check:seed`.
Amendment 8 fold: seed obligations for the saved-views/Drafts queue (AC-247–249) land here.

File surface: `scripts/seed/pool.ts`, `scripts/seed/evaluations.ts`, `scripts/seed/agenda.ts`, `scripts/seed/ugliness.ts`

ACs: AC-3, **AC-234, AC-245, AC-246, AC-249**
Hours: 5
Workflow: inline-full
Shared files: none — per-entity seeder files only. **Never edit `scripts/seed/index.ts`** (M-04a owns it; it globs these files).
Deps: M-04a
Plan: filled in by delegator's plan phase
