FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/private/tmp/claude-501/-Users-atin-Projects-Stage11-deployments-Marquee/e17abbab-2821-422a-9624-44da32fba710/scratchpad/mrq-2-plan-sandbox" || { echo "FATAL: wrong cwd"; exit 99; }`
On failure HALT and report — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-2** (BUILDPLAN **M-02**, the whole init migration — sub-agent-full at implementation, but **you are in the PLANNING-ONLY press-ahead variant**). Actor: `agent:delegator-mrq-2`. You have **no worktree and no branch on purpose** — this sandbox cwd is a scratch space; your dependency (MRQ-1) is being implemented in parallel and you plan while it lands.

**Do:**
1. Claim MRQ-2, bump `in_planning`.
2. Read, from the parent repo read-only: `SPEC.md` §3 (every table — the schema authority), the ticket description (`lattice show MRQ-2 --json` — verbatim scope, serialized ⛔, AC list including the Amendment 11 fold: `buildings` table + `rooms.building_id/av_capabilities/notes`), `EVALUATION.md` §2 rows for your ACs, and `.lattice/orchestration/ticket-map.md` for who consumes the schema.
3. Write the complete implementation plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-2 --json` → `.data.id`; the file is scaffolded — read it first). The plan must enumerate every table, index, and constraint against SPEC §3 (a checklist the implementer ticks), the `outbox.send_policy` default, the status enum including `waitlisted`, the `(person, submission, role)` participation triple, round-aware evaluation, reviewer track scopes, and the Amendment 11 venue tables.
4. Run headless plan-review from the parent: `(cd "$LATTICE_ROOT" && LATTICE_SPAWN_BACKEND=headless lattice plan-review MRQ-2 --mode single --actor agent:delegator-mrq-2-plan-reviewer)`. Triage all findings into an authoritative Resolutions block in the plan file.
5. Bump `planned`. **HALT THERE.** Do not create a worktree, do not write a migration, do not bump past `planned`.
6. c11-send the Orchestrator: "MRQ-2: planned — awaiting RESUME IMPLEMENTATION" (+ one line on any plan-review finding that was architectural).

You will receive a `RESUME IMPLEMENTATION` message naming your post-merge worktree when MRQ-1 lands; implementation (sub-agent-full) happens then, in that worktree, not here.
