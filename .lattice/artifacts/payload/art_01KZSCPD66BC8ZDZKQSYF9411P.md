# Code Review: MRQ-86 — A live decision button says nothing about the decision already made

**Reviewed:** branch `mrq-86-decided-record-cue`, commit `564fbd9`, diffed against
`merge-base(github/main, mrq-86-decided-record-cue)`.

> **Note on the review prompt.** The `### Diff` block embedded in the prompt is **not** this
> ticket's work — it contains the `nav-remove-uninstalled-modules` changes (`route-table.ts`,
> `delivery-health.ts`, `.lattice/*`) from the checkout the prompt was generated in. I ignored
> it and reviewed the real MRQ-86 diff: `SubmissionRecordPage.tsx` (14 lines), new
> `src/ui/submissions/record-copy.ts` (35 lines), new
> `tests/unit/record-decided-cue.MRQ-86.test.ts` (42 lines). Whoever generates these prompts
> should key the diff to the ticket's branch, not the current working tree.

### 1. Verdict

**FAIL (implementation-level)**

The approach is right and the scope discipline is exemplary — the plan should not change. One
defect blocks it: on a record whose acceptance was reversed to **Withdrawn**, the new cue names a
decision that no longer stands, so the page reads `Withdrawn` at the top and `Decided Accepted` in
the action card. The fix is one comparison inside `decidedNote` plus a test, entirely within owned
files.

### 2. Summary

MRQ-86 replaces the Record action card's unconditional `.subtle` copy with a note naming the
standing decision, lifting `moment`/`statusLabel` into a new JSX-free `record-copy.ts` so the copy
can be unit-tested without a component harness. The work is genuinely minimal and in-scope: no API
change, no migration, no confirmation step, `can_decide` untouched, `record.css` untouched, and the
header-height constraint is defended by an invariant (decided copy never longer than undecided
copy) rather than a `min-height` that would drift from the font. Verified locally: the 4 new tests
pass, `tsc --noEmit` is clean, `npm run trace:ac` reports 0 errors, `npm run check:design` passes.
The key finding is that `record.decisions[0]` is not the same thing as "the decision that currently
stands" — a withdrawal writes no decision row, so the cue goes stale exactly where the ticket cares
most.

### 3. Issues

**[MAJOR] src/ui/submissions/record-copy.ts:32 — The cue names a decision that has been undone on a withdrawn record**

`decidedNote` trusts `record.decisions[0]` as the decision in force. It isn't. A withdrawal writes
**no** `submission_decisions` row:

- `writeAcceptanceReversal` (`src/jobs/cascade/decisions.ts:727`) inserts a decision row **only**
  when `input.outcome === "rejected"`. The `withdrawn` outcome updates `submissions.status` and
  stops.
- `writeBulkSubmissionDecisions` (`src/jobs/cascade/decisions.ts:912`) sets `target = null` for
  `action === "withdraw"`, so that path skips `insertDecisions` too.
- `insertDecisions` is typed `status: "accepted" | "waitlisted" | "rejected"` — withdrawal is
  structurally outside the decision log.

So take the ticket's own record: Accepted, then reversed through the `AcceptanceReversalPanel`
rendered directly below this card (`SubmissionRecordPage.tsx:137`, outcome defaults to
`withdrawn`). Result: `status = "withdrawn"` → stage derives to `declined` (`BOARD_STAGE_SQL`
`ELSE 'declined'`) → `can_decide` is true (`submission-record.routes.ts:418`) → the card renders
with `decisions[0]` still being the *accepted* row. The organizer sees:

- summary chip: **Withdrawn**
- action card header: **Decided Accepted · Aug 18, 2026**

The page contradicts itself, and it does so in the direction this ticket exists to prevent — the
cue tells an organizer a decision stands when it has been reversed. One click on the same page
produces it. Bulk withdraw produces it too.

**Fix:** pass the record's stored status and only name the decision when it still matches. The
stored statuses are `draft | submitted | in_review | accepted | waitlisted | rejected | withdrawn`
(`src/db/schema.ts:49`) — `scheduled`/`published` are *derived stage*, not status — so plain
equality is correct and does **not** drop the cue on the ticket's Accepted-and-Scheduled example
(its stored status is `accepted`):

```ts
export function decidedNote(
  latest: { resulting_status: string; decided_at: number } | undefined,
  status: string,
): string {
  // A withdrawal writes no decision row (writeAcceptanceReversal inserts only for
  // `rejected`), so the newest row can describe a decision that has since been undone.
  // Name it only while it still matches the record.
  if (!latest || latest.resulting_status !== status) return UNDECIDED_RECORD_ACTION_COPY;
  return `Decided ${statusLabel(latest.resulting_status)} · ${moment(latest.decided_at)}`;
}
```

