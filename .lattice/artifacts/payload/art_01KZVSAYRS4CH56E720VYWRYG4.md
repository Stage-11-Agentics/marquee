# Plan Review: MRQ-146

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are implementation-detail gaps worth carrying into the build, not plan-level blockers.

### 2. Summary

Reviewed the MRQ-146 plan (narrow the OpenAPI concurrency claim + serve `SKILL.md` from the Worker) against the live codebase. Every factual premise in the plan checks out: the false sentence is at `src/api/openapi.ts:93`, exactly two routes carry `concurrency: "if-match"` (`src/routes/agenda.routes.ts:280` and `:351` — the agenda-item PATCH and DELETE), the SPA catch-all is `src/index.ts:163`, and `wrangler.jsonc` `run_worker_first` is the correct seam. The key concern is a generated artifact the plan doesn't name: `cli/api-registry.json` pins a `documentSha256` over the exact served OpenAPI bytes, so any change to the document requires regenerating it or `check:api` fails.

### 3. Issues

**[MINOR] Implementation step 2 — `cli/api-registry.json` regeneration not identified**
`scripts/checks/check-api.mjs:174` fails when `registry.documentSha256` differs from the served document's digest, and both plan changes (description edit, new header parameters) change those bytes. The plan runs `npm run check:api`, so the miss would surface loudly rather than silently — but the plan's file inventory omits a file that must be modified and committed, and the checklist asks for exactly that.
**Recommendation:** Add an explicit step: after `npx vite build`, run `node cli/generate-api-registry.mjs` and commit the regenerated `cli/api-registry.json`. Also confirm `SKILL.md` itself is unaffected (it renders from `cli/registry.mjs`'s command registry, not the OpenAPI document, so it should not need regeneration — verify with `node cli/generate-skill.mjs --check` or equivalent).

**[MINOR] Implementation step 2 — required-header validation may change the missing-If-Match error surface**
Today a missing `If-Match` is rejected inside the handler by `requireIfMatch` (`src/api/concurrency.ts:40`) with a specific message and `if-match` field. If the header is added as a *validated* zod schema (`request.headers`), zod-openapi's `defaultHook` (`src/api/router.ts:260`) intercepts first and the error message/field changes, even though the envelope shape is preserved. The plan doesn't decide between document-only annotation and validated schema.
**Recommendation:** Decide upfront. The lower-risk option is documenting the header on the route config without duplicating runtime validation (keep `requireIfMatch` authoritative); if a validated schema is chosen instead, confirm no test pins the current `requireIfMatch` message (a grep found none asserting it, but re-check during implementation) and note the message change in the PR body.

**[MINOR] Implementation step 3 — mechanism for embedding SKILL.md content is unstated**
Workers have no filesystem at runtime, and root `SKILL.md` lives outside the assets directory, so an `ASSETS.fetch` approach cannot reach it. The plan's constraints ("no second hand-maintained copy, no broadened asset allowlist") effectively force a build-time raw import (Vite `?raw` of the root file), but the plan never says so. Also worth noting: `SKILL.md` is generated (`cli/generate-skill.mjs`, with a staleness check), so the served bytes are a build-time snapshot — regeneration only reaches production via rebuild + deploy.
**Recommendation:** Name the mechanism (build-time `?raw` import of the repo-root file) and record the snapshot semantics in the PR body so the "generated file changed but deployment didn't" case is a known property, not a surprise.

### 4. Positive Observations

- **Every load-bearing claim in the plan is true in the code.** The description string, the two-and-only-two `if-match` routes, the `src/index.ts` catch-all, and the `run_worker_first` fix pattern all verified exactly as the plan states them. This is a plan written from the codebase, not from the ticket alone.
- **Correct architectural instinct on the header parameters.** Attaching `If-Match` to the route definitions keeps the single-source registry intact, so the served JSON, rendered docs, and CLI registry all inherit the truth from one place — precisely the parity discipline `check:api` enforces.
- **Scope discipline.** The plan serves only `/SKILL.md` and ignores the task's diagnostic mentions of `/llms.txt` and `/.well-known/ai-plugin.json`, which the ticket does not ask to fix. It also explicitly forbids a second hand-maintained skill copy — the exact drift trap this honesty ticket exists to prevent.
- **Verification mirrors the ticket's VERIFY block** (exact description string, case-sensitive `If-Match` count, first three served lines) and correctly treats deployment as a separate operator gate per `DEPLOY.md`, recording the live-verification limitation in the PR body rather than pretending merge equals ship.
- Sensible baseline-first sequencing and the explicit environment-vs-product failure distinction respect the repo's 45s/120s budget rules for a fleet under load.
