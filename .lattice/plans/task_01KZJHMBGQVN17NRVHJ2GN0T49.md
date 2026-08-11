# MRQ-44: Audit — PROTOTYPE badge absent from the product

BUILDPLAN: A-2 — audit track (§5). **Owned by an auditor who did not write the code.**

Scope (verbatim): PROTOTYPE-badge sweep — grep `src/` and the built bundle, visual pass over every product route.
Starts when (verbatim): After M-49.

Pass condition (gate 15): the badge exists **only** under `prototypes/`; no product route renders it. The grep must cover the built bundle, not just source — a badge that survives the build is exactly the failure this audit exists to catch.

ACs: — (backs gate 15)
Hours: 1
Workflow: fast-track
Shared files: none — audit artifact only.
Deps: M-48+M-49

## Plan

1. Establish the audit surface without changing product code: enumerate every product route in `src/ui/shell/route-table.ts`, the page/router wiring, and the generated API registry from `src/routes/_manifest.ts`. Record the complete route and artifact coverage in the review/completion evidence.
2. Audit source and the binding prototype. Scan all product source roots for the badge class/markup and badge copy; independently enumerate every matching file and prove matches are confined to `prototypes/`. Confirm `prototypes/pipeline-v1.1/index.html` still contains both `prototype-badge` and `Prototype · mock data` (or its exact rendered equivalent), with `file:line` evidence.
3. Run the requested production build with `npm run build`, scan every text asset under `dist/` for the same badge markers, and record the result and any build/tooling distinction separately from product findings. Do not repair an audited product finding in this ticket.
4. Add `tests/node/prototype-badge-invariant.test.mjs`, modeled on `tests/node/comms.AC-250.test.mjs`. Key it to the invariant: product roots (`src/` and an existing `dist/`) may not contain badge markers, while matching files must be under the explicit `prototypes/` allowlist and the binding prototype must retain the badge. Use file-path inventories and content assertions; never line-number coordinates.
5. Run the focused guard, the default suite, the production build/scan, and the required `npm run pr-gate -- --ticket MRQ-44`. Self-review the final diff, attach a PASS review artifact naming the final commit, open the Forgejo PR against `master`, attach its URL, and finish at `pr_open`.

Non-goals: no edits to `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `USER_STORIES`, prototypes, or product code; no new AC claim file because this ticket owns no `auto` AC; no exact-line-number guard.

## Plan review

Self-review: the plan covers both source and generated output, includes the route-manifest and route-table inventories, preserves the binding prototype as a positive assertion, and makes the machine guard content/path-invariant rather than coordinate-based. Product findings will be routed to owning tickets rather than fixed here.
