# Code Review: MRQ-165 — Import-roster bridge

**Verdict: Approve.**

## What I checked

The diff embedded in this review's prompt is not the branch's actual diff (see
"Process note" below), so I reviewed the real change directly in the worktree
at `Marquee-worktrees/mrq-165-import-roster` (`git diff github/main...HEAD`),
which touches exactly 5 files: `src/lib/sessionize-import.ts`,
`src/lib/speaker-membership.ts`,
`tests/integration/api/sessionize-import.AC-110-113.test.ts`,
`sequence/submission/LIMITATIONS.md`, and the Lattice plan file.

## Correctness

The fix matches the stated root cause. `src/lib/roster-source.ts`'s
`SPEAKER_ROSTER_PERSON_SOURCE` is `memberships(role='speaker')` UNION
participations-on-live-submissions; `importSpeaker` in
`sessionize-import.ts` now calls the existing `speakerMembershipStatement`
bridge (idempotent via `ON CONFLICT DO NOTHING`, backed by
`uq_memberships_event(org_id, event_id, person_id, role)`) after every speaker
row is reconciled — for created, updated, *and* unchanged/skipped rows. That
last case is the one the ticket's literal "created AND updated" language would
have missed: a person whose fields are identical between the CSV and the
existing `people` row still needs a first-time membership row if this is their
first import into *this* event. The implementation and its test
(`SKIPPED_MEMBERSHIP_PERSON_ID`) correctly widen the ticket's stated scope to
cover this, and the updated docstring in `speaker-membership.ts` says so
("reconciles every speaker row into the event even when the person's fields do
not change").

Undo correctness (AC2) is handled by snapshotting whether *this* row's import
created the membership (`beforeMembership` fetched before the write;
`membership_created`/`membership_id` set only when
`!beforeMembership && membershipWrite.meta.changes > 0`). Traced through:
- A pre-existing membership (`PREEXISTING_PERSON_ID`) is never marked
  `membership_created`, so undo leaves it alone.
- `removeImportedSpeakerMembership` runs **before** `cleanupImportedPerson` in
  `undoSessionizeImport`'s loop body, preserving the ordering the plan calls
  out: `cleanupImportedPerson` counts remaining `memberships` rows as one of
  its "still referenced" guards, so deleting the membership first is what lets
  a created-and-then-undone person (Dana) actually get deleted rather than
  silently retained.
- The `outcome === "skipped"` undo-skip guard was widened to
  `!createdMarker && !membershipCreatedMarker`, so a membership-only row
  (unchanged person, new membership) is no longer skipped during undo — this
  is the exact case the "cover skipped speaker membership reconciliation"
  commit added.

I did not just trust the branch's own tests — I independently reproduced
AC5 by adding a throwaway worktree at the pre-fix commit (`3d38a10a`, test
added, fix not yet applied) and running the new contract test there: it fails
red (`expected undefined to match { is_member: true, name: ... }`) exactly as
claimed, and passes green on `HEAD`. I also ran
`npm run pr-gate -- --ticket MRQ-165` on the branch myself: typechecks (worker/
client/test), production build, shell-truth/design/API/route/schema
contracts, `check:clocks`, the hermetic suite (214/214 passing), and the
merged AC trace all passed — overall `status: "pass"`, 73.1s against the 120s
gate budget. The suite step alone read 67.3s against its own 45s target but is
explicitly flagged `pass-over-budget` by `run-test.mjs`'s own contention
tolerance, not a gate failure — consistent with this project's documented
policy for a shared, multi-agent machine.

Test coverage (AC1–AC4) is genuinely thorough, not just present: it checks
roster visibility for four distinct row shapes (created/updated/pre-existing/
skipped-unchanged) in one pass, exact undo semantics with a
pre-existing-membership control, second-run idempotency at the DB level (row
count stays 4, no duplicates), and a route-level portal read
(`GET /api/v1/me/portal?eventId=...`) authenticated as the imported speaker,
proving `seat: "speaker"` — which is what the bridge docstring names as one of
the four readers that were broken without this row.

## Docs

`LIMITATIONS.md`'s SPK-03 entry is removed in the last commit. I confirmed
PR #174 (which had *added* that limitation entry) is already merged to
`github/main`, so removing it now that the bug is fixed is correct and matches
the plan's stated contingency ("If #174 merges before PR creation, remove or
rewrite its SPK-03 limitation entry during the rebase"). The ABS-14
agent-native paragraph the ticket's "GROUPED SECONDARY" section asks for is
already present on current `github/main` (landed via a different PR); this
branch's own plan correctly scoped that paragraph as "owned by a separate docs
PR" and left `SUBMISSION-NOTES.md` untouched here.

## Minor nit

`LIMITATIONS.md`: removing the SPK-03 bullet also removed the blank line that
separated the preceding bullet from the following `## Internal` heading, so
that bullet now runs directly into the heading with no blank line between
them. Cosmetic only, not worth blocking on.

## Process note (not a code defect, but worth flagging)

The diff supplied in this review's `prompt.md` is far larger than the
branch's real change set — it includes ~30 files spanning clearly unrelated
work (`CLAUDE.md`, `DEPLOY.md` deploy-freeze tooling, `clock-policy.mjs`,
`sequence/auto-eval/*`, multi-event submitter-portal changes in
`portal.routes.ts`/`PortalPage.tsx`, etc.) that this branch's 5 commits do not
touch. In the worktree, `git diff github/main...HEAD` — with `github/main`
freshly fetched — shows only the 5 files described above, and the branch's
merge-base is exactly `github/main`'s current head (0 behind). The diff
embedded in the review prompt appears to be stale, likely captured against an
older base before some rebase, and should not be used to judge what this PR
would actually contain. I'd regenerate it before this review artifact is
reused (e.g., for PR body generation or posting inline comments) — as given,
it substantially misrepresents the change under review.

Separately: no PR is open yet (`gh pr list` is empty for this branch; it's
local-only, 5 commits ahead of `github/main`), and the Lattice task is in
`review` status. That's consistent with this being a pre-PR review pass, not
a defect.
