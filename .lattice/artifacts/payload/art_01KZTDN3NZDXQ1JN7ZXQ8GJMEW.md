# Code Review: MRQ-119 — The public form saves drafts truthfully

## 1. Verdict

**FAIL (implementation-level)** — The plan is sound and almost everything in it landed cleanly, but one behavioral defect sits directly on the ticket's target flow: pressing Enter inside the new inline email prompt triggers implicit form submission instead of saving the draft. One-line-class fix; return to `in_progress` for rework.

## 2. Summary

Reviewed the MRQ-119 diff in worktree `mrq-119-form-drafts` (commit `240a0c4`): `PublicForm.tsx`, `styles.ts`, and the extended node contract test. All five ticket items are implemented and verifiable — the "Draft saved locally" lie is gone with reserved geometry, a footer Save draft exists, the title-only path gets a focused inline address prompt instead of an error, saved states are truthful, the resume link renders on screen with a copy control, and the participant copy now matches the backend's single co-speaker slot (confirmed against `public-form.routes.ts:167-178`). The targeted test passes and `tsc --noEmit` is clean. The key finding is the Enter-key path through the new email prompt, which lands the user on exactly the error wall (or an unintended full submission) this ticket exists to eliminate.

## 3. Issues

**[MAJOR] src/ui/public/form/PublicForm.tsx:511 — Enter in the inline draft-email input implicitly submits the whole form**
The prompt input (`#public-draft-email`) lives inside `<form class="public-form-card" onSubmit={submit}>`, which has a submit button — so per HTML implicit-submission rules, pressing Enter after typing the address fires `submit()`, not `saveDraft()`. In the eval scenario (title only → Save draft → prompt focuses → type address → Enter, the most natural keystroke), `validate()` flags every empty required field, shows "Add the highlighted details, then choose Submit again," and scrolls the person away from the prompt — the draft is never saved and the credibility failure resurfaces at the exact moment the ticket fixes. Worse, on a form whose required fields happen to be satisfied, Enter silently converts "save a draft" into a full abstract submission.
**Fix:** Add `onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveDraft(); } }}` to the draft-email input. This also resolves the smaller discoverability gap that nothing currently tells the person to press Save draft a second time after entering the address.

**[MINOR] src/ui/public/form/PublicForm.tsx:334-341 — `saveDraft()`'s tokened path gives no busy feedback and permits concurrent PATCHes**
When a resume token exists, `saveDraft()` awaits `autosave()`, which never sets `busy`. A clean (non-dirty) explicit save shows no "Saving…" state and leaves both buttons enabled, so a double-click issues two overlapping PATCH requests. Harmless data-wise (same answers), but it breaks the truthful-feedback contract this ticket is about and races the response `setState` calls.
**Fix:** Wrap the explicit-save PATCH in `setBusy(true)/finally setBusy(false)` (e.g., a small `busy` guard inside `saveDraft` around the `autosave()` call), keeping the debounced background autosave path as-is.

**[MINOR] src/ui/public/form/PublicForm.tsx:511 — the resume panel and email prompt appear by insertion, shifting the footer**
`{state.resume_url && <div class="public-draft-resume">…}` inserts a block between the fieldset and footer on first save, and the email prompt grows the footer when revealed. Both are user-initiated appearances at the point of action, and the ticket's reservation requirement named only the status line — so this is a judgment call, not a violation. Flagging it because the house rule ("elements never jump") is strict and both surfaces sit inches from the buttons that trigger them.
**Fix:** Acceptable as-is; if the delegator wants full conformance, reserve min-height for the footer-copy column so the prompt reveal doesn't move the action buttons.

## 4. Positive Observations

- **The trap was handled exactly as specified.** `ensureDraft()`'s no-email branch (PublicForm.tsx:301-305) swaps the old page error for a revealed, auto-focused inline field that writes through `setAnswer("speaker_email", …)` — the same key the server canonicalizes into (`public-form.shared.ts:479`), so no parallel state and no backend change. The click path through the eval scenario works.
- **Reserved geometry is done properly.** `.public-save-status { min-width: 15ch; min-height: 1.4em; visibility: hidden }` with a `has-value` toggle keeps the meta row solid; the longest real status ("Saved 12:59 PM", 14ch) fits inside the reservation, so the first save doesn't shift the row either. The `aria-hidden`/`aria-live` pairing is correct.
- **The `saveStatus` derivation is genuinely truthful**: "Saving…" only while a request is in flight or dirty-with-token, "Saved HH:MM" only from the server's `last_saved_at`, empty otherwise — no pre-token claims anywhere, and the plan's non-goal (no localStorage, no claims before the create response) held.
- **The copy fix was verified against ground truth, not just reworded** — the backend accepts exactly one `co_speaker_name`/`co_speaker_email` pair, so "one optional co-speaker slot" is accurate regardless of the form's configured `max_speakers`, and the now-unused `maximumParticipants` derivation was removed rather than left dangling.
- **The resume panel reuses `resumeLinkPath()`** so the visible href stays same-origin (protecting local validation runs, per the existing comment at PublicForm.tsx:53-62) while the copy action copies the absolute emailed URL — the right split. The `execCommand` textarea fallback reports failure honestly instead of claiming "Copied."
- **Tests extended in the file's established style** (source-contract regexes including a `doesNotMatch` on the deleted lie and a check on the reserved `min-width`), passing in ~60ms — well inside the suite budget.
