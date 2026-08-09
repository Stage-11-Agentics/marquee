# Plan Review: MRQ-8 (M-07 — API core, list contract, OpenAPI assembly)

## 1. Verdict

**FAIL (plan-level)**

The gaps are individually small — most are a paragraph each — but every one of them freezes a
contract the whole fleet keys off (route shapes, the manifest filename convention, the middleware
seam, the registry-consumption path for the CLI). Correcting them after M-07 merges means
re-opening M-07's owned surface while a dozen tickets are already building against it. One
prescription (an explicit read/check/write "D1 transaction boundary") cannot be implemented as
written on D1 at all.

## 2. Summary

Reviewed the MRQ-8 plan against `BUILDPLAN.md` M-07 and §7, `SPEC.md` §2.1–2.4 / §4 / Amendment 7,
`EVALUATION.md` AC-105/106/108 and the `check:api` + `trace:ac` command definitions, and the merged
S-3 verdict at `spikes/s3-d1-chunking/VERDICT.md`. Plan quality is high: the scope line is covered
item-for-item, the S-3 helper contract is transcribed exactly (including the empty-set `null`,
first-seen dedupe, single `JSON.stringify`, single `.run`, and the anti-`IN (?, ?, …)` mechanical
assertion), the `total`/`total_pages` conflict between SPEC §4.2 and Amendment 7 is caught and
resolved toward the amendment, and the ticket correctly refuses 501 stubs so AC-4's stub crawler and
`check:api`'s parity assertion stay honest.

The key concern is that M-07's real product is a set of *fleet-binding freezes*, and several of them
are made silently or made against constraints that don't hold: D1 has no interactive transactions;
the manifest glob cannot distinguish API modules from the SSR page modules that share `src/routes/`
under BUILDPLAN's own naming; `import.meta.glob` does not exist outside the Vite pipeline, so the
M-38 CLI cannot consume the registry the way the plan implies; and the people-route path shape
diverges from Amendment 7's literal text without acknowledging the ambiguity.

## 3. Issues

**[MAJOR] "Optimistic concurrency and rate-limit semantics", item 2 — the prescribed D1 transaction boundary does not exist**

The plan requires the precondition helper to "make the read/check/write transaction boundary
explicit so downstream handlers cannot compare outside their D1 transaction and then race the
write." D1 exposes no interactive transaction — there is no `BEGIN`/`COMMIT` spanning awaits, only
`batch()` (one implicit transaction over statements prepared before the call) and `exec`. A helper
that reads `updated_at`, compares `If-Match`, then issues an `UPDATE` is *always* a race on D1, no
matter how the boundary is documented. An implementer following this text literally will either
ship the race or spend the ticket discovering D1's limits, and every mutating ticket downstream
inherits whichever shape lands.

**Recommendation:** Replace the transaction language with compare-and-swap in the statement itself:
handlers pass the client's `If-Match` value into a single conditional write
(`… WHERE id = ? AND event_id = ? AND updated_at = ?`), and the helper interprets
`meta.changes === 0` as "re-read, then 409 (stale) or 404 (gone)". Where several statements must
move together, require them to be assembled and submitted through one `db.batch([...])` with the
guard statement first. State explicitly that a read-then-write pair across an `await` is a defect
this helper exists to prevent.

**[MAJOR] "Files and responsibilities" / "Generated route manifest", items 1–2 — the glob cannot separate API modules from SSR modules, and the fixture test contradicts the exclusion rule**

Two problems in the same mechanism:

1. The plan says to glob `./**/*.routes.ts` and to exclude "SSR/UI `.route.tsx` files". That
   filename doesn't exist in the contract. BUILDPLAN §7 puts *every* module at
   `src/routes/<name>.routes.ts`, and the SSR modules it names are `src/routes/embed.routes.tsx`
   (line 82) and `src/routes/public-form.route.tsx` (line 74) — inconsistent between themselves, and
   one of them differing from the API form only by extension. A `.ts`-only glob works by accident
   today and breaks the first time an SSR module is authored as `.ts`, or an API module needs JSX.
   Nothing mechanically enforces the split, and M-07 is the ticket chartered to enforce it.
2. Verification item 1 requires that "fixture API modules are discovered without adding them to any
   list", while the manifest description requires the glob to exclude tests. Both cannot be true of
   one module-level `import.meta.glob` call.

**Recommendation:** (a) Pin an unambiguous discriminator now and state it as the fleet rule —
recommended: API route modules are `src/routes/<name>.api.ts` (or a required `apiRoutes` export
validated by the assembler, with the glob rejecting any `.routes.*` module that fails to conform,
naming the file). Whatever is chosen, write it into the plan as the convention every later ticket
follows, since M-08/M-11/M-13/M-21 all create route modules. (b) Factor the manifest as a pure
function — `buildManifest(modules: Record<string, unknown>): RouteEntry[]` — where
`src/routes/_manifest.ts` is a two-line file passing `import.meta.glob(…, { eager: true })` and the
tests pass fixture records directly. That makes discovery, ordering, duplicate detection, and
diagnostics testable without shipping fixtures into the production manifest.

