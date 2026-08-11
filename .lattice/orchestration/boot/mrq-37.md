FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-37-cospeaker" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-37** (M-39 + M-41 — co-speaker flow and the mobile submit pass). Actor: `agent:delegator-mrq-37`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-37-cospeaker`, branch `mrq-37-cospeaker`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMAVGV47ETWDDWRY5BY9Z.md` → `planned` → `in_progress` → implement → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional.** Read the full scope with `lattice show MRQ-37 --json`.

## Two halves, both on surfaces a stranger uses

**Co-speaker flow** — adding a co-speaker to a submission, and what that co-speaker can then see and do. **Mobile submit pass** — the public CFP form at 375 px, driven one-handed.

**The isolation question is the one I hand-review.** A co-speaker gains access to a submission they did not create. That is legitimate and is the point of the feature — but it must be exactly that submission and nothing more. Prove it: a co-speaker reaches the submission they were added to, and is refused everything else, with **no leaked ID or title in the body** and **no row written** — counts before and after, plus a positive control that their legitimate access genuinely works.

MRQ-16 built the speaker portal and MRQ-38 shipped per-role confirm/decline where **a person holding two roles on one submission responds to each independently**. Your co-speaker is a participation row like any other; do not invent a parallel authority path. `src/lib/auth/auth-middleware.ts` now org-filters memberships identically for cookie and bearer — do not diverge them.

## Mobile submit

MRQ-15's public form is merged, with Turnstile gating every public write and presign, and a single-use presign token (MRQ-49 closed a replay hole there — do not reopen it). The submit path persists ONLY `projectApplicableAnswers(...).answers`; a hidden conditional field is neither required nor stored. **You are making that form usable on a phone, not rebuilding it.**

**Elements never jump** matters most here: a validation message appearing under a field must not shove the submit button under the user's thumb mid-tap. Reserve the space. Honest empty, loading and error states; **no sentence may name a field, a type, or an error code without a remedy** — felt checkpoint C3 reads this surface aloud.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts` (one `insertDecisions` writer), `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites**, machine-enforced by an AST inventory in `tests/node/comms.AC-250.test.mjs`), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing**, with a positive control. **Any guard keys on the invariant, never on coordinates.**
- **`WIPE_ORDER` has a merged schema guard** (`tests/node/reset-wipe-order.test.mjs`) asserting it covers every table every migration defines. Add no migration — 0001–0004 are merged and immutable, 0005 is MRQ-66's.
- Suite ~18–29s against 30s; whole gate 45s; prefer `tests/node`. After any rebase `npm ci`, settle ~20s, then gate; resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md`/`DESIGN.md` bind; prototype **v1.9**. Organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files or UI.

**`tests/ac-claims/MRQ-37.json`** — declare what you own; if nothing `auto`, say so explicitly. Before the PR: `npm run pr-gate -- --ticket MRQ-37`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
