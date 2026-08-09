# Mission: Draft EVALUATION.md — Marquee

You are drafting the **evaluation contract** for Marquee's build (tone-architect Phase 1). Output: `EVALUATION.md` at the repo root — what "done" means and *exactly how an agent verifies each criterion without a human in the loop*, for the build fleet and its terminal auditor. This is a DRAFT the orchestrator (surface:128) will review and finalize with the client; write it complete, not tentative.

## c11 etiquette (first)

Load the c11 skill. Tab pre-named **"Eval Draft"**; keep it. Description current; last line: `Lineage: Marquee Initiation → Eval Draft`.

## Inputs (read in order)

1. `sequence/USER_STORIES.md` — the canonical 71 stories, AC-1–AC-224. **In scope for the build: Tier A + Tier B (AC-1–169).** Post-competition ACs get one line: out of build scope.
2. `sequence/research/seams-feasibility.md` — the committed stack (Cloudflare Workers + D1 + R2 + Queues, Resend with demo-safe outbox, ICS METHOD:REQUEST, magic-link auth, two-way Airtable mirror) and its limits; §10 lists what needs live smoke tests.
3. `PHILOSOPHY.md` — speed is a graded feature; the taste rules.
4. `sequence/research/competition-requirements.md` §3 — the judges' evaluation mechanism (the 11-step walkthrough loop on a deployed site).
5. `prototypes/PROTOTYPE-CONTRACT.md` + `prototypes/pipeline-v1.1/DIRECTION.md` — the binding design (v1.1 is being built now; it becomes the visual contract).

## What EVALUATION.md must contain

1. **The harness** — concrete runnable commands the build will ship: unit/integration suite (hermetic, parallel, target ≤30s — Stage 11 hard rule), a Playwright end-to-end suite that drives the deployed/preview site through the full 11-step loop against the seeded database, and a speed-budget check (measured, not asserted: e.g. dashboard and submissions list render against the ~1,000-row seed within stated budgets — pick budgets from the stories' ACs where stated, else propose them). Name the commands (e.g. `npm test`, `npm run e2e`, `npm run check:speed`) — the build plan will create them.
2. **Per-AC verifiability table** — every AC-1–169, tagged:
   - `autonomous` — provable by the harness alone; name which suite covers it.
   - `operator-assisted` — needs a human-supplied artifact or account (say what and when: e.g. Airtable base credentials, Resend live-send proof).
   - `external-oracle` — needs a third-party surface as judge (e.g. AC around Gmail/Outlook rendering ICS invites: the §10.5 smoke test — send, accept, update, cancel against real inboxes).
   - `felt` — the 5 candidate-felt ACs plus any others no assertion settles; schedule each as a **human-use checkpoint** with an explicit trigger (walking skeleton up; each user-facing surface complete; pre-submission full pass).
   Group rows by story; keep each row to one line (AC, tag, how-verified).
3. **The terminal gate** — the ordered checklist the final auditor runs before "done": full loop on the *deployed* site with zero dead ends; seeded demo present with both demo logins working; speed budgets met on deployed infra; Airtable round-trip demonstrated; ICS invite accepted in a real Gmail; reset-demo works; PROTOTYPE badge absent from the product (it belongs to prototypes only); no secret material in the public repo.
4. **Non-goals restated** — the SKIP list, so the auditor doesn't fail the build for things we chose not to do.

## Rules

- Bias hard toward runnable. "Reviewed and looks right" is not a verification method.
- Where an AC's verification depends on something unresolved (Sunday video, Discord ruling), tag it and name the dependency — don't guess silently.
- Cite AC IDs exactly; never invent or renumber them.

When done: `c11 send --workspace workspace:16 --surface surface:128 "Eval Draft: done — <N> autonomous / <N> operator-assisted / <N> external-oracle / <N> felt. File: EVALUATION.md"`.
