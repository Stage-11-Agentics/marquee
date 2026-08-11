FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-68-not-notified" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-68** (M-63 — "Decided · not notified": the built-in view and the attention row). Actor: `agent:delegator-mrq-68`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-68-not-notified`, branch `mrq-68-not-notified`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZQFM4K9VR1EVHS8KRX03NAQ.md` → `planned` → `in_progress` → implement → self-review → PR → `pr_open`. **COMMIT AND PUSH the plan as your first commit.** **Opening the PR is the final step and is not optional.**

## This ticket exists because the product's central claim has three honest exceptions

Read the full scope with `lattice show MRQ-68 --json`. It owns **AC-268 and AC-269**, has **zero schema** — it is fully derived from `submission_decisions` LEFT JOIN `outbox`.

PHILOSOPHY principle 2 makes the status change *be* the notification, and that is what beats the incumbent. The honest corollary, stated in the ticket: the automatic send has exactly **three** designed-in ways not to arrive, **and all three are correct**:

1. The Airtable mirror deliberately does not run the cascade (AC-226). **Note: the Airtable mirror was CUT today — SPEC Amendment 17.** So this path is now theoretical rather than reachable; say so plainly in the UI copy or drop that case, and name your choice in the PR body rather than rendering a state that can never occur.
2. An outbox row sits `queued`, suppressed, or `failed`.
3. The record carries no usable address, so nothing could be queued.

**None of these had a screen.** A decision that silently never reached the speaker is the worst failure this product can have, because the organizer believes the speaker was told. Your view is the answer to "who thinks they were notified and wasn't."

## Build on what is merged

`src/jobs/cascade/decisions.ts` has ONE `insertDecisions` writer; `outbox` carries `entity_id` and `idempotency_key`. MRQ-38 proved the portal reads decision feedback from that same row — your view reads the same join, it does not invent a parallel notion of "notified". MRQ-34 shipped saved views with a fixed column registry and immutable built-ins; **yours is a built-in**, so follow that pattern rather than adding a bespoke screen.

Derive it — do not add a `notified` boolean anyone has to remember to set. A denormalised flag is exactly how this class of bug returns.

## Standing rules

- **Build on merged seams; never fork one.** `src/lib/form-conditions.ts`, `src/jobs/cascade/decisions.ts`, `src/jobs/mail/{outbox,render,merge-data}.ts` (**exactly two `always_live` sites**, machine-enforced by an AST inventory in `tests/node/comms.AC-250.test.mjs`), `src/lib/auth/auth-middleware.ts` (cookie and bearer both org-filter — do not diverge them), MRQ-8's list contract and generated route manifest.
- **Guardrail tests assert the status code AND the absence of the thing**, with a positive control. **Any guard keys on the invariant, never on coordinates.**
- Suite ~19–27s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci`, let it settle ~20s before gating; resolve `.lattice/**` conflicts by taking upstream.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9**; **elements never jump** — a count that appears only sometimes is the classic violation, so reserve its space. Organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files or UI.

**`tests/ac-claims/MRQ-68.json`** claiming AC-268 and AC-269. Before the PR: `npm run pr-gate -- --ticket MRQ-68`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
