# Eval Triage

Eval Triage turns each landed sbek judgement into a verified disposition and, when
the product is wrong, a small reviewed PR. It works while Eval Runner continues the
round. The two seats have deliberately opposite permissions: Runner protects the
measurement; Triage prepares the next build.

## Round brief

Do not infer the active run from the newest-looking directory. The operator or Eval
Runner supplies one explicit brief containing:

- round number and run stamp;
- frozen target URL and deployed `/health` SHA;
- absolute judgement and screenshot directories;
- Eval Runner's c11 workspace/surface refs;
- baseline run stamp, when score deltas matter; and
- the exact deploy-freeze text.

On receipt, set the c11 description to the area or defect currently being handled
and the PRs already landed. If any brief field is missing, keep doing safe read-only
orientation, but do not guess a run or mutate product state.

## Hard boundary during a round

- Do not run, restart, resume, score, or monitor the eval. Do not edit its kit or
  anything under `.eval-kit-agent/` or `sequence/auto-eval/`.
- Do not deploy, reset the live demo, run `loop.sh`, or edit `.deploy-freeze`.
- Do not use the frozen live site to validate an unshipped fix. Use tests, a local
  Worker/dev server, and an approved local browser surface.
- Merging is safe and expected after exact-head review and a passing gate. It does
  not change the frozen deployment.

Only raise a c11 flag when the operator must decide or act: product semantics,
credentials, a migration, or a deploy. Progress and merged PRs belong in the live
description and ledger, not flags.

## Area intake and dispositions

Read the judgement JSON itself and inspect every referenced screenshot before
triaging summaries. Give each defect a stable external-work ID:

```text
eval:<run-stamp>:<area>:<defect-index>
```

Process major before minor. Within a severity, prefer loss of user work, silent
failure, and missing feedback over cosmetic defects. Every defect ends in exactly
one disposition:

- `patch` — reproduced, product behavior is wrong, fix through a PR;
- `already-fixed` — current `github/main` already contains the correction, with
  commit/evidence named;
- `not-reproducible` — the named path was exercised locally and did not fail;
- `intentional-or-disclosed` — the behavior matches an explicit contract or seed
  policy, with the source named; or
- `needs-product-decision` — plausible alternatives change product semantics, so
  stop and flag the operator.

Never patch an unreproduced description speculatively. A non-code disposition is
real work only when its evidence is recorded.

## Machine-readable run ledger

Because eval defects deliberately do not mint Lattice tickets, Eval Triage is the
single writer to this append-only event stream:

```text
.lattice/orchestration/external-work/eval-<run-stamp>.jsonl
```

Each line is one `external-work.v1` JSON object with `at`, `work_item`, `event`, and
the event's facts. Events are `observed`, `triaged`, `branch_opened`, `pr_opened`,
`reviewed`, `gated`, `merged`, or `disposed`. Include severity, area, disposition,
evidence paths, branch, PR, base/head SHAs, review verdict, gate status, and merge SHA
when those facts exist. Append events; never rewrite history to make a later result
look inevitable.

Terminal delivery facts also append to the generic Lattice Orchestrator receipt
stream described by its workflow. The external-work ledger answers *what happened
to this finding*; the delivery receipt answers *what exact change was reviewed,
gated, and merged*.

## Patch lane

Use one linked worktree and one PR per independent concern, cut from `github/main`,
never local `main`. Preserve unrelated work and never use `git stash` in this repo.
For each patch:

1. Reproduce locally and capture the observed failure. If practical, add a
   regression that fails on the unfixed base and passes on the branch.
2. Implement the narrow fix through existing product seams. Validate the actual
   modality involved: source/API tests for logic, a local rendered path for visual
   behavior, and both when the defect spans them.
3. Commit and push the branch; record branch, base SHA, and head SHA in the ledger.
4. Launch an independent reviewer. Before review begins, require the positive
   receipt `REVIEWING <work-item> CWD <abs-worktree> HEAD <sha> BASE <sha>`.
   A launched surface without that receipt is not a review.
5. Run the project gate on the reviewed head. Read its `status`: `fail` blocks,
   `pass-over-budget` warns, and `timeout` is unknown and must be rerun.
6. Enter the landing train. At the front only: fetch current `github/main`, rebase
   if necessary, record the new base/head, repeat exact-head review and gate after
   any push, then merge immediately. A review of an earlier head is obsolete.
7. Verify the merge SHA, append the delivery receipt, close temporary reviewer
   surfaces, and update the Triage description.

Builds may proceed in parallel; final landing is serial. This avoids repeatedly
reviewing and gating branches against a base that another queued PR is about to
replace.

## Round closeout

Triage is complete when every judgement defect has a terminal disposition and every
patch has a merge receipt. Report merged PRs, non-code dispositions, local/runtime
evidence, and any unresolved operator decisions separately. Do not deploy the batch
or lift the freeze; Eval Runner owns the barrier after the measurement is complete.

For the next few rounds, preserve anomalies in the ledger and closeout notes instead
of immediately extending Lattice's CLI or schema. Promote a convention into core
only after repeated runs show that the same fields and transitions remain useful.
