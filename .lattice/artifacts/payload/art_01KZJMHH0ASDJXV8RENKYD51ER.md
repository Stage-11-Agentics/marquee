# Plan Review: MRQ-8 — API core, list contract, and OpenAPI assembly

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the MRQ-8 plan (including the authoritative Cycle-1 resolution block) against `BUILDPLAN.md` M-07/§7, `SPEC.md` §2.2/§4/Amendment 7, `EVALUATION.md` AC-105/106/108, the merged S-3 verdict, and the actual merged/in-review code on `mrq-1-platform-skeleton`. The plan's *contract* design is excellent — the Cycle-1 resolutions (CAS instead of interactive transactions, pure `buildManifest`, Vite-only glob isolation, four-bucket rate limits, canonical-byte hashing) are correct and materially raise the ticket's quality.

It fails on **integration reality, not design**: I checked M-01's actual entrypoint and dependency manifest, and the plan is not executable against them. `src/index.ts` already terminates `/api/*` with a catch-all 404 and the plan never says who mounts the new router; and every library the plan depends on (`zod`, `@hono/zod-openapi`, a validator, a docs renderer, and vitest itself) is absent from the merged tree behind a `package.json` owner that is not a declared dependency of this ticket. Both are cheap to fix as plan text plus an orchestrator pre-clearance — this is not a redesign.

## 3. Issues

**[CRITICAL] "Files and responsibilities" / "Verification and evidence" — no route is reachable: `src/index.ts` has no mount seam and already 404s `/api/*`**

M-01 (branch `mrq-1-platform-skeleton`, currently at review) ends its entrypoint with:

```ts
app.all("/api/*", (context) => context.json(
  { error: { code: "not_found", message: "API route not found" } }, 404));
app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));
```

and `wrangler.jsonc` sets `assets.run_worker_first` to include `/api/*`, so the Worker — not the asset server — owns that prefix. The plan says `router.ts` "exposes a stable mount for M-01's Worker entrypoint" but never states who performs the wiring, while simultaneously forbidding edits to `src/index.ts` ("Do not add a … route array in `src/index.ts`"). As written, `GET /api/openapi.json` and `GET /api/docs` return M-01's 404 for every request, and verification step 2 (AC-106: "request `/api/openapi.json` and `/api/docs` through the Worker/Hono app and assert 200") cannot pass. The pre-existing catch-all must also be *removed*, not just preceded — and its body is a two-field error object that does not carry `request_id`, so it violates M-07's own single-envelope rule the moment any unmatched `/api/*` path is hit.

**Recommendation:** Add an explicit integration clause: M-07 mounts `createApiRouter(runtime)` in `src/index.ts` above the asset fallback and deletes M-01's placeholder `app.all("/api/*")` handler, replacing it with M-07's envelope-conformant not-found. Name this as a **serialized shared-file edit against M-01's owner**, request the orchestrator's pre-clearance before `RESUME IMPLEMENTATION`, and keep the edit to exactly two lines (one import, one `app.route("/", apiApp)`) so the ownership cost is minimal. Correspondingly correct the ticket's "Shared files: none" claim.

---

**[CRITICAL] "Dependencies, baseline, and schema coordination" + R7 — the libraries the plan is built on are not in the tree, and their owner is not a dependency of this ticket**

M-01's merged `package.json` carries exactly one runtime dependency (`hono ^4.13.1`) and dev deps of `@cloudflare/vite-plugin`, `@cloudflare/workers-types`, `@types/node`, `typescript`, `vite`, `wrangler`. There is no `zod`, no `@hono/zod-openapi` (the plan's `OpenAPIHono` and `createListQuerySchema` both assume it), no OpenAPI validator, no bundled docs renderer (R8 forbids a CDN dependency, so one must be vendored), and **no vitest / `@cloudflare/vitest-pool-workers`** — meaning there is currently no way to run a single test in the plan's verification matrix. R7's premise — "the exact merged `@hono/zod-openapi`/Zod versions" — describes packages that do not exist.

