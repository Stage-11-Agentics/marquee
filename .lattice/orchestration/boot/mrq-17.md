FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-16-evalplan" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-17**. Actor: `agent:delegator-mrq-17`. Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-16-evalplan`, branch `mrq-16-evalplan`, off `forgejo/master`. Full arc inline: claim → `in_planning` → plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path) → `planned` → `in_progress` → implement → self-review → validate → PR → `pr_open`. Scope is in `lattice show MRQ-17 --json` — read it first.

Evaluation plan, committees, and reviewer track scopes — ACs **AC-53 – AC-58, AC-98, AC-246**. This is **walkthrough step 8's machinery**, so it is on the judges' critical path.

**MRQ-5 already seeded what you need**: 40 organizer-unreviewed round-1 assignments and 8 reviewer track scopes (adversarial finding B-3). Read that seed before building — the queue should be populated on first load, and if it is empty the bug is yours, not the seed's.

**AC-246 is a security guardrail and I hand-review it:** multi-track intersection controls queue membership; queue reads, submission detail, file reads, exports, and evaluation writes must all go through **one centralized authorization helper**; a guessed out-of-scope submission ID returns **403 with no metadata leaked**. MRQ-60 merged the credential resolver and MRQ-3 enforces per-event reviewer scope down to a schema CHECK — build on both, weaken neither.

This ticket is large (~7h). Prefer landing a coherent, tested core over a broad, thin surface.

## Standing rules

- **Route modules are `*.routes.ts`** so `_manifest.ts`'s glob registers them. A module under `src/routes/` named anything else silently misses the manifest and OpenAPI, and arms a `check:api` failure for someone else. This has already happened twice.
- After any rebase: `npm ci`. Never `npm install --no-save`.
- Ship an **AC-tagged test** under `tests/` naming its `AC-nnn`, plus `tests/ac-claims/<TICKET>.json`. `trace:ac` blocks merge on uncovered `auto` ACs.
- UI copy says **"conference"**, never "event"; the wire API keeps `/api/v1/events/...` (SPEC Amendment 13).
- `DESIGN.md` (Flight Deck) and `prototypes/pipeline-v1.1/index.html` are the binding visual contract — reproduce, don't redesign. Elements never jump; monospaced tabular figures for every count; honest empty/loading/error states.
- Headless plan-review and code-review are **suspended** — self-review inline and attach a standard-shape review naming your exact HEAD.
- Before the PR: `npm run pr-gate -- --ticket <TICKET>`, paste the result into your completion comment. Then push, open the PR against `master`, bump `pr_open`, and c11-send the Orchestrator at **workspace:9 surface:60**. If `security find-internet-password` fails in your sandbox (exit 44), say so and I will open the PR for you.
