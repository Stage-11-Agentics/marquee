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
Plan: filled in by delegator's plan phase
