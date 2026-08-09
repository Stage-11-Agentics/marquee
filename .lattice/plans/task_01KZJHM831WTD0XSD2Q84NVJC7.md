# MRQ-8: API core, list contract, and OpenAPI assembly

BUILDPLAN: M-07 — Wave 0 (§3)

Scope (verbatim): Hono router with a generated route manifest (glob, never a hand-edited list), error envelope, list contract (`page/per_page/q/sort/filters` → `{data,page,per_page,total}`), pagination helper, **bulk selector type (ids *or* filter)**, `json_each` chunking helper, OpenAPI assembly from route definitions, `/api/openapi.json`, `/api/docs`. **The chunking helper's default pattern is S-3's verdict** — M-07 must not pick one before the spike answers (trap 11).

Amendment 6 fold (+3 h, already inside the estimate): `GET /events` discovery, people reads, file lifecycle, scoped tokens (AC-242 UI is M-29's) — plus the pinned semantics: pagination, `ETag`/`If-Match` optimistic concurrency, one error envelope, standard rate-limit headers, durable bulk `operation_id` results, OpenAPI as the single source for docs/CLI/SKILL.
§7 rule this ticket institutionalizes: **registration by glob, never by a hand-edited list.** `src/routes/_manifest.ts` is generated at build from `import.meta.glob`; no agent ever edits a central registry to add a route, and the OpenAPI document is assembled from route definitions, never hand-written.

File surface: `src/api/*`, `src/routes/_manifest.ts` (generated)

ACs: AC-105, AC-106, AC-108
Hours: 4
Workflow: inline-full
Shared files: none by ownership — but `src/routes/_manifest.ts` is **generated**, never hand-edited, and that rule is this ticket's to enforce for the whole fleet.
Deps: M-02, S-3 (the chunking-pattern verdict — do not pick a pattern before the spike returns)
Plan: filled in by delegator's plan phase
