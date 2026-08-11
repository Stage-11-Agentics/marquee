# MRQ-43: Audit — repo hygiene and full-history scan

BUILDPLAN: A-1 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Repo hygiene — secret scan, `Atin/` and internal paths, third-party denylist, full history.
Starts when (verbatim): At every milestone; **twice at the push** (assembled orphan history, then the pushed remote).

Method: `npm run check:repo` over **the full history of the tree being published**, not the tip — gitleaks + the Marquee ruleset + PROTOTYPE-badge absence in `src/` + README lint + `Atin/`/Stage-11 path scan + the third-party-content denylist (`sources/`, `*.pdf`, `competitor-*`, `AGENT-BRIEF-*`, `run-state`, `C11_`, `surface:`, `workspace:`, `/Users/`).
**A-1's second run is a hard gate on the push** (§8 item 13), not a formality. Backs gate 16.

ACs: — (backs gates 15 and 16)
Hours: 2
Workflow: fast-track
Shared files: none — the audit produces an artifact, not a code change. File findings as Lattice comments/artifacts and open follow-up tickets rather than editing the subject code.
Deps: none — its start is a milestone, not a ticket ("at every milestone")
Plan: filled in by delegator's plan phase

## Audit plan

### Scope and non-goals

- Audit the public tree and every reachable commit in the history that is being
  considered for publication. Cover secrets and API keys, internal hostnames
  and tailnet names, `Atin/`, Stage 11 and orchestration vocabulary, real
  emails, headshots/external image URLs, and the third-party denylist named
  above.
- Treat `.lattice/` as an intentional current-repository exposure: enumerate
  the exact files and history objects that MRQ-42 must exclude or replace when
  assembling the public orphan history.
- Run `npm run check:repo`, inspect every reported finding, and classify each
  as a real public-repo issue, an intentional/sanctioned match, or a tooling
  false positive with evidence.
- Do not modify product code, contract documents, or the public-history
  assembly. Do not create `tests/ac-claims/MRQ-43.json`: this ticket owns no
  `auto` AC. Add a fast `tests/node` guard only if the audit identifies a
  recurrence that can be mechanically prevented without changing product
  behavior.

### Evidence sequence

1. Record the exact worktree, branch, `HEAD`, and fetched `forgejo/master`
   SHA. Baseline the clean tree and run
   `npm run check:repo -- --repo . --ref <publish-ref>`; preserve the command
   and complete output for triage. The bare command intentionally fails closed
   because it has no publish target; it is not itself an audit finding.
2. Inspect the repository's checker implementation and its test coverage so
   the audit does not mistake tip-only checks for history coverage. Independently
   scan the current tree and full reachable history with path/object listings,
   `git log --all --full-history`, and literal/regex searches for credentials,
   internal hosts, Stage 11/Lattice vocabulary, sanctioned email exceptions,
   image URLs, `Atin/`, `.lattice/`, and every third-party denylist token.
3. For every match, establish a concrete reproduction: identify the
   `file:line` or history object, state the caller/publication input, and show
   the exact leaked content or failure. For clean categories, state the exact
   commands and path/history coverage that produced no finding.
4. Locate the MRQ-42 assembled orphan ref/commit when available and rerun the
   complete scan against that exact history, recording its SHA and every
   remaining finding. If it is not yet available, report the missing ref to the
   Orchestrator rather than claiming that gate passed.
5. Add only a narrowly scoped automated guard for a verified recurring finding;
   run that guard directly and include its output. If no recurrence warrants a
   guard, say so explicitly.
6. Self-review the audit as an adversary: verify each finding is independently
   reproducible, each clean claim names coverage, and no audit artifact itself
   introduces public-repo material. Attach a review artifact naming the exact
   reviewed commit and a PASS verdict.
7. Run `npm run pr-gate -- --ticket MRQ-43` from this worktree and preserve the
   result. Push the branch, verify local and `forgejo/<branch>` SHAs match,
   then run the same complete scan against the pushed remote/ref (including
   all reachable history). Attach the final findings artifact and report
   `pr_open` to the Orchestrator with the PR URL and both scan SHAs.

### Deliverables

- A durable Lattice audit artifact/comment containing findings in
  `file:line` form, concrete failure inputs and observed outputs, explicit
  clean coverage, the `check:repo` triage, the assembled-orphan scan, and the
  pushed-remote scan.
- Follow-up ticket references for real findings owned elsewhere; no product
  fixes in this audit branch unless a trivially safe, independently verified
  guard is required to prevent recurrence.
- No `auto` AC claims file for MRQ-43.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- The bare `npm run check:repo` exit 1 is correct fail-closed behavior. Do not
  file it as a defect; only explicit publish refs are auditable.
- The 95/100 findings on the working `HEAD` are expected contents of the
  private working repository. Do not clean the tip. Deliver the exact path and
  pattern checklist to MRQ-42 for orphan assembly instead.
- `gitleaks` is unavailable on this machine and `check-repo.mjs` records
  `gitleaks-unavailable` after skipping execution. The Marquee ruleset covers
  denied paths/content and its own patterns, but it is not a substitute for a
  general secret detector; treat gitleaks as an operator prerequisite and do
  not install it in this ticket.
- The orphan ref is not present yet. Do not claim the assembled-history gate
  passed; record the exact missing-ref state and rerun once MRQ-42 publishes a
  candidate.
