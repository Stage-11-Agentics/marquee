# Code Review: MRQ-43 — Audit: repo hygiene and full-history scan

Reviewed branch: `mrq-43-audit-repo` (worktree `Marquee-worktrees/mrq-43-audit-repo`).
Review-prompt SHA: `96a0679`. **The branch moved twice during review** — a test-rename
amend (`47160bb`) and a rebase onto the newly merged master `cfd7e70` — and the final
pushed tip is **`be49a4f`** (local == `forgejo/mrq-43-audit-repo`, verified). The
substantive delta is identical at every SHA. Note for the record: the 30,455-line diff
in the review prompt is almost entirely shared `.lattice/` board churn from concurrent
tickets; the reviewable ticket delta is **+41 lines in two files** plus the Lattice
audit artifacts.

## 1. Verdict

**PASS**

The guard code is correct and verified at the final tip; the audit deliverable is
exceptionally rigorous and honest about what it does *not* claim (no orphan-ref gate
pass, no secret-scan pass while gitleaks is absent). The issues below are
evidence-chain hygiene, not substance; the top one should be fixed with a short
addendum artifact before the orchestrator relies on this milestone's evidence, and the
ticket's own cadence (rerun at every milestone, twice at the push) supersedes the stale
stamp naturally.

Independent verification performed for this review:

- `node --test tests/node/check-repo.test.mjs` at `be49a4f`: **3 pass, 0 fail** (~1.1s).
- `npm run check:repo -- --repo . --ref forgejo/mrq-43-audit-repo`: exit 1, commit
  `be49a4f`, `fullHistory: true`, **96 findings — 83 denied-history-path,
  11 denied-history-content, 1 missing-license, 1 gitleaks-unavailable** — exactly the
  counts the audit artifact claims, and all five new vocabulary labels fire on the
  private history as intended.
- Final branch delta vs merge-base confirmed as only `scripts/checks/repo-policy.mjs`
  (+12) and `tests/node/check-repo.test.mjs` (+29).

## 2. Summary

MRQ-43 delivers a full-history publication audit (durable checklist artifact with a
24-path denied inventory, `file:line` content findings, real-email inventory, and
third-party-material findings) plus a narrowly scoped, plan-sanctioned guard: five new
`DENIED_CONTENT` patterns (Forgejo host, tailnet, Lattice/delegator/orchestrator
vocabulary) with a hermetic fixture test. The guard is fail-closed, self-exempting by
construction, and reproduces cleanly; the audit correctly refuses to claim the two
gates it cannot yet prove (MRQ-42's orphan ref does not exist; gitleaks has never
executed). The findings below are about keeping the evidence chain as precise as the
audit itself demands.

## 3. Issues

**[MAJOR] .lattice artifacts (art_01KZR1E91…, art_01KZR1G6X…, art_01KZR1H7H…) — evidence chain anchors an orphaned SHA**
All three durable artifacts (final checklist, self-review, validation) stamp
`96a0679`, but the auditor subsequently amended (test rename) and rebased, force-pushing
`be49a4f`. `96a0679` is no longer reachable from the pushed branch, so anyone verifying
the audit against the remote cannot resolve the artifacts' "exact reviewed commit" —
the one discipline the audit's own plan (step 6) makes mandatory. The content of every
finding survives the rebase unchanged, and I confirmed the final scan and tests
reproduce identically at `be49a4f`, so this is a stamp problem, not a substance problem.
**Fix:** Attach a short addendum artifact re-stamping `be49a4f`: state the rename-only
amend + rebase, and include the rerun `check:repo` summary (96 findings, same code
counts) and the 3/3 test result at that SHA. One comment; no code change.

