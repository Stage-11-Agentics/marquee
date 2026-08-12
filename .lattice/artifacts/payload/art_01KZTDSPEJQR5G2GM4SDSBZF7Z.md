Verdict: PASS
Reviewed commit: 65581b5c7d2297032261325f3a153e318b53c6f8

Adversarial re-review:
- Fresh form remains truthfully unsaved: no pre-token local-save wording, and the status span keeps reserved geometry while hidden.
- The browser found that clicking Save after typing a title could trigger the existing submit-field blur validation. The fix marks the Save action and suppresses that validation for its blur, so title-only save presents only the inline contact-address prompt.
- Save still delegates persistence to the existing create/PATCH endpoints. Only a returned resume token/last_saved_at/resume_url produces saved UI.
- The visible resumed-draft panel contains the tokenized resume path and an explicit Copy resume link action with truthful failure text and clipboard fallback.
- The participant copy describes the one optional co-speaker slot actually rendered.

Evidence: node --test tests/node/public-form.AC-35-155-157.test.mjs (PASS); npx tsc --noEmit (PASS); git diff --check (PASS). Findings: none.