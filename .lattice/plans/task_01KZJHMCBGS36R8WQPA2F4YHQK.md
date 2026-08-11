# MRQ-53: Audit — reset drill

BUILDPLAN: A-11 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): Reset drill (**AC-230**) — mutate, reset by command and by button, twice consecutively, concurrent poller sees no partial state, **mirror change feed short-circuited and one reconcile enqueued**.
Starts when (verbatim): After M-03; **re-run at CP-3**.

Gate 13's shape: mutate the demo (bulk-accept a wave, un-accept a talk, reschedule a session), run `reset:demo` **and** the in-product button, then re-run `check:seed`. A second context polls the public agenda and the dashboard throughout and must observe only coherent states — never zero sessions alongside non-zero speakers. The second judge inherits nothing from the first.

ACs: **AC-230** (audit evidence; the e2e is M-03's)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-03
Plan: filled in by delegator's plan phase

## Contract and scope

- Audit AC-230 / A-11 at the actual Worker boundary. The judge-facing sequence is: mutate the seeded demo through accepted/rejected submissions, completed speaker tasks, placed and published agenda items, reminder/outbox activity, an attachment, a saved view, an import, webhooks, API tokens, round promotion, and decisions; reset by `npm run reset:demo`, reset through the product button, reset twice consecutively, and compare the restored baseline.
- Prove the reset transaction is observable as old-or-new state to a concurrent public-agenda/dashboard poller, that the mirror change feed is short-circuited and exactly one reconcile message is enqueued, and that reset leaves no orphaned R2 object or mail-draining outbox row.
- Add only audit machinery and the explicit no-auto-AC claim manifest. Do not fix the sidebar/button or other product code under audit; route each finding to its owning ticket with `file:line` and a concrete reproduction.
- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`; do not mint AC IDs. The ticket exercises AC-230, which remains owned by MRQ-3, and owns no `auto` AC.

## Method

1. Establish the exact post-M-03 baseline from the live source and local Worker path: `WIPE_ORDER`, all numbered migrations, demo fixture rows, reset route/job/consumer, CLI polling, and the sidebar action. Record the expected row-count vector by table plus demo-event/person identifiers, outbox/mirror counts, R2 keys, and demo-login result before mutation.
2. Drive a dirty state through the real API/UI paths (using local scratch bindings and the existing seeded persona): accept and reject submissions, complete speaker tasks, place and publish agenda items, send reminders, upload an attachment, create a saved view, run an import, create webhook/API-token/round-promotion/decision rows, and leave the corresponding side effects observable. Capture the exact requests and resulting table/object counts before reset.
3. Run `npm run reset:demo` and poll its job to terminal completion. Assert every migration-defined table's count and the seeded fixture identity/shape, zero owned dirty rows, no R2 orphan, no queued/suppressed outbox row that can later drain, zero mirror change-feed rows, and exactly one `mirror_reconcile` message. Repeat the command immediately and compare the complete vector, not a single count.
4. Drive the same dirty-state classes again, invoke the in-product Reset demo control through the real admin surface, and repeat the complete post-reset and second-reset assertions. If the control is unavailable or points at no reset route, record the UI `file:line` finding and stop treating the button path as passed.
5. Run a second context polling the public agenda and dashboard throughout a reset. Record every observed response/count pair and assert the only accepted states are the pre-reset dirty snapshot or the complete seeded snapshot; specifically reject impossible combinations such as zero sessions with non-zero speakers. Keep this as observed runtime evidence, separate from source/test inference.
6. Add a machine guard in `tests/node/reset-wipe-order.test.mjs` that parses every migration-defined `CREATE TABLE` name and the semantic `WIPE_ORDER` set, asserts exact coverage with no duplicates/stale names, and keys failures on table names rather than line numbers or coordinates. Add `tests/ac-claims/MRQ-53.json` with `owns: []`, `exercises: ["AC-230"]`, and the explicit MRQ-3 ownership note.
7. Run focused reset/guard tests, `npm test`, and `npm run trace:ac -- --ticket MRQ-53`; self-review the exact diff for product-code edits, incomplete table/side-effect coverage, false green button evidence, and public-repo hygiene. Attach a PASS review artifact naming the final HEAD only when all findings are recorded and the guard passes.

## Expected artifacts

- `tests/node/reset-wipe-order.test.mjs`: migration-to-`WIPE_ORDER` invariant guard.
- `tests/ac-claims/MRQ-53.json`: explicit `owns: []` manifest; AC-230 is exercised only and remains owned by MRQ-3.
- Lattice validation/review artifacts: the complete baseline/dirty/reset/twice/button/poller evidence, table-count vectors, R2/outbox/mirror results, demo-login result, and findings with `file:line` plus judge reproduction. These artifacts remain outside the public app tree.
- Mandatory `npm run pr-gate -- --ticket MRQ-53` output pasted into the final Lattice review/completion comment and PR body.

## Verification and handoff

- Refresh `forgejo/master` at every phase boundary and record the exact base SHA; the plan commit is the first branch commit and is pushed before implementation.
- Transition `in_planning → planned → in_progress → review → in_validation → pr_open` with actor `agent:auditor-mrq-53`, verifying each state from `lattice show MRQ-53 --json`. `pr_open` is terminal for this delegator; the Orchestrator merges.
- This is a runtime reset audit, so validation is required: exercise the command and button paths against the local scratch Worker and capture the concurrent poller evidence. Do not claim deployed/browser proof if the actual surface was not reachable; state the exact boundary and route the finding.
- Before `pr_open`, run the mandatory gate from this worktree, push `mrq-53-audit-reset`, open the Forgejo PR against `master`, attach its URL, and send the terminal state to workspace:9 / surface:60.

## Non-goals

- No reset implementation, queue, sidebar, auth, mirror, R2, outbox, import, webhook, token, agenda, evaluation, or seed fix in this audit ticket. Findings route to their owning tickets unless a trivially safe audit-only test/guard change is required and explicitly reported.
- No public deployment, merge, production reset, external mail, Airtable mutation, or credential publication.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Self-review verdict: PASS. The plan covers both reset entry points, two consecutive resets, the complete dirty-state/side-effect inventory, count-vector and ownership assertions, the concurrent coherence oracle, and a future-migration guard keyed on schema table names.
- The existing product button is intentionally treated as an audit subject, not assumed to work from its label. Any unavailable/dead action is a finding with its owning `file:line`; no product repair is authorized here.
- No unresolved plan findings.
