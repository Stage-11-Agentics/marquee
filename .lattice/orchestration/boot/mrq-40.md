FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-40-readme" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it — it is the binding delegator contract. Your ticket: **MRQ-40** (BUILDPLAN **M-45** — README, self-host path, and extension points). Actor: `agent:delegator-mrq-40`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-40-readme`, branch `mrq-40-readme`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZJHMB4NW0RKF0KMVRGPCPZ5.md` (that absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Read the full scope with `lattice show MRQ-40 --json`.

**COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT, before any prose** — `git add -A && git commit -m "MRQ-40 plan" && git push forgejo mrq-40-readme`.

## This is gate-backing and it is judged directly

🔒 **NEVER IN THE CUT BAND.** You back `EVALUATION.md` gate 14 (`check:readme`). This repo ships **public open source** as a competition requirement, and swyx entertained judging maintainability by having someone *demo implement a change*. So the README is not marketing — it is the thing an evaluator uses to decide whether this is a real project.

**The deploy path must be EXECUTABLE from a clean checkout.** Not aspirational, not "roughly these steps." Actually follow your own instructions in a fresh clone and fix whatever is wrong — a README whose first command fails is worse than no README, and this run has repeatedly found green tests hiding dead paths. Say plainly what needs a real Cloudflare account (that work is MRQ-57 and is not done) versus what runs locally on `wrangler dev`/miniflare today.

**B-2, and get the wording exact: demo login is a `demo_mode`-only affordance, and the README must say how to turn it off.** Someone self-hosting this must not discover a demo entry point in production because we were vague about it.

## Framing, ruled and binding

- **Lead with Cloudflare and the explicit API bonus (R53).** That is the strongest true thing about this build.
- **Present the Airtable mirror as a deliberate engineering trade — never as a claim to the source-of-truth bonus.** Overclaiming there is worse than not mentioning it (Amendment 4).
- **Code legibility is part of the deliverable** (Amendment 2): a real CONTRIBUTING section, honest module boundaries, extension points that actually exist. Point at real files — `src/lib/form-conditions.ts` (one shared condition evaluator), `src/jobs/cascade/decisions.ts` (one decision writer), `src/jobs/mail/outbox.ts` (demo-safe outbox with exactly two `always_live` sites), `src/routes/_manifest.ts` (glob-generated route manifest), `src/lib/venue-geometry.ts`. Those single-source seams are the architecture worth explaining.
- The import section depends on Sessionize import (MRQ-31, **not built**). Write it against `fixtures/sessionize/*` and mark it clearly as the fixture-backed shape, to be folded to real text when MRQ-31 lands.

## Public-repo hygiene — you are the most exposed ticket on the board

Nothing secret ships: no tokens, no Stage 11 internals, no `Atin/` content, no real email addresses, no internal hostnames or Forgejo URLs, no Lattice/orchestration references. Write for a stranger who has never heard of us. Assume every word is read by a judge.

## Evidence required

`tests/ac-claims/MRQ-40.json` — if this ticket owns no `auto` AC directly, say so explicitly in the PR body rather than shipping an empty claims file. **Prefer adding no integration tests**: the suite is the fleet's inner-loop clock and a docs ticket should cost it nothing. If `check:readme` needs assertions, put them in `tests/node` (plain node, no Worker runtime).

Before the PR: `npm run pr-gate -- --ticket MRQ-40`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
