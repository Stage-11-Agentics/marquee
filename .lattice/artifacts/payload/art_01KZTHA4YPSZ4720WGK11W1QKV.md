# Code Review: MRQ-124 — Batch publish in the agenda builder

Reviewed at branch `mrq-124-batch-publish` @ `810a9c2`.

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the server-side publication command is genuinely well built. Two
things block it: the API registry committed on this branch is wrong and makes
`npm run check:api` (and therefore `pr-gate`) fail — I ran it and reproduced the failure — and
the accessibility half of the ticket, which was the *reason* the ticket carries CFP-15, ships
labels that are false whenever a slot is occupied plus a large number of dead tab stops.

## 2. Summary

I reviewed the batch-publish read model (`agenda.queries.ts`), the write command
(`agenda.routes.ts`), the audit helper, the builder UI panel, the agenda-slot ARIA changes,
and the four test files. The transactional design is the strongest part of the diff: the
count-guarded `UPDATE`, the `updated_at`-stamped second write, and the conditional
`INSERT … SELECT` audit rows are a careful, honest answer to the reversal-safety constraint
the ticket asked to preserve, and the negative controls in the integration test actually
exercise it. The blocking findings are around it, not in it: a stale `cli/api-registry.json`
that fails the API parity gate, and `role="button"` drop cells whose "Empty agenda slot"
label is asserted even when the cell contains sessions.

Verification I ran on the branch:
- `npm run check:api` → **fail** (`cli-registry-parity`, `cli-registry-hash-mismatch`)
- `node --test tests/node/agenda-publish.AIA-07.test.mjs` → 2 passed
- `npx vitest run tests/integration/api/agenda.AC-70-74-252-253.test.ts` → 9 passed (3.55s)

## 3. Issues

**[CRITICAL] cli/api-registry.json:3 — The regenerated registry drops a live operation and carries a stale document hash; `check:api` fails**

Commit `bd97f90` ("refresh API registry after rebase") added
`POST /api/v1/events/{eventId}/agenda/publish` but also *removed*
`POST /api/v1/events/{eventId}/speakers/invite inviteSpeakersToPortal`. That operation is
real and served on this branch: `src/routes/speaker-invites.routes.ts:32` declares it and
exports `apiRoutes`, and `src/routes/_manifest.ts:19` auto-registers every `**/*.routes.ts`
via `import.meta.glob`, so nothing had to import it. The registry looks like it was
regenerated against a build predating MRQ-113. Running the gate command confirms both halves
are wrong:

```
"findings": [
  { "code": "cli-registry-parity",
    "missing": ["POST /api/v1/events/{eventId}/speakers/invite inviteSpeakersToPortal"] },
  { "code": "cli-registry-hash-mismatch",
    "served":   "e3927306f4f8661899cb4974e4e50215624d3cd483a7bad6f2a187d75682b4db",
    "registry": "677f06c50624f50384698afe5c69fd73e0e92f635f83f3b76306896d29457dc7" }
]
```

The `documentSha256` mismatch is independent of the missing operation, so a hand-edit that
only re-adds the invite line will still fail.

**Fix:** delete `dist/`, rebuild, and regenerate with `node cli/generate-api-registry.mjs`
against *this* branch's bundle, then re-run `npm run check:api` and confirm zero findings
before re-running the ticket gate. The gate result pasted into the completion comment must
come from a run that includes this file.

---

**[MAJOR] src/ui/agenda/AgendaPage.tsx:254, src/ui/agenda/track-board.tsx:37 — `role="button"` drop cells announce a false label when occupied, expose no keyboard behaviour, and add dozens of dead tab stops**

`DropCell` now unconditionally sets `role="button" tabIndex={0} aria-label={ariaLabel}`, and
every caller passes a label beginning `Empty agenda slot ·` / `Empty track slot ·`. But in
`DayBoard` (`AgendaPage.tsx:355-361`), `WeekBoard`, `RoomBoard`, and `TrackBoard` the cell's
children are the `SessionTile`s for that room/time. So a cell holding three talks announces
itself as the button "Empty agenda slot · Room 101 · Mon · 10:00" — the label is a statement
that is false exactly when the cell has content worth describing.

