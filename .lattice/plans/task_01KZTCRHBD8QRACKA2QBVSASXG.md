# MRQ-119: The public form saves drafts truthfully

CFP-07 (w1) + the judge-flagged credibility major. You own PublicForm.tsx. (1) DELETE the 'Draft saved locally - just now' lie (PublicForm.tsx:469, renders whenever no resume token exists; ensureDraft()'s only caller is handleFile) — reserve the status line's space so removal doesn't shift the row (house rule: elements never jump). (2) 'Save draft' control in the footer. TRAP: ensureDraft hard-requires an email but the eval scenario enters ONLY a title — ask for the address inline at the moment of saving instead of erroring. (3) Truthful saved states; existing autosave effect takes over once a resume token exists. (4) Show the resume link ON SCREEN, copyable (the judge cannot read mail; a human with slow mail has no other way back). (5) Fix the 'up to four participants' copy vs the single co-speaker slot — make the copy true. The entire draft backend already ships (create/patch, resume tokens, draft_resume mail, resumed banner): a finished feature with no button. Full spec: section T-H. Register rows 44,45 + 15's copy defect.

## Plan

### Scope and contract mapping

- Keep the change in `src/ui/public/form/PublicForm.tsx` and its co-owned stylesheet. The existing create/patch draft API, resume-token mail, and resumed state are the source of truth; no route, schema, or mail changes are needed.
- CFP-07: add a discoverable footer `Save draft` action; show truthful `Saving…`/`Saved HH:MM` states only after the backend returns a resume token; leave the autosave effect as the post-token path; expose the returned resume URL on the form with an explicit copy action.
- Credibility major / cross-cutting audit rule: remove the pre-token `Draft saved locally · just now` claim entirely. Keep its status element with reserved geometry so the conference/meta row does not jump before the first save.
- Register row 15: replace the inaccurate “up to four participants” statement with copy describing the one optional co-speaker slot the public form actually renders.

### Implementation

1. Add small UI state for the save-time email prompt and clipboard result. `ensureDraft()` will reveal and focus an inline contact-address field when no email is present, without presenting the backend’s required-email response as a page error. The prompt writes through the existing `speaker_email` answer so the same `ensureDraft()` payload and server validation remain authoritative; subsequent saves and file uploads reuse the same path.
2. Add a footer action beside Submit. It invokes `ensureDraft()` while the form remains editable, uses truthful busy text, and preserves the existing autosave effect once `resume_token`/`draft_id` exist. The action remains available for a resumed draft as an explicit save affordance while autosave continues to handle later edits.
3. Render a persistent, on-screen resume panel after draft creation, containing the same-origin link path plus a `Copy resume link` button. Copy the absolute backend URL when available, with a small browser fallback for environments without `navigator.clipboard`, and report `Copied`/failure truthfully.
4. Make the save-status span always present with a minimum width/height and hidden empty state; only render visible text for an actual save, in-flight save, or returned `last_saved_at`. Add compact responsive styles for the prompt, link, and action group without changing the existing mobile field contract.

### Verification

- Extend the existing node contract test for the public form with assertions covering the removed false phrase, `Save draft`, inline email prompt, resume-link copy affordance, and reserved status geometry. Run that targeted test directly; do not run the full `npm test` suite under fleet load.
- Run targeted TypeScript/Vitest checks for touched UI-adjacent tests as applicable, then inspect the rendered SSR output for a fresh form (blank reserved status, no false saved claim) and a resumed/saved state (visible link and copy control).
- Before PR, check `uptime` and defer if the 1-minute load exceeds 24, then run `npm run pr-gate -- --ticket MRQ-119`; paste the exact result in the completion comment. Record local validation evidence and open the GitHub PR at `pr_open`.

### Non-goals and risks

- Do not change backend email requirements, draft persistence, token lifetime, or mail delivery. A draft must still have a reachable address; the UI now asks at the point of action rather than pretending a local save happened.
- Do not use localStorage or claim a draft exists before the create response succeeds. The only authoritative saved state is the returned draft payload, and the link shown/copyable is the returned tokenized URL.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Self-review PASS: the plan keeps all persistence and validation on the existing backend contract, handles the ticket's title-only path inline, preserves status geometry, and names the required evidence. No unresolved plan findings.
