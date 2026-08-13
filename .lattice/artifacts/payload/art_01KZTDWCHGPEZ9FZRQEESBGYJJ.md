Verdict: PASS
Reviewed commit: d698d8833dd4d2d26b9cc33455aa0d9bedec0c7f

Adversarial re-review:
- The second live-browser pass showed the first blur guard was insufficient for c11's click dispatch: required-field errors still appeared on title-only Save. This commit defers blur validation and lets the Save action mark the same event-loop turn, so the draft prompt is isolated from submit validation.
- Fresh forms still render an empty, reserved save-status span with no local-save claim. The explicit footer action remains a non-submit button.
- A title-only Save opens and focuses the contact-address prompt; no backend write is attempted until an address exists. After an address, the existing create endpoint returns the authoritative resume token/timestamp/link.
- Resumed edits continue through the existing PATCH autosave, and the explicit Save action PATCHes current answers. The resume panel and clipboard/fallback behavior are unchanged and truthful.

Evidence: node --test tests/node/public-form.AC-35-155-157.test.mjs (PASS); npx tsc --noEmit (PASS); git diff --check (PASS). Findings: none.