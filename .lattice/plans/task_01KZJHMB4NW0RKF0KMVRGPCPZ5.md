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
## Objective

Make `README.md` a public stranger's path from clone to a working Marquee
instance. The local path must be executable today with Wrangler dev/Miniflare;
the hosted Cloudflare path must distinguish documented commands from the real
account work still owned by MRQ-57.

## Scope

- Rewrite only the README's product, self-host, local-development, deployment,
  import, extension-point, empty-state, and CONTRIBUTING guidance.
- Lead with Cloudflare Workers and the explicit API bonus (R53).
- Describe Airtable as an intentional asynchronous D1 mirror tradeoff, never
  as the source of truth.
- State that one-click demo login is a `demo_mode`-only affordance, explain
  the `403`/no-cookie behavior when disabled, and give an explicit command to
  turn demo mode off for a self-hosted deployment.
- Explain the real single-source seams: `src/lib/form-conditions.ts`,
  `src/jobs/cascade/decisions.ts`, `src/jobs/mail/outbox.ts` (including the
  exactly two `always_live` sites), `src/routes/_manifest.ts`, and
  `src/lib/venue-geometry.ts`.
- Document Sessionize against `fixtures/sessionize/*` as the fixture-backed
  import shape, marked for reconciliation with MRQ-31's real text when that
  ticket lands.
- Add the MRQ-40 AC claim manifest and only plain-Node README contract tests
  needed to make the README claims mechanically traceable; do not add Worker
  integration or e2e tests for documentation.

## Non-goals and safety boundaries

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, or
  `USER_STORIES.md`; do not mint AC IDs.
- Do not provision Cloudflare resources, put secrets, claim a live deployment,
  or alter `wrangler.jsonc`/package scripts owned by other tickets. Say plainly
  that Workers Paid, account/binding creation, real secrets, custom domains,
  and the scratch deploy are MRQ-57/operator work and are not verified here.
- Do not include tokens, real addresses, internal paths, Stage 11/Lattice/c11
  references, or private-host details in public text.

## Build sequence

1. Replace the walking-skeleton README with a numbered, reproducible local
   sequence using `npm ci`, `.dev.vars.example`, Vite build, a private local D1
   persistence directory, migrations, `npm run seed`, Wrangler dev, health,
   and a non-zero seeded-count check. Keep foreground server operation and
   cleanup understandable for a human while leaving the command blocks
   executable by the README gate.
2. Add the separate production/self-host sequence: account/authentication
   preconditions, resource/binding placeholder warning, remote migrations and
   seed, secret handling, deployment, health verification, and the explicit
   hosted-vs-local boundary.
3. Add the demo-mode shutdown instructions, empty-install expectations, the
   fixture-backed import section, real extension points, module-boundary map,
   and a practical CONTRIBUTING section for a stranger implementing a change.
4. Add `tests/ac-claims/MRQ-40.json` for AC-160–AC-162 and plain Node static
   contract tests with literal AC-prefixed titles. Keep the claims aligned with
   the actual README and avoid claiming deployed proof.

## Verification and handoff

- Self-review the README as a public-repo evaluator: every command must be
  copyable, every current limitation must be labelled, and no internal or
  secret material may appear.
- In a fresh temporary clone/worktree, follow the documented local sequence
  against a fresh local state directory; verify `/health` is 200 and the seeded
  API reports non-zero data. Record the observed commands and results separately
  from inference about the unavailable Cloudflare account.
- Run the plain Node README tests, `npm test`, and finally
  `npm run pr-gate -- --ticket MRQ-40`; preserve the gate output in the task
  completion comment. Check `git diff --check`, public-repo scans, and the
  branch/remote SHA after every push.
- Lifecycle: move to `planned` after this plan is committed, then
  `in_progress` for implementation, `review` with a PASS review artifact,
  `in_validation` with local clean-checkout evidence (or an explicit N/A for
  the unavailable remote gate), and `pr_open` only after the PR is opened.
