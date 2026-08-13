# Code Review: MRQ-146

## 1. Verdict

**PASS** — Implementation is correct, matches the plan, and both honesty defects are fixed at their single sources of truth. Three minor observations below; none blocks merge.

## 2. Summary

Reviewed the five-file diff that (a) narrows the OpenAPI `info.description` concurrency claim to the two agenda mutations, documents the `if-match` header parameter on exactly those two operations, and (b) serves the canonical generated `SKILL.md` from the Worker as markdown, with the matching `run_worker_first` entry. The work is tight, single-sourced, and well-tested: I independently confirmed `concurrency: "if-match"` and `requireIfMatch` exist nowhere outside `agenda.routes.ts`, so the narrowed sentence is now literally true, and the served skill is the same `?raw`-imported file the AC-142 parity test already forces to be regenerated from the CLI registry — no second copy. I ran the touched test files (15/15 pass) and the full `pr-gate --ticket MRQ-146` (every check passed; over the 120s time budget only, at 207s, consistent with concurrent fleet load per the project's own rule).

## 3. Issues

**[MINOR] src/routes/agenda.routes.ts:446,520 — Declaring the required header changes which layer rejects a missing If-Match**
Routes register through `@hono/zod-openapi`, so a declared `request.headers` schema is runtime-validated (pipeline step 5) before the handler runs. A request missing `If-Match` now gets a 400 from the validation `defaultHook` with zod's generic required-field message, instead of `requireIfMatch`'s specific "If-Match header carrying the resource's current strong ETag is required". Status, envelope, and field path are unchanged, and no test pinned the old message — but the handler-level missing-header branch in `requireIfMatch` is now unreachable over HTTP for these two routes, and the caller-facing message got less helpful.
**Fix:** Attach the guidance to the schema so the better message survives, e.g. `z.string().min(1, "If-Match header carrying the resource's current strong ETag is required")` plus a required-key message, or accept the generic message knowingly. Not blocking.

**[MINOR] tests/integration/api/meta.test.ts:226-230 — Skill test hardcodes prose from a generated file**
The test asserts the first three lines of the response verbatim, but `SKILL.md` is a build artifact regenerated from `cli/registry.mjs` (`renderSkill()`, enforced by `tests/node/skill.AC-142-144.test.mjs`). Any future wording change to the skill intro will break this unrelated meta test, and the failure will read as a serving bug rather than a copy change.
**Fix:** Import the same source in the test (`import skill from "../../../SKILL.md?raw"`) and assert `body === skill`. That is also a strictly stronger claim — the served bytes are the canonical file — with zero drift surface.

**[MINOR] src/api/openapi.ts:110 — Line style and phrasing**
The replacement line runs ~140 characters in a description block otherwise wrapped near 80, and "the two agenda item mutation operations that require it" is mildly circular (they require it because they're the ones it applies to).
**Fix:** Rewrap to match neighbors and consider naming the operations ("the agenda-item PATCH and DELETE operations"). Cosmetic.

## 4. Positive Observations

- **The narrowed claim was verified true, not just asserted.** Grep confirms `concurrency: "if-match"` appears only on `updateAgendaItem` and `removeAgendaItem`, and `requireIfMatch`/`compareAndSwapResource` are used nowhere else in `src/routes/` — the description, the documented headers, and the runtime now agree.
- **Single-source discipline held on both fixes.** The description edit is in the one canonical `DOCUMENT_CONFIG`; the header params live on the same route objects the document, docs page, and (generated-on-demand) CLI registry are all built from, so `check:api` parity flows through automatically. The skill is served from a `?raw` import of the root `SKILL.md` — no hand-maintained copy, exactly as the plan required.
- **The contract test guards both directions.** It asserts the narrowed sentence, that case-sensitive `If-Match` occurs exactly once in the served bytes (mirroring the ticket's own counting methodology), and that exactly `["removeAgendaItem", "updateAgendaItem"]` carry the header — so either re-broadening the prose or silently adding/dropping a documented header fails the suite.
- **The deploy-critical seam was handled knowingly.** `run_worker_first` gets an exact `/SKILL.md` entry mirroring the PR #111 `/claim/*` fix, and the config's own comment records that tests cannot see this list — the task's "verify after deploy" curl step correctly remains the closing gate.
- **Header schema follows existing precedent** (lowercase key with a described zod string, matching `public-schedules.routes.ts`'s `x-schedule-write-key`), and the route registration order in `src/index.ts` places `/SKILL.md` ahead of the ASSETS catch-all with no auth middleware in front.
- **The empty-`owns` ac-claims file is the right shape** for a ticket that fixes honesty without minting a new acceptance criterion; the gate's trace step passed with zero uncovered ACs.

## Verification performed

- `npx vitest run tests/integration/api/meta.test.ts tests/integration/api/agenda.AC-70-74-252-253.test.ts` — 15/15 pass.
- `npm run pr-gate -- --ticket MRQ-146` — every check passed; `pass-over-budget` on wall-clock only (207s vs 120s objective), attributed to machine load per project rule ("a red suite must mean a real defect, never a busy machine").
- Manual inspection of `src/api/concurrency.ts`, `src/api/route.ts`, `src/api/router.ts`, `src/index.ts`, `wrangler.jsonc`, `scripts/checks/check-api.mjs`, and `tests/node/skill.AC-142-144.test.mjs` to confirm the seams the diff leans on behave as the plan assumed.
