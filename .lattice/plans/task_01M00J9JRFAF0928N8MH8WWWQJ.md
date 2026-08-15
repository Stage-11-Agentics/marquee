# MRQ-200 implementation plan

## Scope and contract

Implement the four review follow-ups from PR #224 (`e60dacd8`) in this worktree only.
Items 1 and 2 share the list-scope/API seam; item 3 is a focused shared-style correction;
item 4 is independent and will be split into a child ticket/PR if its query/API/UI
surface becomes more than a clean, reviewable change. Preserve the existing product
language and the Philosophy requirements that speed and agent-facing API truth are part
of respect for the operator. Do not deploy or change the deploy freeze.

## Work units

1. **Cheap list resolution and honest list scope (items 1 + 2).**
   - Inspect `src/routes/person-lists.routes.ts`, `src/routes/people.routes.ts`,
     `src/routes/people.queries.ts`, the People list-band client, OpenAPI definitions,
     registry artifacts, and existing integration tests.
   - Add a members-free single-list projection with exactly the display fields
     `{id, name, kind, member_count, created_by_name, created_at}` and preserve org
     ownership/authorization semantics. The response must not load or serialize member
     rows.
   - Change the People band to resolve its id directly, retaining resolving/named/
     missing/error states and making missing depend on the endpoint's real 404.
   - Make an unknown or foreign `list_id` on `GET /api/v1/org/people` return the
     documented not-found response while an existing empty list remains a successful
     zero-row response. Update OpenAPI, generated/checked API registry material, and
     route/API tests together.
   - Remove or restate the old index-completeness tripwire only after the band no longer
     depends on the list index.

2. **Regression coverage for the API/band seam.**
   - Add focused assertions for the projection shape/no-member behavior, same-org
     empty-list versus unknown/foreign-list status, and direct band resolution states.
   - Before treating each new assertion as regression coverage, verify it fails against
     the base commit in a detached scratch worktree containing only the test change;
     remove that worktree and prune it afterward. Record the observed base failure in
     the ticket/commit notes.

3. **Shared `.field` input selector (item 3).**
   - Enumerate every `.field` usage and all local overrides before editing.
   - Guard text-entry sizing in `src/styles/components.css` with radio/checkbox type
     exclusions, then remove only local patches that are solely undoing that shared
     overreach. Verify no radio or checkbox under `.field` inherits the text-entry
     width/min-height contract.
   - Add a structural/style regression assertion if the existing test conventions support
     it, and prove the new assertion fails on the base commit first.

4. **Facet counts (item 4).**
   - Trace how People list filters, search, and chips are represented from route through
     query to panel rendering. Prefer counts computed for the actual in-view population;
     if that cannot remain a clean change, stop this work unit and create/link a separate
     ticket and PR rather than smuggling a broad redesign into MRQ-200.
   - Cover list-scoped, search-scoped, chip-scoped, empty, and unfiltered behavior with
     regression tests, each base-failure verified before implementation.

## Verification and delivery gates

1. Run focused tests during each work unit, then the full suite and inspect the reported
   status (`fail` is blocking; `pass-over-budget` is a warning; `timeout` is unknown and
   must be rerun).
2. Run the required static gate: the three `tsc --noEmit` projects, `vite build`,
   `check:design`, `check:api`, `check:routes`, `check:schema`, and `trace:ac`, followed
   by `npm run pr-gate -- --ticket MRQ-200` immediately before the PR claim.
3. Build and seed the local Worker using the README recipe on a verified free port. Use
   Playwright via `@playwright/test` at 1440x900 to inspect the People list band and the
   Evaluation screen. Confirm direct list resolution states and that Evaluation checkboxes
   and round toggles have unchanged, compact geometry. Enumerate `.field` usages again
   after the CSS change. Remove `.dev.vars` before the gate.
4. Commit meaningful units on `mrq-200`, inspect exact diffs, push `github mrq-200`, and
   open one ready-for-review PR with `gh pr create --repo Stage-11-Agentics/marquee
   --base main`. Obtain a review from another agent, resolve all findings, wait for the
   green gate, merge the PR, and report the merged state. Do not deploy.
5. Record validation evidence in Lattice, transition through review/validation/pr_open,
   and close with `lattice complete MRQ-200 --review ...` only after the PR is reviewed,
   green, merged, and the no-deploy constraint is honored.
