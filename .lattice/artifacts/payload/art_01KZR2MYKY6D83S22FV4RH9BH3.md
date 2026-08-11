# Plan Review: MRQ-42 (Cycle 2)

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed, with the issues below carried as binding implementation directives (none requires a return to `in_planning`).

### 2. Summary

Reviewed the revised MRQ-42 plan (M-50 `trace:ac` closure + M-56 public-repo assembly) against the task description, the A-1 audit checklist (`art_01KZR1P0MS8QQGZYSREFW1TNVS`), the boot contract, and the live code in `scripts/checks/`. The plan is strong: all five Cycle-1 findings are resolved with concrete mechanics (plan-commit-then-branch-replacement, `ls-tree` + `log --full-history --name-only` instead of `rev-list --objects`, honest `gitleaks-unavailable` handling, honest AC reporting). The key remaining concern is a self-matching hazard: the extended denylist and its regression fixtures will themselves ship inside the public orphan and be scanned by their own content rules — the existing obfuscation discipline in `repo-policy.mjs` must be extended to every new pattern and fixture, or `check:repo` will fail on its own policy file at gate time.

### 3. Issues

**[MAJOR] Phase 3.1–3.2 / Phase 4.1 — Extended denylist and fixtures will self-trip the content scan unless obfuscated**
`check-repo.mjs` scans `git log -p` of the publish ref for `DENIED_CONTENT`, and the public orphan's single commit includes `scripts/checks/repo-policy.mjs` and the `tests/node` regression fixtures themselves. The current file deliberately builds its markers via `joinParts` (the MRQ-43 "self-matching fix") precisely so the policy file doesn't match its own patterns. The plan's new additions are hazardous here: a literal path regex like `/(^|\/)\.lattice\//i` contains the word-bounded token "lattice" and will match the existing `Lattice vocabulary` content pattern; likewise, regression fixtures that spell out denied path names (`AGENT-BRIEF-…`, `run-state`) or denied content strings (`workspace:9`, `C11_…`) as literals will be flagged when the orphan's own history is scanned. Phase 4.1 would then go red on the checker's own source, at exactly the moment the plan is trying to prove cleanliness.
**Recommendation:** Add an explicit implementation rule: every new pattern in `repo-policy.mjs` and every denied-string fixture in the regression tests must be constructed dynamically (the existing `joinParts` idiom or equivalent), never as a contiguous literal. Include a self-scan assertion in the regression test: run the content scan over the checker's and tests' own source and assert zero findings.

**[MAJOR] Phase 3.3/3.5 vs Phase 4.1 — `check:design` on the orphan requires `prototypes/skins/skin-c.html`, which is not in the public tree list**
`verify-design-contract.mjs` hard-reads `prototypes/skins/skin-c.html` (plus `src/styles/tokens.css`, `src/styles/components.css`, `src/ui/shell/route-table.ts`) from the repository root. The task description's public tree list (`src/`, `migrations/`, `scripts/`, `cli/`, README, LICENSE, SKILL.md, SEED-DATA.md, PHILOSOPHY.md, curated contract docs) does not include `prototypes/`. Phase 3.5's generic "design-contract inputs exist in the staged snapshot" gestures at this but never names the file, and Phase 4.1 unconditionally runs `check:design` on the orphan. As written, that check throws on the assembled tree. Similarly, `trace:ac` on the orphan hard-requires `EVALUATION.md` at root and `tests/ac-claims/` — so "survives curation" is not optional for EVALUATION.md if Phase 4.1 is to run as specified.
**Recommendation:** Make the decision explicit in the plan/implementation: either (a) include exactly `prototypes/skins/skin-c.html` (not all of `prototypes/`) in the snapshot after content-scrubbing it, and ship a curated-but-AC-intact `EVALUATION.md` plus `tests/ac-claims/`, or (b) run `check:design` from the private tree and record it as an explicit N/A on the orphan with the reason. Whichever is chosen, name the files; do not leave it to the generic verification sentence.

**[MINOR] Phase 3.3 — "validated MRQ-36 branch" is a stale reference; MRQ-36 is already merged**
`forgejo/master` tip (`49cd454`) is the MRQ-36 merge. Pulling CLI/SKILL artifacts from the `mrq-36-cli` branch instead of the refreshed base risks assembling a stale copy if master has moved past the branch.
**Recommendation:** Source all snapshot content from the single recorded base SHA on `forgejo/master` (which now contains MRQ-36); drop the branch reference.

**[MINOR] Phase 4.6 — PR from an unrelated-history orphan against `master` will have no merge base**
The orphan shares no ancestry with `master` by design, so Forgejo will report the PR as conflicted/unmergeable (add/add on every differing file). That is acceptable — the PR is the review-and-evidence artifact and the Orchestrator owns what happens after `pr_open` — but if unstated, it will look like a defect at handoff.
**Recommendation:** State in the PR body that the no-merge-base condition is intentional and expected (it is the ancestry proof working as designed), and that merge/publish disposition is an Orchestrator decision.

**[MINOR] Phase 1/4 — plan commit becomes unreachable on the remote after the branch replacement**
After the Phase-4.5 force-with-lease, `01a6917` (the already-pushed plan commit) is dangling on Forgejo and eligible for GC. The durable record is the `.lattice/plans/` file in the main working repo, which is sufficient — but the plan's claim that it "remains recoverable … from the private pushed history" quietly expires at the force-push.
**Recommendation:** If durability of the pushed plan commit matters, park it under a side ref (e.g. `mrq-42-plan-archive`) before replacing the branch; otherwise reword the handoff to point at the `.lattice` plan file as the sole durable copy.

### 4. Positive Observations

- **All five Cycle-1 resolutions are genuinely incorporated, not just restated.** The plan-commit-then-replace sequence with a parentlessness/non-ancestry proof, the `ls-tree` + `log --full-history --name-only` walk with a duplicate-content regression fixture, and the tip-deletion-is-insufficient framing all directly answer the prior findings and match the A-1 audit's mechanics (including the `rev-list --objects` dedup trap the audit demonstrated with `walkthrough.en.vtt`).
- **The gitleaks posture is exactly right.** The plan refuses to install, fake, or infer a clean secret result, and carries `gitleaks-unavailable` as a named operator prerequisite through the PR and handoff — matching the boot contract's hard rule and the audit's finding that the local ruleset cannot establish zero-secret proof.
- **Honest AC reporting is built in.** `op-assist`/`oracle`/`felt` criteria are reported by ID as `uncovered-pending-operator` rather than relabeled, and Phase 2 forbids self-seeded tests that claim more than they prove — the gate-19 standard this run has been holding.
- **Verification runs at the right targets.** `check:repo` runs with explicit `--repo`/`--ref` against the assembled orphan before the remote exists, then again against the pushed ref with a SHA-equality check — precisely the double scan the A-1 audit keys off.
- **Immutable boundaries are crisp:** contract files untouched in private history, no AC minting, exact base SHA recorded, stop at `pr_open`. The plan is easy to audit against because it commits to specifics.
