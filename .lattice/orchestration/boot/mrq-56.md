FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-56-spike-d1-chunking" || { echo "FATAL: wrong cwd"; exit 99; }`
On failure HALT and report — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-56** (BUILDPLAN **S-3**, spike, ~1h, fast-track — self-review, no headless reviews). Actor: `agent:delegator-mrq-56`. Branch: `mrq-56-spike-d1-chunking`.

**Question to settle** (full text in `lattice show MRQ-56 --json`): does a 150- and a 1,000-record bulk write survive D1's **100-bound-parameter cap** and per-invocation query limits, and which pattern wins — chunking at ≤90 bound params, or a single `json_each(?)` JSON-parameter pattern? This verdict **blocks M-07's chunking helper** (ticket MRQ-8), so the deliverable is a decision, not a prototype.

**Method:** no Cloudflare auth exists on this machine yet — use **local D1** (`wrangler d1 execute --local`, or `wrangler dev` with a local D1 binding; miniflare's D1 enforces the same SQLite bound-parameter limits). Build a minimal harness under `spikes/s3-d1-chunking/` in your worktree: schema with a realistic submissions-shaped table, generators for 150 and 1,000 rows, both write patterns, timings. Note explicitly in the verdict which limits are local-verified vs. deploy-verified-later.

**Deliverable:** `spikes/s3-d1-chunking/VERDICT.md` — the winning pattern, the numbers, the exact helper signature you recommend M-07 build, and any trap found. Commit, self-review, attach the verdict inline to the ticket (`lattice attach MRQ-56 --type note --role validation --inline "<verdict summary>"`), open the PR, bump `pr_open`, and c11-send the Orchestrator the one-line verdict (it gets relayed into MRQ-8's boot prompt).
