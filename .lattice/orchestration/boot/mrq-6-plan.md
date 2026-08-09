FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-6-plan-sandbox" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-6** (BUILDPLAN **M-05a + M-06** merged — design system + admin shell + the check harness; inline-full, ~6h). Actor: `agent:delegator-mrq-6`. You are in the **PLANNING-ONLY press-ahead variant**: no worktree, no branch, this sandbox is scratch space. Your dependency MRQ-1 (platform skeleton) is being implemented in parallel.

**Do:**
1. Claim MRQ-6, bump `in_planning`.
2. Read, from the parent repo read-only: the ticket description (`lattice show MRQ-6 --json`), `DESIGN.md` (Flight Deck is binding), `prototypes/skins/skin-c.html` (its header comment carries the canonical token block that lifts verbatim into `src/styles/tokens.css`), `prototypes/pipeline-v1.1/index.html` at v1.6 (the binding prototype — the admin shell, sidebar, and header you are planning must reproduce it one-to-one), `EVALUATION.md` §1 (**all thirteen harness commands** must be registered up front, stubs where empty — this ticket owns that) and its §4 gate list, and `PHILOSOPHY.md`'s craft rules (elements never jump; tabular figures on every count).
3. Write the complete implementation plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-6 --json` → `.data.id`; scaffolded file — read before write). It must cover: the token layer lifted from skin-c, the component set the prototype implies, the admin shell (sidebar/header/routing), and every harness command by name with its stub contract — `test` hermetic and ≤30s is the fleet's inner-loop clock and a slow default suite is a defect, so state how you keep it fast and what goes in the slow suite instead. Speed budgets: **AC-sourced budgets fail; the seven client-signed objectives warn only** — the harness must implement that distinction, not conflate it.
4. Run headless plan-review from the parent: `(cd "$LATTICE_ROOT" && LATTICE_SPAWN_BACKEND=headless lattice plan-review MRQ-6 --mode single --actor agent:delegator-mrq-6-plan-reviewer)`. Triage every finding into an authoritative Resolutions block appended to the plan file.
5. Bump `planned`. **HALT THERE** — no worktree, no code, no status past `planned`.
6. c11-send the Orchestrator: "MRQ-6: planned — awaiting RESUME IMPLEMENTATION" plus one line on any architectural finding.

Every admin screen in the build inherits your shell and every ticket's tests run on your harness, so the plan's job is to make those two surfaces right once.