**[MINOR] Plan step 7 — pr-gate result and PR reference not preserved**
The plan requires "run `npm run pr-gate -- --ticket MRQ-43` … and preserve the result"
and "report `pr_open` … with the PR URL and both scan SHAs." No pr-gate output appears
in any artifact or event, no PR URL is recorded, and the task went
`in_progress → review → in_validation` without a `pr_open` event (other tickets on this
board do emit `pr_open`). The guard commit therefore has no recorded merge path.
**Fix:** Run pr-gate at `be49a4f`, fold its output into the addendum artifact, and
record either the PR URL or an explicit statement of the orchestrator's direct-merge
path for this branch.

**[MINOR] tests/node/check-repo.test.mjs:40-50 (`runCheck`) — every test run clobbers the real preserved report**
`writeReport` anchors to `REPOSITORY_ROOT` (derived from the script's own path in
`scripts/checks/lib/command.mjs:6-9`), so the fixture tests overwrite the worktree's
real `artifacts/checks/repo.json` with fixture data on every `npm test`. I observed
this directly during review (and regenerated the report against the pushed ref
afterward — it now again records `be49a4f` / 96 findings). This pattern predates the
diff — the two existing CONTRACT tests do the same — but this ticket's plan treats that
file as preserved evidence, and the new third test triples the clobber.
**Fix (follow-up ticket, per this ticket's no-product-changes rule):** add a report-dir
override (env var or `--report-dir`) consumed by `writeReport`, set it to the fixture
temp dir in `runCheck`. Until then, treat `repo.json` as regenerable, never as durable
evidence — the durable copy belongs in the Lattice artifact, which the auditor
correctly did.

**[MINOR] scripts/checks/repo-policy.mjs:9-14 — the split-token constraint is invisible**
`joinParts`/`markerA–E` exist so the checker's own source (and its test) cannot trip
the content scan once `scripts/` ships in the public orphan — the labels are split too,
and even the opaque `markerA–E` names are load-bearing (a descriptive name would
contain the denied word). None of this is stated, so a well-meaning maintainer
inlining the "needlessly obfuscated" literals would make the checker fail on itself at
the publication gate — fail-closed, but a confusing failure no test catches (the
fixture repo doesn't contain `scripts/`).
**Fix:** One comment above `joinParts`, worded without any denied token, e.g.:
`// Tokens are split so this file's own text passes the scan it defines.`

## 4. Positive Observations

- **The audit artifact is the strongest deliverable on this board.** The 24-path
  denied inventory includes a genuine tool-behavior discovery — `git rev-list
  --objects` deduplicates by blob and silently dropped `walkthrough.en.vtt` — with the
  corrected `git log --full-history --name-only` methodology handed to MRQ-42. Every
  material finding carries `file:line` plus a concrete caller/publication input (the
  ICS `PRODID` disclosure via a real calendar payload is a model example).
- **Honest non-claims.** The two unprovable gates are stated as unproven — the
  missing MRQ-42 orphan ref and the never-executed gitleaks scan — with the explicit
  warning that the Marquee ruleset is not a secret detector. This is exactly the
  fail-closed posture gate 16 needs, and it resists the strong incentive to report
  green.
- **The guard is well-engineered.** Fail-closed word-boundary patterns; the
  self-exemption technique applied *consistently* (patterns, labels, and test markers
  all split); the test writes all five markers and asserts each label individually
  against the report output. Hermetic fixture, ~1.1s, comfortably inside the 30s
  inner-loop budget.
- **Scope discipline.** No product files touched, no tip "cleanup" of the private
  repo (per the authoritative plan-review resolutions), no `tests/ac-claims/MRQ-43.json`
  for a ticket that owns no auto AC, and the guard is precisely the "narrowly scoped
  automated guard for a verified recurring finding" the plan permits — the recurrence
  (README `delegator`, seed `orchestrator`, Lattice vocabulary in contract docs) is
  documented in the same artifact.
- One redundancy noted, no action needed: the `forgejo.stage11.ai` pattern is subsumed
  by the existing `/Stage[- ]?11/i` (which matches `stage11`), but it earns its place
  by producing a more precise finding label.
