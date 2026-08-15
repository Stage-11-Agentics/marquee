# Code Review: MRQ-164 — Three round-4 majors: the system holds the information and the organizer's surface drops it

## 1. Verdict

**PASS** — Implementation is correct and meets acceptance criteria.

## 2. Summary

Reviewed the actual PR diff (GitHub PR #182, 9 files: `src/lib/conflicts.ts`, `src/lib/sessionize-import.ts`,
`src/ui/onboarding/OnboardingPage.tsx` + `onboarding.css`, and five test files). Note: the diff embedded in
this review's prompt was much larger (~4,500 lines touching auto-eval infra, `check-clocks.mjs`,
`check-deploy.mjs`, the landing page, portal multi-event switcher, etc.) — that is stale-base noise, not
part of this PR. `gh pr diff 182` confirms the PR's real footprint is exactly the 9 files above; this review
is scoped to those.

All three parts land a correct, narrowly-scoped fix, each preceded by a failing-then-passing repro exactly
as the ticket demanded, and each verified live against a running Worker with screenshots attached to the
Lattice task (`--role validation`). The PR body states the required last-write-wins product decision
explicitly. Full suite (215 tests) and `pr-gate` both pass in this worktree (`pr-gate`: 42.7s/120s). No
correctness, security, or test-coverage issues found; a couple of minor/informational notes below, none
blocking.

## 3. Issues

No blocking issues found.

**[MINOR] `src/ui/onboarding/onboarding.css:56-62` — sticky-column offset is a hand-maintained magic number**
`.onboarding-matrix th.onboarding-speaker-column { left: 38px; ... }` is hardcoded to match
`.onboarding-select-column`'s `width: 38px` declared six lines above. The coupling isn't documented at the
`left: 38px` site (only at the `width: 38px` site, implicitly), so a future width change to the select
column silently misaligns the speaker column's sticky offset — the columns would overlap or leave a gap
during horizontal scroll, and nothing would catch it except eyeballing the UI (the node test only regexes
for `position: sticky`, not the numeric relationship).
**Fix:** either compute the offset in a CSS custom property shared by both rules (e.g. `--select-col-width`),
or add a one-line comment at the `left: 38px` declaration pointing back to `.onboarding-select-column`'s
width so the two are visibly paired.

**[MINOR, pre-existing/out-of-scope] `src/lib/sessionize-import.ts:472` — email is overwritten unconditionally, unlike title/company/bio**
`next.email = normalizeEmail(row.email || placeholder)` is written to `people.email` whenever a row is
`changed`, with no blank-preserves-stored guard — if an existing person is matched by name (not email) and
the CSV's email column is blank, their real email gets replaced by a synthetic `speaker+<hash>@example.invalid`
placeholder. This is the same failure class the ticket fixes for title/company/bio, but it predates this PR
(confirmed via `git show main:src/lib/sessionize-import.ts` — the line is unchanged) and is outside the
ticket's stated scope (`sessionize-import.ts:488-497`, title/company/bio only). Not a regression from this
diff; flagging only because it sits three lines above code this PR already touched, so it's cheap context
for a follow-up ticket.
**Fix (future ticket):** extend the same `merge()` helper to `email`, falling back to `current.email` when
`row.email` is blank and a match already exists.

## 4. Positive Observations

- **Part 1 root-cause is genuinely correct, and the PR proves it rather than asserting it.** The ticket's
  own five-layer trace said the obvious fix (role list) was already right; the implementer wrote the judge's
  exact repro first, confirmed it *passes* on unfixed `main`, and then found the real gap on the other side
  of the pair (`+ Add session` recording only a `submitter` participation). Verified independently by reading
  `src/lib/conflicts.ts`, `src/lib/participants.ts`, and `src/routes/agenda.queries.ts` in the worktree — the
  fallback in `conflictParticipants` is narrow exactly as claimed (fires only when no participant holds an
  agenda role) and composes cleanly through `sharedConflictParticipants` and `auto-place.ts` since all three
  share the one helper. Unit tests (`agenda-conflicts.AC-76-77.test.ts`) cover both the fallback and the
  no-false-positive case (a non-presenting submitter must not manufacture a conflict).
- **Part 2 correctly identified there was no data bug.** `onboarding.queries.ts` already derives `tasks`/`cells`
  from every `task_templates` row, confirmed by reading the route — the fix is entirely presentational
  (overflow affordance + sticky identity columns + "No tasks assigned" honesty), which is the cheaper and
  more honest fix than inventing a data-layer change for a rendering problem.
- **Part 3's product decision is stated, not implied**, exactly as the ticket demanded (last-write-wins on a
  non-blank disagreement, justified by the existing per-row outcome table + Batch undo), and the `merge()`
  helper is correctly a no-erase merge (`incoming.trim() || stored`) reused for title/company/bio uniformly.
  The `overwritten`/`retained` field-reason logic is precise: it only reports a field as overwritten when the
  merged value actually differs from what was stored.
- **All three parts have live-system validation, not just unit coverage.** Three screenshots are attached to
  the Lattice task (conflicts panel going 7→8 with "Colin Flaherty is double-booked", the onboarding scroll-note
  reading "8 task columns · scroll the grid sideways to reach…", and the import ROW DETAIL reading "matched by
  normalized email; overwrote title; kept company, bio (blank in CSV)") — each matches its acceptance criterion
  precisely, not just a generic "it loaded" screenshot.
- **Full suite passes clean**: 215/215 tests, `pr-gate` 42.7s/120s (well inside budget in this run). The new
  test files use the real API surface (`SELF.fetch` / `app.request`) rather than calling internals directly,
  consistent with the rest of the test suite's conventions.
- **Scope discipline**: the implementer noticed `/submissions/new`'s copy overpromises ("submitter and
  speaker-of-record context") but correctly filed that as a PR comment rather than minting a new ticket,
  respecting this repo's single-writer ticket-minting rule.