**[MAJOR] "Generated route manifest", item 4 — the CLI cannot import a manifest built on `import.meta.glob`**

`check:api` asserts (Amendment 6, `EVALUATION.md` §1.1) that "served JSON, rendered docs, and the
**CLI registry** derive from one route registry; operation counts and content hashes must match."
The plan discharges this by exporting a canonical signature set from the manifest. But
`import.meta.glob` is a Vite compile-time transform: `cli/` is a thin Node binary (SPEC §4.3), and a
plain `node`/`tsx` import of `_manifest.ts` gets a runtime `import.meta.glob is not a function`.
M-38 will then do the one thing this ticket exists to forbid — hand-maintain its own command
registry — and the drift only surfaces at the gate.

**Recommendation:** Name the consumption path in the plan. Either (a) the CLI's only registry input
is `GET /api/openapi.json` from the target instance (simplest; also makes `--url` honest), or
(b) M-07 emits a build-time generated artifact (e.g. `dist/api-registry.json` with the signature set
plus a content hash) produced by the Vite build from the same route objects, and the CLI reads that.
Whichever is chosen, say so explicitly, and state that the artifact is generated-only and never an
input (the plan already has that rule for OpenAPI — extend it here).

**[MAJOR] "Amendment 7 resource contracts" — people paths are nested under `/events/:eventId` against Amendment 7's literal text and the org-scoped data model, with no decision recorded**

Amendment 7 (`SPEC.md` line 649) reads: `GET /events/:id/people` (+ filters), then `GET/PATCH
/people/:personId`, `GET /people/:personId/submissions` — the event prefix appears on the list and is
absent on the detail routes in the same sentence. SPEC §2.4 reinforces that reading: `people`,
`memberships`, and `api_tokens` are **org-scoped**, not event-scoped. The plan nests all of them:
`GET/PATCH /api/v1/events/:eventId/people/:personId`, `.../people/:personId/submissions`. There is a
real authorization argument for nesting (reviewer scope is per event and never inherited, §4.1), so
this is a defensible choice — but it is made silently, and it is frozen for `check:api` parity, the
CLI registry, SKILL links, and every people-touching ticket.

**Recommendation:** Resolve it explicitly in the plan with the reasoning stated, and record it as a
decision (comment on MRQ-8, or a SPEC amendment note) rather than an implementation detail. If
nesting wins, say why the org-scoped detail routes were rejected and how a cross-event person read
is served; if the literal Amendment 7 shape wins, say how event-scoped authorization is applied to an
org-scoped path. The same paragraph should confirm the `POST .../files/sign|complete` paths against
SPEC §4.2's existing public `POST /api/v1/public/uploads/sign` and speaker-scope
`POST /me/uploads/sign|complete` so three presign paths don't get frozen with three different shapes.

**[MAJOR] "Files and responsibilities" / plan authority — `src/api/router.ts` becomes a de facto shared file, though the ticket claims none**

The ticket asserts "Shared files: none by ownership." But `src/api/router.ts` owns middleware
installation, and the plan hands enforcement to other tickets: M-03 supplies session/bearer
enforcement, M-13 supplies R2 mechanics, the rate-limit module says "enforcement adapters can use KV
without changing route shapes." Every one of those needs a middleware registered in M-07's file.
Delegators run in separate worktrees; the result is either serialized edits through the orchestrator
or a merge conflict on the exact kind of central list this ticket was created to abolish.

**Recommendation:** Apply M-07's own rule to middleware. Define an explicit ordered pipeline
(request-id → rate-limit → auth → validation → handler) whose stages are *declared per route* in the
route definition and resolved by the router from a registry that later tickets extend by adding a
file, not by editing `router.ts`. At minimum, name the extension points and the ownership handoff in
the plan so M-03/M-13/M-29 know which file they may touch, and flag the shared-file field on the
ticket for the orchestrator.

**[MAJOR] Scope vs. the 4 h estimate on the CP-1 critical chain — the Amendment 6 fold is not reconciled**

BUILDPLAN Amendment 6 says "M-07 absorbs the four pre-kickoff gaps (**+3h**)", but the M-07 row
(line 54) still reads 4 h and the CP-1 chain math (line 57) uses M-07 = 4 to reach 15 h. The ticket
asserts the +3 h is "already inside the estimate," which the source doesn't support. Meanwhile the
plan enumerates ~12 modules, four contract files, an OpenAPI assembler, two meta endpoints, a docs
shell, and seven verification suites including 150/1,000-ID D1 integration probes — that is not a
4 h ticket by any reading, and M-07 sits on the chain that sets the CP-1 clock.

