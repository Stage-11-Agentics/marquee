# Plan Review: MRQ-127 — Create-submission pickers and honest errors

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

## 2. Summary

Reviewed the MRQ-127 plan against the task description, spec section T-N3 (`sequence/eval-response-tickets.md:345-349`), and the current code. The plan covers all four spec obligations (settings-backed pickers, required submitter typeahead with inline create, field-level 422 surfacing, agenda drop-cell accessibility labels — the fourth is explicitly in T-N3's "Also" clause, so it is in scope, not creep), and every code claim it makes was verified accurate. The remaining concerns are minor: field-name mapping between API and UI controls needs to be explicit, and the search-candidate extension has a small, probably-acceptable side effect on global QuickSearch membership.

Verified claims, for the record:

- `src/ui/submissions/CreateSubmissionPage.tsx` today is exactly as described: raw text inputs for `submitter_person_id`, comma-separated track IDs, and format ID, with errors flattened through `errorSummary` (line 49) into one global string.
- `createSubmissionInput` in `src/routes/submission-record.routes.ts:48-69` already accepts both `submitter_person_id` and an inline `submitter` object (`personInput` minus role/position) — so the inline create-person fallback needs **no API change**, as the plan asserts.
- `api-client.ts` already parses `field` and `details` off the envelope into `MarqueeApiError` (lines 296-297, 135-136); the server populates them on precisely this route's 422s (`track_ids`, `format_id`, `person_id`, `answers` at `submission-record.routes.ts:570-668`). Step 1 is genuinely just UI-side extraction, correctly scoped.
- The formats/tracks list endpoints exist in `event-settings.routes.ts` (`listEventFormats`, `listEventTracks`) with `program:read` grants — suitable feeds for the pickers.
- Person candidates in `src/routes/search.routes.ts:88-95` come only from a `participations` join today, so a submitter-only person is invisible to the typeahead; step 2's extension is necessary, and reusing the existing scope predicates (`eventScope`) is the right way to keep restricted form admins from widening their view.
- Both named test files exist, and `pr-gate.mjs` does take `--ticket MRQ-N`.

## 3. Issues

**[minor] Implementation plan step 1/3 — API field names do not map one-to-one onto UI controls**
The server's 422 `field` values include `person_id` (thrown by the shared person-resolution path at `submission-record.routes.ts:664`, which serves both submitter and participants), `track_ids`, `format_id`, `answers`, and `participants`. The UI controls will be named differently (a submitter picker, a track multi-select). "Maps details to the named field" (step 1) glosses over this: without an explicit field→control mapping plus a fallback, a `person_id` error either lands on the wrong control or vanishes.
**Recommendation:** State in step 1 that the extraction helper takes an explicit map of API field names → form controls for this screen, and that any 422 whose field is unmapped falls through to the global alert *with the server's message text*, never silently dropped. Add a unit case for the unmapped-field fallback.

**[minor] Implementation plan step 2 — submitter inclusion changes global QuickSearch membership, not just the typeahead**
`querySearchCandidates` feeds the single event search endpoint (`/api/v1/events/{eventId}/search`) that both QuickSearch and the new typeahead will consume. Adding submitter-only people means they now appear in global search as `type: "Speaker"` — a person who merely submitted (and may have been rejected) will be labeled a "Conference speaker." The plan's own non-goal ("do not redesign the global search result taxonomy") brushes against this.
**Recommendation:** Acknowledge the membership change as intended in the plan, and either accept the "Speaker" label consciously or give submitter-only people a subtitle that doesn't assert speakerhood. Assert whichever choice in the new search test so it's a decision, not an accident.

**[minor] Scope — "required" submitter is client-side only**
The API will continue to default the submitter to the acting admin when omitted (`submitter_person_id` is `.optional()`), so the actor-default path survives for direct API callers even after the UI enforces the choice. That is the correct reading of T-N3 (a screen ticket; tightening the API would break the importer and other callers), but the plan's verification line "no … actor-default submitter path remains in the UI" could be misread as claiming the server path is gone.
**Recommendation:** Keep the scope as-is; just phrase the check precisely ("the UI always sends an explicit submitter") so the reviewer of the PR doesn't expect an API change.

**[minor] Verification matrix — inline-create duplicate window from the candidate cache**
`searchCandidateCache` snapshots candidates for a typeahead burst. An organizer who creates a record with an inline new person and immediately starts a second record for the same person may not see them in the typeahead until the TTL lapses, and would plausibly create a duplicate person. Not a blocker — the window is short by design — but it's the kind of edge the 11pm-organizer lens cares about.
**Recommendation:** Note the TTL in the plan and confirm it is short enough to shrug at (or invalidate the event's cache entry after a successful create). One sentence either way.

## 4. Positive Observations

- **Every code reference in the plan is real and accurate.** The line-level claims (api-client flattening, settings endpoints, the existing `submitter` input) all check out against HEAD — this is a plan written from the code, not from memory.
- **The inline-create design is the simplest correct one:** riding the existing `submitter` input on the create route means no new endpoint, no migration, and no second network round-trip — the person and the submission commit together.
- **Security posture is stated, not assumed:** step 2 explicitly keeps the existing form-admin visibility predicates as the source of truth and adds a positive test rather than only trusting the join.
- **Scope discipline is strong.** The agenda-label item looks like creep against the task description but is verified in-spec (T-N3 "Also" clause); non-goals explicitly fence off the public form, migrations, and contract docs.
- **Fleet-aware verification:** targeted Vitest instead of the full suite, the load check before the gate, and stopping at `pr_open` all match the project's multi-agent operating rules ("a red suite must mean a real defect").
- The `record.css` fixed/reserved-region note shows awareness of the "elements never jump" ruling before a reviewer has to ask.
