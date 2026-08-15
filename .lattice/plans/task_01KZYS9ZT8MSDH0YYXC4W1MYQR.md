# MRQ-179: CNT-12: a session's content cannot be approved until it has been scheduled

Rubric item **CNT-12** — `content-management`, weight **3**, `cannot_judge` in round 4 (unreached) → `partial` in round 9 — **1.5 recoverable, joint-largest in my queue.** Scenario: **CNT-S3**.

This item was a free exclusion in round 4 because the run never got to it. Round 9 reached it, so it now costs real points. That is the coverage trap firing exactly as predicted.

## Acceptance criterion — the rubric's `pass_criteria`, verbatim

> A status control exists and persists (exact state names may vary - draft/in-review/approved is the inferred norm); the public agenda page shows the approved session (with its updated title) and omits the unapproved one. If no public agenda exists yet at area-04 time (it is built and published in a later area), the gate may be verified on any public sessions/preview surface, or judged from the agent's recorded observation together with the area-06 public-widget evidence

And the criterion itself, verbatim:

> Sessions carry a content approval/review status the organizer can set, and unapproved content is excluded from the public agenda output. (This item grades the approval GATE, not the public widget rendering itself — that is graded by public-widgets EMB-06.)

## Why it fell short — the judge's own reasoning

> A gate exists and it holds, but it is not a per-session content approval status. **There is no draft/in-review/approved field on the session record; public visibility is governed by the /agenda-builder "Publish the program" panel** [...] with per-session checkboxes and a "Review publication" action — **and only already-SCHEDULED sessions are even listed there, so content cannot be approved independently of being placed on the schedule.** The exclusion half is verified on the real public surface: the anonymous /agenda lists ~24 published talks, and searching it for "Taming" returns "No published sessions match"; both of this area's accepted-but-unpublished sessions are absent [...] The inclusion half was not demonstrated for these sessions — the agent deliberately did not schedule/publish either one (to avoid pre-empting the scheduling area).

## Scope this narrowly — do not build an approval subsystem

Half of what held this to partial is coverage the agent deliberately deferred, and the exclusion half already passes on the real public surface. **The one product fact standing in the way is the coupling: approval is only reachable through scheduling.**

That is, again, the standing rule — *a control that vanishes when inapplicable is a defect*. An accepted, unscheduled session simply does not appear in the panel that governs its publication, so the organizer has no way to express "this content is reviewed" until a room and a time exist. Those are two different decisions made by two different people at two different times.

## What to build

1. **The "Publish the program" panel lists every accepted session**, not only scheduled ones. An unscheduled session appears with its publication control **rendered disabled and carrying the reason** ("needs a room and time before it can go public") rather than being omitted — so the organizer can see the whole population and what each one is waiting on.
2. **The session record carries its publication/content status visibly** — an accepted session should not have to be looked up in the agenda builder for the organizer to learn whether the public can see it.
3. **Keep the gate exactly as strict as it is.** Nothing unapproved may reach the public agenda; the exclusion behaviour already passes and must not regress. This ticket widens what is *visible and settable*, never what is *published*.
4. If you conclude a genuine per-session status field is the right model rather than deriving it, say so on the ticket **before** building it — that is a schema question and schema questions stop at the operator.

## Acceptance

- An accepted, unscheduled session is present in the publication panel, disabled, with its reason stated.
- The public agenda still omits it.
- A regression test covers both halves — visible-but-disabled in the panel, absent from the public output.

## Constraints

- Your **own linked worktree**, created as your first act, then `pwd` and `git branch --show-current` to prove it. Never the primary checkout (it is the Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree and two agents stashing at once swap each other's work.
- **No migration without the operator.** If you conclude one is needed, stop and say so on the ticket.
- **Do not deploy.** An eval round is running and a `.deploy-freeze` marker sits at the primary checkout. Merging is wanted; deploying is not, and is not yours.
- **Elements never jump** — reserve space for anything that swaps.
- Ship a regression test that fails on `main` and passes on your branch.
- Gate serialized. macOS has no `flock(1)`; wrap it: `python3 -c 'import fcntl,subprocess,sys; f=open("/tmp/marquee-gate.lock","w"); fcntl.flock(f, fcntl.LOCK_EX); sys.exit(subprocess.run(["npm","run","pr-gate"]).returncode)'`
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.
