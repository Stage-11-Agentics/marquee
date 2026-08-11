# Code Review: MRQ-8 — API core, list contract, and OpenAPI assembly

**Note on scope:** the diff embedded in the review prompt was truncated at 5,000 of 19,240 lines (all `.lattice/` orchestration metadata — task JSON, plan artifacts, boot notes) before reaching a single line of actual source. The real change is on branch `mrq-8-api` (`git diff $(git merge-base master mrq-8-api) mrq-8-api`, 27 files / 2,559 insertions). This review reads that diff directly, and additionally builds the branch in a worktree to run `tsc`, `npm test`, `npm run trace:ac`, and `npm run check:api` against the real artifact, plus two targeted reproduction tests against the live `createApiRouter` pipeline.

## 1. Verdict

**FAIL (implementation-level)**

## 2. Summary

The API-core substrate (route definitions, generated manifest, error envelope, list/pagination, S-3 bulk helper, CAS concurrency, rate-limit vocabulary, OpenAPI assembly, meta routes, and the `check:api` N-7 activation rule) is well-designed and, in isolation, well-tested — `tsc`, the full test suite (49/49), `trace:ac`, and `check:api` all pass cleanly against a real build. However, `src/api/router.ts`'s per-entry `app.use(path, middleware)` registration is not scoped by HTTP method, so any two routes sharing a path with different methods leak each other's auth/rate-limit policy onto one another. This is confirmed by direct reproduction against the shipped `createApiRouter`. It doesn't manifest yet (MRQ-8 registers only two `GET`s at distinct paths), but `router.ts` is explicitly "closed" after this ticket (R5) — no downstream ticket may touch it — and the plan itself mandates several same-path method pairs (`GET/PATCH /api/v1/people/:personId`, `PATCH/DELETE .../files/:fileId`, `GET/POST /api/v1/org/tokens`). The bug is latent today and will corrupt authorization on the very routes the plan requires, in code no later ticket is permitted to fix.

## 3. Issues

**[CRITICAL] src/api/router.ts:531-536 — per-route middleware is not scoped to its own HTTP method, so routes sharing a path bleed policy into each other**

`createApiRouter` registers each entry as:
```ts
for (const entry of entries) {
  app.use(toRoutingPath(entry.path), routeMiddleware(entry.policy, runtime));
  app.openapi(entry.route as never, entry.handler as never);
}
```
Hono's `app.use(pattern, mw)` matches by path only, not method — the middleware runs for *every* HTTP method whose handler is registered at (or after) that path pattern, not just the method the entry declares. When two `ApiRouteEntry` objects share a path (any pair from `GET/PATCH /api/v1/people/:personId`, `PATCH/DELETE .../submissions/:submissionId/files/:fileId`, `GET/POST /api/v1/org/tokens`, all explicitly named in this plan's "Amendment 7 resource contracts" section and in R1's CAS endpoint inventory), the manifest's deterministic alphabetical sort (`METHOD path operationId`) means whichever method sorts first (e.g. `DELETE` before `GET`, `GET` before `PATCH`/`POST`) has its policy middleware silently applied to every method registered afterward on that path — in addition to that later method's own policy.

Verified by instantiating the actual `createApiRouter` from this branch with two fixture routes on the same path (`GET /api/v1/files/{id}` = public, `DELETE /api/v1/files/{id}` = requires `program:write` grant, `DELETE` sorting first alphabetically): an anonymous `GET` request — which the route's own policy declares public — is rejected with `401 unauthenticated`, because it inherits the `DELETE` sibling's grant-gated middleware registered earlier at the same path. A second reproduction (two routes with `GET` sorting first) confirms the inverse: a `PATCH` at the same path runs *both* the `GET`'s and the `PATCH`'s middleware, double-charging the rate limiter across two different buckets and leaving whichever bucket's headers were set last on the response.

This bug is invisible in this ticket's own test suite because MRQ-8 registers exactly two `GET`s at two distinct paths (`/api/openapi.json`, `/api/docs`) — no path collision exists yet to trigger it. But R5 states plainly: *"`src/api/router.ts` is not a shared edit point after this ticket... M-03/M-13/M-29 add route modules and adapter implementations/composition files; they do not edit middleware order or append registrations in `router.ts`."* Every future ticket that registers a same-path method pair (which the plan requires multiple times) will silently inherit incorrect authorization/rate-limiting the moment it lands, with no mechanism to fix it without violating R5.

**Fix:** scope the middleware to its own route instead of registering it via a path-wide `.use()`. `OpenAPIHono.openapi()` accepts middleware ahead of the handler in its argument list, scoped to that route's exact method+path:
```ts
app.openapi(entry.route as never, routeMiddleware(entry.policy, runtime) as never, entry.handler as never);
```
Add a regression test with two entries sharing a path but different methods/policies (e.g. a public `GET` and a grant-gated `PATCH`/`DELETE` on the same path) asserting each method enforces only its own policy — this is exactly the shape the reproduction above exercises and exactly the shape absent from `tests/integration/api/pipeline.test.ts`.

