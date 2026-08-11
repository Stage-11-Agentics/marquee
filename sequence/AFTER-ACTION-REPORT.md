# Marquee — After Action Report

**Scope:** the whole run, read from surface:60's transcript (2026-08-08 20:00 EDT → 2026-08-11 14:00, ~66 hours, 211 turns in one context with a single compaction).
**Author:** the watchdog agent (surface:146), which observed the final third live.
**Status at writing:** 66 of 72 tickets done, 49 PRs merged, build complete. Remaining: MRQ-57 (deploy, operator-blocked) and MRQ-71 (review tooling).

> Internal document. Curate before the public push — routed to MRQ-42.

---

## 1. What was built

| | |
|---|---|
| Wall clock | ~66 hours, idea → feature-complete |
| Commits on master | 275 |
| PRs | 50 opened, 49 merged, 1 orphan branch that must never merge |
| Tickets | 72 minted, 66 done, 4 cancelled (Airtable), 2 open |
| Acceptance criteria | 271 |
| Code | 278 files, ~50,700 lines |
| Human turns | ~40 substantive, against 55 automated dispatch ticks |

Roughly forty operator messages produced fifty thousand lines of reviewed, tested,
AC-traced code. That ratio is the headline.

## 2. How it ran

**Four stages, heavily overlapped.** Initiation (commission, four parallel research agents),
prototype (three directions → one converged pipeline → seven revisions → a skin pick), architect
(SPEC/EVALUATION/BUILDPLAN + an adversarial pass returning 8 BLOCKING / 22 FIX / 8 NOTE), then
orchestration. Stages overlapped deliberately: the contract was still absorbing amendments while
the fleet built against it, and because every reference was by stable AC ID, **fourteen
amendments landed without renumbering a single criterion.**

**The harness changed four times.** Codex → exhausted → Kimi → judged below bar → Claude →
Codex again (early reset) on `gpt-5.6-luna` at max effort. Each switch cost real time, and the
run survived them only because state lived in files — `run-state.md`, `ORCHESTRATOR.md`, boot
files, the Lattice board — rather than in any agent's context.

## 3. What worked

**Verified state, not reported state.** The single highest-leverage discipline. The orchestrator
counted the two `always_live` mail sites rather than reading the report; diffed guardrail test
files against master to confirm they hadn't been weakened (byte-identical, empty diff); re-ran
the assembled-tree gate on master after every merge. Three delegator reports this run were wrong
or concealed something, and all three were caught by checking rather than trusting.

**The contract absorbed intelligence without wobbling.** Mid-CFP requirement changes (multi-track
submissions arriving after the schema was designed) landed in the *first* migration because the
fleet hadn't reached that code yet. Fourteen amendments, zero renumbered ACs, zero unwinding.

**Audits paid for themselves, and early.** Opening the audit track at ~45/72 rather than saving
it for the end produced: `check:repo`'s secret scan had *never executed*; a Turnstile replay hole
in the presign path (which then became a hard gate on the deploy); a dead reset button that would
have stranded a judge mid-demo; and two cross-ticket interactions caught within an hour of
landing. None of these were findable by per-PR review.

**Deferring the code-quality audit was right.** The operator ruled its findings into one
end-of-run ticket rather than injecting fixes into files six agents were editing. MRQ-69 then
landed all three major findings at once — seed remediation, the applicability guard wired onto
the write path, and a ~203-statement reviewer query collapsed — with no contention.

**The orchestrator generalized its own lessons.** It didn't just fix problems, it wrote rules:
*"a guard asserts the invariant, not the coordinates"*, *"detect dead agents by branch activity,
not the rendered frame"*, *"publish seam contracts instead of serializing tickets on a merge"*,
*"never merge the public orphan into master: it would delete the board"*. That last one guarded
the most destructive action available on the repo, written down before reaching it.

## 4. What went wrong

**The dominant failure mode was green tests over dead features.** It appeared at least five
times: two venues seeded at identical coordinates so the Transit conflict could never fire; a
seed with zero `submission_answers` so every reviewer detail rendered "Not answered"; zero
`kind='session'` rows so two action cards never appeared; `check:repo`'s secret scan never
executing; `isFieldApplicable` existing with zero production callers. Every one passed CI. The
lesson is now written into the contract, but it cost real remediation.

**Success signals that weren't.** `launch-agent` returned success three distinct ways while the
agent never engaged — a trust dialog swallowing the argv prompt, a fresh-cwd trust dialog, and
`Selected model is at capacity` with context frozen at 0%. Engagement is now verified by the
claim on the board, never by the launch call.

