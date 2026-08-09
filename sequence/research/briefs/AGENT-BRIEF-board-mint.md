# Mission: Mint the Lattice Board + Validation Plan — Marquee

You are the **board minter** for Marquee's staged fleet run (Lattice Orchestration, Phase 0). The fleet is NOT being dispatched — you create the complete board and validation plan; every ticket stays in `backlog`. Transcription with precision, not design: `BUILDPLAN.md` and `EVALUATION.md` are your sources and they are law.

## c11 etiquette (first)

Load the c11 skill. Tab pre-named **"Mint"**; keep it. Last description line: `Lineage: Orchestrator → Mint`.

## Read

`BUILDPLAN.md` (every ticket table incl. all amendments — M-01…M-55+, the audit track, spikes S-1..S-3, and amendment-added tickets like M-52/M-53/M-54) · `EVALUATION.md` (all in-scope ACs and gates) · `sequence/USER_STORIES.md` scope table + amendments (AC authority) · `.lattice/config.json` (status vocabulary — everything stays `backlog`).

## Rules for minting (binding)

- One Lattice ticket per BUILDPLAN item. `lattice create "<title>" --actor "agent:orchestrator-intake"` then `lattice update <ID> description="..." --actor ...` (or create with description if supported — check `lattice create --help` first).
- **No ticket IDs or M-numbers in titles** — titles are the BUILDPLAN scope in plain words (e.g. "Platform skeleton and first real deploy", not "M-01: …"). Put the M-number in the description's first line.
- **Verbose fidelity** — description carries: `BUILDPLAN: M-xx` · full scope text from the plan · `ACs: <the exact AC IDs>` · `Hours: <est>` · `Workflow: <mode>` · `Shared files: <any BUILDPLAN-flagged shared-file surface>` · `Plan: filled in by delegator's plan phase`.
- **Workflow mode per ticket**: `fast-track` for ≤2h mechanical items; `inline-full` default; `sub-agent-full` for M-02 (schema), M-25/M-26 (mirror), and any ticket ≥7h.
- **Dependencies**: `lattice link <id> depends_on <other> --actor "agent:orchestrator-intake"` — exactly the BUILDPLAN's dep column, no additions (loose deps kill parallelism). Spikes block their dependents as the plan states.
- Every mutation carries `--actor "agent:orchestrator-intake"`.
- Keep a scratch mapping file `.lattice/orchestration/ticket-map.md`: `| M-xx | MRQ-n | title |` — every downstream boot prompt keys off it.

## Validation plan — `.lattice/orchestration/validation-plan.md`

Schema (load-bearing, exact):

```
# Validation Plan
Source spec: [SPEC.md](../../SPEC.md) · Source evaluation: [EVALUATION.md](../../EVALUATION.md) · Date: 2026-08-09

| # | Criterion (ID) | Verification method | Artifact to inspect | Pass condition | runnable_at |
```

- **Every in-scope AC gets ≥1 row** (Tier A + Tier B per the stories scope table + amendments; post-competition ACs excluded). `runnable_at` ∈ `pre-merge-static` | `post-merge-smoke` only. `felt` + `operator-assisted` ACs are smoke-side by construction; `external-oracle` rows name the oracle (real Gmail/Outlook/Apple inbox; the clean skill-agent). Speed *objectives* (the seven client-signed ones) are smoke rows whose pass condition is "measured and reported" not "under budget"; AC-sourced budgets are pass/fail.
- Verification methods concrete and reproducible; pass conditions single-line testable. Artifact column names the ticket (via ticket-map) whose PR carries it.
- Also transcribe EVALUATION §4's terminal gate as an ordered checklist section at the end, each item citing its ACs.

## When done

Report: `c11 send --workspace workspace:16 --surface surface:128 "Mint: done — <N> tickets, <N> links, <N> validation rows + <N> gate items. Map: .lattice/orchestration/ticket-map.md. <any BUILDPLAN ambiguity found, one line each>"`. Commit everything (`.lattice/` included) as one commit. Do not transition any ticket out of backlog; do not touch contract docs.
