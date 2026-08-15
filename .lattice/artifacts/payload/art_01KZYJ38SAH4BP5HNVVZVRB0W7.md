# Code Review: MRQ-167

### 1. Verdict

**FAIL (implementation-level)**

### 2. Summary

The diff supplied for review does not implement MRQ-167. The ticket calls for making
`POST /api/v1/org/imports/people` preview and/or reverse field-level overwrites (dry-run
diff, prior-value receipt, `name` treated like the other fields) — none of which touches
`src/routes/org-imports.routes.ts`, `import_rows`, or any people-import code. The actual
diff under review only edits two auto-eval harness prompt files
(`sequence/auto-eval/prompts/coordinator.md` and `implementer.md`), adding `--cwd`
guidance and a "don't work in the auto-eval worktree" warning — a real and reasonable
change, but unrelated to this ticket's acceptance criteria.

### 3. Issues

```
**[CRITICAL] (whole diff) — Diff does not implement MRQ-167**
The reviewed diff touches only `sequence/auto-eval/prompts/coordinator.md` and
`sequence/auto-eval/prompts/implementer.md`, adding `--cwd` launch guidance and a
worktree-contamination warning. None of the three acceptance criteria are addressed:
there is no dry-run/confirmation diff surface, no prior-value capture in `import_rows`
(or a sibling), and `name` is still unconditionally overwritten in
`src/routes/org-imports.routes.ts:79-106` (unchanged by this diff). This diff cannot be
evaluated against MRQ-167's acceptance criteria because it does not attempt them.

Separately: there **is** a real candidate implementation for this ticket already open —
GitHub PR #188 ("MRQ-167: make org people imports reversible", branch
`mrq-167-import-receipt`, currently DRAFT), whose diff touches
`src/routes/org-imports.routes.ts`, `src/ui/people/PeopleModals.tsx`,
`src/ui/people/PeoplePage.tsx`, `src/ui/people/people-api.ts`, `src/ui/people/people.css`,
and adds `tests/integration/api/org-imports.MRQ-167.test.ts`. That is almost certainly
the diff this review was meant to evaluate.

**Fix:** Regenerate this review against PR #188 / branch `mrq-167-import-receipt`'s actual
diff (or whatever diff the MRQ-167 task's worktree currently holds), not the auto-eval
prompt-doc diff. If the auto-eval prompt change is itself meant to be reviewed, it belongs
to a different ticket and should be submitted under that ticket's own review, since it has
nothing to do with speaker-data overwrite/undo.
```

No other issues were evaluated in depth, since the diff has no bearing on the ticket's
correctness, security, testing, or performance criteria. A follow-up review is needed once
the correct diff is attached.

### 4. Positive Observations

The two prompt-doc edits, taken on their own terms, are sound and well-motivated:

- `coordinator.md`: adding `--cwd /Users/atin/Projects/Stage11/deployments/Marquee` to
  both the analyst and implementer launch commands closes a real footgun — a launched
  agent silently inheriting the orchestrator's cwd and committing into the wrong tree.
  The accompanying paragraph explains *why* (a prior incident where two implementers
  contaminated the auto-eval machinery branch), which matches this repo's convention of
  justifying operational rules with the incident that motivated them.
- `implementer.md`: reordering the worktree setup to `cd` into the primary checkout
  first, then explicitly `cd` into the new worktree, plus the added `pwd` /
  `git branch --show-current` sanity check, is a concrete, verifiable guard against the
  same class of mistake. Naming the specific off-limits worktree
  (`Marquee-worktrees/mrq-auto-eval`) rather than a generic warning is good practice —
  it's unambiguous for a fresh agent with no prior context.

These are good changes; they are simply not MRQ-167.