**[MINOR] Plan scope was silently trimmed at merge, not amended in the plan itself — src/api/contracts/{events,people,files,tokens}.ts and the R3 `vite.config.ts` dist-emission wiring are both absent**

The plan's "Files and responsibilities" section and its "Amendment 7 resource contracts" section (both AUTHORITATIVE) require freezing unregistered path/schema exports for `GET /api/v1/events`, people reads/patch, submission file lifecycle, and org tokens CRUD under `src/api/contracts/*`, plus (R3) build-time emission of `dist/api-registry.json`/`dist/openapi.json` from `vite.config.ts`. Neither exists in this diff — confirmed by `git ls-tree`, and `vite.config.ts` has no diff against `master` at all. R6 is explicit that "no scope is cut... without a new explicit Orchestrator ruling," and implementation order segment (D) names "Amendment 7 contract exports" as binding. The Orchestrator's merge comment does bless this cut after the fact ("neither blocks a downstream ticket since routes register by glob"), which is a reasonable call, but it happened as an offhand review-comment rather than a recorded plan amendment (unlike every other deviation in this run, which got an `R#`/`V#` entry). Not a functional defect — future tickets can still add these contracts independently — but the plan document itself is now out of sync with what actually shipped, which is exactly the kind of drift the plan's own amendment discipline exists to prevent.

**Fix:** append a short amendment (`R12` or similar) to the plan recording the cut and its rationale, so a reader of the plan doesn't have to reconstruct it from a merge comment.

**[MINOR] Naming: `src/api/list.ts` / `route.ts` / `router.ts` were flagged by an earlier plan-review pass as violating BUILDPLAN §7's keyword-safe naming rule ("no `list.ts`, no `helpers.ts`... those names collide across tickets") and shipped unrenamed**

The recorded recommendation was `list-contract.ts`, `route-definition.ts`, `api-router.ts`. This is cosmetic and doesn't affect correctness — flagging only because it was raised and not visibly triaged into the Cycle-1 resolution block alongside R1–R11, so it's unclear whether it was consciously rejected or simply dropped.

## 4. Positive Observations

- **S-3 helper is exact.** `runBulkByIds` dedupes preserving first-seen order, no-ops before touching `prepare` on an empty set, serializes the ID array exactly once, and calls `prepare`/`.run()` exactly once — verified by both the diff and a passing `tests/unit/api/bulk-concurrency.test.ts`, including a source-scan assertion that the helper never constructs `IN (?, ?, ...)` or chunks.
- **CAS primitive (R1) is correctly centralized.** `compareAndSwapResource` computes `nextUpdatedAt = max(now, expected.updatedAt + 1)` so same-millisecond writes still produce distinct ETags (tested), classifies `meta.changes` into `updated`/`missing`/`stale` without ever exposing an interactive-transaction assumption, and `assertCasUpdated` maps outcomes to 404/409 with the current ETag attached — matching R1 precisely.
- **Manifest/glob discipline (R2) is real, not aspirational.** `buildManifest`/`buildManifestEntries` are pure and unit-tested against fixture modules (discovery order, duplicate route, duplicate operationId, malformed export, Hono-style-path rejection all covered by name), while `src/routes/_manifest.ts` itself is just the two-line glob + `buildManifest` call the plan calls for — genuinely nothing else lives there.
- **OpenAPI/document hashing (R8) is deterministic and mechanically checkable end to end.** `canonicalize` recursively sorts keys, the document is serialized once, SHA-256'd, and that one digest is reused for the response `ETag`, the docs shell's embedded meta tag, and `check:api`'s comparison — verified live: `npm run check:api` builds the real Worker bundle, serves it in-process, and confirms `ETag == sha256(served bytes) == docs-shell digest`.
- **The N-7 `check:api` activation rule is implemented correctly.** CLI-registry parity skips with a printed notice while `cli/` doesn't exist yet, the served-JSON/rendered-docs half runs live from this ticket forward, and the exact three SPEC §4.2 URLs are named as an allowlist rather than flagged as drift — confirmed by running the command against a real build (`status: "pass"`, correct notice, correct allowlist).
- **Docs shell is genuinely self-contained (R8).** No external script/style/font reference; tested both by a content-based assertion in `meta.test.ts` and by `check:api`'s own `docs-external-dependency` check.
- **Four-bucket rate-limit vocabulary (R11) is followed exactly** — no fifth `public_write` bucket; `ip_submission` keying is a mode on the `write` bucket as specified.
- **Real-artifact validation, not just green tests:** `tsc` (three tsconfigs), the full `npm test` (49/49, 4s, well inside the 30s budget — R9 honored), `npm run trace:ac --scope=merged` (0 uncovered), and `npm run check:api` (built the actual Worker bundle and served it) were all run against the real branch during this review and pass. The default suite stays fast and hermetic per R9; the AC-105/106/108 tests carry the required `AC-n ·` prefixes matching `tests/ac-claims/MRQ-8.json`.
- **The ticket caught a real cross-cutting bug outside its own surface** (SPEC §4.2/§9 still say `/api/v1/events/...` after the UI's `event → conference` rename) and recorded it rather than silently smuggling a matching change into API core — good instinct given the plan's explicit prohibition on schema/scope smuggling.
