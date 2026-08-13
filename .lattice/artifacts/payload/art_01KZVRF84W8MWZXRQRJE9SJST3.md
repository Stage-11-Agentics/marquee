# Plan Review: MRQ-139

## 1. Verdict

**FAIL (plan-level)** — The submitted plan is a verbatim copy of the task description. No planning has occurred. The task should return to `in_planning` for a real plan.

## 2. Summary

I reviewed the plan for MRQ-139 (organizer-side participant management plus the `max_speakers: 4` vs one-co-speaker-slot contradiction on the public form) against the task description and the current codebase. The plan document restates the ticket word-for-word — surface, defect evidence, fix shape, provenance — and adds nothing: no chosen approach, no API design, no file list, no test plan, and no resolution of the explicit fork the ticket itself poses ("either honour max_speakers with repeatable co-speaker slots or stop advertising 4"). The ticket is a good ticket; it is not a plan, and this is a medium-sized change with several genuine design decisions that must be made before implementation.

## 3. Issues

**[CRITICAL] Whole document — The plan is the task description, unmodified**
Every section of the "plan" (SURFACE, WHAT BREAKS, CONFIRMED AT, FIX SHAPE, WHY URGENT, SIZE, PROVENANCE) is copied verbatim from the ticket. A plan review cannot evaluate completeness, feasibility, or risk because there is no proposed approach to evaluate. Proceeding to implementation from this document means every design decision gets made ad hoc inside the implementation pass, which is exactly what plan review exists to prevent.
**Recommendation:** Return to `in_planning`. Produce a plan that states the chosen approach, enumerates endpoints and files to be created or modified, and defines verifiable acceptance criteria. The issues below are the specific questions that plan must answer.

**[CRITICAL] Fix shape — The ticket's explicit fork is left undecided**
The task offers two paths for the public form: honour `max_speakers` with repeatable co-speaker slots, or stop advertising 4. These have very different costs. Repeatable slots touch `src/ui/public/form/PublicForm.tsx`, the fixed `co_speaker_name`/`co_speaker_email` field contract in `src/routes/public-form.routes.ts` (participant assembly and validation at lines ~168–260), and the co-speaker magic-link flow; "stop advertising 4" is a copy/config change plus the min/max validation already present at `public-form.routes.ts:169-173`. A plan must commit to one (or explicitly split the public-form half into a follow-up ticket) before implementation starts.
**Recommendation:** Decide the fork in the plan and justify it. Given SIZE: medium and that the organizer-side add-participant control removes most of the practical pressure, a defensible split is: build the organizer-side management fully, and for the public form either implement repeatable slots or scope it out with a stated follow-up — but say which, in writing.

**[MAJOR] Backend scope — No organizer-side write path exists, and the plan doesn't design one**
`submission_participants` rows are written today only by the public intake path (`src/routes/public-form.routes.ts`, inserts around line 253 with `role` of `speaker`/`co_speaker` and a `position`). There is no POST/DELETE/PATCH participant endpoint in `submission-record.routes.ts` or `submissions.routes.ts` — the record's participant data is read-only via `participantListSql` (`src/lib/participants`, used from `submissions.queries.ts:442`). The plan needs to specify the new endpoints (add/remove, and whether role/position are editable), their Zod schemas, validation against the form's `min_speakers`/`max_speakers`, audit-log entries (the codebase logs mutations), and concurrency handling consistent with `src/api/concurrency.ts`.
**Recommendation:** The plan should enumerate the new routes (e.g., `POST /submissions/:id/participants`, `DELETE /submissions/:id/participants/:participationId`), their request/response contracts, and where they live — plus OpenAPI/manifest updates (`src/api/openapi.ts`, `src/routes/_manifest.ts`) since the ticket itself notes API readers will scrutinize this surface.

**[MAJOR] Person picker — Data source and person-creation semantics are unspecified**
The fix shape calls for a "person picker + role," but the plan doesn't say what the picker searches (an existing people-search endpoint? a new one?), or what happens when the person doesn't exist yet — the public path dedupes/creates `PersonRow`s by email. Create-on-the-fly vs. pick-existing-only changes both the API and the UI meaningfully.
**Recommendation:** Specify the picker's backing query and the create-new-person behavior (likely: search existing people by name/email, allow inline creation with name+email, dedupe by email like the intake path does).

**[MAJOR] Side effects — Organizer-added co-presenters and the magic-link/portal flow**
When the public form creates a co-speaker, it issues a magic-link participation flow (`public-form.routes.ts:275` builds `/co-speaker?participation=...` and grants the person portal authority). The plan must decide whether an organizer-added participant triggers the same invitation/grant (and any comms), or is silently attached. Silently attaching a person to a session they can't see in their portal is a coherence bug waiting to happen; auto-emailing on an organizer's data-entry action is also a real decision, not a default.
**Recommendation:** State the decision explicitly in the plan — recommended: create the portal grant, do not auto-send email, and surface the invite link on the record so the organizer chooses when to send (consistent with "the system does the chase work" only when asked).

**[MINOR] Acceptance criteria and tests — None defined**
The ticket's evidence is verifiable (grep results, live API responses) but the plan defines no acceptance criteria or test plan. The project's rules require a fast suite (45s budget) and `npm run pr-gate` before PR.
**Recommendation:** The plan should list testable ACs — e.g., "organizer can add a participant with a role to an existing submission and it renders in the PARTICIPANTS panel," "remove works," "adding beyond `max_speakers` is rejected with a 422," and whichever public-form outcome was chosen — and name the Vitest files that will cover the new routes.

**[MINOR] Design conformance — No reference to the binding prototype/DESIGN.md**
The PARTICIPANTS panel gains its first mutation affordance. The plan doesn't mention how the add/remove control conforms to the Flight Deck design language, and DESIGN.md binds the build to the prototype one-to-one. Also note the global UI rule that elements never jump: an "add participant" affordance must not shift the panel layout when toggled.
**Recommendation:** One line in the plan naming the pattern being reused (whatever the record page's existing edit affordances use) is sufficient — but it should be there.

## 4. Positive Observations

The underlying ticket is excellent, and the plan inherits that: the defect is precisely located (`SubmissionRecordPage.tsx:231`, confirmed at live sha `75b871d94c6f`), the evidence is reproducible (grep commands, live API responses), the `max_speakers: 4` vs one-slot contradiction is a sharp catch, and the fix shape honestly presents the scope fork rather than hiding it. Provenance is recorded. All of that gives the eventual planner a strong foundation — the gap is solely that the planning step itself was skipped, not that the work is misunderstood.
