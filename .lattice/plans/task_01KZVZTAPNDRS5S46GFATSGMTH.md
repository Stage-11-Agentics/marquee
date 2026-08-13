# MRQ-158: V2-9: latent.space theme leaves native controls unstyled

## Plan

1. Audit the register theme CSS, shared control tokens, and dark-register routes for
   native-control gaps; confirm the Day, Night, and swyxy scopes remain untouched.
2. Add `color-scheme: dark`, token-only input/select/textarea states, checkbox/date
   treatment where native chrome is visible, and themed scrollbar rules to the
   latent.space stylesheet. Apply the same treatment to AI Engineer only if its
   rendered controls show the same defect; leave swyxy unchanged unless its explicit
   dark mode is actually broken.
3. Run the design checker and project gate. Measure the latent.space input and
   placeholder foreground/background pairs against the 4.5:1 floor.
4. Run a local dev build in c11's right-pane browser: capture before/after evidence
   for the agenda Filter Sessions control, list search inputs, scrollbars, typed text,
   placeholder text, AI Engineer, and Day/Night scope.
5. Commit, push, open `MRQ-158: ...`, attach the observed verification evidence, and
   report the PR and gate result to the orchestrator.

## Acceptance criteria

- Native controls in latent.space use the register palette rather than light-default
  chrome, including scrollbars and the agenda Filter Sessions input.
- Inputs, selects, and textareas have tokenized surface, text, border, placeholder,
  focus-ring, and native control treatment under `html[data-theme="latent-space"]`.
- Date inputs and checkboxes/radios receive the same coherent native treatment where
  they are used; no literal colors are added outside theme tokens.
- AI Engineer is audited and fixed only if browser evidence shows the same class of
  mismatch; swyxy light and explicit dark states remain unchanged if already correct.
- Measured text and placeholder contrast is at least 4.5:1, with ratios recorded in
  the PR body.
- Design checks, the documented PR gate, and real-browser validation pass.
