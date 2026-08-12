# Plan Review: MRQ-84 — Sessionize importer silently drops unrecognized tracks and formats

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the submitted plan for MRQ-84 against the task description and the actual
import path in `src/lib/sessionize-import.ts`. The plan is a **byte-for-byte copy of the
task description** — same headings, same prose, same code excerpts — with no
implementation steps, no acceptance criteria, and no decisions resolved. The ticket is
unusually prescriptive, so the copied content is not *wrong*; the problem is that the
planning stage consumed the ticket and returned it unchanged, leaving the one genuine
correctness trap in this change unaddressed: the `current?.primary_track_id` fallback
means "left unset" is a false statement on a re-import over a row already categorized
inside Marquee.

Process note, surfaced rather than scored: this review is running in the primary
checkout on `main`, where MRQ-84 is **already implemented and merged** (`98d768d8`,
"MRQ-84: the importer drops a track it doesn't recognize, and says so", PR #29).
`unmatchedTaxonomyNotes()` exists at `src/lib/sessionize-import.ts:629` and is wired
into the `reason` array at line 773. If this review gate is being replayed against
shipped work, the findings below are best read as what the plan *should* have said —
and notably, the merged code resolves issue #1 correctly while the plan never raised it.

## 3. Issues

**[CRITICAL] Plan (whole document) — The plan is a verbatim duplicate of the task description**

The `### Plan` section reproduces the task description exactly: "What was seen", "Root
cause", "Scope", "Constraints", "Verification", "Delivery", "File ownership" — all
identical strings. Nothing was added: no ordered implementation steps, no function or
signature the implementer will introduce, no test names, no enumeration of the cases the
change must distinguish. A plan that restates its input has not done the work the
planning gate exists to do; it defers every decision to implementation time, which is
exactly what this gate is meant to prevent. It also means the plan cannot be reviewed
for the thing it is supposed to contain — the approach.

**Recommendation:** Return to `in_planning` and write an actual plan. At minimum:
(a) the shape of the change — where the "did this non-empty value resolve?" fact is
captured and how it reaches line 773 (a small pure helper taking `{name, matched,
resolvedId}` per field and returning note strings is the natural seam, and it is unit
testable without a D1 fixture); (b) the exact copy strings for each case; (c) the test
list with `AC-<n> · ` titles; (d) the explicit statement that `next.formatId` /
`next.trackId` are computed *before* the reason array, so the note can read the resolved
value rather than re-deriving it.

---

**[CRITICAL] Plan → Scope — "left unset" is wrong on the update/skip path, and the plan never notices**

The ticket's suggested copy is `track "Platform" not recognized, left unset`. But the
code at `sessionize-import.ts:686-687` does **not** unset anything on a re-import:

```ts
formatId: format?.id ?? current?.format_id ?? null,
trackId: track?.id ?? current?.primary_track_id ?? null,
```

If a session was imported earlier and an organizer then assigned it a track inside
Marquee, a subsequent import whose CSV carries `Platform` resolves to `null`, falls back
to the **existing** `primary_track_id`, and the row keeps its track. Emitting "left
unset" there tells the operator their categorization was lost when it was not — a false
alarm in exactly the flow (re-import) that Verification step 2 exercises. The plan
copies the ticket's phrasing without noticing the fallback it quoted three paragraphs
earlier.

**Recommendation:** Make the plan state the two-case rule explicitly and give both
strings: when the resolved id is `null`, `… not recognized, left unset`; when the
fallback supplied a value, `… not recognized, existing value kept`. Add an AC and a test
for the second case — import a row, set a track in Marquee, re-import with an unmatched
name, assert the reason does not claim the value was unset.

---

**[MAJOR] Plan → Verification — No acceptance criteria are minted, but the gate requires them**

The Constraints section carries `Test titles must begin AC-<n> · or CONTRACT · or
trace:ac fails`, and the plan reproduces that line — while defining zero AC numbers. The
implementer is left to invent both the criteria and their numbering at test-writing
time, which is how traceability drifts. The verification prose describes four assertions
(unmatched imports successfully; unmatched value appears in reason; empty column
produces no note; reason correct on the `skipped` path) but never names them as criteria.

**Recommendation:** Enumerate the ACs in the plan, one line each, and map each to its
test title. A workable set: AC-1 unmatched track/format still imports; AC-2 the reason
names the unmatched value; AC-3 empty track/format columns produce no note; AC-4 the
note is correct on the re-import (`skipped`/`updated`) path; AC-5 an unmatched name over
an existing categorized row says "existing value kept", not "left unset".

---

**[MAJOR] Plan → Verification #2 — The `skipped` path is asserted without acknowledging what makes a row `skipped`**

Outcome is `!current ? "created" : actualChanged ? "updated" : "skipped"`
(`sessionize-import.ts:768`). A genuine re-import of an unchanged export produces
`skipped` *because nothing changed* — including the track, which stayed unmatched and
therefore stayed at its fallback. The plan asks to "confirm the reason still reads
correctly on the `skipped` path" without saying what "correctly" is there, and the
answer depends entirely on issue #2 above. A second-run row will read
`same external_ref and values already present; track "Platform" not recognized, …` —
which is the intended behavior, but the plan should say so rather than leave the
implementer to decide whether the note belongs on a skip at all.

**Recommendation:** State the expected full reason string for both the first import and
the re-import in the plan, so the test is transcribing a decision rather than making one.

---

**[MINOR] Plan → Scope — The outcome-chip question is raised and left open**

"Consider whether the outcome chip should stay `created`…" is a question, not a
decision. It is the ticket's question; a plan should close it. The ticket already
constrains the answer (do not invent a new outcome value), so the plan can simply commit.

**Recommendation:** Write the decision: outcome semantics are unchanged; the caveat
lives only in `reason`. One sentence, and the implementer never reopens it.

---

**[MINOR] Plan → Scope — The preview surface is not mentioned, and the operator learns only after committing**

`previewCsv()` (`sessionize-import.ts:330`) parses and maps columns; it does not touch
the event's taxonomy, so the wizard's live preview cannot show this warning. The
operator sees the note only in the Row detail table *after* the import has run. That is
consistent with the ticket's "no new UI" constraint and its out-of-scope list, but it is
a real limitation of the chosen seam and belongs in the plan (and in the PR's
follow-up note) rather than being discovered during the smoke test.

**Recommendation:** Add one line acknowledging that the warning is post-hoc by design,
and flag "surface unmatched taxonomy in the preview step" as the follow-up the ticket
already invites ("note it in the PR rather than growing this").

---

**[MINOR] Plan → File ownership — `src/ui/import/*` is claimed conditionally but no UI work is needed**

`SessionizeImportPage.tsx:147` renders `{row.reason ?? "—"}` in an unstyled `<td>`, so a
longer reason string flows through with no component change. Claiming the directory
"if the reason needs presentation work" holds a lock a sibling agent may want. The one
real risk is visual, not structural: reasons now concatenate up to five clauses and the
results table has no wrap or width treatment called out.

**Recommendation:** Either drop the conditional claim, or make it concrete — "read the
Reason column width during the smoke screenshot; if a five-clause reason overflows,
`sessionize-import.css` is in scope for wrapping only."

## 4. Positive Observations

- **The underlying ticket is exemplary**, and the plan inherits that: the defect is
  evidenced end to end (`UX-SWEEP-FINDINGS-PASSB.md`, Flow 5), the root cause is located
  to exact lines, and the seam for the fix is identified with the surrounding code quoted.
- **The scope fence is drawn in the right place.** Explicitly ruling out fuzzy matching
  and a mapping UI — while naming both as legitimate product ideas for the PR notes — is
  precisely the discipline that keeps a small defect ticket small.
- **The "no new failure mode" constraint is well argued.** Tying it to the verified
  duplicate-safety result (`created: 0, skipped: 6`) makes it a fact the implementer can
  check rather than an instruction to obey.
- **The copy standard is right.** Insisting the unmatched value be named — because the
  operator's next action needs it — is the kind of concrete taste rule that produces
  organizer-facing text worth reading, and it matches the "the organizer's language"
  principle in `PHILOSOPHY.md`.
- **Verification demands a real-artifact smoke through the wizard UI**, correctly noting
  that Pass B validated the API only and the wizard has never been driven in a browser.
  That gap is called out rather than assumed away.
