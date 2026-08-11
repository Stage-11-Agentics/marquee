FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-18-reviewer-queue" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-18**. Actor: `agent:delegator-mrq-18`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-18-reviewer-queue`, branch `mrq-18-reviewer-queue`, off `forgejo/master`. Read the scope first: `lattice show MRQ-18 --json`.

Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Headless reviews are suspended — self-review and attach a standard-shape review naming your exact HEAD.

## Walkthrough step 8 — the screen a judge actually drives

ACs **AC-59 – AC-65, AC-158, AC-159, AC-244 – AC-246**. MRQ-17 just merged the evaluation plan, committees, and reviewer track scopes; MRQ-5 seeded 40 organizer-unreviewed round-1 assignments across 8 scopes. **The queue should be populated on first load — if it is empty, the bug is yours, not the seed.**

**AC-244 and AC-246 are guardrails and the orchestrator hand-reviews them.** AC-244: a reviewer opens the full submission without losing queue position, sees every evaluator-visible field and downloadable file metadata, seeded identity is absent under blind mode, and closing returns to the identical queue ID and index. AC-246: the multi-track intersection rule runs through the **one centralized authorization helper** MRQ-17 established — do not add a second authorization path — and a guessed out-of-scope ID returns **403 with no metadata in the body** (assert the body, not just the status). **AC-245: Approve / Maybe / Deny is the primary recommendation and must save with score and criteria null.**

## Standing rules

- Route modules are **`*.routes.ts`** declared through `defineApiRoute` so the manifest glob and OpenAPI pick them up. Anything else silently misses the schema and arms a `check:api` failure. This dodge has happened twice and is now fixed fleet-wide — do not reintroduce it.
- After any rebase: `npm ci`. Never `npm install --no-save`.
- Ship an **AC-tagged test** under `tests/` naming its `AC-nnn`, plus `tests/ac-claims/MRQ-18.json`. `trace:ac` blocks merge on uncovered `auto` ACs.
- **Never weaken an existing guardrail test to make your change pass.** If one breaks, your change is wrong. The orchestrator diffs prior guardrail tests against master and expects them empty.
- UI copy says **"conference"**, never "event"; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).
- `DESIGN.md` (Flight Deck) and `prototypes/pipeline-v1.1/index.html` at **v1.7** are the binding visual contract — drive the prototype, reproduce it, do not redesign. Elements never jump; monospaced tabular figures for every count; honest empty/loading/error states.
- Before the PR: `npm run pr-gate -- --ticket MRQ-18`, paste the result into your completion comment. Then push, PR against `master`, bump `pr_open`, c11-send the Orchestrator at **workspace:9 surface:60**. If the Forgejo keychain lookup fails in your sandbox (exit 44), say so and I will open the PR.
