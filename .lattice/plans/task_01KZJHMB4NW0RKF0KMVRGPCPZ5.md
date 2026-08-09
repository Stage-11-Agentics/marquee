# MRQ-40: README, self-host path, and extension points

BUILDPLAN: M-45 — Tier B rank 26 (US-02), Wave 2 (§5), built at position 6 in the band

🔒 **GATE-BACKING — NEVER IN THE CUT BAND.** Backs `EVALUATION.md` gate 14 (`check:readme`). Built here rather than at rank 26 because a gate is unconditional; rank 26 is retained only for gate 19's cut-line record.

Scope (verbatim): **README + self-host + executable clean-checkout deploy, empty states, extension points** — states that demo login is a `demo_mode`-only affordance and how to turn it off (B-2).
Dependency note (verbatim): it depends on M-30 only for the import section, which is written against `fixtures/sessionize/*` and folded to M-30's real text later. **Not M-30** — that dependency is what pinned M-45 to rank 26 behind the cut line.
Amendment 4 framing: lead with Cloudflare + the explicit API bonus (R53); present the Airtable mirror as a deliberate engineering trade, never as a claim to the source-of-truth bonus.
Amendment 2 note: swyx entertained judging maintainability ("have them demo implement a change"). Code legibility is part of the deliverable — clean module boundaries, a real CONTRIBUTING section, no clever-but-opaque constructs.
AC-162 extension points to name: registration-platform sync, Airtable mirror, calendar OAuth. (OAuth calendar write is a documented extension point, never built — EVALUATION §5.)

ACs: AC-160 – AC-162
Hours: 5
Workflow: inline-full
Shared files: `README.md` — **M-45 OWNS it, single author** (§7). Other tickets file notes into `docs/notes/<ticket>.md` for this ticket to fold in.
Deps: M-08 (a deployable, seeded app to document)
Gate: `check:readme` executes the README's numbered deploy sequence **verbatim** — commands extracted from its fenced blocks — from a clean checkout in a fresh container against a scratch Workers project, with **no human input at any step**. A Cloudflare API token in CI is a human precondition (§8 item 9).
Plan: filled in by delegator's plan phase
