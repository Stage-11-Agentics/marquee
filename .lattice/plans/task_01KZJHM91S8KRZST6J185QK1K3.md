# MRQ-18: Reviewer queue

BUILDPLAN: M-17 — Wave 1 (§4), walkthrough step 8

Scope (verbatim): Own shell; queue constrained by track intersection; one card opens full evaluator-visible fields/files and returns to the same index; primary **Approve/Maybe/Deny** recommendation saves without a numeric score; optional scorecard; resume/advance; blind identity stripped in query layer; **`GET /rounds/:id/export?format=csv` ships (+1 h) — AC-64 and AC-246 both assert over "every export" and there was no reviewer export route to scan**; detail/file/export/write routes all use M-16's helper.

Amendment 8: the recommendation maps to organizer-facing accepted/waitlisted/rejected **decision proposals without changing lifecycle status** until an authorized program lead acts.
Blind review: identity stripping happens **in the query layer**, not the view — A-8 byte-scans every reviewer-visible response *and export* for seeded identity strings.
Seed dependency (B-3): M-04b seeds the demo organizer a reviewer membership, track scopes over every track, and ~40 round-1 assignments, so this queue opens populated and AC-62's 20-advance speed run has material.

File surface: `src/routes/review.routes.ts`, `src/ui/review/*`

ACs: AC-59 – AC-65, AC-158, AC-159, **AC-244–246**
Hours: 9
Workflow: sub-agent-full (≥7 h)
Shared files: none owned — consumes `src/lib/reviewer-scope.ts` (M-16's) on **every** route including the export.
Deps: M-16
Speed: AC-62 is an AC-sourced budget — score submitted → next card interactive, median ≤ 300 ms over ≥20 consecutive advances.
Audits that key off this ticket: A-8 (anonymity scan), A-9 (reviewer isolation)
Plan: filled in by delegator's plan phase

## Implementation plan

Working tree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-18-reviewer-queue`
Branch: `mrq-18-reviewer-queue`, based on `forgejo/master @ 7fd8326ae6ecd0a639f2a8d1fe0498bd2b17cf19`

### Scope and non-goals

- Deliver the reviewer-facing queue and its API contract for AC-59–65, AC-158–159, and AC-244–246.
- Keep the reviewer surface blind and track-scoped at the query/authorization boundary; do not add a second authorization helper or expose organizer navigation.
- Do not change lifecycle status from a reviewer recommendation. Persist the recommendation, optional score/criteria, reviewer actor, timestamp, and the organizer-facing decision proposal mapping.
- Do not edit `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, `sequence/USER_STORIES.md`, the binding prototype, or the schema migration. Do not broaden this ticket into organizer evaluation-plan management, comparison-round authoring, or a new file-upload lifecycle.

### API and data boundary

1. Move the reviewer route definitions currently appended to `src/routes/evaluation.routes.ts` into `src/routes/review.routes.ts`, retaining `defineApiRoute` and the `*.routes.ts` manifest convention. Remove the moved entries/imports from the evaluation module so OpenAPI has one operation for each route.
2. Reuse `authorizeReviewerScope` from `src/lib/reviewer-scope.ts` as the only resource authorization call for queue membership, record/detail, files, CSV export, evaluation read/revisit, and evaluation write. Every failure must happen before loading submission/person metadata; guessed out-of-scope IDs return 403 with a body containing neither the guessed ID nor hidden metadata.
3. Make queue membership the intersection of explicit carried track scopes and an assigned/committee review assignment, with deterministic ordering and an unreviewed-first cursor. Return position/total/remaining and the current evaluation so a refresh resumes the same card. Ensure the seeded organizer reviewer receives the seeded round-one queue on first load.
4. Build the reviewer detail query as the evaluator-visible projection: submission identity is limited to safe record fields, complete abstract, format/tracks, form-field labels plus submitted answers, and ready/pending submission-file metadata. Do not select submitter/speaker name, company, email, bio, headshot, or any identity-derived search blob in blind mode. Keep admin-facing routes unchanged so AC-65 remains true.
5. Add `GET /api/v1/events/{eventId}/rounds/{roundId}/export` with `format=csv` query support. Generate CSV from the same authorized blind projection and invoke the centralized helper for every exported record; scan/export responses must not contain seeded submitter identity strings.
6. Make recommendation writes accept Approve/Maybe/Deny without numeric fields, explicitly normalize omitted score and criteria to SQL `NULL`, upsert the reviewer evaluation, preserve the submission lifecycle status, mark only the reviewer assignment complete, and return the recommendation-to-`accepted`/`waitlisted`/`rejected` proposal mapping. Include the saved actor/time and current review on the queue/detail response for revisit.

### UI and interaction

1. Add `src/ui/review/ReviewerPage.tsx` and `src/ui/review/review.css`, and mount `/reviewer` before `AppShell`'s admin layout so the route has no Sidebar/Topbar/admin navigation. Use the existing Flight Deck tokens/components and the v1.7 prototype's queue composition, anonymous badge, explicit scope chips, full abstract card, exact recommendation labels, optional scorecard, comment, and honest loading/error/empty states.
2. Load the current event's plan/round, then the reviewer queue. Render the first seeded card without a user-created filter; position, remaining count, and active review are derived from server data. Keep the queue ID/index in component state while opening a detail dialog/page; closing restores focus to the same card and index without navigation.
3. Detail view must show all API-provided evaluator-visible fields, full abstract, and file metadata, with an explicit blind-mode redaction section. Recommendation save posts with `score: null` and `criteria_scores: null` for the simple path, updates the current evaluation, advances to the next unreviewed card without a full-page navigation, and supports keyboard shortcuts for recommendation/score/advance. The layout must remain operable at 375px and contain no admin chrome.

### Verification and artifacts

- Add AC-tagged tests under `tests/` covering first-load populated queue, position/resume, detail completeness and blind byte-scan, all three null-score recommendations/revisit/lifecycle preservation, out-of-scope 403 body concealment across queue/detail/file/export/write, CSV `format=csv`, keyboard/mobile surface invariants, and route-manifest/OpenAPI parity as applicable.
- Add `tests/ac-claims/MRQ-18.json`; claim non-overlapping ownership of AC-59–65, AC-158–159, AC-244 and exercise the already-owned AC-245/AC-246 without duplicating MRQ-5/MRQ-17 ownership.
- Run the focused reviewer integration/static tests, `npm test`, type checks/build as needed, and `npm run pr-gate -- --ticket MRQ-18`. During `in_validation`, exercise the real Worker API with the seeded fixture and the reviewer UI through the available local browser/runtime path; attach both test and validation evidence.
- Before commit, self-review the exact diff for forbidden identity fields, route naming, duplicate operations, admin chrome, status mutation, and weakened prior guardrails. The review artifact must name the exact HEAD and carry PASS (headless review is suspended; use the standard-shape own-review fallback if needed).