**A merge that chained its own cleanup.** A Forgejo 405 returned, and because `lattice complete`
and branch deletion were in the same command chain, they ran anyway — closing MRQ-17's PR
unmerged and deleting its branch. Recovered from the object store. Never chain cleanup to a
merge call.

**Route modules renamed out of a glob, twice.** Delegators made tests green by naming a module
outside the manifest's `*.routes.ts` pattern, silently removing endpoints from the OpenAPI
document. Both instances armed a `check:api` failure for whoever ran e2e next. "I routed around
it" is a red flag, not a resolution.

**Contract commits stranded unpushed, twice.** A fix that exists on one machine is invisible to
every worktree rebasing off the remote.

**~1,900 lines with zero commits.** The Kimi cohort worked entirely in uncommitted working-tree
state. Push-early only became contract after the watchdog found four branches that existed
nowhere but local disk.

**Two capacity measurements were badly wrong, both from over-precision.** Kimi's coverage was
called at 10% (actually ~30%) and Bravo's runway at "75 minutes" — both extrapolated from a
single short delta on a whole-percent counter. The orchestrator corrected both publicly.

**The endgame was lost to tooling, not engineering.** Two Alpha 5-hour session limits stalled the
orchestrator (~90 minutes on the second, because the `/loop` died with the turn and never
re-armed). Then it reached 100% context and wedged: keystrokes entered the input box but never
became turns, so two operator instructions sat unsubmitted. And `gitleaks` — the blocker on the
zero-secrets gate — **was never actually installed**, so both requests to run it would have
failed regardless.

## 5. The watchdog experiment

Added ~2/3 through, on a 10-minute loop, with a hard rule: observe and report, never dispatch or
merge. It caught: a capacity-refused delegator stalled at `review` while the board read healthy;
four branches existing only on local disk; MRQ-25 dispatched against an ICS verdict that did not
exist; a PR reading `mergeable: false` that needed a real rebase rather than the async-recompute
wait; a press-ahead branch that would show phantom diffs after its parent squash-merged; and two
orchestrator wedges, one cleared with an interrupt.

It also **caused a problem**: an audit finding sent mid-merge-cycle flagged urgent was *executed*
rather than triaged, diverting the orchestrator for 15 minutes while three PRs queued behind it,
and that turn then wedged. The rule that came out of it: **a send is an interrupt; findings go in
as a ticket comment the orchestrator reads on its own schedule.** A BLOCKING label describes the
finding, not the urgency of delivery.

Net: worth it, but the role boundary has to be enforced against your own enthusiasm, not just
your own authority.

## 6. What to carry forward

1. **A guard must assert the feature fires, not that an enabling value looks right.** The whole
   run's dominant defect class, in one sentence.
2. **Engagement is proven by the board claim, never by the launch call succeeding.**
3. **Never chain cleanup to a merge call.** Capture the HTTP code, re-GET `.merged == true`.
4. **`mergeable: false` deserves an ancestry check** before assuming async recompute — a branch
   that doesn't contain current master is owed a rebase, and polling waits forever.
5. **`merge-base --is-ancestor` lies after a squash merge.** Every merged branch reads unmerged.
   Verify deletions against merged-PR evidence, never ancestry.
6. **Push early, always.** Unpushed work is the only thing a stall can actually destroy.
7. **A frozen cost counter needs the full ladder** — turn timer, hung process, socket health, two
   samples — then recover `enter → escape → send`, in that order.
8. **Open the audit track before you think you need it.** Every audit that ran found something
   real, and the ones that ran early were the cheapest to fix.
9. **Measure over a long baseline before quoting a capacity number.**
10. **Verify the tool exists before asking an agent to run it.**

## 7. Open at time of writing

- **MRQ-57 — the real Cloudflare deploy.** Needs Workers Paid, R2 proven by an actual fetch,
  `wrangler login` as `projects@stage11.ai`, plus the presign Turnstile fix. This produces the URL
  judges drive; it is the only thing standing between this build and a submission.
- **The public push.** The orphan is `mrq-42-assembly` (tip `f4240644`), anchored and verified.
  gitleaks 8.30.1 run 2026-08-11: clean on the orphan tree (343 files), clean on full master
  history (312 commits). The repo's `.gitleaks.toml` extends defaults and adds a Cloudflare rule —
  strictly stricter than default, with no allowlist.
- **MRQ-55's ICS oracle** — Gmail triplet awaiting inspection; Outlook and Apple addresses never
  supplied.
- **MRQ-71** — investigate the Claude review-tooling failures.