Three compounding problems:
1. **False name.** The label never reflects occupancy.
2. **Invalid nesting.** `role="button"` may not contain interactive descendants; each
   `SessionTile` is `draggable` with its own `aria-label`, a resize handle, and a room-open
   control. Several screen readers flatten or suppress the children of a button, so this can
   make placed sessions *less* reachable than before the change.
3. **Dead keyboard stops.** The cell is focusable and announced as a button but has no
   `onClick` or `onKeyDown`. `TIME_SLOTS` has 12 entries (`track-board.tsx:7`), so the day
   view alone adds 12 × rooms focus stops that do nothing on Enter/Space, and the week and
   track views add more. That is a keyboard regression on the page the ticket set out to make
   more navigable.

This is the half of the ticket that CFP-15 and every AIA item depend on, so it matters more
than its size in the diff.

**Fix:** drop `role="button"`. Use `role="group"` (or leave the cell generic) with a label
computed from actual content — `Empty slot · Room 101 · Mon 10:00` when the child list is
empty, `Room 101 · Mon 10:00 · 2 sessions` when it is not — and make the cell focusable only
if you also give it a real activation handler (e.g. Enter opens a "place a session here"
affordance). If focus is wanted purely so the drop target is *findable* by an agent or by
tests, a labelled non-focusable region plus the existing `data-track-slot` hooks already
achieves that without inventing a button that does nothing.

---

**[MAJOR] src/routes/agenda.routes.ts:189,234-265 — Placeholder expansion and a 40-row cap instead of the codebase's `json_each` bulk convention; the headline "publish the program" case cannot complete**

`submission_ids` is capped at 40 (line 189) and the SQL expands one placeholder per id twice
over (lines 234-235, 244, 255, 265), which is why the cap exists at all — the agenda update
binds `2N+3` values and 40 is what keeps it under D1's limit. The diff then registers two new
exemptions in `tests/node/bulk-paths.AC-66-69.test.mjs` to legalise the pattern.

The codebase already solved this and documents the rule in `src/api/bulk.ts:129-134`:
`WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))` via `runBulkByIds` — *"One
serialization, one prepare, one `.run()` — never placeholder expansion, never chunk
splitting."* `src/jobs/cascade/decisions.ts:255,336,499` and `src/jobs/mail/audience.ts:59`
all follow it.

The user-visible consequence: the panel offers only per-row checkboxes — there is no
select-all (I grepped; none exists) — and the client sends the raw selection with no chunking
(`AgendaPage.tsx`, `publishSelected`). A first-time organiser publishing a 60-session program
must tick 40 boxes, publish, then tick the rest; tick 41 and they get a raw Zod 422 through
`errorSummary`. The demo seed has exactly one unpublished session, so nothing in the test
matrix or a manual pass would surface this.

**Fix:** rebuild both updates on `json_each(?)` with a single JSON binding (the count-guard
subquery becomes `... AND candidate.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`),
raise the cap to something a real program fits inside, remove the two new
`EXPECTED_PLACEHOLDER_SITES` entries, and add a "Select all N" control to the select step.

---

**[MINOR] src/routes/agenda.routes.ts:194,308 — `skipped_submission_ids` is a permanently empty field in the public contract**

The response schema promises `skipped_submission_ids`, but the handler is all-or-nothing: any
ineligible id throws 409 before the write, and line 308 always returns `[]`. A published API
field that can never be non-empty invites a client to write branch logic that never runs.

**Fix:** remove it from `batchPublishResponse` and the return value. The 409 already carries
the "something changed, refresh" meaning.

---

**[MINOR] src/routes/agenda.queries.ts:508 — The "live" count is narrower than what the public site actually shows**

`live` counts `is_published = 1 AND submission.status = 'accepted'`, but the public agenda
query (`src/lib/public-site.ts:329-332`) renders `ai.is_published = 1 AND s.status NOT IN
('rejected','withdrawn')`. A session published while accepted and later moved to, say,
`waitlisted` stays on the public agenda but is counted in neither term — the chrome under-
reports what is live. Withdrawn/rejected agree between the two, so this is a narrow window,
but the counter's whole job is to be the one honest number in the chrome.