Compounding this: `package.json` and `vitest.config.ts` belong to M-06, which is bundled into **MRQ-6** (`Design system, admin shell, and the check harness`), currently at `planned`. MRQ-8's declared dependencies in Lattice are only MRQ-2 and MRQ-56 — MRQ-6 is not among them, so nothing schedules it ahead of this ticket, and §7 states dependency additions "queue" through its owner.

**Recommendation:** Name the exact dependency set the plan requires (`zod`, `@hono/zod-openapi`, the chosen OpenAPI validator, the chosen self-hosted docs renderer) in the plan, and state the two prerequisites explicitly: (a) MRQ-6 must merge before MRQ-8 implements, or the orchestrator must add MRQ-6 as a dependency edge / authorize an interim serialized `package.json` edit; (b) R7's version check is a *baseline step to perform*, not a merged fact — reword it as "select and pin versions, then confirm 3.1 support; fall back to 3.0.x otherwise." Without this the plan's step 7 ("run focused tests, full `npm test`, TypeScript/build") has no runner.

---

**[MAJOR] "Files and responsibilities" — `src/api/list.ts` is a named, explicit BUILDPLAN §7 violation**

BUILDPLAN §7 ("Keyword-safe naming") reads: "**No `utils.ts`, no bare `index.ts` inside a module, no `list.ts`, no `helpers.ts`** anywhere: those names collide across tickets and turn an agent's grep-and-replace into another ticket's regression." The plan proposes `src/api/list.ts` by name. The adjacent `src/api/route.ts` / `src/api/router.ts` pair is the same hazard one character apart, and `src/api/contracts/{events,people,files,tokens}.ts` puts bare feature nouns in a directory later tickets will also write into.

**Recommendation:** Rename to `src/api/list-contract.ts`, `src/api/route-definition.ts` + `src/api/api-router.ts`, and `src/api/contracts/<feature>.contract.ts`. This is a rename in the plan, not a design change — but it is exactly the class of thing that costs a review cycle at PR time.

---

**[MAJOR] R3 step 2 — `dist/api-registry.json` emission requires a `vite.config.ts` edit and is not needed by any of this ticket's ACs**

M-01's `vite.config.ts` is a four-line `defineConfig({ plugins: [cloudflare()] })`; emitting `dist/api-registry.json` and `dist/openapi.json` from the in-memory document requires a build-plugin addition to that M-01-owned file. R3 correctly says to serialize it, but leaves the branch unresolved — which means the implementer discovers a blocking coordination step mid-flight. None of AC-105, AC-106, or AC-108 requires the emitted artifact; it exists for M-38's offline CLI `--help` and M-29's completed `check:api`, both of which are downstream tickets.

**Recommendation:** Resolve the branch in the plan rather than at implementation time. Preferred: M-07 exports the canonical document/registry **builder functions** from `src/api/`, and defers the build-time *emission* (and its `vite.config.ts` wiring) to M-29/M-38, which own `check:api` and the CLI. If the orchestrator wants emission in M-07, get the `vite.config.ts` edit pre-cleared with M-01's owner before `RESUME IMPLEMENTATION`. Same question applies to R8's bundled docs renderer: prefer vendoring it into the Worker bundle (e.g. a Vite `?raw` import inside `src/api/`) over adding a static-asset route, which would drag in `wrangler.jsonc`.

---

**[MAJOR] "Verification and evidence" §1 — the convention test enforces the wrong half of AC-105**

AC-105 is "every non-GET request captured during a full-loop session must exist in the public OpenAPI document; **the UI-only write set must be empty**", and SPEC §2.2 names the structural rule that wins it: "the SPA may not read `document`-embedded bootstrap data for anything a route can return. Every admin read is a GET on `/api/v1/*`; every admin write is a non-GET on `/api/v1/*`." The plan's static test guards the opposite direction — it rejects JSON `/api/` declarations from nonconforming *filenames* — and describes the other side only as "rejects JSX/API modules that evade this split," which is not a specification. Nothing in the plan makes it mechanically impossible for a later ticket to add a `POST` handler to an SSR `*.route.tsx` module or to embed bootstrap JSON in an SSR shell. M-07 is the ticket that institutionalizes §7's registration rule for the whole fleet; this is the rule that most needs institutionalizing, because it is invisible until `check:api`'s Playwright replay runs at gate time.

