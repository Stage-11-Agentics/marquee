FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-41-craft" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-41** (M-46 — empty-state pass and craft sweep). Actor: `agent:delegator-mrq-41`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-41-craft`, branch `mrq-41-craft`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMB7N2R81QBNK2K2364NJ.md` → `planned` → `in_progress` → work → self-review → PR → `pr_open`. Read the full scope with `lattice show MRQ-41 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any other work.** **Opening the PR is the final step and it is not optional** — one agent on this run finished everything, passed its gate, and died before opening the PR.

## This is what a judge actually sees

Nearly every screen now exists: submissions list, program board, submission record, agenda with swimlanes and three conflict classes, reviewer queue, evaluation plan, chase board, communications, venues with a map, public site and embeds, speaker portal, public CFP form, saved views and the draft queue, quick search, scoped API tokens.

**Walk every one of them cold, in an empty and a populated state.** The failures you are hunting are the ones tests never catch: an empty list that looks broken instead of finished; a loading state that flashes or shifts; a control that resizes when its label changes; a count that jitters because it is not tabular; a truncation that hides the only distinguishing part of a title; a screen whose copy names a field or an error code instead of a remedy.

**Elements never jump** is the house rule and it is most often violated by things that only appear sometimes — a conflict badge, a filter chip count, a validation message. Reserve the space.

Honest empty states: \"no drafts need attention\" and \"nothing outstanding\" are real, good answers and should look deliberate rather than like a failed query. \`PHILOSOPHY.md\` binds — one obvious primary action; the organizer's language, not ours.

**Be surgical.** Five other agents are live in these files. Prefer many small, isolated commits over one sweeping refactor, do not restructure components, and do not rename anything shared. If a fix needs a structural change, name it in your PR body and leave it to me.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts`, `src/lib/venue-geometry.ts`, `src/routes/comms.routes.ts`, MRQ-8's list contract and generated route manifest.
- **The mail guardrail is now machine-enforced by an AST inventory** in `tests/node/comms.AC-250.test.mjs`: no production module may import a Resend client, only `src/jobs/mail/consumer.ts` may reference the endpoint, and exactly **two** live-policy writes exist, both in `outbox.ts`. If your work trips it, you have introduced a third — fix your code, never the guard.
- **Guardrail tests assert the status code AND the absence of the thing** (no leaked ID, no row written — check counts before and after) **and carry a positive control** so they cannot pass vacuously.
- Suite ~10–18s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci` and let it settle ~20s before gating. Resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; **elements never jump**. Organizer's noun is **"conference"**; wire API keeps `/api/v1/events/...`. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-41.json`** — if you own no `auto` AC, say so explicitly rather than shipping an empty claims file. Before the PR: `npm run pr-gate -- --ticket MRQ-41`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
