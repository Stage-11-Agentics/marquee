# Plan Review: MRQ-36 (M-38 CLI + M-39 SKILL.md)

## 1. Verdict

**PASS** — with one binding correction (the AC-250 ownership line) and two risks to verify early. The correction is unambiguous and one line; it does not require a replanning cycle, but the implementer must apply it, and the plan's own verification commands would deterministically catch it if missed.

## 2. Summary

Reviewed the delegator plan for the merged M-38 (`marquee` CLI) + M-39 (`SKILL.md`) ticket against the live repo. The plan is unusually well-grounded: it matches the actual `check:api` CLI-registry mechanism (`cli/api-registry.json` with `operations` + `documentSha256`, activation-on-existence at `scripts/checks/check-api.mjs:148-183`), the merged MRQ-30 bearer-token contract, and the already-landed `POST /comms/send` exactly-one-of enforcement (`src/routes/comms.routes.ts:577-580`). The key concern is a claims-file error: the plan promises to *own* AC-250, which is already owned by MRQ-32 and would fail `trace:ac` with a `duplicate-owner` error.

## 3. Issues

**[MAJOR] Verification — AC-250 ownership collides with MRQ-32**
The plan states: "Add `tests/ac-claims/MRQ-36.json` with unique ownership for AC-138–AC-144 and AC-250." But `tests/ac-claims/MRQ-32.json` already declares `"owns": ["AC-250"]` (the server half, per Amendment 9: AC-250 is built by M-35 send surface + M-38 CLI `remind`). `scripts/checks/trace-ac-core.mjs:77` emits a hard `duplicate-owner` error when two tickets own the same AC, so the plan as written fails its own `npm run trace:ac -- --scope=merged --ticket=MRQ-36` step.
**Recommendation:** List AC-250 under `exercises` in MRQ-36's claims file (tagging the CLI-half tests with AC-250 is still correct and satisfies coverage); ownership stays with MRQ-32. `owns` should be AC-138–AC-144 only, with AC-145 documented as the gate oracle exactly as the plan already does.

**[MAJOR] Approach step 3 — `event seed`'s token reachability of `POST /admin/reset-demo` is unverified, and gate 12 depends on it**
The CLI is token-only (AC-140), and the gate-12 oracle gets *only* `SKILL.md` + URL + token and must complete seed → triage → accept → schedule. The seed operation the plan targets, `POST /api/v1/admin/reset-demo` (`src/routes/admin-ops.routes.ts:36`), is declared `auth: { kind: "public" }` and its own description names only two accepted credentials: the `x-marquee-local-validation` header or "an owner/program-lead session." Mechanically, `authHasRole` (`src/lib/auth/scope-resolution.ts:77-99`) does resolve token auth (a `program:write`-granted owner token should pass), but whether bearer resolution actually populates `getAuth` on this public-policy route — and whether token access is *intended* here — is not established, and the fixed grant enum (`src/api/grants.ts`, Amendment 7 / AC-242) has no admin grant to fall back on. If a token cannot reach it, the whole gate-12 chain breaks at step one and the fix is a route-behavior change that may exceed this ticket's declared scope ("no contract-document edits," no route-convention changes).
**Recommendation:** Make "prove `reset-demo` accepts a scoped bearer token end-to-end" the first implementation task, before CLI scaffolding. If it does not, stop and surface the seam to the orchestrator rather than silently widening the route inside this ticket. Also note the route returns 202 + `job_id` — `event seed` must poll `GET /admin/reset-demo/{jobId}` to completion before resolving the seeded event ID; the plan's "queue-backed" wording implies this but the polling loop should be explicit in the command's contract.

**[MINOR] Verification — the `e2e:cli` half of AC-138–AC-140 is deferred without saying so**
EVALUATION declares AC-138–AC-140 as `e2e:cli` "against a deployed instance" (AC-140: "two distinct instance URLs"). The plan claims them via hermetic `tests/node/` tests plus a `wrangler dev` evidence pass. That follows house precedent (MRQ-32 owns AC-250 with `tests/node/` coverage; `trace-ac` only requires tag coverage), and `tests/e2e` is still stubbed pending MRQ-50's runner — but the plan explicitly distinguishes hermetic proof from the gate only for AC-145, not for the e2e:cli half.
**Recommendation:** Add one line to the claims documentation mirroring the AC-145 treatment: the deployed-instance `e2e:cli` execution of AC-138–AC-140 lands with the e2e harness (MRQ-50) / at the gate, and the hermetic tests plus `wrangler dev` evidence are the in-ticket proof. Consider shipping the CLI e2e spec file into `tests/e2e/` now (it activates automatically once `MARQUEE_E2E_URL` exists) if cheap.

**[MINOR] Non-goals — "the installed `marquee` bin" implies a `package.json` edit this plan doesn't declare**
`package.json` has no `bin` field today, and BUILDPLAN M-06 states `package.json` is M-06-owned and its edits serialize through the orchestrator. The PR-body sentence commits to "the installed `marquee` bin" as an alternative invocation. Relatedly, the `check:skill-agent` stub in `package.json` (owner MRQ-44, reason "SKILL, CLI, and isolated agent runner are not implemented") becomes half-stale once this ticket lands; the stub itself is MRQ-44's to replace.
**Recommendation:** Either drop the bin phrasing and standardize on `node cli/marquee.mjs`, or explicitly declare the one-line serialized `package.json` `bin` addition and coordinate it. Leave the `check:skill-agent` stub untouched (it is MRQ-44's seam); optionally note the stale-reason handoff in the PR body.

## 4. Positive Observations

- **The registry seam matches reality, not aspiration.** The plan's "generate the checked registry artifact from the canonical OpenAPI output used by `check:api`" maps one-to-one onto what `check-api.mjs` actually validates (`cli/api-registry.json` operations parity + `documentSha256`), including awareness that the check activates the moment `cli/` exists. This is the difference between a plan written against the contract and one written against the code — this one is both.
- **Dependency posture is verified-correct.** Bearer-only, no cookies, no second credential format — and MRQ-30 is in fact merged (`65aa56d`). The `remind` exactly-one-of rule mirrors server-side enforcement that already exists on master, so the CLI validates what the API validates.
- **Honest evidence taxonomy.** The plan explicitly refuses to launder green unit tests into gate-12 credit, documents AC-145 as the oracle's, and pre-commits to recording dependency limitations rather than overclaiming runtime proof. That is exactly the discipline the AC-claims system exists to enforce.
- **Guardrails name the real footguns**: no `/messages/send` alias (the precise AC-250 trap), `recipientsFor` empty-selection semantics preserved, README ownership left with MRQ-40, contract documents untouched.
- **Registry-driven help** makes AC-141 ("enumerates the registry exactly") structurally undriftable rather than test-patched — the right architecture for a parity-gated surface.