**Recommendation:** Raise the arithmetic with the orchestrator before implementation resumes (M-07 is
4 h or 7 h, and CP-1 is dispatch+15 h or +18 h — the two readings can't both hold). In the plan, add
an explicit build order with a stated minimum viable core (route definition + manifest + error
envelope + list/pagination + bulk selector + `runBulkByIds` + OpenAPI + the two meta routes) and
mark concurrency, rate-limit helpers, and the four Amendment 7 contract files as the trailing
segment, so a time-boxed cut lands on a coherent line rather than mid-substrate.

**[MINOR] "OpenAPI and docs assembly", item 1 — OpenAPI 3.1 emission is a library-version bet**

`OpenAPIHono` emits 3.0.x by default; 3.1 output depends on which `@hono/zod-openapi` (and zod)
version M-01 merged and on calling the 3.1 document getter. AC-106 only requires "OpenAPI validates."

**Recommendation:** Make 3.1 conditional in the plan — emit 3.1 if the merged dependency set supports
it, otherwise 3.0.x — and pin that the repository validator must be configured for whichever version
ships. Don't let a version aspiration block AC-106.

**[MINOR] "OpenAPI and docs assembly", item 2 — the docs renderer's asset origin is unspecified**

`GET /api/docs` needs a renderer (Scalar/Redoc/Swagger UI). If the shell references a CDN script,
AC-160's clean-container README run and the self-host story acquire a network dependency, and the
public repo ships a third-party script tag. The plan also asks for a "deterministic ETag" on
`/api/openapi.json` without saying what it's computed over.

**Recommendation:** State that the renderer is bundled as a static asset served by the Worker (no
external script origin), and define the docs ETag as a hash of the serialized document so
`check:api`'s content-hash equality across served JSON and rendered docs is computable.

**[MINOR] "Verification and evidence", items 6–7 — integration probes vs. the ≤30 s `npm test` budget**

M-06 fixes `npm test` at ≤30 s from the first commit, and speed is a graded feature (R7). Driving
150- and 1,000-ID D1 writes plus Worker-boot probes for docs endpoints can quietly blow that budget
for every ticket after this one.

**Recommendation:** Say which suite each probe lands in — fast unit/contract tests in the default
`npm test`, the wave-scale D1 probes behind an explicitly-invoked integration project — and record
the measured default-suite delta in the ticket evidence.

**[MINOR] "Optimistic concurrency", item 1 — ETag durability isn't addressed**

Two gaps in "strong ETag from identity + `updated_at`": (a) instants are epoch **milliseconds**
(SPEC §2.4) and ULIDs are monotonic within a millisecond, so two writes to one row inside the same
millisecond produce an identical tag and a lost update passes `If-Match`; (b) edge compression can
weaken or drop `ETag` on responses, and a weakened tag no longer satisfies a strong `If-Match`
comparison — which is exactly the header the plan requires.

**Recommendation:** Include a monotonic component beyond the timestamp (a row `version` counter if
M-02's schema has one, otherwise `updated_at` + a per-write ULID/`rowid` component) and assert in a
test that two same-millisecond writes yield different tags. Add an assertion that the ETag survives
the deployed response path unweakened, or state the compression setting the ticket relies on.

**[MINOR] "Optimistic concurrency", item 3 — a fifth rate-limit bucket is introduced without recording it**

Amendment 7 pins buckets as `read/write/send/import` with public traffic keyed by IP+submission. The
plan adds `public_write` as a peer bucket. Sensible, but later tickets and `check:api` will compare
against the amendment's four.

**Recommendation:** Either express public traffic as `write` + a public keying rule (matching the
amendment) or record `public_write` as an explicit M-07 decision in the plan and on the ticket.

## 4. Positive Observations

- **The S-3 verdict is honored precisely, not paraphrased.** The helper signature, the empty-set
  `null` before `prepare`, first-seen dedupe, exactly one `JSON.stringify`, exactly one `.run`, the
  `CAST(value AS TEXT) FROM json_each(?)` caller shape, and the mechanical "no `IN (?, ?, …)`"
  source assertion all match `spikes/s3-d1-chunking/VERDICT.md`. The plan also refuses to re-open
  the chunking question, which is exactly what trap 11 asked for.
- **Honest AC boundaries.** AC-242 is left to M-29, AC-106's sidebar link is left to M-29, and
  AC-108 is claimed only as a foundation with M-08/M-29 completing it. The plan carries AC IDs into
  test names, which is what keeps `trace:ac --scope=merged` green on the PR without over-claiming.
- **The refusal to register contracts without handlers** is the right call — 501 stubs would have
  padded the OpenAPI document while failing AC-4's stub crawl and making `check:api`'s parity
  assertion meaningless.
- **The `total` vs. `total_pages` conflict between SPEC §4.2 and Amendment 7 was caught and
  resolved,** with the reasoning stated. That is the kind of contract reading that prevents a
  fleet-wide envelope split.
- **Sort safety is treated as an injection boundary, not a convenience** — endpoint-owned sort
  whitelists, caller strings never becoming SQL identifiers, ULID as the stable secondary key.
- **The schema-touchpoint paragraph is exemplary:** M-07 reads M-02's types, never edits the
  migration or schema, and escalates rather than smuggling a schema change into API core. That single
  paragraph removes the most likely cross-ticket collision in Wave 0.
- **Explicit anti-drift list** (no second registry, no route array in `src/index.ts`, no handwritten
  OpenAPI, no dispatch switch) gives the reviewer and `check:api` the same target.