**Recommendation:** Add a stated fleet invariant plus its static check: (a) `*.route.tsx` SSR modules may declare **GET only** — any non-GET handler fails the convention test with the filename; (b) SSR modules may not serialize privileged read payloads into HTML for the admin SPA. Ship the check as a source scan in M-07 so every later ticket inherits the failure locally rather than at the gate.

---

**[MAJOR] R6 / "Delivery sequence" — the estimate flag addresses the arithmetic but not the plan-versus-estimate mismatch**

R6 correctly surfaces the 4 h vs 7 h contradiction between BUILDPLAN's amendment text and its row/CP-1 math, and correctly refuses to rewrite the board unilaterally. But the plan's own content — a route-definition factory, pure manifest + glob, error envelope + status map, list/pagination + D1 executor, CAS concurrency, rate-limit buckets/headers, bulk selector union + durable result + the S-3 helper, four Amendment 7 contract families, OpenAPI assembly, a self-contained bundled docs renderer, and a ten-part verification matrix including 150/1,000-row D1 probes — is well beyond *either* number, and the plan declares all five segments (A–E) binding. Since M-07 sits on the CP-1 critical chain (M-01 → M-02 → M-07 → M-08 = 15 h), an unbounded M-07 delays the first loop screen directly.

**Recommendation:** Have the plan state a defensible AC-minimum core versus a deferrable tail *before* implementation, so a timebox stop is a planned outcome rather than a judgment call. Suggested core (satisfies AC-105/106/108): segments A–C plus the bulk selector/S-3 helper. Suggested tail (candidates for a follow-on ticket if the box is hit): the four Amendment 7 contract families (D), which register no handlers and block nothing until M-13/M-29 land. Ask the orchestrator to rule on 4 h vs 7 h *and* on this split in the same decision.

---

**[MINOR] Whole document — the plan is layered, and a top-down reader implements withdrawn instructions**

The Cycle-1 block is declared authoritative, but the superseded text remains in place: the "read/check/write transaction boundary" (withdrawn by R1), fully nested `people` detail paths (withdrawn by R4), the fifth `public_write` bucket (withdrawn by R11), unconditional OpenAPI 3.1 (conditioned by R7), and the fixture-discovery approach (restructured by R2). A fresh implementation agent reading this as its contract encounters each wrong instruction ~150 lines before its correction.

**Recommendation:** Fold the eleven resolutions into the body text and reduce the Cycle-1 block to a changelog of what moved. This is a mechanical edit and removes a real misimplementation risk given the plan is handed to a context-clean implementer.

---

**[MINOR] "Verification and evidence" preamble — partial AC claims will read as full coverage to `trace:ac --scope=merged`**

`trace:ac` scans test names for `AC-nnn` prefixes and, on PRs, "considers only the ACs claimed by already-merged tickets plus the ACs the current PR names," failing when an `auto` AC has zero tests. It does not model partial coverage. MRQ-8 will name AC-105/106/108 while genuinely covering only the static half of AC-105 (no full-loop network replay), part of AC-106 (no app-navigation link), and the API half of AC-108 (no UI/API ID parity). Once MRQ-8 merges, those three ACs are "covered" and MRQ-30's completion work is no longer mechanically demanded.

**Recommendation:** Keep the AC-prefixed test names (they are required), but state in the plan that the PR body must record the explicit partial-claim boundary for each of the three ACs and name MRQ-30/MRQ-9 as the completing tickets, so the orchestrator's audit does not read green as done.

---

**[MINOR] "Verification and evidence" §2 — AC-106's navigation link is likely MRQ-6's, not M-29's**

The plan twice assigns the app-navigation link to M-29. SPEC §5's global chrome puts `⌘ API & CLI` in the admin sidebar **footer**, which is M-05a's shell — bundled into MRQ-6, not MRQ-30. BUILDPLAN's M-29 row says "docs route linked from sidebar," so both readings exist in the source.

