# Mission: Draft SPEC.md + BUILDPLAN.md — Marquee

You are drafting the remaining two thirds of Marquee's build contract (tone-architect Phases 2–3). Outputs: `SPEC.md` and `BUILDPLAN.md` at the repo root. DRAFTs the orchestrator (surface:128) finalizes with the client after the v1.1 prototype review — write them complete and decisive, not tentative.

## c11 etiquette (first)

Load the c11 skill. Tab pre-named **"Contract Draft"**; keep it. Description current; last line: `Lineage: Marquee Initiation → Contract Draft`.

## Inputs (read in order)

1. `sequence/run-state.md` — all signed decisions (stack, scope, rounds, repo, domain, seeding).
2. `sequence/USER_STORIES.md` — AC-1–169 in scope (Tier A + B, cut from the bottom of B only).
3. `EVALUATION.md` — the harness the plan must ship; command names are already fixed there.
4. `sequence/research/seams-feasibility.md` — the committed stack with limits, patterns, hour estimates (§9), and the 16 deadline traps (§8), every one of which the plan must dodge explicitly.
5. **The binding design:** `prototypes/pipeline-v1.1/index.html` if it exists when you reach spec-writing (a builder is producing it now — check again before drafting UI sections), else `prototypes/pipeline/index.html` + `prototypes/pipeline-v1.1/DIRECTION.md` (the intent is fully specified there) + `prototypes/chase/index.html` and `prototypes/marquee/index.html` for the grafted screens. Note in SPEC.md's header which you used; the orchestrator re-verifies against final v1.1.
6. `PHILOSOPHY.md`, `prototypes/PROTOTYPE-CONTRACT.md`, `sequence/research/seed-source-2025.md` + `sources/aie-summit-2025-program.json` (the seed generator's source), `sequence/research/competition-requirements.md` §3–4.

## SPEC.md must contain

- **Data model** — every entity with fields, each field with a writer and a reader (an unwritten field is a silent hole). The load-bearing shapes: Abstract-vs-Session as one submissions table with a `kind` + review-bypass semantics; participation as the **(person, session, role)** triple with per-role confirmation; round-aware evaluation schema; event-scoped everything (multi-event modeled, one-event UI); task/file-request/form task kinds; the outbox; the mirror outbox + allowlist.
- **API surface** — REST routes the UI rides on (nothing UI-only — PHILOSOPHY principle 3), auth model (magic links, sessions, demo logins, reset-demo), public vs authed vs admin scopes.
- **Screen-by-screen specification** keyed to the prototype: every screen, its states (empty/loading/error included), and its ACs by ID. Zero design decisions left to the implementer.
- **Non-goals** — the SKIP list verbatim, so nothing creeps back in.
- **Guardrails, each with its own enforcement criterion and a demanded audit ticket:** no secret material in the public repo (`check:repo`); demo-safe email mode from first commit — the app must be *incapable* of mailing a non-allowlisted address in demo mode; never read Airtable on a request path; PROTOTYPE badge never in product code; cookies scoped to the exact subdomain; every list surface budgeted per EVALUATION §1.3.
- **Seed specification** — generator sourced from the 2025 program JSON: 1,000 submissions shaped like the real distribution, real 2025 program as the accepted core scaled toward ~150 speakers (present both the 60-accepted-mirror and 150-scaled options with a recommendation; the client decides at review), the deliberate ugliness list from the prototype contract, placeholder imagery only (no real people's photos).

## BUILDPLAN.md must contain

- **Architecture restated in one page** (from seams; decisions are made — do not reopen them).
- **Ticket breakdown with dependencies**, sequenced around human-visible checkpoints: **walking skeleton first** (deployed Worker + D1 + one loop screen + seed + demo login, on day one — it de-risks traps 2/4 immediately), then loop screens in walkthrough order, then Tier B in decided order. Each ticket: scope, ACs covered, file surface, est. hours.
- **Merge-friendly boundaries** — one-file-per-route/module registration over shared hand-edited lists; name every unavoidable shared file so the orchestrator serializes those edits; keyword-safe names checked.
- **Spike tickets** for the genuinely unproven: the Airtable webhook inbound loop; ICS rendering in real clients (the smoke); D1 bulk-write chunking at wave scale.
- **The human track** separated from the agent track: account checks, inbox setup, Sessionize export, Discord dependencies (Sunday video → freeze), the public-repo push ritual (curate strategy docs, `check:repo`, Apache-2.0 LICENSE, README).
- **Schedule against the deadline** (Wed 2026-08-12 22:00 PT): overnight build tonight → QA Sunday → Sunday-video delta absorbed → polish Mon/Tue → deploy + public push Tue → submit Wed with buffer.

## Rules

- Cite AC IDs exactly; never renumber. Where you'd deviate from an upstream artifact, flag it loudly for the orchestrator instead of silently forking (living-artifacts norm).
- Dodge, by name, every seams §8 trap that touches your plan.

When done: `c11 send --workspace workspace:16 --surface surface:128 "Contract Draft: done — SPEC <N> screens/<N> entities, BUILDPLAN <N> tickets/<N> spikes. Flags: <any deviations, one line>"`.
