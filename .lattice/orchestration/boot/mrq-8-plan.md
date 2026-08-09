FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-8-plan-sandbox" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-8** (BUILDPLAN **M-07** — API core, list contract, OpenAPI assembly; inline-full, ~4h). Actor: `agent:delegator-mrq-8`. You are in the **PLANNING-ONLY press-ahead variant**: no worktree, no branch, this sandbox is scratch space. Your dependencies MRQ-2 (schema) and MRQ-56 (spike, **already merged**) are ahead of you; you plan now because M-07 sits on the CP-1 critical chain (M-01 → M-02 → **M-07** → M-08).

**S-3's verdict is IN — it is settled, do not re-litigate it.** The merged spike (`spikes/s3-d1-chunking/VERDICT.md` on master, PR #1) ruled: the chunking helper's default pattern is **one JSON ID array passed as a single bound parameter, expanded with `json_each(?)`** — one write query at both 150 and 1,000 rows, 6 ms median — beating ≤90-binding chunking (12 queries, 8.5 ms). Local D1 accepts exactly 100 bound parameters and rejects 101. The helper must dedupe its IDs, no-op on empty input, stringify once, and run once. Read that VERDICT.md for the recommended helper signature and build your plan around it.

**Do:**
1. Claim MRQ-8, bump `in_planning`.
2. Read, read-only from the parent repo: the ticket description (`lattice show MRQ-8 --json` — the verbatim scope plus the Amendment 6 fold: `GET /events` discovery, people reads, file lifecycle, scoped tokens, pagination/ETag semantics), `SPEC.md`'s API section, `EVALUATION.md` rows for AC-105/106/108, and `spikes/s3-d1-chunking/VERDICT.md`.
3. Write the complete implementation plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-8 --json` → `.data.id`; scaffolded file — read before write). It must pin: the **generated** route manifest (glob-derived, never a hand-edited list — `check:api` asserts registry parity against OpenAPI, so a hand-maintained list is a guaranteed gate failure), the error envelope, the list contract (`page/per_page/q/sort/filters` → `{data,page,per_page,total}`), the pagination helper, the bulk selector type (ids **or** filter), the `json_each` chunking helper per the verdict, and OpenAPI assembly from route definitions serving `/api/openapi.json` + `/api/docs`.
4. Note explicitly where your plan touches the schema, since MRQ-2 is planning in parallel — your plan reads the schema, it never defines it.
5. Run headless plan-review from the parent: `(cd "$LATTICE_ROOT" && LATTICE_SPAWN_BACKEND=headless lattice plan-review MRQ-8 --mode single --actor agent:delegator-mrq-8-plan-reviewer)`. Triage every finding into an authoritative Resolutions block appended to the plan file.
6. Bump `planned`. **HALT THERE** — no worktree, no code, no status past `planned`.
7. c11-send the Orchestrator: "MRQ-8: planned — awaiting RESUME IMPLEMENTATION" plus one line on any architectural finding.

Every later API, CLI, and agent-facing ticket inherits these contracts, so the plan's job is to get them right once.
