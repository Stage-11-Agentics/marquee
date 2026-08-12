# Code Review: MRQ-127 — Create-submission pickers and honest errors

Reviewed at branch `mrq-127-create-pickers`, HEAD `eb91d06`, worktree
`/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-127-create-pickers`
(working tree clean).

Verification actually run for this review:

- `npx vitest run tests/unit/client-error-handling.test.ts` → **1 failed / 21 passed**
- `npx vitest run tests/integration/api/search.AC-101-104.test.ts` → **5 passed** (19.5s)
- `npx tsc --noEmit` → clean
- Machine load at review time: `load averages: 108.23 78.32 63.93`. The unit failure is
  an assertion mismatch, not a timeout, so load does not explain it.

---

### 1. Verdict

**FAIL (implementation-level)**

The approach is right and most of the screen is well built. But the branch is red on its
own new test, and the ticket's third deliverable — field-level 422/validation surfacing —
misses the single largest class of field errors this form produces. Both are fixable
without revisiting the plan.

### 2. Summary

I reviewed the search-candidate SQL rewrite, the new `fieldError` extraction, the rebuilt
`CreateSubmissionPage`, the agenda drop-cell labelling, and the two touched test files.
The state modelling on the create screen is genuinely good (abort controllers, debounce,
reserved-height error spans so nothing jumps, settings-backed options, a required submitter
choice) and the form-admin scoping in search is preserved — the AC-104 negative control
still passes.

The key findings: the new unit test fails against this exact HEAD; `fieldError` gates on
`code === "unprocessable"` and therefore silently drops every Zod validation error (which
arrive as `malformed_request` carrying exactly the `field`/`details` shape it knows how to
read); the tracks multi-select passes an array to Preact's `value`, which Preact coerces to
a string and which deselects every option once two tracks are chosen; and the new inline
create-person path lands on `uq_people_org_email` → `conflict` → "Someone else changed this
while you were working on it," which is the dishonest-error failure mode this ticket exists
to eliminate.

### 3. Issues

**[CRITICAL] tests/unit/client-error-handling.test.ts:85 — the new test fails on this HEAD**

```
AssertionError: expected 'That change would leave the program i…' to contain 'Choose a format from this conference\…'
Expected: "Choose a format from this conference's settings."
Received: "That change would leave the program in a state it cannot be in. Adjust the values and try again. · ref none"
```

`errorSummary` composes `describeError`, which for a `MarqueeApiError` returns the canned
`ERROR_TREATMENTS[code].sentence` — never `error.message` (`src/ui/shell/api-client.ts:174-193`).
The diff does not change that, so the assertion cannot pass. The second assertion at line 96
(`expect(errorSummary(details)).toContain("The submission has invalid values.")`) fails for
the same reason once the first is fixed. `npm run pr-gate` runs the suite, so this blocks the PR.

