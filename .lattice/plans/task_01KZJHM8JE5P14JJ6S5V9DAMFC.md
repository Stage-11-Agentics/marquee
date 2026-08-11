# MRQ-13: Form builder, catalog, and condition evaluator

BUILDPLAN: M-12 — Wave 1 (§4), walkthrough step 4 · longest single ticket in the plan

Scope (verbatim): Multiple independent event forms with name/kind/status/visibility/response count; new + duplicate (fields/rules, never responses); steps rail, immutable post-open target, all field CRUD/types, per-field validation, participant limits, form admins, lifecycle/open-close-reopen settings, and deep-equal live preview. Seeded baseline visibly includes title/abstract/outcome/format/multi-track, primary speaker profile/headshot, co-speaker, supporting file, and conditional vendor field. **Owns the condition *evaluator* (+2 h, moved out of M-36 by B-7):** the `form_fields.condition` schema shape, the shared `isFieldApplicable()` helper in `src/lib/form-conditions.ts`, client show/hide, and the server rule that a hidden field is neither required nor persisted. The evaluator is load-bearing for a Tier A screen on M-14 and for M-55's applicable-missing-fields computation, both of which land before rank 17 — building it here is what stops M-14 hardcoding a vendor conditional that M-36 would then have to unpick.

File surface: `src/routes/forms.routes.ts`, `forms.queries.ts`, `src/lib/form-conditions.ts`, `src/ui/forms/*`

ACs: AC-17 – AC-21, AC-24, AC-27 – AC-33, **AC-132, AC-133, AC-234**
Hours: 10
Workflow: sub-agent-full (≥7 h)
Shared files: `src/lib/form-conditions.ts` is created here and **added to, never rewritten** by M-14, M-36, and M-55 (§7 shared-helper rule).
Deps: M-09
Note: M-14 exercises AC-132/AC-133 on the public surface, but **M-12 owns those IDs for `trace:ac`**.
## Plan

### Contract and boundaries

- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`; this implementation follows their existing form schema and Amendment 13 vocabulary rule: UI copy says **conference**, while the API and database retain `/api/v1/events/...` and `event_id`.
- Work against `forgejo/master` at `9da8a3b06f20d960f0728bd5805445c9966e4a43`; the branch was rebased before planning and `npm ci` was run. Baseline `npm test` passed: 21 files / 110 tests, plus the hermetic check summary.
- Preserve MRQ-8's generated `*.routes.ts` manifest and shared list envelope (`page`, `per_page`, `q`, `sort`, typed filters → `data`, `page`, `per_page`, `total`, `total_pages`). No hand-edited manifest or second pagination shape.
- Use the runtime credential resolver and the existing grant/role model. Form reads and writes must fail closed for anonymous, reviewer, and speaker principals; program staff/owners and a form's explicit admins are the only authoring actors. Do not invent an auth path.
- The existing `forms`, `form_fields`, `form_admins`, `routing_rules`, `submissions`, and `submission_answers` tables are the source of truth. No migration rewrite or replacement schema is planned.

### Shared condition contract (load-bearing)

Create `src/lib/form-conditions.ts` as the durable seam that MRQ-15, MRQ-33/34, and later communications work extend rather than replace.

- Keep the persisted shape exactly `condition: { all: [{ fieldKey, op, value }] } | null`; export the condition/clause types and a runtime parser/normalizer so malformed stored JSON is handled safely.
- `isFieldApplicable(field, answers)` is the only applicability decision point. It accepts a form-field-like object and answer values keyed by `fieldKey`; an absent/null condition applies, while every clause in `all` must match. Support the schema's equality/non-equality and collection/answered predicates with deterministic scalar/array normalization, and fail closed for unknown or malformed operators.
- Export the server-side answer projection/validation primitive used by submission writers: evaluate conditions against the submitted answer map first, ignore values for non-applicable fields, require and validate only applicable fields, and return a normalized payload containing no hidden keys. This is the proof boundary for AC-133 and the future public-form writer; it must not be duplicated in MRQ-15.
- Keep the helper dependency-light and browser-safe so the builder preview, future SSR public form, and M-55 applicable-missing-fields query can all import the same code. Tests cover one clause and multiple clauses in both directions, hidden omission, hidden supplied-value stripping, and validation activating when a field becomes visible.

### API and query layer

Add `src/routes/forms.queries.ts` for SQL/query composition and `src/routes/forms.routes.ts` for all registered API operations.

- Catalog: `GET /api/v1/events/{eventId}/forms` uses the common list query/response contract, supports typed `status`/`kind` filters, q search, stable sort, response counts, public/private detail, and textual Abstract/Session target markers.
- Form CRUD: create, read, update, and delete forms; validate names/slugs, defaults, lifecycle dates, welcome copy, participant limits, per-submitter limit, and message/admin settings. Duplicate in one transaction-like sequence, copying form settings, fields, conditions, routing configuration, and admins as appropriate, but never submissions/answers; reset id/name/slug/status and response count for the copy.
- Lifecycle: publish/open, close, and reopen operations preserve the slug, drafts, responses, and limits. A form whose status is `open` or has ever opened cannot change `kind`; return the shared conflict envelope with an explanation suitable for the UI. Closed reads remain ordinary data responses and write attempts are rejected before any row is written.
- Field CRUD: list/create/read/update/delete fields, enforce the eight `FORM_FIELD_TYPES`, JSON `config` round-trip for options and validation rules (`min`, `max`, `minLength`, `maxLength`, `pattern`, `accept`, `maxBytes`), condition round-trip, unique keys, and position normalization. Add `PATCH /reorder` with atomic contiguous positions. Never let delete/reorder leave gaps or duplicate positions.
- Admins: list/add/remove form administrators with event-scoped person checks and explicit program-staff/form-admin authorization. Keep reviewers and speakers out of every authoring path.
- Route policies use `defineApiRoute`, `jsonResponse`, `errorResponses`, `If-Match`/CAS where the existing API contract requires it, and the route module filename `forms.routes.ts` so `check:api` sees every operation and OpenAPI documents the same paths.

### Seed and form domain data

Extend the existing deterministic seed so the baseline form is visibly usable and demonstrates the shared evaluator without hardcoded public-form branches.

- Keep the existing seeded conference and hotel/travel task form. Expand the CFP field registry in builder order to include title, abstract, attendee outcome, format, multi-track, primary speaker name/email/role/company, biography, headshot, optional co-speaker, optional supporting file, vendor-content question, and a product/service field conditioned on the vendor answer being Yes.
- Encode the vendor field with the canonical condition shape and configure it as required only when applicable. Use schema-driven field types/configuration for the demo; later public-form work must be able to render the same rows by reading the API.
- Preserve deterministic IDs, no real addresses/headshots/secrets, existing multi-track semantics (at least one, first primary), and all existing seed assertions. Add or update seed tests for the field registry and conditional baseline without weakening the current 1,000-row/AC-234 checks.

### Flight Deck UI

Create `src/ui/forms/FormsPage.tsx` and `src/ui/forms/forms.css`, then mount `/forms` from `AppShell` while keeping the existing route table/sidebar entry.

- Catalog cards show multiple independent conference forms, name, textual kind, status, public/private detail, response count, and isolated `Duplicate`/`+ New form` actions.
- The builder is a fixed three-column layout: steps rail, editor, and reserved live-preview column. Adding/editing/reordering/deleting fields updates the preview beside the editor without reflowing the editor; fixed-width segmented controls and `—` placeholders preserve geometry. The preview's extracted field projection is the same `{label,type,position,required}` source used by the future public form.
- Implement all seven steps named by the contract: Type & basics, Welcome, Form fields, Participants, Rules & routing, Messages, Publish. Make the immutable post-open target visibly legible with explanatory copy rather than a silently disabled control. Show conditional summaries in each field row and show/hide conditional preview fields through `isFieldApplicable()`.
- Match the binding prototype's Flight Deck tokens, dense instrument-grid layout, text-not-colour state labels, organizer vocabulary (“conference”), honest empty/loading/error states, and no decorative motion. File fields use MRQ-14's upload contract/interface and do not reimplement presign/verify/serve.
- Keep UI data flow on `/api/v1` and never simulate a second local catalog. Use accessible labels, keyboard-safe reorder controls alongside drag, and stable layout dimensions for the live preview.

### Verification artifacts

- Add AC-tagged tests under `tests/` covering the registry, condition evaluator and hidden-answer projection, form list contract, validation config, participant defaults/limits, lifecycle/close behavior, per-submitter limits, duplication without responses, immutable target, route authorization, field CRUD/reorder, and seed baseline. At minimum, one test title explicitly includes `AC-132` and one explicitly includes `AC-133`; no dynamic test titles.
- Add `tests/ac-claims/MRQ-13.json` with `owns`: `AC-17`–`AC-21`, `AC-24`, `AC-27`–`AC-33`, `AC-132`, `AC-133`, `AC-234`; `exercises` is empty unless a non-owned criterion is deliberately exercised.
- Run targeted form tests, `npm test`, `npm run check:api`, `npm run trace:ac -- --scope=...` as supported by the harness, and the required `npm run pr-gate -- --ticket MRQ-13`. For validation, run the Worker/API probes and a c11-browser/Playwright desktop check of `/forms` if the local runtime is available; attach the observed result separately from test results.
- Perform inline self-review after implementation. Because headless reviews are suspended, attach a standard-shape review artifact naming the exact branch HEAD, with `Verdict: PASS` or `PASS-WITH-NITS`, findings with file/line references, and explicit confirmation that the shared condition contract and hidden-field server rule are covered. Move through `in_validation` only after validation evidence is attached, open the Forgejo PR against `master`, verify the pushed head, attach the PR URL, and stop at `pr_open`.