**Recommendation:** Note the ambiguity in the plan and let the orchestrator assign it, rather than asserting M-29 owns it; otherwise AC-106's second clause can fall between two tickets that each believe the other has it.

---

**[MINOR] Throughout — BUILDPLAN M-numbers and Lattice MRQ IDs are mixed in the same sentences**

The plan says "comment on MRQ-8/MRQ-2" in one place and "M-03 supplies…", "M-13 supplies R2 presign…", "M-06's ownership of `package.json`" elsewhere. The mapping is not identity: M-13 = **MRQ-14**, M-06 = **MRQ-6**, M-29+M-54 = **MRQ-30**. An implementer coordinating a serialized edit could easily open the wrong ticket.

**Recommendation:** Add a one-line mapping table for every ticket the plan names, sourced from `.lattice/orchestration/ticket-map.md`, or use MRQ IDs with the M-number in parentheses throughout.

---

**[MINOR] R1/R10 — the monotonic `updated_at` bump changes a column other tickets read, and that contract should be published**

I verified the mechanism is type-safe: SPEC §3 declares `updated_at INTEGER`, so `updated_at + 1` is arithmetic, not a text coercion — R1 is sound. But `updated_at` is also the Airtable mirror's change-feed key (M-25) and AC-82's cross-view freshness signal, and R1 makes it a logical version counter that can lead wall-clock by a few milliseconds under contention.

**Recommendation:** State the contract explicitly in the plan — "`updated_at` is a monotonic version, not a timestamp; readers must not assume it equals wall clock" — so M-25's change feed and any `updated_at`-based display are written against the real semantics.

---

**[MINOR] "Bulk selector, result, and S-3 helper" — no request-idempotency convention for non-GET routes**

M-07 owns the shared header and envelope vocabulary, and SPEC §4/M-11 already require an `Idempotency-Key` header on send paths. The plan defines a durable *response* `operation_id` but no request-side idempotency contract, so M-11 will invent one and M-18's bulk retries have undefined semantics.

**Recommendation:** Add `Idempotency-Key` to the shared route metadata and response-header vocabulary (contract only — storage/enforcement stays with M-11/M-18), so there is one spelling across the fleet and it appears in OpenAPI from the first document.

## 4. Positive Observations

- **The Cycle-1 resolutions are genuinely strong engineering.** R1's rejection of an interactive-transaction model for D1 in favor of a conditional-update CAS — with the `meta.changes === 0` re-read used only to *classify* 404 vs 409 — is exactly right for the platform, and the warning that `db.batch()` does not gate later statements on an earlier zero-change guard is the kind of trap that normally surfaces only in production.
- **R2's split of `buildManifest(modules)` from the `import.meta.glob` call is the single best decision in the plan.** It makes discovery unit-testable with injected fixtures, keeps fixtures out of the production glob, and resolves the earlier fixture/exclusion contradiction cleanly.
- **R3 catches a real cross-runtime defect before it shipped** — `import.meta.glob` is Vite-only, and a Node CLI importing `_manifest.ts` would have failed at M-38 with a confusing error. Defining the artifact consumption path now is correct even if the emission itself should move downstream.
- **S-3 is consumed faithfully and completely.** The helper signature, dedupe-preserving-first-seen-order, `null` on empty before calling `prepare`, exactly one `JSON.stringify`, exactly one `.run()`, and the mechanical "never constructs `IN (?, ?, …)`" source assertion all match the spike verdict verbatim — including the resistance to re-litigating the bounded-chunk alternative.
- **R9 protects the ≤30 s inner loop deliberately**, routing the 150/1,000-row D1 probes to the integration lane and requiring before/after suite timings as evidence. Very few tickets think about the wall time they bequeath to the fleet.
- **The boundary section is disciplined**: refusing to register contracts without real handlers, and explicitly rejecting 501 stubs "merely to make OpenAPI look complete," is what keeps the generated document truthful from the first build.
- **R8's canonical-bytes-once hashing** (one deterministic serialization feeding the ETag, the emitted artifact, and the docs identity) is precisely what `check:api`'s content-hash parity assertion needs, and the no-CDN requirement for the self-host container is a real constraint most plans would miss.
