Verdict: PASS
Reviewed commit: 6dc922f5be7b55b4a21fa8f04b6b42be26e82e28

Adversarial re-review:
- The live c11 click path still dispatches blur around the click; the final one-line change holds draft-save intent for 500ms, covering that ordering without changing normal blur validation. The title-only Save path therefore shows only the inline contact-address prompt and no submit-required error storm.
- Fresh state has no local-save claim and preserves the hidden status slot. Draft creation, resume URL display, and copy remain backed solely by the returned server state.
- Existing resumed PATCH autosave and explicit Save behavior remain intact. The participant copy remains truthful for the one co-speaker slot.

Evidence: node --test tests/node/public-form.AC-35-155-157.test.mjs (PASS); npx tsc --noEmit (PASS); git diff --check (PASS). Findings: none.