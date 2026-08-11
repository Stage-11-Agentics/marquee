FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-65-fold" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` — binding delegator contract. Your ticket: **MRQ-65** (M-60 — the disclosure fold; AC-263, SPEC Amendment 14). Actor: `agent:delegator-mrq-65`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-65-fold`, branch `mrq-65-fold`, cut clean off `forgejo/master`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/task_01KZQAGWE9MWZBMSR0STDNWQ1J.md` → `planned` → `in_progress` → implement → self-review → PR → `pr_open`. **COMMIT AND PUSH YOUR PLAN AS YOUR FIRST COMMIT.** **Opening the PR is the final step and is not optional.**

## The rule that carries this whole ticket

Client ruling: venue surfaces show for **every** conference and **fold** when there is one building. And the distinction that makes it right:

> **Zoom 2 (instruction) is independent of building count. Zoom 1 (relation) is not. A single hotel still has a door and a security desk.**

So with fewer than two pinned buildings, **hide the comparison**: the `· Building` room-label suffix (it is disambiguation, not decoration — name the building once in the page header instead), walking times, Transit conflicts, and the agenda building band; collapse the embedded site map.

**But never hide the instruction.** MRQ-64 just merged arrival instructions — the portal location card, place merge fields, and ICS `GEO`. A speaker at a single-venue conference still needs to know which lobby, that photo ID is required, and how long security takes. **Folding that away would be the defect this ticket exists to prevent.**

## What is merged underneath you

`src/lib/venue-geometry.ts` (`walkingMinutes`, `getTransitConflicts`), `src/routes/agenda.queries.ts` (ONE `getConflicts` producing room, person and transit classes into one array feeding the dashboard count, drawer and tiles), `src/ui/venues/*` (map, authoring), and MRQ-64's portal location card and ICS GEO. **Fold at the presentation layer — do not fork the conflict path or the geometry helpers**, and do not make `getTransitConflicts` lie by feeding it doctored input.

**AC-253 still binds:** building `access_note` and AV capabilities are operator-facing and stay off public surfaces. MRQ-64 proved that boundary with a test asserting the note is present on the authenticated portal and absent from the public agenda — do not weaken it while folding.

## Prove the fold both ways

Test with a single pinned building AND with two: the comparison affordances disappear in the first and appear in the second, while the instruction surfaces are present in **both**. A test that only checks the folded case cannot tell folding from deletion.

**Elements never jump** — folding must not reflow the surrounding layout. Reserve the space or restructure deliberately, and name which you chose in your PR body.

## Standing rules

Suite ~10–18s against 30s; whole gate 45s. Prefer `tests/node`. After any rebase `npm ci` and let it settle ~20s. Resolve `.lattice/**` conflicts by taking upstream. Prototype **v1.9** binds; organizer's noun is **"conference"**. **This repo ships public** — no secrets, internal hostnames, Stage 11 internals, or ticket IDs in shipped files.

**`tests/ac-claims/MRQ-65.json`** claiming **AC-263**. Before the PR: `npm run pr-gate -- --ticket MRQ-65`, paste the result. Then push, **open the PR against master**, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**.
