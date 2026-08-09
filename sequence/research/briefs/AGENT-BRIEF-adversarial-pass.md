# Mission: Adversarial Contract Pass — Marquee

You are the **adversarial reviewer** of Marquee's complete build contract (tone-architect Phase 4), the last gate before a codex fleet builds it overnight against a Wed 2026-08-12 22:00 PT competition deadline. You did not write any of it. Your job is the dangerous gap the authors glossed over — not style, not preference. Assume the fleet will build exactly what is written and nothing that isn't.

## c11 etiquette (first)

Load the c11 skill. Tab pre-named **"Adversary"**; keep it. Description current; last line: `Lineage: Marquee Initiation → Adversary`.

## Read (all of it, cold)

`sequence/run-state.md` (decisions + rulings) · `PHILOSOPHY.md` · `sequence/USER_STORIES.md` (AC-1–250; amendments at tail are authoritative for deltas; AC-239 struck) · `EVALUATION.md` · `SPEC.md` · `BUILDPLAN.md` · `prototypes/pipeline-v1.1/index.html` (the binding prototype, v1.4+closure) · `sequence/research/competition-requirements.md` §3–4 + §7.5 rulings · `sequence/research/seams-feasibility.md` §8 traps · `sequence/research/api-comparison.md`.

## Hunt, in priority order

1. **Contradictions between artifacts** — an AC the SPEC ignores; a SPEC claim no BUILDPLAN ticket builds; an EVALUATION gate item citing dead or wrong ACs; amendment layers (1–9, authored by four different hands tonight) that disagree with each other or with the prototype. The recent "closure" amendment (AC-245–249) and the amendment stack landed fast — check the seams between them hard.
2. **Guardrail enforcement gaps** — every SPEC guardrail claims an audit ticket: does the ticket exist, with the right scope? Especially: demo-safe email (can ANY code path mail a non-allowlisted address?), Airtable never-on-read-path, secret material in the public repo, cookie scoping, Turnstile before every public write incl. presigned uploads.
3. **Tier A holes** — walk the 11-step walkthrough loop step by step against SPEC screens and BUILDPLAN tickets: any step whose ticket chain has a missing dependency, an unbuilt affordance the prototype shows, or an AC with no ticket. The prototype is binding: anything visible in it must be ticketed or explicitly deferred.
4. **Deadline realism** — sum the ticket hours against ~86 remaining hours with 4–6 parallel codex workers; find the critical path; name what the cut line hits if Wave 1 slips 30%; check the three spikes are actually scheduled before their dependents.
5. **The judge's path** — anything a judge driving the walkthrough hits that no artifact owns: first-load experience, error states on the public form, the reset-demo timing between judges, mobile.

## Report

`sequence/research/contract-adversarial.md`: findings ranked **BLOCKING** (fleet must not launch until fixed) / **FIX** (fix in first wave, doesn't block launch) / **NOTE**. Each: what, where (file/section/AC), why it bites, concrete fix. No praise section, no summary of what's good — gaps only. Then `c11 send --workspace workspace:16 --surface surface:128 "Adversary: done — <N> BLOCKING / <N> FIX / <N> NOTE. File: sequence/research/contract-adversarial.md"`. Do not edit any contract file; do not commit. ~90 minutes.
