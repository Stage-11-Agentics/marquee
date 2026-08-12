# Code Review: MRQ-82 — Acceptance reversal is not recorded in Decision History

## 0. Note on the review input (read this first)

**The diff embedded in the review prompt was not MRQ-82's.** It contained the
`.lattice` bookkeeping for MRQ-75 plus the code from PR #27
(`nav-remove-uninstalled-modules`: `delivery-health.ts`, `route-table.ts`) — the
diff of the checkout the review was launched from, not of the ticket under
review. No file named in the MRQ-82 plan appeared in it.

I located the real work and reviewed that instead:

- Branch `mrq-82-reversal-decision-history`, tip `5f95f8b`, PR **#31** (open, MERGEABLE)
- Worktree `Marquee-worktrees/ux-polish`, based on `main` at `21e6cef`
- Diff: `src/lib/decision-history.ts` (new, 99), `src/routes/submission-record.routes.ts` (+21/-4), `src/ui/submissions/SubmissionRecordPage.tsx` (+2/-2), `tests/unit/decision-history-reversal.MRQ-82.test.ts` (new, 79)

Worth fixing in the harness that generated the prompt — a reviewer who trusted
the attached diff would have reviewed someone else's PR and passed it under this
ticket's number.

---

## 1. Verdict

**PASS** — the implementation is correct, matches the plan, and I verified it
against a real D1 rather than only reading it. Findings below are all `minor`;
none blocks merge, and the ticket is deliberately LOW priority.

## 2. Summary

The delegator did what the plan asked first: it checked whether this was a read
gap rather than a write gap, and it was. `writeAcceptanceReversal` has always
written a full `submission.acceptance_reversed` audit row — status, all three
branch choices, and the cancelled counts (`src/jobs/cascade/decisions.ts:751`) —
and the record route simply never read it. The fix adds that read, merges it into
the decision list newest-first with a deliberate tie-break, and renders it through
the existing generic history markup. No migration, no new write path, no new
surface. The rationale for not using `submission_decisions` is correct and I
confirmed it in the schema: `migrations/0001_init.sql:388` CHECKs
`resulting_status IN ('accepted','waitlisted','rejected')`, and the default
reversal outcome is `withdrawn`.

