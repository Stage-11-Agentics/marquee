FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-14-plan-sandbox" || { echo "FATAL: wrong cwd — actual: $(pwd)"; exit 99; }`
On failure HALT and report the actual pwd to the Orchestrator via c11 send — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-14** (BUILDPLAN **M-13** — uploads: presign, verify, serve; inline-full, ~5h). Actor: `agent:delegator-mrq-14`. You are in the **PLANNING-ONLY press-ahead variant**: no worktree, no branch, this sandbox is scratch space. Your only dependency, MRQ-1, is in review.

**Do:**
1. Claim MRQ-14, bump `in_planning`.
2. Read, read-only from the parent repo: the ticket description (`lattice show MRQ-14 --json` — verbatim scope and its traps), `SPEC.md`'s upload/media sections, and `EVALUATION.md` rows for **AC-52, AC-146–148, AC-231, AC-232**. Note that AC-146–148 are owned by MRQ-24 for `trace:ac` purposes — you implement the upload half; MRQ-24 owns those AC test names. Say so in your plan so the two tickets don't both claim them.
3. Write the complete implementation plan to `$LATTICE_ROOT/.lattice/plans/<task_uuid>.md` (absolute path; uuid from `lattice show MRQ-14 --json` → `.data.id`; scaffolded — read before write).

**Traps the plan must address explicitly** (they are in the ticket text; the plan states how each is prevented):
- Presigned PUT targets `{account}.r2.cloudflarestorage.com` — **never** a custom domain (trap 9).
- R2 is canonical for media; Airtable only ever receives a public R2 URL (trap 10).
- `/complete` does a HEAD verify **and** a magic-byte sniff — content type is never trusted from the client.
- Per-IP and per-submission caps in KV; a nightly orphan sweep.
- Serving happens on a separate origin with `Content-Disposition: attachment`.
- AC-231 is the presign gate — treat it as a guardrail: an unauthenticated or out-of-scope presign request must fail closed, and the plan names the test that proves it.

**Credential reality:** the operator deferred all real Cloudflare work to **MRQ-57**, so no R2 account exists for this run yet. Plan for local verification against miniflare's R2 binding, and mark in the plan exactly which assertions can only be confirmed against a real bucket — those become a checklist line on MRQ-57 rather than a silent gap.

4. Run headless plan-review from the parent: `(cd "$LATTICE_ROOT" && LATTICE_SPAWN_BACKEND=headless lattice plan-review MRQ-14 --mode single --actor agent:delegator-mrq-14-plan-reviewer)`. Triage every finding into an authoritative Resolutions block appended to the plan file.
5. Bump `planned`. **HALT THERE** — no worktree, no code, no status past `planned`.
6. c11-send the Orchestrator: "MRQ-14: planned — awaiting RESUME IMPLEMENTATION" plus one line on any architectural finding and one line listing the real-bucket-only assertions.
