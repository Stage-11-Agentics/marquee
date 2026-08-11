# MRQ-42: AC-coverage closure and public-repo assembly

BUILDPLAN: M-50 + M-56 — cross-cutting (§5) · MERGED at mint (3 h + 3 h = 6 h; both extend `scripts/checks/*` with no dependencies, and both are the release-verification plumbing the terminal gate runs)

🔒 **GATE-BACKING — NEVER IN THE CUT BAND** (M-56 backs gate 16; M-50 backs gate 3). The merged ticket inherits the lock.

**M-50 — `trace:ac` closure** (3 h)
Scope (verbatim): every live `auto` AC in scope named by at least one test; AC-239 treated as a tombstone and any reuse/unknown ID rejected; coverage report attached.
`--scope=all` is the gate's form and runs from CP-2 onward; `--scope=merged` is the PR default.

**M-56 — Public-repo assembly** (3 h)
Scope (verbatim): build the publishable tree as an **orphan/squashed initial commit with no ancestry from this working repo** (`src/`, `migrations/`, `scripts/`, `cli/`, `README.md`, `LICENSE`, `SKILL.md`, `SEED-DATA.md`, `PHILOSOPHY.md`, plus whichever of SPEC/EVALUATION/BUILDPLAN survive §8 item 10's curation). Extend `check:repo`'s ruleset with the third-party-content denylist and run it over the assembled history *before* the remote exists. **Backs gate 16; never in the cut band.** Rehearsed at the CP-3 dry run, not improvised at 21:00 Tuesday.
Why an orphan (§8 item 12a): the private development history carries orchestration state, research sources, redistributed material, absolute local paths, internal account posture, and operator routing IDs. Deleting those files only at the tip would leave them recoverable from history.

## Objective and immutable boundaries

- Own MRQ-42 through `pr_open`; the Orchestrator owns merge/public deployment after that state.
- Keep `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, and `sequence/USER_STORIES.md` unchanged in the private working history. Do not mint or reuse AC IDs.
- Use `forgejo` and `master`; refresh refs at every phase boundary and record the exact base SHA.
- The final branch ref is one public orphan commit. The earlier private plan commit is pushed first for recovery, then the branch is deliberately replaced by the unrelated public orphan before the PR.
- `gitleaks` is not installed. Do not install, fake, or infer a clean secret result; retain `gitleaks-unavailable` as an explicit operator prerequisite in the PR and handoff.

## Phase 1 — claim, plan, and durable first commit

1. Claim MRQ-42 as `agent:delegator-mrq-42`, transition to `in_planning`, refresh `forgejo/master`, and record the exact base SHA in the handoff.
2. Baseline the current tree with `npm ci`, `npm test`, `npm run trace:ac -- --scope=all`, and the explicit-target `check:repo` behavior. Separate observed failures from inference; do not weaken a fail-closed command.
3. Self-review this plan against the MRQ-43 checklist. The plan-review resolutions below are authoritative for the assembly mechanics, the complete-history path walk, the gitleaks limitation, and the honest AC report.
4. Transition to `planned`, then commit and push this plan as the first commit. Verify local HEAD equals `forgejo/mrq-42-assembly` after the push before implementation begins.

## Phase 2 — M-50 AC-coverage closure

1. Run `npm run trace:ac -- --scope=all` and inspect the complete `ac-coverage.json`: every live `auto` criterion must have a literal, statically discoverable test title; AC-239 must remain a tombstone; unknown/recycled IDs and duplicate ownership are errors.
2. For each uncovered `auto` AC, add the smallest real test at the correct layer (`tests/node` first, otherwise unit/integration). The test must exercise the shipped code or a deterministic fixture that proves the production path, not a self-seeded answer. Add or amend only the ticket claim manifest required by the existing ownership map; MRQ-42 itself owns no product AC unless the live contract and evidence require one.
3. Re-run `npm test`, `npm run trace:ac -- --scope=all`, and `npm run trace:ac -- --scope=merged --ticket=MRQ-42`. Any remaining `op-assist`, `oracle`, or `felt` criterion is reported by ID as `uncovered-pending-operator`; it is never relabeled as mechanically covered. Gate 3 is clean only when there are no errors and no uncovered live `auto` criteria.

## Phase 3 — M-56 policy and public snapshot

1. Extend `scripts/checks/repo-policy.mjs` and `scripts/checks/check-repo.mjs` so the denylist rejects `.lattice/**`, all `sequence/research/**`, the audit's exact 24 denied paths, the supplied historical regexes (`sources/`, PDFs, competitor files, agent briefs, run-state, `Atin/`), and forbidden internal vocabulary/content. Historical paths must be collected from both `git ls-tree -r --name-only <ref>` and `git log --full-history --format= --name-only <ref>`; never use `git rev-list --objects` for this audit because it deduplicates equal blobs.
2. Add a fast `tests/node` regression for complete historical path coverage, including two distinct denied path names carrying identical content, plus the existing content-policy cases. Keep the checker’s explicit `--repo`/`--ref` requirement and fail-closed behavior.
3. Build a staging snapshot from the current application tree and the required public CLI/SKILL artifacts from the validated MRQ-36 branch. Include runtime source, migrations, scripts/checks, CLI, tests, fixtures, package/build configuration, README, Apache-2.0 LICENSE, SKILL.md, SEED-DATA.md, PHILOSOPHY.md, DESIGN.md, and only the contract/evaluation material that survives public curation and is needed by the checks. Preserve all AC semantics in any public curation copy; do not alter the private contract files.
4. Exclude `.lattice/**`, all `sequence/research/**`, private `sequence/**`/run-state/operator material, spikes and source briefs, PDFs, competitor documents, agent briefs, and any other non-product artifact. Remove or scrub internal hosts, account/email identifiers, local `/Users/` paths, c11 routing IDs, and orchestration vocabulary from every surviving public file. Replace deployment examples with clearly non-production example values; never publish `.dev.vars` or real credentials. Retain the sanctioned external OSM tile dependency only as an explicit product dependency, not as a headshot/source artifact.
5. Add the Apache-2.0 LICENSE and ensure the public README retains its numbered clean-checkout path and named integration extension points. Verify all required runtime files, test imports, and design-contract inputs exist in the staged snapshot.
6. Create the final public commit with `git commit-tree`/a temporary index or an equivalent isolated orphan workflow, then point `mrq-42-assembly` at that commit. Prove it has no parent and no ancestry from `forgejo/master` or any private development commit. Do not carry the plan commit into the final public ref; it remains recoverable only from the private pushed history until the branch replacement.

## Phase 4 — gates, review, remote proof, and PR

1. On the assembled orphan, run the explicit checks with the exact orphan commit/ref: `npm test`, `trace:ac -- --scope=all`, `check:design`, and `npm run check:repo -- --repo <worktree> --ref <orphan-ref>`. Record the full JSON/output, including `gitleaks-unavailable`.
2. Run the complete current-tree and historical-path audit independently with `git ls-tree` plus `git log --full-history --name-only`; assert no denied path, forbidden content, real email, or private history survives. Do not claim a clean secret scan.
3. Transition through `in_progress` → `review`, self-review the exact final orphan diff and history, and attach a standard review artifact naming the reviewed HEAD with `PASS` only when the public-tree and AC evidence are complete. Then transition to `in_validation` and attach the command evidence (or an explicit N/A where a deployed/browser gate does not apply).
4. Immediately before push/PR, run `npm run pr-gate -- --ticket MRQ-42` at the exact final HEAD and paste the result into the completion comment/PR body. Do not open a PR on a red gate.
5. Push the orphan branch with the required force-with-lease after verifying its local ref, fetch the remote, and run `npm run check:repo -- --repo <worktree> --ref forgejo/mrq-42-assembly` against that pushed ref. Confirm the remote SHA equals the local orphan SHA and that the remote scan still reports the same explicit gitleaks prerequisite.
6. Create the Forgejo PR against `master` with MRQ-42, M-50/M-56, AC-coverage evidence, the orphan/no-ancestry proof, the exact public exclusions, named uncovered operator ACs if any, and `gitleaks-unavailable`. Attach the PR URL, transition to `pr_open`, and send the Orchestrator the final state at workspace:9 surface:60. Stop at `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **Finding:** A normal descendant commit would leak the mandatory plan commit into the public history. **Resolution:** push the plan first for durability, then create the public commit independently and replace the branch ref; verify parentlessness and non-ancestry before opening the PR.
- **Finding:** `git rev-list --objects` under-reports equal blobs. **Resolution:** the checker and the independent audit use `git ls-tree` plus `git log --full-history --name-only`, with a regression fixture for duplicate-content path names.
- **Finding:** Removing a file at the tip is insufficient for public release. **Resolution:** assemble only the explicit public snapshot, excluding `.lattice/**`, `sequence/research/**`, all audit-denied paths, and private operator/research material before the first public orphan commit.
- **Finding:** The local machine cannot prove zero secrets. **Resolution:** never install or fake gitleaks; carry the observed `gitleaks-unavailable` finding as an operator prerequisite in both PR and handoff.
- **Finding:** `trace:ac` can hide honest gaps if tests claim more than they prove. **Resolution:** close every live `auto` gap with real tests, retain explicit names for any uncovered non-auto/operator criteria, and report them rather than claiming coverage.

ACs: — (backs gates 3 and 16; M-50 produces `ac-coverage.json`)
Hours: 6 (3 + 3)
Workflow: inline-full
Shared files: `scripts/checks/*` — additive; the `package.json` entries already exist (registered by M-05a+M-06).
Deps: none listed in the plan's cross-cutting table
Audit that keys off this ticket: A-1 runs `check:repo` twice at the push — over the assembled orphan history, then over the pushed remote.
