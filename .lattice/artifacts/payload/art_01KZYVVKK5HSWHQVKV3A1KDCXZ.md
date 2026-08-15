# Code Review: MRQ-180 — bulk reminder confirmation reconciles to the selection

## 1. Verdict

**FAIL (implementation-level)** — The approach is sound and the onboarding drawer now fully satisfies the acceptance criteria, but the shared server-side change silently reintroduces the same defect class on the Comms screen, which displays `selected`/`queued`/`duplicate` but not the new `skipped` field. One small rework closes it.

## 2. Summary

The diff adds a `skipped` array to the `/comms/send` response (name + reason per unqueueable recipient), reconciles `selected` to the exact pair count the drawer promised, renders the accounting in the onboarding confirmation, and ships a genuine mixed-case regression test. I verified the sum invariant against the real helpers on `main`: `recipientsFor` pins one row per person/submission pair, `enqueueBulkReminder` maps 1:1 recipient→outbox attempt, so `queued + duplicate + skipped = selected` holds for both pair and non-pair selectors. The key finding: the new email filter in `resolveReminderSelection` applies to **every** caller of the send endpoint, and `CommsScreen.tsx` still renders only `Queued X · duplicates Y · selected Z` — an emailless recipient there now produces visibly non-reconciling numbers with no explanation, which is precisely the contradiction this ticket exists to eliminate.

## 3. Issues

**[MAJOR] src/ui/comms/CommsScreen.tsx:339 (with src/routes/comms.routes.ts, `resolveReminderSelection`) — The Comms screen now shows a confirmation that doesn't reconcile, with no skip surfaced**
Before this change, a recipient with an empty email still got an outbox row (`enqueueOutbox` inserts whatever `toEmail` it's given), so on the Comms screen `queued + duplicate = selected` always held and the row appeared in the delivery log. After this change, `resolveReminderSelection` filters emailless recipients out of queueing for *all* selectors — including the broad status/task selectors the Comms screen sends — and reports them only in `skipped`, which that screen's `SendResult` interface (`CommsScreen.tsx:61-66`) doesn't even declare, let alone render. An organizer bulk-sending from Comms with one emailless speaker now sees "Queued 2 · duplicates 0 · selected 3": a send confirmation that contradicts the selection, and a speaker who never gets chased — the exact defect entry from round 9, relocated. There is also no test covering the non-pair selector path with an emailless recipient.
**Fix:** Extend `SendResult` in `CommsScreen.tsx` with `skipped` and render it in the `send-result` line (e.g., `· skipped N` plus name — reason rows, mirroring the drawer). Add a non-pair-selector case (or extend the MRQ-180 test) asserting an emailless recipient surfaces in `skipped` for a status/task selector too.

**[MINOR] src/routes/comms.routes.ts, `skippedRecipientsFor` fall-through — the catch-all reason "no open task remains" is asserted, not derived**
The function checks person existence, email, event membership, pair participation, and role, but never queries `speaker_tasks` — the terminal reason is an assumption that whatever else `recipientsFor` filtered on must have been task state. For the onboarding drawer (which always sends `task_state: "open"`) that's right; for an API caller whose selector carries `status`/`track_id`/`format_id`, or `task_state: "done"`, or no task filter at all, the named reason is confidently wrong. Same for a person-only pair whose person has a speaker *participation* but no speaker *membership*: the fallback query requires `membership.role = 'speaker'`, but `isSpeaker` here accepts participation roles, so the real drop reason (no membership) is reported as "no open task remains".
**Fix:** Make the last branch honest about the selector: derive it from `selector.task_state` ("no open task remains" / "no completed task" ) and fall back to a neutral "did not match the reminder filters" when other filters are present or the cause can't be pinned. Optionally check `speaker_tasks` for the pair so the common case stays precise.

**[MINOR] src/ui/onboarding/OnboardingPage.tsx:345 — duplicate render keys when one person is skipped for two sessions**
Skipped rows are keyed `skipped-${row.person_id}`. A person selected via two pairs (two submissions) with no email produces two skipped entries with the same `person_id` — correct accounting, colliding Preact keys.
**Fix:** Key by index or `skipped-${row.person_id}-${index}`, or include the reason/submission in the key.

**[MINOR] src/ui/onboarding/OnboardingPage.tsx:336 — dropping `role: "speaker"` from the send selector is an untested behavior change**
Removing the role filter is very plausibly the actual root-cause fix for round 9 (a co-speaker pinned by `chosen_part.role = 'speaker'` was silently dropped; now the pair resolves via the role-priority pin instead). It's the right call for an exact board selection — the ticked pair is the promise — but nothing in the diff tests it: the regression test still passes `role: "speaker"` and covers only the missing-email drop. If a co-speaker was the round-9 culprit, this change is load-bearing and unguarded.
**Fix:** Add a test case: a pair whose participation role is `co_speaker`, sent without `role`, is queued (and, with `role: "speaker"` supplied, is skipped with the role reason from `skippedRecipientsFor`).

No security issues found: all new SQL is parameterized and follows the existing `json_each(JSON.stringify(...))` pattern; skip reasons render as JSX text; nothing sensitive is logged.

## 4. Positive Observations

- **The sum invariant is real, not cosmetic.** I traced it end-to-end: `recipientsFor`'s `DISTINCT` + participation-pinning subquery yields at most one row per pair, the person-only fallback covers exactly the null-submission pairs, and `enqueueBulkReminder` returns one result per recipient — so `queued + duplicate + skipped = selected` genuinely holds, and the test asserts the invariant itself (`result.queued + result.duplicate + result.skipped.length` equals `result.selected`), not just the literal values.
- **The regression test is a proper mixed case** and demonstrably fails on `main` twice over: the `skipped` field doesn't exist there, and `main` would enqueue an outbox row for the emailless recipient, so the outbox assertion (`only per_mrq180_queueable`) fails too. It also verifies DB state, not just the response body.
- **Email filtering happens before `enqueueBulkReminder`,** which keeps the existing index-aligned `outboxRows`/audit mapping (`recipients[index]`) correct without touching it — the least invasive place to intervene.
- **`skippedRecipientsFor` carries a good doc comment** stating the contract ("exact board selections are a promise to account for every selected pair"), and its diagnosis order (person → email → membership → participation → role) reads like the resolution pipeline it mirrors.
- **The UI respects the craft rules:** `aria-live="polite"` moved to the always-present wrapper (a live region that exists before content actually announces), and the `min-height` slot reserves space for the confirmation so the drawer doesn't jump when the result lands — the "elements never jump" rule applied unprompted.
- The updated empty-selector test keeps the `selected: 0, skipped: []` contract for a deliberate no-op selection intact.