**Verification I ran** (worktree `ux-polish`):

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` (full suite) | **91/91 pass**; 115s against the 45s budget — fleet load, not this change (the new file runs in 402ms) |
| `npx vitest run tests/unit/decision-history-reversal.MRQ-82.test.ts` | 9/9 pass |
| `npm run trace:ac` | no errors, no warnings, no uncovered ACs |
| **Live integration check (mine, temporary, deleted after)** | Seeded org/event/people/accepted submission + an `approve` decision row, ran the real `writeAcceptanceReversal`, then executed **the exact SQL from the diff** against real D1 and fed it through `decisionHistory()`. Result: 2 entries, reversal first, `resulting_status: "withdrawn"`, `decided_by_name: "AIE Program Committee"`. **The shipped query works.** |

That last one matters because the committed tests never execute the new SQL — see
Issue 3.

## 3. Issues

**[MINOR] src/routes/submission-record.routes.ts:260 — the reversal read scans every audit row in the conference**

The `WHERE` names `event_id`, `entity_id`, and `action`, but not `entity_type`.
SQLite therefore cannot use `idx_audit_entity_created(entity_type, entity_id,
created_at)` — its leading column is unconstrained — and falls back to
`idx_audit_event_created(event_id, …)`, scanning the whole event's audit log on
every record-page load. Verified with `EXPLAIN QUERY PLAN` in the integration
harness:

```
shipped:            SEARCH reversal USING INDEX idx_audit_event_created (event_id=?)
+ entity_type:      SEARCH reversal USING INDEX idx_audit_entity_created (entity_type=? AND entity_id=?)
```

Invisible on demo data; the record page is the busiest screen in the product and
speed is a graded feature (R7), so a per-open full-event scan is the kind of thing
that only shows up once a real conference has months of audit rows. The
pre-existing `history` query at line 293 has the same shape, so this is not a
regression — but it is a second one added.

**Fix:** add `AND reversal.entity_type = 'submission'` to the `WHERE`. One line,
switches the plan to the selective index. (Same one-line fix would help line 293.)

---

**[MINOR] src/routes/submission-record.routes.ts:255 — a second round-trip for rows the route already fetches**

The `history` query at line 290 is `SELECT id, action, actor_kind,
actor_person_id, entity_type, entity_id, after_json, created_at FROM audit_log
WHERE event_id = ? AND entity_id = ?` — the same table, the same filter, and it
already selects `action`, `after_json`, and `created_at`. Every reversal row is
therefore fetched twice per page load. The only thing the new statement adds is
`person.name` via the `people` join.

**Fix:** add `LEFT JOIN people person ON person.id = audit_log.actor_person_id`
and `person.name AS actor_name` to the existing history query, then filter
`history.results` for `action === "submission.acceptance_reversed"` in JS before
passing to `decisionHistory()`. Removes a D1 round-trip from the record page and
makes both reads impossible to drift apart. Worth doing only if you also take
Issue 1's `entity_type` predicate, since the history query needs it too.

---

**[MINOR] tests/unit/decision-history-reversal.MRQ-82.test.ts — nine tests, and none of them touch the code path that was actually broken**

The whole ticket is a read gap. The tests cover `decisionHistory()` and
`reversalNote()` as pure functions over hand-built row objects — good tests of the
merge and the copy — but nothing executes the SQL, so the failure modes that
would actually reproduce the bug are unguarded: a wrong `action` string, `entity_id`
vs `entity_type` confusion, a renamed column, or the `people` join breaking. All
nine tests stay green if the query returns zero rows forever.

The repo has an integration harness that makes this cheap: I wrote exactly this
test while reviewing (seed → real `writeAcceptanceReversal` → shipped SQL →
`decisionHistory`) and it ran in ~10s, in the pattern of
`tests/integration/cascade-reversal.AC-121-123.test.ts`. It passes today — this is
a regression-guard gap, not a live defect.

**Fix:** add one integration test titled `CONTRACT · a reversed record's history
reads back from the audit log the reversal actually wrote`, asserting two entries
with the reversal first. Reasonable as a follow-up given the deadline.

---

**[MINOR] src/lib/decision-history.ts:47 — the degrade path states facts it does not have**

`reversalNote` treats "choice is not the string `cancel`" as "the organizer chose
retain." So an unreadable or shape-drifted payload yields *"speaker tasks kept,
queued emails kept, calendar invite kept"* — three positive claims about a real
person's tasks and mail, asserted from the absence of data. That is worse than
saying nothing, on a screen whose entire purpose here is being trustworthy about
what happened.

The malformed-JSON test only asserts `resulting_status: ""`, so the note it
produces in that case goes unchecked. Note the strictly-malformed case is
unreachable in practice — `audit_log.after_json` CHECKs `json_valid`
(`migrations/0001_init.sql:709`) — so the live exposure is a future payload
whose keys are renamed, not corrupt JSON. Low severity, easy to close.

**Fix:** branch on `choice === "retain"` explicitly and emit something honest for
neither — e.g. omit the clause, or `"cascade choices not recorded"`. Then assert
the note in the malformed test.

---

**[INFO] merge coordination with PR #28 (`mrq-86-decided-record-cue`)**

MRQ-86 reads `record.decisions[0]` as "the standing decision"
(`decidedNote(record.decisions[0])`). After this PR, index 0 can be a *reversal*
entry, whose `decision` is the literal `"reversal"` and whose `resulting_status`
may be `withdrawn` — the cue would read "Decided Withdrawn". Currently muted,
because `can_decide` is only true for stages `submitted | in_review | accepted |
waved | declined` (`submission-record.routes.ts:435`) and a reversal leaves the
record `withdrawn` or `rejected`, so the cue does not render on a reversed record.
Both PRs edit `SubmissionRecordPage.tsx` and both report MERGEABLE now; whichever
lands second should re-check that assumption rather than inherit it. Not a defect
in this diff.

## 4. Positive Observations

- **It obeyed the plan's instruction to look before writing.** The plan said
  "confirm first whether this is a read fix" — the delegator confirmed it, found
  the audit row already carried everything, and shipped ~20 lines of SQL plus a
  pure merge function instead of a new write path and a migration. The header
  comment cites the actual CHECK constraint that forces the design, and that
  citation checks out against `0001_init.sql:388`.
- **The tie-break is the good detail.** A reversal to `rejected` writes its own
  `submission_decisions` row at the same millisecond as the audit row (both use
  `now` in `decisions.ts:729` and `:751`). Without the kind-aware comparator, the
  history reads as two unrelated rejections. It is handled, commented with the
  *why*, and tested — that is the kind of thing usually found in production.
- **"Retain" is reported as loudly as "cancel."** `reversalNote` says "speaker
  tasks kept," not just silence, and there is a test whose comment explains why:
  an organizer needs to know the speaker's tasks are still live as much as they
  need to know they were pulled. Also handles `0` correctly — "no queued emails to
  cancel" rather than "0 queued emails cancelled." This is the organizer's
  language, per PHILOSOPHY.md, not the schema's.
- **The UI change is two conditionals, not a new component.** The generic history
  renderer absorbed the new entry kind exactly as the ticket predicted, and the
  count chip now reads 2 where it read 1.
- **Test titles conform** (`CONTRACT · …` on every test and describe), `trace:ac`
  is clean, `tsc --noEmit` is clean, and the response schema is `z.unknown()`
  (line 20), so the added `kind`/`note` fields pass through without an OpenAPI
  change. Feedback and note render as JSX text, so they are escaped — no injection
  surface added.
- **The file-ownership constraint was respected**: MRQ-76 merged to `main` as
  `551407c` before this branch touched `submission-record.routes.ts`.
