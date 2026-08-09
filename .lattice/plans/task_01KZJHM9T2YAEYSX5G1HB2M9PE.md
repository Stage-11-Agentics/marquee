# MRQ-26: Airtable mirror — outbound

BUILDPLAN: M-25 — Tier B rank 8 (US-72), Wave 2 (§5) · the protected moat block

Scope (verbatim): change feed, 10-per-PATCH upserts, token bucket, seeded base, Settings status/live log.

Architecture (§1): outbound is a `mirror_outbox` change feed draining on a queue, batching 10 records per PATCH with `performUpsert.fieldsToMergeOn: ["marquee_id"]` at ≤4 req/s. **Airtable is never on a read path** (guardrail G4, trap 8 — Team throttles at 2 req/s and 30-hop serial pagination would lose R7 outright). Trap 10: the mirror receives a public R2 URL, never an Airtable attachment URL.
Positioning (Amendment 4): present the mirror as a deliberate engineering trade — *"your team keeps its Airtable view without paying its latency"* — never as a claim to the source-of-truth bonus.

ACs: **AC-225, AC-228**
Hours: 8
Workflow: sub-agent-full (named in the mint brief: mirror)
Shared files: none — module-local under `src/jobs/mirror/*`. **The Airtable client is importable only from `src/jobs/mirror/*`** — A-4 scans for a violation, and that isolation is what makes AC-225's 60 s budget affordable.
Deps: M-02, M-08
Harness: `npm run check:mirror` already exists as a stub (M-05a+M-06 registered all thirteen commands) — fill it, do not add a script.
Precondition: a **dedicated Airtable test base + PAT**, distinct from the demo base (EVALUATION §1.6 item 9) — the mirror suite writes destructively and must never be able to corrupt the base a judge will open.
Plan: filled in by delegator's plan phase
