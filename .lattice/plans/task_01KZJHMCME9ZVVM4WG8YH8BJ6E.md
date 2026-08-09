# MRQ-56: Spike — D1 bulk-write chunking at wave scale

BUILDPLAN: S-3 — spike (§6). Time-boxed; **fails loudly rather than leaking into a feature build.**

Question it settles (verbatim): Does a 150- and a 1,000-record bulk accept survive the **100-bound-parameter cap** and the per-invocation query limit, and which pattern wins — chunk at ≤90 or a single `json_each` parameter? It throws only under real data, only at scale (trap 11).

Box: 1 h. Blocks: **M-07** (which builds the one chunking helper — trap 11) **and M-18**. When: D+0 → D+3, alongside M-01/M-02.
Deliverable: a written verdict naming the winning pattern, recorded on this ticket. **M-07 must not pick a default pattern before this returns.**

ACs: — (de-risks AC-66 – AC-69; guardrail G11)
Hours: 1
Workflow: fast-track
Shared files: none — throwaway spike code.
Deps: none
## Fast-track plan

1. Build an isolated local-D1 Worker harness under `spikes/s3-d1-chunking/` with a submissions-shaped schema, deterministic 150/1,000-row generators, and three probes: an intentional 101-binding control, bounded chunks using at most 90 total bindings, and one `json_each(?)` ID-array binding.
2. Run both candidate writes repeatedly through a real `wrangler dev` local D1 binding. For each size/pattern, reset equivalent rows, assert the exact changed/final counts, record per-trial wall timings and D1 query counts, and preserve machine-readable results.
3. Write `VERDICT.md` with the winner, measured numbers, traps, the exact M-07 helper signature, and a strict split between locally observed behavior and production-deploy verification still owed.
4. Commit the spike, perform a self-review of the committed diff and rerun the harness, attach the verdict summary as validation evidence, push/open the Forgejo PR, and stop at `pr_open` after sending the Orchestrator the one-line decision.

## Scope guard

This spike makes a decision only. It does not add the production M-07 helper, edit binding contract docs, or claim that local Miniflare verifies account-plan/runtime limits that require a deployed Worker.
