Review: MRQ-13 inline self-review
HEAD: 7e9501ef8022e928fd1dd7e2bde2f57c8024c733
Verdict: pass
Scope: exact rebased MRQ-13 diff against forgejo/master at 40bfda68c860518de86c51714e7c8b92681c3dae

Findings: none.

Reviewed contract points:
- src/lib/form-conditions.ts defines the persisted form_fields.condition shape as {all:[{fieldKey,op,value}]} and the shared isFieldApplicable() contract for later tickets to extend.
- Server-side projectApplicableAnswers() fails closed for hidden fields: hidden required fields are not validated, and submitted values for hidden fields are omitted before persistence.
- Form authoring resolves the canonical credential principal, enforces organization/event scope, and limits explicit form-admin catalog access to assigned forms.
- Form lifecycle preserves the immutable target after open and retains the public URL for closed forms.
- Generated API manifest parity is preserved; static field reorder routing is registered before the field-id route.
- Builder preview uses the shared evaluator and fixed three-column layout with reserved preview space, fixed-width toggles, and stable rows.

Verification:
- npm run pr-gate -- --ticket MRQ-13: PASS
- npm run check:api: PASS
- git diff --check forgejo/master...HEAD: PASS
- forgejo/master is an ancestor of HEAD; remote branch matches HEAD

Disposition: ready for validation.