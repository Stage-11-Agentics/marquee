# Plan Review: MRQ-167

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

I reviewed the plan against the current implementation of `src/routes/org-imports.routes.ts`, `src/lib/people-import.ts`, the `imports`/`import_rows` schema, and the existing Sessionize dry-run/undo precedent in `src/routes/imports.routes.ts` and `src/lib/sessionize-import.ts`. The diagnosis of the bug is accurate — the unconditional `name` overwrite, the missing preview, and the missing undo path are all real. But the "plan" submitted for review is a verbatim copy of the task description with no added implementation detail: it leaves the single architectural fork the ticket itself raises unresolved, specifies no API contract for either the preview or undo path, is silent on required frontend work, and gets the schema question wrong when the repository already has the answer. This needs to go back to planning before implementation starts.

## 3. Issues

```
**[CRITICAL] Shape of a fix, step 1 — the dry-run-vs-apply-and-show fork is not resolved**
The plan says "Dry-run first … Return the per-person, per-field diff … and apply only on
confirm — or apply-and-show, if that keeps the flow to one step, provided step 2 exists."
This is not a detail to fill in during implementation — it is the central design decision,
and the two branches produce materially different systems: (a) a new preview endpoint +
a confirm endpoint + a two-step frontend modal, versus (b) the existing single endpoint
writing immediately + a receipt/undo endpoint + an undo affordance in the UI. The route's
own docblock (org-imports.routes.ts:1-13) explicitly argues against a separate "run" step
("three round trips to reach the same place is the shape this product exists to delete"),
which makes option (a) a direct tension with an existing, deliberate product decision that
the plan doesn't even acknowledge, let alone resolve.
**Recommendation:** Pick one branch explicitly and justify it against the existing
one-step-import philosophy. Given the philosophy tension, apply-and-show with a receipt +
undo endpoint (mirroring the Sessionize precedent) is the more consistent choice — the
plan should say so and scope accordingly, or argue explicitly for the two-step exception.
```

```
**[CRITICAL] Shape of a fix, step 1/2 — no API contract for preview or undo**
Nothing in the plan specifies: the request shape for triggering a dry run (a `dry_run`
flag? a separate path?), the response schema for the field-level diff (per person, per
field, old → new — capped at how many rows for a 2MB CSV upload?), a new
`POST /api/v1/org/imports/{importId}/undo` route (or equivalent), its request/response
shape, its `operationId`, or its auth/rate-limit bucket. Acceptance criterion 1 requires
"a confirmation that shows the field-level diff, or is reversible from the import receipt
afterwards" — neither path exists today, and the plan does not sketch either contract.
**Recommendation:** Add explicit route(s), request/response schemas, and status codes
before implementation starts, following the existing OpenAPI-annotated pattern in
org-imports.routes.ts and the four-endpoint precedent in imports.routes.ts
(preview/mapping/run/undo).
```

```
**[CRITICAL] Acceptance — undo path has no named endpoint or ownership**
The acceptance criteria require the import to be "reversible from the import receipt
afterwards" as one of two valid options, but no route for reading a receipt or triggering
an undo is named anywhere in the plan. `org-imports.routes.ts` currently exports exactly
one route (`importPeople`). Sessionize's precedent (`imports.routes.ts:197-214`,
`undoSessionizeImport` in `sessionize-import.ts:914-945`) shows this needs a real endpoint
with idempotency handling (`undone_at !== null` guard), not just a schema field.
**Recommendation:** Name the new route(s) explicitly, and reuse the Sessionize
`undone_at`/`status='undone'` convention on the `imports` table rather than inventing a
new one.
```

```
**[CRITICAL] Frontend scope entirely unaddressed**
Both viable acceptance branches require UI changes that the plan does not mention:
`ImportPeopleModal` (`src/ui/people/PeopleModals.tsx:52-124`) is strictly one-step today
(upload → immediate result), with no preview/diff state and no receipt surface from which
an undo could be triggered. `PeoplePage.tsx:331-338` only shows a toast summary. A
diff-preview UI or a receipt-with-undo UI is new frontend work either way, plus copy that
must respect the CRM/Segment/Contacts/Directory word ban already enforced by
`tests/unit/people.MRQ-131.test.ts:213-221`. The plan doesn't identify which files change
or that frontend work is in scope at all.
**Recommendation:** Explicitly list the frontend components to add/modify, and note the
existing `SessionizeImportPage.tsx` stepper (`"upload" | "mapping" | "results"`) as the
pattern to borrow if the two-step path is chosen.
```

