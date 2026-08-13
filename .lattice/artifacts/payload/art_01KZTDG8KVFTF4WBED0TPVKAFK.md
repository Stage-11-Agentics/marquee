Verdict: PASS
Reviewed commit: 240a0c4958ac276403a7e0c767aaf7bfe08579c4

Adversarial review:
- Fresh form: the pre-token "Draft saved locally" claim is gone; the status span remains in the DOM with reserved min-width/min-height and is hidden until a real save or in-flight save exists.
- Title-only save: Save draft is a non-submit footer control. With no speaker_email answer it opens and focuses an inline contact-address field, clears the page error, and only creates a draft after the user supplies an address.
- Persistence truth: the returned PublicFormState alone supplies resume_token, last_saved_at, and resume_url. The rendered resume panel includes the link and an explicit Copy resume link action; no localStorage or speculative success path was added.
- Resumed draft: the existing 750ms autosave remains the normal PATCH path; the explicit Save draft also PATCHes current answers for a dirty resumed draft.
- Copy failure: clipboard failure is surfaced as Copy failed rather than claiming success; navigator.clipboard has a document.execCommand fallback.
- Participant copy: the old up-to-four claim is replaced with the one optional co-speaker slot actually rendered by the form.

Evidence: node --test tests/node/public-form.AC-35-155-157.test.mjs (PASS); npx tsc --noEmit (PASS); git diff --check (PASS). Findings: none.