Note the *product* behaviour the resolution promised ("an unmapped 422 remains visible in
the form-level alert with the server's message") **is** implemented — but in the page, at
`CreateSubmissionPage.tsx:169`, not in `errorSummary`.

**Fix:** assert against what actually carries the server message. Either drop the two
`errorSummary` assertions and assert `direct.message`/`details.message` directly, or move the
composition into a small exported helper (e.g. `fieldOrSummary(error)`) that
`CreateSubmissionPage.tsx:169` also calls, and test that helper. The second option is better —
right now the "server message survives to the alert" rule lives inline in one screen and is
untested.

---

**[MAJOR] src/ui/shell/api-client.ts:224 — `fieldError` drops every Zod validation error, which is most of them**

```ts
if (!(error instanceof MarqueeApiError) || error.code !== "unprocessable") return undefined;
```

Request-schema failures do not use `unprocessable`. `createApiRouter`'s `defaultHook`
(`src/api/router.ts:259-273`) emits `ApiError.badRequest(...)` → code `malformed_request`,
with `field: issueField(issue)` (a dotted path) and
`details: issues.map(each => ({ field, message }))` — precisely the two shapes `detailIssues`
and the `error.field` branch already parse. The gate throws them away.

Failure scenario: an organizer types spaces into Title (browser `required` is satisfied),
submits. The UI sends `title: ""` after `.trim()`, `title: z.string().trim().min(1)` rejects,
and the operator gets *"The system sent a request this conference could not accept. Reload the
page. If it repeats, copy the diagnostic report and file it."* — no field marked, and an
instruction to reload that will lose their typing. Same for a title over 500 chars (paste), and
for any `submitter.email` format rejection. That is the exact "the opaque error does not just
block, it refuses to say why" defect in the ticket text, still live on the primary path.

Tellingly, the author mapped `assign("submitterEmail", ["submitter.email"])` at
`CreateSubmissionPage.tsx:164` — a dotted path that *only* `issueField` produces. That mapping
is dead code under the current gate.

**Fix:** accept any envelope that carries field data, not one code:

```ts
if (!(error instanceof MarqueeApiError)) return undefined;
if (error.code !== "unprocessable" && error.code !== "malformed_request") return undefined;
```

and extend the form-level alert at `CreateSubmissionPage.tsx:169` to prefer the server message
for `malformed_request` too. Add a unit case covering a `malformed_request` with
`details: [{ field: "title", message: … }]`.

---

**[MAJOR] src/ui/submissions/CreateSubmissionPage.tsx:209 — the tracks multi-select clears itself at two selections**

```tsx
<select id="submission-tracks" multiple value={trackIds} onChange={…}>
```

Preact 10 (10.29.8 here) has no array handling for `<select multiple>`. After diffing children,
`diffElementNodes` compares `newProps.value` to `dom.value` — an array is never `===` a string,
so it always calls `setProperty`, which does `dom.value = value` (verified in
`node_modules/preact/dist/preact.module.js`; the bundle contains no `multiple`/`selected`
special-casing at all). Assigning `["track_a","track_b"]` to `select.value` coerces to
`"track_a,track_b"`; per the HTML spec the `value` setter selects the first option whose value
matches and deselects the rest — no option matches, so **every option is deselected**.

Failure scenario: organizer ⌘-clicks Agents (state `["track_agents"]`, DOM re-selects it — fine),
then ⌘-clicks Evals. State becomes `["track_agents","track_evals"]`, the re-render blanks the
control, and the operator sees their selection vanish. If they click a third track, `selectedOptions`
is read from the now-empty DOM, so state collapses to that one track and the first two are lost.
This is deliverable (1) of the ticket, and it also breaks the global "elements never jump" rule.

**Fix:** drive selection from the options and drop `value` from the select:

```tsx
<select id="submission-tracks" multiple onChange={…}>
  {model.tracks.map((track) => (
    <option value={track.id} key={track.id} selected={trackIds.includes(track.id)}>{track.name}</option>
  ))}
</select>
```

A checkbox list would be better still — it removes the "hold ⌘ or Ctrl" instruction the field
note currently has to carry, and it is keyboard- and touch-reachable. Either way this needs a
real-browser pass, not just a screenshot of the empty state.

---

**[MAJOR] src/ui/submissions/CreateSubmissionPage.tsx:147 — inline "Create new person" with an existing email dead-ends on the wrong error**

`migrations/0001_init.sql:749` has `CREATE UNIQUE INDEX uq_people_org_email ON people(org_id, email)`.
`makePerson` (`src/routes/submission-record.routes.ts:665-676`) queues an unconditional
`INSERT INTO people` for the `submitter` object — no lookup by email — and the route wraps any
`DB.batch` failure as `ApiError.conflict("the submission could not be created with those record
relationships")` (line ~740). The client renders the `conflict` treatment: *"Someone else changed
this while you were working on it. Reload to see their version before saving yours."*

Failure scenario, and it is the ticket's own 11pm organizer: the speaker already exists in the org
but has no submission or membership in *this* event, so the typeahead cannot find them (the
candidate set is submissions-and-memberships only, and `searchText` at `search.routes.ts:133`
does not include email, so searching the address finds nothing either). The organizer does the
only thing left — Create new person, real name, real email — and is told someone else edited the
record and they should reload. There is no path forward from that screen, and the message is a
lie about what happened. This ticket exists to kill exactly this.

**Fix:** in `makePerson`, look the email up within `event.org_id` first and reuse the row when it
matches (that is also the right dedupe behaviour), or — if reusing silently is too much for this
ticket — catch the unique violation and throw
`ApiError.unprocessable("a person with that email already exists in this conference", "submitter.email")`
so the new `fieldError` path (after the fix above) puts it under the Email input with a usable
sentence. Adding `email` to the speaker `searchText` array is a one-line companion fix that makes
the person findable in the first place.

---

**[MAJOR] src/routes/search.routes.ts:88-95 — the rewritten people query loses its index path, on the request the typeahead fires per keystroke**

```sql
FROM people p
JOIN submissions s ON s.event_id = ?
  AND (s.submitter_person_id = p.id OR EXISTS (
    SELECT 1 FROM participations participation
    WHERE participation.submission_id = s.id AND participation.person_id = p.id))
WHERE 1 = 1
```

The old shape started from `participations` (indexed) and joined inward. The new shape puts an
`OR` inside the join predicate, which SQLite cannot satisfy from an index — and there is no index
on `submissions(submitter_person_id)` alone (`idx_submissions_submitter_form_status` is the closest,
and it is not usable here). `people` is org-wide, not event-scoped, so the plan degrades toward
`|people| × |event submissions|` with a correlated `EXISTS` per pair.

This lands on the hot path twice over: the typeahead deliberately omits the `x-search-session`
header (per the plan's resolution), so `searchEvent` takes the **uncached** `querySearchCandidates`
branch (`search.routes.ts:205-207`) on every 160ms debounce burst. At AIE scale (a few thousand
people, ~1k submissions) that is millions of row comparisons per keystroke group. R7 says treat a
slow list as a defect.

I did not benchmark this — it is a read of the plan shape, not a measurement — but the fix is cheap
enough that it is not worth arguing about:

**Fix:** replace the `OR` with a `UNION` of two index-friendly queries (one over `participations`,
one over `submissions.submitter_person_id`), keeping `submissionsScope.clause` on both branches, and
add `CREATE INDEX idx_submissions_event_submitter ON submissions(event_id, submitter_person_id)`.
The `Map` dedupe at line 171 already handles overlap, so the shapes compose.

---

**[MINOR] src/routes/search.routes.ts:105-112 — the memberships branch is unplanned, untested, and mislabels staff as speakers**

The plan (step 2) says "include submitters as well as participants." This also adds every
`memberships` row for the event to the unscoped candidate set, rendered as `type: "Speaker"` with
`href: /onboarding?person=…`. That is a change to the **global** quick-search taxonomy, which the
plan lists as a non-goal, and it is visible in the Topbar dialog, not just the new typeahead: an
ops user searching a reviewer's name now gets them as a "Speaker" pointing at speaker onboarding.
No test covers this branch — the new integration test exercises the submitter path only. It also
puts program-committee accounts at the top of the submitter typeahead, which is a slightly awkward
outcome for a ticket whose motivating defect was "AIE Program Committee" becoming the speaker of
record (the required explicit choice does mitigate it).

**Fix:** either drop the memberships branch (submitters were the stated need) or keep it and add a
positive test plus a subtitle that does not imply speaking, and note the taxonomy change on the ticket.

**[MINOR] tests/ — the plan's third verification-matrix row was not delivered**

The matrix promised "New MRQ-127 node/source checks: picker controls are settings-backed and
required; no raw ID placeholders or actor-default submitter path remains in the UI; agenda drop-cell
labels cover each board." `grep -rl MRQ-127 tests/ scripts/` returns only the two files in the diff.
Deliverables (1) and (2) and the entire agenda change therefore ship with zero automated coverage —
which is why the multi-select defect above got through.

**Fix:** add the promised `tests/node/create-submission-ui.MRQ-127.test.mjs` in the style of
`tests/node/submission-record-surface.MRQ-101.test.mjs` — assert the settings-backed options, the
required submitter, the absence of the old `track_agents`/`format_talk` placeholders, and one
`ariaLabel` per drop-cell call site.

**[MINOR] src/ui/agenda/AgendaPage.tsx:210 and src/ui/agenda/track-board.tsx:37 — `role="region"` floods the landmark menu**

`TIME_SLOTS` is 12, so a day board emits 12 × rooms regions and the track board 12 × days × tracks.
Every one is a landmark in a screen reader's landmark list; several dozen unnamed-by-structure
regions is harder to navigate than none. The `aria-label` is the valuable half of this change.

**Fix:** use `role="gridcell"` inside a `role="grid"`/`role="row"` structure for the day and week
boards, or `role="group"` for the track slots. Keep the labels as written — they read well.

**[MINOR] src/ui/submissions/CreateSubmissionPage.tsx:174 — the new-person name error renders twice**

`submitterFieldError = fieldErrors.submitter || fieldErrors.submitterName` puts "Enter the
submitter's name." under the Name input (line 204) *and* again at the fieldset foot (line 207).

**Fix:** `const submitterFieldError = fieldErrors.submitter;` — the per-input `InlineError`s
already cover the new-person branch.

**[MINOR] src/ui/submissions/CreateSubmissionPage.tsx:167 — server field errors never clear as the operator edits**

Only `fieldErrors.submitter` is cleared on interaction (lines 188-199). After a failed submit, the
red text under Title, Tracks, and Format persists while the operator fixes the value, and only
resets on the next submit. Stale red under a field the operator just corrected reads as "still
wrong."

**Fix:** clear the matching key in each control's `onInput`/`onChange`, the way the submitter
controls already do.

**[MINOR] src/ui/submissions/CreateSubmissionPage.tsx:194-199 — the typeahead's ARIA is not a listbox and has no keyboard path**

`role="listbox"` contains `<button role="option">` children *and* non-option `<span
class="record-picker-placeholder">` children; a listbox may only contain options/groups. There is
also no arrow-key navigation — the buttons are tabbable, so it is reachable, but a 20-result list
means 20 tab stops between the query field and the next control.

**Fix:** move the placeholders outside the listbox element (or drop the listbox roles and let it be
a plain labelled list of buttons — honest and simpler), and add ↑/↓/Enter handling on the input if
the combobox pattern is kept.

**[MINOR] src/ui/submissions/CreateSubmissionPage.tsx:109 — a common name can be squeezed out of the results**

`SEARCH_RESULT_LIMIT` is 20 and the server ranks Abstracts, Sessions, Speakers, and Forms together;
the screen then filters to `type === "Speaker"` client-side. A query like "Chen" that also appears in
many submission titles can return 20 non-person rows, and the picker will say "No matching people"
about a person who exists — pushing the operator into the create-person path and issue 4 above.

**Fix:** pass a type filter (e.g. `&type=Speaker`) to the search route and apply it before the limit,
or raise the limit for this caller.

**[MINOR] src/ui/submissions/CreateSubmissionPage.tsx:111 — the search failure discards its reason**

`.catch((caught: unknown) => { … setSubmitterSearchState("error"); })` ignores `caught`, so an
expired session and a 500 are the same "People search unavailable. Try again." — and an aborted
request is indistinguishable from a real failure.

**Fix:** keep `errorSummary(caught)` in state and render it, matching what the settings loader at
line 88 already does.

**[MINOR] src/ui/submissions/CreateSubmissionPage.tsx:209-210 — no cold-start guidance**

An event with no formats or tracks yet renders an empty multi-select and a lone "No format selected"
option, with no pointer to Conference settings. The previous free-text fields at least let an operator
proceed. Given MRQ-126's bound-options work this may be handled elsewhere, so flagging only.

**Fix:** when `model.tracks.length === 0`, replace the control with a line pointing at
Conference settings · Tracks.

### 4. Positive Observations

- **The load/ready/error state machine is the right shape.** `LoadState` as a discriminated union
  with `model: null` on the non-ready arms makes the `{model && …}` guard total, and the submit
  button disables on `!model` so the form cannot be posted against options that never loaded.
- **Both effects clean up correctly.** `AbortController` plus `clearTimeout` in the teardown, with
  `controller.signal.aborted` checked before every `setState` — no late-response state writes, no
  ordering bug between overlapping typeahead requests. This is the part of async UI most often gotten
  wrong and it is right here.
- **Reserved space, per the global no-jump rule.** `.create-field-error` carries `min-height: 13px`
  and a `&nbsp;` fallback, `.record-person-suggestions` has `min-height: 44px`, and
  `.record-picker-state` has `min-height: 45px`, so errors and search states appear without shifting
  the form. The CSS uses only existing tokens (I verified all eleven resolve in `src/styles/tokens.css`).
- **The security-sensitive half of the SQL rewrite is intact and proven.** `submissionsScope.clause`
  still applies to the widened people query, and AC-104's negative control — a scoped form admin
  getting `[]` for the secret record — still passes, as does the whole search file. The
  `scopedPersonId === null` guard correctly keeps the memberships branch away from restricted admins.
- **The plan-review resolutions were honoured where they were implementable:** the explicit
  API-field-to-control map is there, the `Conference person` subtitle is asserted by test rather than
  claimed, and the typeahead really does bypass the 5-second prefetch cache so an inline-created
  person is visible on the next query.
- **`detailIssues` is defensive in the right way** — it accepts both a bare array and `{issues: […]}`,
  and tolerates `field` or `fieldKey`, which matches the two shapes the API actually emits
  (`ApiError.unprocessable(msg, field, issues)` uses `fieldKey`; the router hook uses `field`). The
  code-gate above is the only thing keeping it from working.
- **Typecheck is clean**, and making `ariaLabel` a required prop on both `DropCell`s is the right
  call — it makes an unlabelled drop target a compile error rather than an audit finding.
