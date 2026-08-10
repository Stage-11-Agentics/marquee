# MRQ-8: API core, list contract, and OpenAPI assembly

BUILDPLAN: M-07 — Wave 0 (§3)

Scope (verbatim): Hono router with a generated route manifest (glob, never a hand-edited list), error envelope, list contract (`page/per_page/q/sort/filters` → `{data,page,per_page,total}`), pagination helper, **bulk selector type (ids *or* filter)**, `json_each` chunking helper, OpenAPI assembly from route definitions, `/api/openapi.json`, `/api/docs`. **The chunking helper's default pattern is S-3's verdict** — M-07 must not pick one before the spike answers (trap 11).

Amendment 6 fold (+3 h, already inside the estimate): `GET /events` discovery, people reads, file lifecycle, scoped tokens (AC-242 UI is M-29's) — plus the pinned semantics: pagination, `ETag`/`If-Match` optimistic concurrency, one error envelope, standard rate-limit headers, durable bulk `operation_id` results, OpenAPI as the single source for docs/CLI/SKILL.
§7 rule this ticket institutionalizes: **registration by glob, never by a hand-edited list.** `src/routes/_manifest.ts` is generated at build from `import.meta.glob`; no agent ever edits a central registry to add a route, and the OpenAPI document is assembled from route definitions, never hand-written.

File surface: `src/api/*`, `src/routes/_manifest.ts` (generated)

ACs: AC-105, AC-106, AC-108
Hours: 7 (Orchestrator ruling after plan review; full Amendment 7 fold included)
Workflow: inline-full
Shared files: none by ownership — but `src/routes/_manifest.ts` is **generated**, never hand-edited, and that rule is this ticket's to enforce for the whole fleet.
Deps: M-02, S-3 (the chunking-pattern verdict — do not pick a pattern before the spike returns)
Plan: filled in by delegator's plan phase

## Plan authority and implementation boundary

This plan is the implementation contract for M-07. It incorporates `SPEC.md` section 4, Amendment 7's API fold, AC-105/106/108, and the merged S-3 verdict. S-3 is settled: the default ID-set bulk-write transport is one JSON array bound once and expanded with `json_each(?)`; bounded placeholder chunks are not an alternate path in M-07.

M-07 owns the API substrate that every later route consumes: typed route definitions, glob registration, response/error/list/concurrency/rate-limit/bulk contracts, OpenAPI assembly, and the two meta endpoints. It also freezes reusable route contracts for the Amendment 7 additions (`GET /events`, people reads, submission-file lifecycle, and scoped tokens). It does **not** register a contract without a real handler or ship 501/stub endpoints merely to make OpenAPI look complete. Domain tickets pair those contracts with real handlers:

- M-03 supplies authentication/authorization principals and session/bearer enforcement.
- M-13 supplies R2 presign, completion verification, deletion, and replacement-version behavior.
- M-29 supplies scoped-token persistence/effective grant-intersection behavior and the token UI, then completes `check:api` and the app-sidebar docs link.
- Submission/event/people domain tickets supply their D1 queries and mutations.

That boundary keeps the runtime registry and OpenAPI document truthful from the first build while fixing the public API shapes before implementation fans out.

## Dependencies, baseline, and schema coordination

1. On `RESUME IMPLEMENTATION`, create/use the orchestrator-provided worktree only then, fetch `forgejo`, and rebase on the current `forgejo/master`. Record the exact base SHA. Do not implement from this planning sandbox.
2. Confirm M-01 and M-02 are merged before editing. Read M-01's Hono/Vite entrypoint and test conventions, plus M-02's `migrations/0001_init.sql` and `src/db/schema.ts`, before selecting imports or query fields. Preserve M-06's ownership of `package.json` and the script table; consume its existing `test`/`check:api` commands and coordinate rather than editing scripts.
3. **Schema touchpoint, explicit:** M-07 reads M-02's schema types and uses the already-defined `events`, `people`, `memberships`, `api_tokens`, file/submission relationship, `updated_at`, and event/org keys when declaring resource shapes and D1 integration fixtures. M-07 never edits `migrations/0001_init.sql`, never edits or extends `src/db/schema.ts`, never creates a migration, and never defines a parallel schema type. If the merged schema lacks a field required by the binding contract, stop and comment on MRQ-8/MRQ-2 for resolution; do not smuggle a schema change into API core.
4. Baseline the commands available after M-01/M-06 land (`npm test`, TypeScript/build, and `npm run check:api` if no longer a stub) and record pre-existing failures. No browser/computer-use validation is needed in M-07; the live validation is Worker/app requests to JSON/docs endpoints and D1-backed helper probes.

## Files and responsibilities

The exact split may follow the merged scaffold's naming conventions, but keep the responsibilities separate and under M-07's owned surface:

- `src/api/route.ts`: `ApiRoute`/`ApiRouteModule` types and a `defineApiRoute`/`defineApiModule` factory that keeps method, path, `operationId`, request/response schemas, auth/scopes, rate-limit bucket, concurrency requirement, and handler together. A route cannot enter the registry without both its definition and handler.
- `src/routes/_manifest.ts`: the generated registry mechanism. It contains an eager `import.meta.glob` over API route modules (for example `./**/*.routes.ts`, excluding `_manifest.ts` and tests), normalizes modules, sorts them deterministically, and rejects duplicate `method + path` or `operationId`. It contains **no import list, route names, paths, or per-feature edits**. Vite expands the glob at build time; adding/removing a conforming route module changes the manifest automatically.
- `src/api/router.ts`: creates the `OpenAPIHono` API app, installs request/error/not-found middleware, mounts every generated route, and exposes a stable mount for M-01's Worker entrypoint. Registration and document assembly consume the same route objects.
- `src/api/errors.ts`: the single error schema, typed error constructors, request-ID middleware, validation hook, not-found handler, and unexpected-error handler.
- `src/api/list.ts` and `src/api/pagination.ts`: list query/response schema factories, validated paging/sort parsing, offset/total-page calculation, and deterministic endpoint-owned sort maps.
- `src/api/concurrency.ts`: strong ETag generation and the named reusable `compareAndSwapResource` primitive for shared `If-Match` enforcement; mutating route handlers do not implement CAS ad hoc.
- `src/api/rate-limit.ts`: route bucket vocabulary and shared standard-header/429 response helpers; enforcement adapters can use KV without changing route shapes.
- `src/api/bulk.ts`: the exclusive selector union, durable result schema, and S-3 `runBulkByIds` helper.
- `src/api/contracts/{events,people,files,tokens}.ts` (or an equivalently clear split): reusable Amendment 7 path/request/response definitions. They stay unregistered until a domain module supplies a handler.
- `src/api/openapi.ts` plus a real meta route module discovered by the same glob: document assembly and the live `GET /api/openapi.json` and `GET /api/docs` handlers.
- Colocated `*.test.ts` files under `src/api/` for contracts and unit tests, using the merged Worker test harness for actual Hono/D1 probes.

Do not add a second hand-maintained registry, route array in `src/index.ts`, handwritten OpenAPI/YAML file, docs-only operation list, or feature-specific dispatch switch. `check:api` is expected to compare registry operations against OpenAPI, so any such list is both architecture drift and a guaranteed gate failure.

## Contract details to implement

### Generated route manifest and route definition

1. A feature route module exports one well-known value (for example `apiRoutes`) produced by the factory. Each entry carries the Hono/OpenAPI definition and its handler as one object. Make malformed exports, missing handlers, duplicate routes, and duplicate operation IDs fail during assembly/build with a diagnostic naming the module.
2. Glob only API route-module filenames, not SSR/UI `.route.tsx` files. Sort glob keys and route entries so registration and OpenAPI output are deterministic across machines.
3. Register each definition exactly once with `OpenAPIHono`. Generate OpenAPI from the registered definitions; do not reconstruct paths from Hono internals or a second schema.
4. Export a canonical operation signature/fingerprint (`METHOD normalized-path operationId`, sorted) so M-29's `check:api`, CLI generation, and SKILL links can consume the same source. The parity assertion compares the generated manifest signatures to the served document's operations and fails for missing, extra, or duplicate entries.
5. Keep meta routes truthful too: `/api/openapi.json` and `/api/docs` are real route definitions with real handlers and appear in the generated document. The docs HTML loads the exact same `/api/openapi.json` output rather than embedding a copied spec.

### One error envelope

Every API failure response with a body uses:

```ts
type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    field?: string;
    details?: unknown;
  };
  request_id: string;
};
```

The request ID is accepted from the trusted Worker request context when present or generated once per request, returned in the envelope, and exposed on a response header for log correlation. Pin the status map from Amendment 7: 400 malformed request, 401 missing/invalid credential, 403 authenticated but insufficient, 404 absent or intentionally concealed, 409 stale ETag or lifecycle conflict, 422 syntactically valid but invalid domain state, 429 rate limited, 500 unexpected. Validation errors use the same envelope (including a safe `field` where applicable); 500 responses never leak a stack, SQL, bindings, or secrets. Route handlers throw/return typed API errors rather than inventing local JSON shapes.

### List and pagination contract

1. `createListQuerySchema(filterShape, sortKeys)` composes the common query with endpoint-specific flat filters: `page` defaults to 1 and must be a positive integer; `per_page` defaults to 50, is positive, and caps at 100; `q` is optional normalized text; `sort` is validated against an endpoint-owned whitelist; endpoint filters are typed rather than accepted as arbitrary SQL names/values.
2. `createListResponseSchema(itemSchema)` emits `{data, page, per_page, total, total_pages}`. The first four fields are the base M-07 contract; `total_pages` is the binding Amendment 7 addition. `data` is always an array and totals are non-negative integers.
3. The pagination helper returns validated `limit`, `offset`, page metadata, and a safe order clause chosen only from the endpoint's sort registry. Caller strings never become SQL identifiers. Every order appends ULID `id` as the stable secondary key (with a documented deterministic direction), unless `id` is already the unique primary sort.
4. The D1 pagination executor accepts separately prepared count/data statements, runs both against identical filters, and returns the common envelope. Empty/out-of-range pages return `data: []` with the authoritative `total` and `total_pages`, never rewrite the requested page silently.
5. Preserve query semantics end to end: the same parsed filter object is reusable by UI list reads and the filter arm of bulk selectors. This is the structural basis for AC-108's UI/API ID equality.

### Bulk selector, result, and S-3 helper

Define the selector as an exclusive discriminated union, never two optional fields:

```ts
type BulkSelector<F> =
  | { kind: "ids"; ids: readonly string[] }
  | { kind: "filter"; filter: F };
```

Reject neither/both shapes and validate IDs as non-empty ULID strings at the API boundary. The shared bulk result contract carries a durable `operation_id`, `selected`, `succeeded`, `failed`, publication/outbox state, and per-item failures only for an explicit-ID selector; filter-wide operations do not echo an unbounded item list. This ticket defines the contract, while M-18 owns durable operation persistence and decision/cascade behavior.

Implement S-3's exact helper signature and behavior:

```ts
export async function runBulkByIds<T = Record<string, unknown>>(
  ids: readonly string[],
  prepare: (idsJson: string) => D1PreparedStatement,
): Promise<D1Result<T> | null>;
```

- Deduplicate while preserving first-seen order.
- Return `null` before calling `prepare` for an empty normalized set.
- call `JSON.stringify(normalizedIds)` exactly once and pass that one string to `prepare`.
- Call the prepared statement's `.run<T>()` exactly once and return its result.
- Never fall back to placeholder expansion or split into chunks.
- Callers retain fixed bindings and use `WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`, with the JSON ID set as the final logical input.

Document bounded `<=90` all-binding chunking only as a future fallback for a query that cannot use D1 JSON functions; do not implement it as a competing default. S-3 already established that local D1 accepts exactly 100 bindings and rejects 101, and that the one-JSON pattern is one write at both 150 and 1,000 IDs.

### Optimistic concurrency and rate-limit semantics

1. Generate a strong quoted ETag from resource identity plus `updated_at`; do not use a weak tag for `If-Match`. Mutable representations expose it on reads/writes. The shared precondition helper requires/evaluates `If-Match` on PATCH, DELETE, agenda move, and publish routes as they are added.
2. A stale/mismatched tag yields 409 in the common error envelope, returns the current ETag header, and includes only the safe current resource summary needed to recover. The helper must make the read/check/write transaction boundary explicit so downstream handlers cannot compare outside their D1 transaction and then race the write.
3. Route definitions declare one bucket: `read`, `write`, `send`, `import`, or `public_write` (public enforcement keys include IP plus submission/draft identity where applicable). Shared response helpers emit `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`; 429 also emits `Retry-After` and the common error envelope. Cookie-authenticated SPA traffic and equivalent bearer-token traffic use the same bucket policy.

### Amendment 7 resource contracts

Freeze these paths and shapes as route definitions/schema exports, without registering fake handlers:

- `GET /api/v1/events`: only events visible to the authenticated principal/token; each item includes `id`, `slug`, `name`, start/end dates, timezone, and the effective role. It uses the shared list envelope if paginated; event restrictions and membership remain intersected by the auth/token owner.
- `GET /api/v1/events/:eventId/people?q=&role=&task_status=&page=&per_page=`, `GET/PATCH /api/v1/events/:eventId/people/:personId`, and `GET /api/v1/events/:eventId/people/:personId/submissions`. These expose the one `people` model plus roles/participations; never create separate Speaker or Contact API models. Reads use list pagination and mutations carry ETag/If-Match metadata.
- `GET /api/v1/events/:eventId/submissions/:submissionId/files`, `POST .../files/sign`, `POST .../files/complete`, and `PATCH/DELETE .../files/:fileId`. Replacement means a new upload version, not an in-place byte replacement endpoint. The contract separates metadata mutation from M-13's R2 mechanics and marks presign/completion with the public/write rate-limit and authorization metadata they require.
- `GET/POST /api/v1/org/tokens`, `DELETE /api/v1/org/tokens/:id`. Creation accepts `name`, the fixed grant enum (`program:read`, `program:write`, `review:write`, `speaker:write`, `agenda:write`, `comms:send`, `mirror:write`), and optional `event_ids`; omitted restriction means all events still allowed by issuer membership, while an explicit list restricts to its intersection. The create response can show the secret exactly once; list/detail schemas never expose a hash or secret. Deletion/revocation is immediate when M-29 supplies persistence/auth.

### OpenAPI and docs assembly

1. Emit valid OpenAPI 3.1 JSON with title/version, `/api/v1` server/base information, operation IDs, auth schemes (cookie and bearer), common error/list/rate-limit/concurrency components, and request/response examples sourced from the route schemas.
2. `GET /api/openapi.json` returns that assembled document with JSON content type and a deterministic ETag. `GET /api/docs` returns a rendered documentation shell configured against `/api/openapi.json`, with no copied route payload. Both are public read-only meta endpoints.
3. The canonical generated document is the one future YAML export, docs rendering, CLI registry, and SKILL links consume. Do not commit a handwritten OpenAPI JSON/YAML snapshot. If a build artifact is emitted later, it must be generated from this document and carry build SHA/generated time metadata, never become an input.

## Verification and evidence

Add test names/comments carrying `AC-105`, `AC-106`, or `AC-108` where they actually prove those criteria; do not claim AC-242, which M-29 owns.

1. **Manifest/parity (AC-105):** fixture API modules are discovered without adding them to any list; ordering is deterministic; duplicates/malformed modules fail with filenames; the canonical registry signature set equals OpenAPI's operation set exactly. A static scan rejects a central list and handwritten OpenAPI paths. When M-06's command is active, run `npm run check:api` as well as the focused tests.
2. **OpenAPI/docs (AC-106):** validate the assembled document with the repository's OpenAPI validator; request `/api/openapi.json` and `/api/docs` through the Worker/Hono app and assert 200, correct content types, docs references the live JSON URL, and representative common schemas/security metadata are present. M-29 later adds the app-navigation link and final cross-artifact hash gate.
3. **Lists (AC-108 foundation):** cover default/edge/invalid page sizes, max-100 enforcement, total-page arithmetic, out-of-range pages, unknown sort rejection, stable ULID tie-breaking, q plus at least three endpoint-filter combinations, and equality of normalized filters used for list reads versus filter-wide selectors. M-08/M-29 later supplies the full seeded UI/API ID parity observation.
4. **Error/concurrency/rate headers:** drive validation, not-found, stale ETag, domain conflict, rate-limit, and unexpected exceptions; assert one envelope/request ID, exact status mapping, no 500 leakage, strong ETags, current-state 409 recovery metadata, standard headers, and `Retry-After` only where appropriate.
5. **Bulk selectors/results:** accept exactly one selector arm; reject both/neither/malformed IDs; enforce bounded per-item results; round-trip the durable result schema.
6. **S-3 helper:** against the merged local D1 migration, drive 150 and 1,000 unique/duplicate IDs, assert exact affected rows, first-seen dedupe order, one serialization value, one `prepare`, one `.run`, and zero calls on empty input. Add a mechanical source/statement assertion that M-07's bulk helper never constructs `IN (?, ?, ...)` or one placeholder per ID. Record that these are M-07 integration results; do not relabel S-3's local timing as deployed proof.
7. Run focused tests, full `npm test`, TypeScript/build, and active `npm run check:api`. Then run the normal code-review and live validation phases only after implementation is resumed; this planning-only run stops at `planned`.

## Delivery sequence after RESUME IMPLEMENTATION

1. Rebase after M-01/M-02, baseline, and adapt names only to their merged public seams.
2. Implement route/error/list/pagination/bulk/concurrency/rate-limit primitives with focused tests.
3. Implement the glob manifest and generated registration, then assemble OpenAPI and meta routes from the same definitions.
4. Add the Amendment 7 contract exports and ensure no unhandled contract is registered.
5. Run the complete verification matrix, commit owned files, and proceed through review, running-system validation, Forgejo PR, and `pr_open` under COMMON.md. Those phases are explicitly out of scope until the Orchestrator sends `RESUME IMPLEMENTATION`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Artifact `art_01KZJM16YMF9MMAAM9CMTTMZFX` returned **FAIL (plan-level)** with six major and five minor findings. Every finding is triaged below. This block is authoritative over any earlier conflicting wording in this plan; implementation must apply these resolutions, not the superseded clauses.

### R1 — D1 concurrency is compare-and-swap, never an interactive transaction (MAJOR, accepted)

The earlier instruction to expose a read/check/write “transaction boundary” is withdrawn. D1 has no interactive transaction spanning awaited reads. Every mutable handler must perform the version check in the mutation itself:

```sql
UPDATE resource
SET ..., updated_at = CASE WHEN updated_at >= ? THEN updated_at + 1 ELSE ? END
WHERE id = ? AND event_id = ? AND updated_at = ?
```

The API core owns this as one named primitive in `src/api/concurrency.ts`, not a pattern copied into each route:

```ts
export async function compareAndSwapResource<TCurrent, TResult>(input: {
  expected: { id: string; updatedAt: number };
  now: number;
  prepareWrite: (version: {
    expectedUpdatedAt: number;
    nextUpdatedAt: number;
  }) => D1PreparedStatement;
  readCurrent: () => Promise<TCurrent | null>;
  versionOf: (current: TCurrent) => { id: string; updatedAt: number };
}): Promise<
  | { kind: "updated"; result: D1Result<TResult>; etag: string }
  | { kind: "missing" }
  | { kind: "stale"; current: TCurrent; etag: string }
>;
```

`compareAndSwapResource` decodes the expected `updated_at` from the already-validated strong `If-Match` tag, computes `nextUpdatedAt = max(now, expectedUpdatedAt + 1)`, invokes the caller's conditional prepared write exactly once, and owns the `meta.changes` classification. `meta.changes === 1` is success and returns the new strong ETag. On `meta.changes === 0`, the primitive calls the supplied already-authorized/event-scoped `readCurrent` only to classify the response: concealed/missing becomes `missing`/404; present with a different version becomes `stale`/409 with the current strong ETag and safe resource summary. Any other change count is an internal invariant failure. A route-level read followed later by an unconditional write is a defect; routes use this primitive rather than reproducing the classification or version arithmetic.

For multi-statement state changes, do **not** assume a `db.batch()` guard statement prevents later statements from running when it changes zero rows. Use a single atomic SQL statement where possible; otherwise every dependent statement in one `db.batch()` must be conditioned on the same expected resource version (or on a guard result materialized within SQL) so stale input produces zero side effects. The monotonic update expression makes two writes in the same wall-clock millisecond produce distinct versions without asking MRQ-2 for a new column.

Endpoints contractually dependent on `compareAndSwapResource` are:

- M-07 Amendment 7 contracts: `PATCH /api/v1/people/:personId`, `PATCH/DELETE /api/v1/events/:eventId/submissions/:submissionId/files/:fileId`, and `DELETE /api/v1/org/tokens/:id` once their real handlers land.
- Every later `PATCH` or `DELETE` resource route in SPEC section 4.2, including `/me`, event details/taxonomy, forms/fields/admins, submissions, views, participants, evaluation/committee resources, agenda items, imports/mirror/webhook resources, and other mutable representations.
- Agenda move/resize (`PATCH .../agenda/items/:id`) and every publish action, including form publish and `POST .../agenda/publish`, because Amendment 7 names agenda move and publish explicitly in addition to all PATCH/DELETE routes.

The filter-wide/explicit-ID bulk endpoint does not pretend that one representation ETag covers many selected records; M-18 retains durable `operation_id`, per-record lifecycle-conflict, and result semantics for that path. Any bulk implementation that needs per-record CAS composes the same primitive/conditional SQL contract rather than inventing another version scheme.

### R2 — filename discriminator and pure manifest builder (MAJOR, accepted)

The fleet convention is now explicit:

- JSON API modules use plural `src/routes/<feature>.routes.ts`; they contain no JSX and export the required `apiRoutes` value.
- SSR/page modules use singular `src/routes/<feature>.route.tsx`; they are never API-manifest inputs. BUILDPLAN's `embed.routes.tsx` spelling is normalized to `embed.route.tsx` when that ticket lands, with a deviate-with-flag note because the contract itself uses inconsistent singular/plural SSR examples.
- `_manifest.ts` globs only `./**/*.routes.ts`, excluding itself and test files. A static convention test rejects JSON `/api/` route declarations from any nonconforming filename and rejects JSX/API modules that evade this split.

Factor discovery logic into `buildManifest(modules: Record<string, unknown>): RouteEntry[]` under `src/api/`. The production `_manifest.ts` is only the eager `import.meta.glob` call plus `buildManifest(modules)`. Unit tests inject fixture module records directly into the pure builder, so fixtures prove discovery/order/duplicate/malformed diagnostics without being discoverable or shipped in the production glob. This resolves the earlier fixture-versus-test-exclusion contradiction.

### R3 — Node CLI consumes generated outputs, never `_manifest.ts` (MAJOR, accepted)

`import.meta.glob` is Vite-only. Neither M-38 nor any Node script may import `src/routes/_manifest.ts`. The consumption path is:

1. The Vite/Worker build assembles OpenAPI from the glob-derived route objects.
2. That same build emits generated-only `dist/api-registry.json` (canonical operation signatures plus the SHA-256 of canonical OpenAPI JSON) and `dist/openapi.json` from the in-memory document. These are outputs, never inputs and never hand-edited.
3. The packaged CLI uses the generated registry for offline `--help`/command enumeration and fetches `GET /api/openapi.json` from its selected `--url` for target-aware execution/compatibility. It never carries a separately authored operation list.
4. M-29's completed `check:api` compares manifest signatures, emitted registry/document, served JSON, and rendered docs content hash. M-38 consumes the emitted artifact; if build wiring requires a `vite.config.ts` or package-script change, serialize it through the M-01/M-06 owner rather than editing those shared files unilaterally.

### R4 — literal people paths and one shared upload service (MAJOR, accepted with explicit decision)

The earlier fully nested people-detail paths are withdrawn. Follow Amendment 7 literally:

- `GET /api/v1/events/:eventId/people` is event-scoped and paginated.
- `GET/PATCH /api/v1/people/:personId` and `GET /api/v1/people/:personId/submissions` are org-scoped paths because `people` is one org-level model, not duplicated per event.

Authorization still fails closed. The list requires membership/grant intersection for its path event. An org-scoped detail is visible only when the principal has an effective relationship to the person through at least one permitted event; otherwise return concealed 404. Its submissions projection includes only events in the caller's effective event set. PATCH mutates the one shared person identity, uses CAS/If-Match, and requires the program-write/owner authority supplied by M-03/M-29; no event-restricted token may use the org path to learn or mutate fields outside its effective event set.

The three audience paths for uploads are aliases over one M-13 service, not three implementations: public form presign/complete adds Turnstile and public keying; `/me/uploads/sign|complete` adds speaker ownership; event submission file lifecycle adds admin/reviewer authorization. All use one object-key/versioning, validation, completion, and deletion service. Admin replacement is a new upload version; there is no byte-replace route.

### R5 — `router.ts` is closed after M-07; middleware extends through adapters/metadata (MAJOR, accepted)

`src/api/router.ts` is not a shared edit point after this ticket. `createApiRouter(runtime)` receives typed adapters (`credentialResolver`, `rateLimiter`, and other request services) through an `ApiRuntime` interface. Route definitions declare auth policy, required scopes/role, rate bucket/keying, concurrency mode, and request schema. The fixed pipeline is:

1. request ID/error boundary;
2. credential resolution (anonymous remains a real principal state);
3. rate-limit selection/enforcement using principal or public keying;
4. route authorization/concealment;
5. request validation;
6. handler;
7. response normalization/standard headers.

M-03/M-13/M-29 add route modules and adapter implementations/composition files; they do not edit middleware order or append registrations in `router.ts`. Auth-required policies fail closed when no credential adapter is installed. R2 behavior is a handler service, not central middleware. If the merged composition root needs wiring, coordinate its owner as a serialized shared-file edit. The ticket's “no shared files” claim remains true for post-M-07 route fan-out because all extension seams are additive outside the core router.

### R6 — estimate contradiction and coherent implementation order (MAJOR, resolved by Orchestrator)

The Orchestrator ruled that 4 h was wrong and **M-07 is 7 h**. The full API-core and Amendment 7 scope remains binding; no scope is cut. CP-1's critical chain is therefore **M-01 (3 h) + M-02 (4 h) + M-07 (7 h) + M-08 (4 h) = 18 h**, moving CP-1 from D+15 to **D+18**. This ruling supersedes the earlier 4 h ticket/scaffold text and closes the review's scheduling flag.

Implementation order under the corrected estimate is: (A) route definition + pure manifest/glob + error envelope; (B) list/pagination + bulk selector + exact S-3 helper; (C) OpenAPI assembly + both live meta routes; (D) concurrency/rate adapters + Amendment 7 contract exports; (E) full verification. All five segments are binding M-07 scope. If implementation overruns, report the overrun at a segment boundary and continue the full scope; do not silently cut, merge, or advertise a partial substrate without a new explicit Orchestrator ruling.

### R7 — OpenAPI version follows validated library support (MINOR, accepted)

OpenAPI 3.1 is preferred only if the exact merged `@hono/zod-openapi`/Zod versions support its 3.1 document builder and the repository validator is configured for 3.1. Otherwise emit a valid supported 3.0.x document and configure the validator accordingly. AC-106 requires a valid document, not an unsupported version aspiration. The chosen version is pinned in tests and cannot drift silently.

### R8 — docs are self-contained and hashes are over canonical bytes (MINOR, accepted)

`/api/docs` uses a renderer bundled in the Worker/static assets; it has no CDN script/style dependency and works in the clean self-host container without public network access. Canonicalize the OpenAPI object deterministically, serialize it once, and compute SHA-256 over those exact UTF-8 bytes. The JSON response ETag and `dist/api-registry.json` content hash use that digest; the docs shell identifies/references the same digest so `check:api` can compare served JSON, emitted artifact, and rendered docs mechanically.

### R9 — preserve the <=30 s inner loop (MINOR, accepted)

Default `npm test` includes fast pure manifest/error/list/pagination/selector/OpenAPI contract tests and remains hermetic and <=30 s. The 150/1,000-row local-D1 helper probe and full Worker endpoint integration run in M-06's explicit integration/check lane (prefer the existing `check:api` project once active), not the default suite. M-07 does not add a package script itself; it coordinates the test-file convention with M-06. Evidence records the before/after default-suite wall time and the separate integration command/time so later tickets do not inherit a hidden slow inner loop.

### R10 — durable strong ETags without a schema change (MINOR, accepted)

ETags are strong quoted encodings of resource ID plus the monotonic stored `updated_at`, not merely wall-clock time. The R1 conditional update advances `updated_at` to at least prior+1, so same-millisecond writes cannot reuse a tag. Tests freeze the clock and prove two consecutive successful writes produce distinct tags and a stale tag produces zero mutation. Local Worker validation asserts the exact strong ETag survives the response path; the later deployed validation/check asserts Cloudflare does not weaken/drop it. If the deployed stack cannot preserve the strong header, implementation stops and reports rather than weakening `If-Match` semantics.

### R11 — four buckets; public is a keying mode (MINOR, accepted)

Withdraw the fifth `public_write` bucket. Route metadata exposes exactly Amendment 7's `read | write | send | import` buckets plus a separate keying mode. Public writes use bucket `write` with `keying: ip_submission` (or the appropriate draft token identity); authenticated cookie and bearer calls use the same bucket policy keyed to the effective principal. Standard headers and 429 behavior remain as already planned.

### Cycle 1 disposition

All review findings are resolved above; none is deferred or ignored. R4 fixes a fleet-wide path ambiguity toward the literal SPEC and records the authorization consequence. R6 is now closed by the 7 h / CP-1 D+18 Orchestrator ruling. No code, worktree, branch, or status beyond `planned` is authorized before `RESUME IMPLEMENTATION` names the worktree.

## Orchestrator Rulings after Cycle 1 (AUTHORITATIVE)

1. **CAS accepted and centralized.** `compareAndSwapResource` is the API core's reusable primitive; the endpoint dependency inventory in R1 is binding. Interactive D1 transactions and per-call-site CAS variants are forbidden.
2. **Estimate corrected without a cut.** M-07 is 7 h; the entire planned scope remains binding because the agent-native API core is a moat feature inherited by later API, CLI, and skill tickets. CP-1 is D+18.
3. **Quota/execution mode.** On `RESUME IMPLEMENTATION`, execute inline-full in this same delegator session. Do not spawn sub-agent tabs, collaboration agents, or review/implementation worker panes. The normal implementation → review → validation → PR lifecycle still applies, performed in-session with the required durable artifacts.
4. **Hold.** MRQ-8 remains `planned` with no worktree or branch until the Orchestrator supplies the resume worktree path.

## Resume Revalidation Amendments (AUTHORITATIVE)

Revalidated 2026-08-10 against `forgejo/master @ 203dfa4ffa927ac622e0a30040dcadb811d590f7` (MRQ-1 skeleton, MRQ-2 schema + migration, MRQ-6 design system + check harness all merged). The plan stands; four genuine drift items:

- **V1 — validation/OpenAPI libraries are not on master.** R7 assumed "the exact merged `@hono/zod-openapi`/Zod versions"; `package.json` carries only `hono` + `preact`. Resolution: add runtime deps `zod@^4` + `@hono/zod-openapi@^1.5.2` (peers: zod ^4, hono >=4.10 — compatible with merged hono 4.13) and dev dep `@scalar/openapi-parser` (AC-106 document validation; supports 3.1). Dependencies only — the M-06 script table is untouched. Flagged as a shared-file edit; MRQ-6 is merged and inactive, so there is no active owner to serialize with.
- **V2 — test placement follows the merged harness, not colocation.** The plan's "colocated `*.test.ts` under `src/api/`" cannot run: merged `vitest.config.ts` includes only `tests/unit/**` and `tests/integration/**`, and `trace:ac` scans only `tests/`. M-07 tests live under `tests/unit/api/` (pure/hermetic, default suite) and `tests/integration/api/` (Worker/D1 probes, same vitest run — kept fast; the 150/1,000-row helper probe asserts correctness, not wall time). Titles carry the enforced `AC-n ·` / `CONTRACT ·` prefixes, and `tests/ac-claims/MRQ-8.json` owns AC-105/AC-106/AC-108 (pr-gate's `trace:ac --scope=merged --ticket=MRQ-8` requires it).
- **V3 — composition-root and build wiring edits.** `src/index.ts` gets a minimal mount of the M-07 API app ahead of the existing `/api/*` 404 catch-all (plan anticipated this seam; M-01 merged/inactive). `vite.config.ts` gains the R3 emission wiring so `vite build` emits generated-only `dist/api-registry.json` + `dist/openapi.json` from the glob-derived document (outputs, never inputs). Both are shared files with merged, inactive owners; flagged per contract.
- **V4 — `check:api` ownership label.** The merged stub assigns `check:api` completion to MRQ-9 (plan text said M-29). No M-07 action: it stays a stub, and M-07 supplies the canonical operation signatures, served document, and emitted artifacts that the later parity gate compares. Do not edit the script table.

No other drift: S-3 verdict merged as assumed; `src/db/schema.ts` carries every field the plan reads (events/people/memberships/api_tokens, Amendment 12 attachment fields, monotonic `updated_at`); M-06's `pr-gate`/`test`/`trace:ac` commands exist as assumed; `check:design`/`check:repo` do not intersect the M-07 file surface.