**Fix:** count `live` with the same predicate the public site uses, keeping the stricter
`status = 'accepted'` for the *candidate* list where the reversal-safety guard belongs.

---

**[MINOR] src/routes/agenda.routes.ts:345 — `publicationActor` is a fifth copy of `actorFor`**

Identical logic already exists at `submission-record.routes.ts:167`,
`submission-decisions.routes.ts:35`, `submissions-bulk.routes.ts:43`, and
`submission-reversal.routes.ts:103`. The diff correctly extracted `auditStatementFromSelect`
into `src/lib/audit.ts` rather than inlining it — this deserved the same treatment.

**Fix:** lift one implementation into a shared module (`src/lib/auth/` or alongside
`DecisionActor`) and have all five call sites use it. Doing it in this ticket is optional;
doing it *here* rather than adding a fifth copy is not much more work.

---

**[MINOR] tests/node/agenda-publish.AIA-07.test.mjs:20-24 — Assertions on source whitespace prove formatting, not behaviour**

`assert.match(page, /role="button"\n    tabIndex=\{0\}\n    aria-label=\{ariaLabel\}/)` binds
the test to exact indentation and attribute order; a formatter run breaks it, and it passes
happily against the mislabelled-occupied-cell defect above because it only ever reads the
source string. `tests/unit/agenda-track-board.AC-78-81.test.ts` already renders these
components with a real snapshot, so a DOM-level assertion was available.

**Fix:** move the ARIA assertions into the rendering unit test — render a board with an
occupied cell and an empty cell and assert each accessible name is *true of that cell*. That
test would have caught the major finding; this one cannot.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:782,801 — A failed publish reports below the toolbar, not at the panel that failed**

`publishSelected` writes failures into the shared `notice` state, rendered at line 801 after
the publication panel and the view toolbar, while the publication success state renders at
line 782 above the panel. The user presses Publish in the panel and the explanation appears
past the toolbar.

**Fix:** give the panel its own error slot inside `agenda-publication-actions` (space already
reserved by `min-height: 52px`), so the outcome lands where the action was taken.

## 4. Positive Observations

- **The write path is the best part of this diff and it is genuinely careful.** The
  count-guarded `UPDATE` makes the agenda half all-or-nothing without a second round trip;
  the submissions update keys off `item.updated_at = now` so it can only touch rows this batch
  actually stamped; and the post-batch reconciliation refuses to report success on a count
  mismatch. The reversal-safety constraint the ticket insisted on is preserved in the SQL
  itself rather than in a pre-flight read that a race could invalidate.
- **`auditStatementFromSelect` is the right extraction.** Making the audit row conditional on
  both writes having landed — via `INSERT … SELECT` with predicates — keeps audit and reality
  from disagreeing, which is exactly the invariant the header comment in `src/lib/audit.ts`
  exists to protect. Adding it to the shared helper instead of hand-rolling an INSERT at the
  call site is the correct instinct.
- **The integration test earns its name.** It walks accepted → withdrawn → 409 → back to
  accepted → mixed-batch 409 → success, and asserts the database state (not just the status
  code) after each rejection, plus the dual-table flags and the audit row at the end. The
  mixed-batch case in particular is the one a lighter test would have skipped.
- **The read model is single-sourced.** `readAgendaPublication` is used by the snapshot, the
  candidate list, and the post-publish refresh, so the counter, the preview, and the command
  provably answer the same question — the comment at `agenda.queries.ts:296-300` says exactly
  why, and it is right.
- **The two-step select → review flow is honest.** The preview shows the precise fields about
  to become public (title, time, room, building, speakers), says "Nothing is visible until you
  confirm," and the success state links to the public agenda. The CSS reserves space
  (`min-height` on the actions row and candidate rows, `tabular` numerals on the counter),
  which respects the no-jumping rule.
- **`public_agenda_url` matches the real public route.** `/agenda?event=<slug>` is what
  `public-agenda.route.tsx:65` parses, and `events.slug` is `NOT NULL`, so the link resolves.
