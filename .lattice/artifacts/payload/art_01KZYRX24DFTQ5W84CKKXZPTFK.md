# MRQ-170 — Independent review (second pass, post-merge)

Branch `mrq-170-submitter-edit` @ `e9c4b294` (4 commits, not 3 — `e9c4b294` "Make speaker
boundary regression confirmed" also lands). Merge base `17242b06`. Merged as PR #192.

### 1. Verdict

**FAIL (implementation-level)**

The merge was *partly* justified — the authorization fix is genuinely correct and the
feature works end-to-end — but it shipped a confirmed silent data-loss path in the exact
field the ticket is about, so a follow-up ticket is owed rather than a revert.

### 2. Summary

Reviewed the full diff (9 source files, 3 test files), re-derived the `editableTalk`
authorization from the SQL rather than the commit message, and ran the suite (3 files,
37 tests, all passing, 17.9s). The authorization hole described in `6c321db1` is really
closed — both branches of the new WHERE clause require a `participations` row on *that*
submission, the bind order is correct, and no migration was added. The key finding is
elsewhere: the ticket puts two live editing surfaces on the same undecided submission,
and they write to **different stores**, so an edit made in `/portal` is invisible on the
resume link and is silently reverted by the next save there.

### 3. Issues

---

**[HIGH] src/routes/portal.routes.ts:1568 — Portal edits and resume-link edits write to different stores; portal edits are silently reverted**

`updateSpeakerTalk` writes only the `submissions` row (title/abstract). The resume-link
surface reads its answers from `submission_answers` via `readAnswers()` in
`public-form.shared.ts:124`, and `editSubmittedSubmission` recomputes title/abstract from
that answer map. Before this ticket the two could not collide: `editableTalk` required a
speaker *membership*, which an ordinary public-form submitter never has
(`speakerMembershipStatement` is only called from `speakers.routes.ts`), so a submitter
got a 404 on the portal path. MRQ-170's new submitter branch opens it — and requirement #1
deliberately keeps the resume link editable at the same time.

I verified this against the real stack, not by reading:

```
portal PATCH status: 200
submissions.abstract after portal edit: "PORTAL EDITED ABSTRACT"
resume-link answers.abstract:            "The original abstract that the organizer should receive."   <-- stale
```

and then the data-loss variant — submitter opens the resume link and edits only the
*title*, leaving the (stale) abstract textarea untouched:

```
resume PATCH status: 200
submissions.abstract AFTER resume save: "The original abstract that the organizer should receive."
```

The portal edit is gone, with no warning, and the organizer's record now shows the
pre-edit abstract. This fails requirement #2 (persistence in the speaker's view) on the
resume surface and undermines #3 (organizer sees the edited text). It escapes the test
suite because `submitter-editing.MRQ-170.test.ts` exercises the public PATCH path for
round-trip and the portal path only for *reading* — the two are never crossed.

**Fix:** make the two surfaces share one source of truth. Cheapest correct option: in
`updateSpeakerTalk`, also project the new title/abstract into `submission_answers` for the
`title`/`abstract` field keys (the helper `replaceProjectedAnswers` already exists and is
used by the public path). Alternative: have `loadPublicForm` overlay
`submissions.title/abstract` on top of the answer map for those two keys, so the
`submissions` row is authoritative everywhere. Either way, add a regression test that
edits in `/portal` and then asserts the resume-link `answers.abstract`.

---

**[MEDIUM] src/routes/public-form.routes.ts:643 — Audit row and answer projection are written even when the guarded UPDATE matches zero rows**

`editSubmittedSubmission` checks editability from `base` (read earlier), then issues a
`batch()` whose UPDATE is guarded by `status IN ('submitted','in_review')` — but the
`auditStatement` in that same batch is unconditional, and `replaceProjectedAnswers` runs
unconditionally afterwards, outside the batch. If a decision lands between the read and
the write (exactly the mid-edit race in scope for this ticket), the UPDATE matches zero
rows while the audit row still claims the edit happened and the answer projection is
still overwritten. The result is a HISTORY entry that disagrees with the record and a
`submission_answers` set that disagrees with `submissions` — and the request returns 200.

The codebase already names this hazard, in `submission-record.routes.ts:325`: "An audit
row that lands in a different transaction from the change it describes is worse than no
audit row at all — it reads as authoritative while being free to disagree with reality."

**Fix:** run the UPDATE first, check `meta.changes > 0` (D1 returns it), and only then
write the audit row and replace the projected answers; return 409 with the editability
reason otherwise. That also makes the tautological `form_id`/`submitter_person_id`
predicates in the WHERE clause earn their place.

---

**[MEDIUM] src/ui/public/form/PublicForm.tsx:677 — The "why you can't edit" notice on the public form is unreachable dead code**

The new notice
`{!editingSubmitted && state.state === "submitted" && state.submission_edit_reason ? <div class="public-notice alarm">…}`
sits in the main form branch. But the branch above it returns early:

```tsx
if (state.state === "submitted" && state.confirmation && !editingSubmitted) return <confirmation screen>
```

and `confirmation` is non-null for *every* submitted state
(`public-form.shared.ts:327` — `record.state === "submitted" ? {…} : null`). So whenever
the notice's condition holds, the early return has already fired. A submitter who follows
their resume link after a decision lands sees the generic confirmation screen and is never
told why editing stopped — requirement #4 is met in `/portal` but not on the resume
surface, which is the surface requirement #1 also names. No test covers the public form's
decided state, which is why this survived.

**Fix:** render `state.submission_edit_reason` inside the confirmation branch (it already
has the right "honest when unavailable" tone), and delete the unreachable copy. Add a test
asserting the reason text appears on the resume surface after a decision.

---

**[LOW] src/routes/portal.routes.ts:1310 — `talkEditingOpen` drops the decision check for anyone holding a speaker membership**

```ts
if (current.isSubmitter && !current.hasSpeakerMembership) { …submitterEditability… }
return current.formStatus === "open" && …   // no submission-status check
```

Once a submitter is promoted to speaker (accepted → `speakerMembershipStatement`), they
fall to the speaker branch, which never consults `submission.status`. Meanwhile
`submitterSnapshot` computes the portal's `edit` field from `submitterEditability` alone,
ignoring membership — so the UI shows the button disabled with "the conference has already
made a decision" while the API would still accept the PATCH. The divergence is safe in
direction (UI stricter than API) and the speaker branch's looseness is pre-existing, but
one policy helper now has two answers for one person.

**Fix:** take the `submitterEditability` branch whenever `isSubmitter` is true, regardless
of membership — or state explicitly in the helper's doc comment why a promoted speaker is
allowed past their own decision.

---

**[LOW] src/lib/submission-editing.ts:33 — Wrong reason returned for draft and withdrawn submissions**

Anything outside `{submitted, in_review}` gets "Editing is closed because the conference
has already made a decision." A `draft` has had no decision; a `withdrawn` submission was
withdrawn by the submitter. The UI does not currently reach this (the resume form uses the
autosave path for drafts), but the PATCH route is public and returns the string verbatim
in a 409. In a product whose stated principle is honesty when a control is unavailable,
this is the one sentence that must not guess.

**Fix:** branch the reason on status — draft, withdrawn, decided.

---

**[LOW] src/routes/public-form.routes.ts:652 — `search_blob` write is dead and disagrees with the database**

`search_blob = JSON.stringify(projected.projected.answers)` is immediately overwritten by
the `submissions_search_blob_update` trigger (`migrations/0001_init.sql:962`), which
rebuilds it as `lower(trim(title || ' ' || abstract))` after any UPDATE OF title/abstract.
This copies an existing wart in the sibling public-form paths rather than introducing one,
and `submission-record.routes.ts:333` already documents why it should not be written by
hand. Harmless today, misleading to the next reader.

**Fix:** drop the column from the UPDATE and the corresponding bind.

---

**[NIT] src/ui/portal/portal.css:235 — `min-height: 330px` on every submitted row**

The editor form is always rendered and hidden with `visibility: hidden`, and the row
reserves its full height — correct per the "elements never jump" rule, and a deliberate
choice I'd rather see than a layout shift. But it costs ~330px per abstract whether or not
anyone is editing, so a submitter with four abstracts scrolls past 1300px of mostly empty
rows. Worth revisiting with a collapsed height plus a reserved-space transition.

### 4. Positive Observations

- **The authorization fix is real, and I verified it from the SQL rather than the commit
  message.** Both arms of the new predicate require a `participations` row on *that*
  submission — the submitter arm on `role = 'submitter'`, the speaker arm on
  `role IN ('speaker','co_speaker')` *and* an event-level speaker membership. The
  `events`/`org_id` join blocks cross-org reach and the participation predicate blocks
  cross-event and cross-person reach. The hole from `c897a1fa` (membership untied to the
  submission) is genuinely closed on both the GET and the PATCH, since both route through
  `editableTalk`.
- **The 7-parameter bind order is correct**, which is the easy way to reintroduce the same
  bug silently. SQLite numbers `?` by textual occurrence, so the two SELECT-list `EXISTS`
  params bind before the `org_id` join and the `submission.id` predicate — and
  `bind(personId, personId, orgId, submissionId, personId, personId, personId)` matches
  exactly. Worth noting because a wrong order here would have swapped `orgId` into a
  `person_id` slot and failed open-ish rather than loudly.
- **The cross-speaker CONTRACT test is a real boundary test, not a happy path.** It drives
  speaker B against speaker A's submission on *both* GET and PATCH, accepts either 403 or
  404, and then re-reads as speaker A to assert the title did not change — that final
  re-read is what makes it a regression test rather than a status-code assertion. The
  fixture change that confirms `part-portal-other` is a nice touch: it ensures speaker B is
  a fully legitimate confirmed speaker, so the test proves scoping rather than proving
  speaker B was simply unauthorized.
- **The token boundary is correctly scoped and tested.** `findResumeSubmission` keys on
  `form_id` + `resume_token_hash`, so a token from another event's form finds nothing and
  the route 403s; the test exercises a one-character-mutated token.
- **No migration**, as required — confirmed by name-only diff across all four commits.
- **Reuse over reinvention, exactly as the plan asked.** `submitterEditability` is one
  ~20-line policy function consumed by all three surfaces (portal snapshot, portal PATCH,
  public form), which is why the disabled-with-reason strings agree between the API and the
  UI. Requirement #5 needed no new code at all because `speaker_talk_updated` was already a
  `CONTENT_ACTION` and the public path reuses the same before/after audit shape — the
  organizer's HISTORY panel picks it up with correct actor attribution, and the integration
  test asserts `actor_name: "MRQ-170 Submitter"` rather than just the action.
- **Partial-merge semantics on the public PATCH** (`{...base.answers, ...answerMap(body)}`)
  with a documented rationale — an omitted field is not silently erased.
- **The no-op short-circuit** on both write paths avoids writing a history row for a save
  that changed nothing, which keeps the HISTORY panel readable.