Call site becomes `decidedNote(record.decisions[0], record.status)`
(`SubmissionRecordPage.tsx:133`). Add a `CONTRACT · ` test for the accepted-then-withdrawn case,
and one pinning that an accepted record whose stage has advanced still shows its cue. The length
invariant is unaffected. (If you'd rather say something on a reversed record than fall silent,
that's a copy call for the operator — but it must not be the stale decision, and it must stay
within the length invariant.)

---

**[MINOR] tests/unit/record-decided-cue.MRQ-86.test.ts:33 — The height invariant is asserted in characters, which is a proxy for rendered width**

`expect(note.length).toBeLessThanOrEqual(UNDECIDED_COPY.length)` guards the "elements never jump"
constraint by character count. `.subtle` is 11.5px proportional text with `tabular-nums`
(`src/styles/components.css:56`) — digits are fixed-width, letters are not — so equal character
counts do not imply equal rendered width, and `toBeLessThanOrEqual` admits exactly that boundary.
The comment above it claims "strictly shorter," which the assertion doesn't enforce.

In practice there's real headroom (31 chars vs 41, and `.card-head` carries `min-height: 52px`), so
nothing is broken today. But the test's stated job is to make the invariant impossible to break,
and it doesn't quite.

**Fix:** either `toBeLessThan` with a stated margin (e.g. assert the decided note stays ≤ 80% of
the undecided length), or reword the comment to say plainly that this is a character-count proxy
chosen deliberately over a layout measurement. Either is fine; the mismatch between comment and
assertion is the part worth closing.

---

**[MINOR] src/ui/submissions/record-copy.ts:34 — "Decided Accepted" reads as machine output**

`Decided ${statusLabel(...)}` yields `Decided Accepted`, `Decided Maybe`, `Decided Rejected`.
`Decided Maybe` in particular reads oddly for an organizer. Constraints are met (plain language, no
field names, no slugs, `Maybe` used for the waitlist), so this is taste, not a violation —
`Accepted · Aug 18, 2026` or `Already accepted · Aug 18, 2026` carry the same signal in the
organizer's own words. Worth an operator glance during the browser check; both alternatives stay
inside the length invariant.

---

**[MINOR] no file — The wiring itself is untested; the browser verification is undemonstrated**

The tests cover `decidedNote` as a pure function. Nothing asserts that the page passes
`record.decisions[0]` (rather than, say, the last element) into the header — that link is
eyeball-only. The repo has no component-render harness at all (`tests/` is `unit`, `node`,
`integration`, `ac-claims`), so this matches the house pattern and I'm not asking for new infra.
But it does mean the ticket's stated verification — two card headers side by side in a browser,
plus taking a decision on-screen — is the only thing that closes the loop, and the branch carries
no evidence it was run. Do it before merge, and include the withdrawn record from the major finding
as a third case.

### 4. Positive Observations

- **The scope discipline is the best part of this change.** Every one of the ticket's "out of
  scope" items was genuinely left alone: no confirmation step, no disabled button, `can_decide`
  untouched, no API field, no migration, and `record.css` never opened. The diff is 79 insertions
  for a UX defect — that's the right size for this ticket.
- **Solving the height constraint with an invariant instead of a `min-height` is the better
  engineering.** A reserved-space rule in CSS silently rots when the font or copy changes; a test
  that pins "the decided string is never longer than the string already shipping in that slot"
  fails loudly at the moment someone breaks it. The reasoning is written down at
  `record-copy.ts:20–30` and it's correct reasoning.
- **The extraction is motivated, not reflexive.** `record-copy.ts` exists so the copy can be tested
  without dragging a CSS-importing component tree into a Worker-free test, and the module comment
  says exactly that. `moment`/`statusLabel` moved byte-identical — no behavior smuggled into a
  refactor.
- **`UNDECIDED_RECORD_ACTION_COPY` as a shared constant** means the undecided string has one
  definition used by both the render path and the test, so the invariant can't drift from the copy
  it guards.
- **The tests explain themselves.** Each one carries a comment naming the rule it defends and where
  that rule comes from (`decided_at DESC` ordering, DESIGN.md's Maybe naming, elements-never-jump),
  which is what makes them useful to the next person rather than just green.
- **Housekeeping is clean:** `CONTRACT · ` prefixes throughout, `trace:ac` 0 errors, `check:design`
  pass, typecheck clean, tests pass in 1.5s.
