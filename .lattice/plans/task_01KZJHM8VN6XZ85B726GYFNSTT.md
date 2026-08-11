# MRQ-16: Speaker portal

BUILDPLAN: M-15 — Wave 1 (§4), walkthrough step 6

Scope (verbatim): Status hero and concrete wave/slot; task list where acknowledge/form/file open and validate their actual payload surface; profile/headshot edit; organizer-controlled talk title/description edit + history; handbook pages (AC-233 cuttable if named). **Does not own AC-235/236** — it renders the decision-feedback slot that M-52 fills, and **role confirm/decline is M-42's** (AC-152–154, rank 23), not duplicated here in prose. Three tickets writing `src/ui/portal/*` against one AC is exactly the failure §7 exists to prevent, and an AC owned by everyone is owned by no one when `trace:ac` asks who covers it.

Ownership boundary (binding): this ticket renders slots; **M-52 owns AC-235/236 end to end** and **M-42 owns AC-152–154**. Do not claim their IDs in test names.
AC-233 (Speaker Handbook) is the one cut-line criterion sitting on a Tier A story — if cut, gate 19 must name it explicitly.

File surface: `src/routes/portal.routes.ts`, `src/ui/portal/*`

ACs: AC-43 – AC-52, **AC-237, AC-240**, AC-233 (cuttable if named)
Hours: 7
Workflow: sub-agent-full (≥7 h)
Shared files: `src/ui/portal/*` is written by M-15, M-42, and M-52 — **one file per concern**, and the AC ownership above is what keeps them from colliding.
Deps: M-13, M-11
Plan status: ready — exact API/UI/test seams are pinned below before implementation.

## Objective

Build the authenticated speaker portal for M-15 / walkthrough step 6. Render the speaker's status hero (wave and concrete slot), task list, profile/headshot editor, organizer-controlled talk editor with history, decision-feedback slot, and handbook pages. Task actions must open their actual payload surface: acknowledge tasks must acknowledge, form tasks must render the existing conditional form builder, and file tasks must use the inherited upload flow.

## Binding ownership

- Owned ACs: AC-43–AC-52, AC-237, AC-240, and AC-233 unless implementation evidence forces the explicitly named cut-line decision.
- Not owned and must not be claimed in prose, code, or test names: AC-235/236 (M-52 decision feedback) and AC-152–154 (M-42 role confirm/decline).
- Render the decision-feedback slot without implementing its behavior; leave the location/arrival-instructions slot to MRQ-64.
- Keep organizer-facing noun as “conference”; preserve `/api/v1/events/...` wire paths.

## Implementation outline

1. Read `CLAUDE.md`, `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, the v1.9 prototype, and existing route/lib/test conventions. Map the inherited MRQ-3 session and speaker-membership guard, MRQ-13 `isFieldApplicable()` form path, MRQ-14 upload path, and existing outbox constraints before editing.
2. Add the portal API in `src/routes/portal.routes.ts` so it is discovered by `_manifest.ts` and represented in OpenAPI. The authenticated `GET /api/v1/me/portal` response is scoped to a session principal with a `speaker` membership and an optional event query; it returns only that person's submissions, tasks, profile, schedule, feedback slot, and static handbook. Mutations are `POST /api/v1/me/tasks/{taskId}/complete`, `PATCH /api/v1/me/profile`, and `PATCH /api/v1/me/submissions/{submissionId}/talk`; the organizer control is `PATCH /api/v1/events/{eventId}/submissions/{submissionId}/talk-editing` behind `program:write`. Every handler repeats the person/event/submission ownership predicate. Tests include both 401/403 status assertions and body assertions proving a second speaker's identifiers and data are absent.
3. Implement `src/ui/portal/*` as separate concern files: stable shell/status/task rendering, actual acknowledge/form/file task surfaces, profile/headshot editing, talk edit/history, decision-feedback slot renderer, and handbook. Reuse `isFieldApplicable()` plus `projectApplicableAnswers()` for conditional form projection/validation. Extend the existing authenticated MRQ-14 sign route only to add the already-modeled `person_headshot` owner; profile writes bind a ready, session-owned attachment. No alternate upload lifecycle or `always_live` write site is added.
4. Preserve v1.9 geometry and honest states: reserved task rows, fixed-width actions, “—” placeholders, tabular numerals, long-name/title truncation, complete-state copy, loading/error/empty states, and the required `Room · Building` location shape without public `access_note` leakage.
5. Add AC-tagged tests under `tests/` for each owned auto claim, including route manifest/OpenAPI parity and session isolation. AC-233 is included in this build with a static per-event Markdown projection and heading/link rendering test. Add `tests/ac-claims/MRQ-16.json` with only AC-43–AC-52, AC-233, AC-237, and AC-240; do not claim decision-feedback behavior or role confirmation/decline.

## Verification and handoff

- Run focused AC tests, route/schema checks, type/lint checks, and the full local gate. Verify the route module appears in the generated registry/OpenAPI document before PR creation.
- Perform a self-review in this worktree after implementation; attach a standard-shape PASS review naming the exact branch HEAD because headless reviews are suspended for this ticket.
- Run the real portal flow against a local server with scratch fixtures and c11 browser validation where supported; record observed behavior separately from test/inference evidence.
- Commit logical units, push `mrq-16-portal` immediately after the first commit and after every meaningful commit, verify remote equality, run `npm run pr-gate -- --ticket MRQ-16`, create the Forgejo PR against `master`, attach its URL, and transition to `pr_open`.
