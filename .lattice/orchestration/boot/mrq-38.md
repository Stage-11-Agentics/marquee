FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-38-confirm" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-38** (BUILDPLAN **M-42 + M-52** — role confirm/decline and decision feedback; ~6h). Actor: `agent:delegator-mrq-38`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-38-confirm`, branch `mrq-38-confirm`, cut clean off `forgejo/master` (`b3672e3`).

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMAYHGQMZCJX3XQJX72P2.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-38 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any code** — `git add -A && git commit -m "MRQ-38 plan" && git push forgejo mrq-38-confirm`.

## You are filling two slots other tickets deliberately left empty

MRQ-16 built the speaker portal and **explicitly did not claim AC-152–154 or AC-235/236**, because an AC owned by everyone is owned by no one. Those slots are rendered and waiting. You are their **sole owner, end to end**.

**AC-235 is the demo's headline action and has one hard rule: it must not use a second render path.** The chain is already built and you connect it, you do not rebuild it:
- **MRQ-19** shipped ONE writer — `insertDecisions` in `src/jobs/cascade/decisions.ts` — and both the single and bulk decision paths already funnel through it. Your `submission_decisions` write **is that writer**. A second insert is the defect.
- **MRQ-12/MRQ-25** own the outbox; the decision message renders **once** into it. `outbox` carries `entity_id`, which is what makes `idempotency_key = sha256(template_key, entity_id, person_id)` work.
- **MRQ-16** renders the portal slot. The portal must display **from that same `submission_decisions` row** — not from a re-render, not from a copy on the submission.

Prove it the way the AC is written: **bulk-accept 3 records, assert 3 `submission_decisions` rows exist, and assert all 3 portals render from them.** Then repeat with no feedback note. Byte-equivalent normalized feedback from one row is the assertion.

**AC-153 is the subtle one:** a person holding two roles on one submission confirms **each independently** — one response does not settle the other. Test that pair directly; it is the case a naive `UPDATE ... WHERE person_id = ?` silently breaks.

Decline notifies and flags the agenda (AC-152/154). Confirm/decline is visible to the lead, per role.

## The comms seam — I have already ruled on it

Three tickets now touch the templated-send path. The ruling, in order: **MRQ-24 (chase board) defines the reminder-send shape and merge-field rendering additively and lands first; MRQ-32 (comms cluster) extends it; you extend it too.** Your "one-off templated email logged on the record" is a consumer of that same shape — **do not define a second merge-field renderer or a parallel templated-send path.** MRQ-24 names its functions and their contract in its PR body; read that before you build. If the shape genuinely cannot express what M-52 needs, tell me and I will rule — do not work around it silently.

Every send you add is **`demo_safe`**. `outbox.send_policy` has **exactly two** `always_live` write sites and neither is yours; Resend's free tier is 100/day and judging is imminent.

## Standing rules

- **Guardrail tests assert the status code AND the absence of the thing**, with a positive control so they cannot pass vacuously. A speaker confirming a role must not be able to settle another person's role — assert the rejection **and** that no row changed.
- **The fast suite is at ~18–26s against a hard 30s budget** and has already turned master red once. Prefer `tests/node` for anything not needing a Worker runtime; add integration files only where you must.
- `PHILOSOPHY.md` and `DESIGN.md` bind; prototype **v1.9** is the binding visual contract. **Elements never jump** — a confirm/decline control must not resize its row when its label changes. The organizer's noun in UI copy is **"conference"**; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).

## Evidence required

An **AC-tagged test** under `tests/` naming its `AC-nnn`, plus **`tests/ac-claims/MRQ-38.json`** claiming **AC-152 – AC-154 and AC-235/AC-236** — you are their sole owner, so `trace:ac` expects them here and nowhere else. After any rebase run `npm ci` before trusting a red test.

Before the PR: `npm run pr-gate -- --ticket MRQ-38`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