```
**[MAJOR] Shape of a fix, step 2 — schema guidance is wrong; the plan invents an open
question the repo already answers**
The plan says to record prior values "in `import_rows` (or a sibling)". In fact
`import_rows.before_json` and `imports.undone_at` already exist as typed columns
(`migrations/0001_init.sql:664-687`, `src/db/schema.ts:684-702`) and are already used by
the Sessionize import path — they are simply never populated by the people-import route.
No migration is needed; the fix is to change the per-row `SELECT` (currently
`SELECT id FROM people WHERE …`, `org-imports.routes.ts:80-83`) to also fetch
`name, title, company, bio`, and to populate `before_json` on the existing INSERT. Leaving
"or a sibling" open invites an unnecessary new table, which would also require updating
the demo-reset cleanup paths (`reseed-demo.ts:205-206`, `remove-demo.ts:52`) that currently
assume `import_rows` is the only row-level table to clear.
**Recommendation:** State plainly that no migration is required; the fix populates the
existing `before_json` (and `undone_at`) columns, matching the Sessionize convention.
```

```
**[MAJOR] "Diff that plan against the existing rows" understates the required new code**
`planPersonImport` (`src/lib/people-import.ts:89-122`) is a pure, synchronous CSV parser —
it never touches D1, never knows the org id, and does not itself decide create vs. update
(that decision is inline in the route's write loop). The plan's phrasing implies this is a
small extension of an existing diff; it actually requires a new DB-aware layer (e.g.
`planPersonImportAgainst(db, orgId, plan)`) that doesn't exist yet, and a decision about
whether skipped/duplicate rows (already dropped at people-import.ts:102-111) appear in the
diff view.
**Recommendation:** Name the new function/module and its signature, and state whether
skipped rows are represented in the preview/receipt.
```

```
**[MAJOR] No reuse of the existing in-repo precedent for this exact problem**
`src/routes/imports.routes.ts` + `src/lib/sessionize-import.ts` already implement
preview → mapping → run → undo for the Sessionize import path, including the
`before_json = COALESCE(import_rows.before_json, excluded.before_json)` first-snapshot-wins
convention (`sessionize-import.ts:424-442`) and a full undo implementation
(`sessionize-import.ts:914-945`) that distinguishes created vs. updated rows and guards
idempotency. The plan cites none of this, risking a divergent, half-compatible
reimplementation of a pattern that's 200 lines away and already tested.
**Recommendation:** Explicitly reference the Sessionize precedent as the pattern to reuse
or the reasoning for deliberately diverging from it.
```

```
**[MAJOR] Test impact not assessed — an existing contract test will break**
`tests/integration/api/people.MRQ-131.test.ts:280-302` ("CRM-05") asserts the current
apply-on-upload behavior (202, immediate counts, immediate field update) for this exact
endpoint. If the fix makes the endpoint dry-run-by-default, this test breaks and must be
updated as part of the change. Separately, `people-brief.ts:35` already promises agents
"give me the import_id so I can undo it if it's wrong" — a promise the API cannot
currently keep — and that string is asserted verbatim in
`tests/unit/people.MRQ-131.test.ts:239`. The plan's single testing instruction ("proven by
a test") does not acknowledge either existing test.
**Recommendation:** Call out CRM-05 as needing an update (not just a new test), and note
that the undo-capability promise in `people-brief.ts` becomes true rather than aspirational
once this ships.
```

```
**[MINOR] Task description cites a route path that does not exist**
The task description (and the plan, which copies it verbatim) refers to
`POST /api/v1/org/imports/people`. The actual route is `POST /api/v1/org/imports`
(`org-imports.routes.ts:33`, confirmed by `people-api.ts:270`, `cli/marquee.mjs:304`, and
a source-text test assertion). This is a small thing but suggests the plan was not checked
against the current source before submission.
**Recommendation:** Correct the path reference.
```

```
**[MINOR] Two-step design would need to solve CSV persistence, and the plan doesn't
mention it**
Unlike Sessionize, which persists an import manifest to R2 (`imports/{eventId}/{importId}.json`)
between its preview and run steps, the people-import path does not persist the uploaded
CSV anywhere. If the dry-run branch of the fork is chosen, the plan needs to say how the
second (confirm) call gets back to the same data — re-post the full CSV, or newly persist
it server-side with an expiry.
**Recommendation:** If the two-step branch is chosen, add this to the plan explicitly;
this is one more point in favor of the apply-and-show + undo branch, which avoids the
problem entirely.
```

## 4. Positive Observations

The underlying diagnosis is accurate and well-evidenced: the unconditional `name` overwrite, the `COALESCE`-only handling of title/company/bio, and the absence of any prior-value capture in `import_rows` are all confirmed by direct inspection of `org-imports.routes.ts`. The plan correctly declines to reopen the column-mapping-wizard question and cites the existing reasoning in `people-import.ts` for not doing so, which is a good instance of scope discipline. The acceptance criteria are testable in principle (diff-shown-or-reversible, receipt carries prior values, blank cell still means "not carried"). The task is also right that this is worth fixing on product-philosophy grounds even without a rubric item forcing it — that framing is honest about motivation rather than gaming a scoring system.
