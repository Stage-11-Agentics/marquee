# MRQ-209 — Organization Home

## Contract and evidence scope

- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-209-org-home`
- Base: `github/main` at `de189c0e`.
- Binding design: `sequence/org-settings-design.md` iteration 3, `DESIGN.md`, and `PHILOSOPHY.md`.
- Prototype driven before implementation at `http://127.0.0.1:8123/pipeline-v1.1/index.html?v=15#org/home`; browser validation is local-only, with no credentials or external actions.
- Parent report channel: `c11 send --workspace workspace:6 --surface surface:256 "MRQ-209: <status>"`.

## Implementation plan

1. Add one organization-home API composition at `GET /api/v1/org/home`.
   - Authorize through the existing organization-access seam and keep all data org-scoped.
   - Return conferences as seasons with calendar dates/state and headline counts for submissions, speakers, and sessions; include a direct dashboard target for the live conference and a create-conference target.
   - Return relationship KPIs: people, returning speakers (people participating across at least two conferences), in outreach, and organizers.
   - Return newest four organization activity rows from `audit_log`, joined to actor and conference names, with a full activity-lens target.
   - Return exactly the three named attention sources as fixed slots: outreach next-touch, stale conference seats, and live server status. Each source gets a named reader seam; absent parallel data is represented as empty/omitted, never fabricated. Server status is derived directly from `readInstanceStatus` in this request, not by a browser round trip.
   - Keep the page to one browser request and bounded server-side D1 queries; no per-row queries or client-side aggregation.

2. Add the Organization Home route and UI composition.
   - Mount `/org/home` as its own admin-shell page, with a minimal Organization/Home sidebar entry if MRQ-203 has not merged yet.
   - Reproduce the prototype one-to-one: the between-conferences copy, season cards, fixed attention strip, relationship KPI block, and recent activity block.
   - Use tabular figures, reserved geometry for loading/empty/error states, honest copy for missing attention sources, and existing shell components/error treatment.
   - Link live conference cards to `/dashboard` with the event selection query, create to `/conferences/new`, attention rows to their owning surfaces, CRM/activity lenses to their existing routes.

3. Add focused tests and contract coverage.
   - Unit-test pure response/query helpers where practical.
   - Add API integration coverage for org isolation, season/headline/KPI/activity semantics, fixed attention slots, empty absent seams, and bounded request composition.
   - Add UI/source contract coverage for route mounting, one fetch, exact prototype vocabulary, fixed slots, and links.
   - Run relevant tests first, then `node scripts/checks/pr-gate.mjs` (or the touched checks) and report statuses literally: `fail`, `pass-over-budget`, or `timeout`.

4. Validate the running system.
   - Start/use the local Worker with the branch build, navigate to `/org/home` in the c11 WKWebView, verify page data and links, inspect browser errors, and capture observed runtime evidence.
   - Move MRQ-209 through `planned`, `in_progress`, `review`, and `in_validation` with comments/artifacts as each gate is actually met.
   - Commit early and push the branch. Open the PR against `github/main`; do not merge it. Report completion or recoverable blockers to the parent and raise a c11 flag only for operator action.

## Non-goals / boundaries

- Do not build outreach, stale-seat, settings, activity-lens, or sidebar systems owned by MRQ-205, MRQ-212, MRQ-207, MRQ-211, or MRQ-203. Only consume named seams and add the minimal nav row if needed.
- Do not add fake counts or demo-only data to make the page look populated.
- Do not add a migration unless the existing schema cannot support the composition; use existing org-scoped tables and fail honestly when a parallel source is absent.
- Do not merge the PR or touch the primary checkout's product code.

## Expected handoff

- Committed implementation and tests on `mrq-209-org-home`.
- Green or honestly classified gate output.
- Open PR URL and exact branch SHA.
- Lattice review/validation evidence and a concise c11 parent report.
