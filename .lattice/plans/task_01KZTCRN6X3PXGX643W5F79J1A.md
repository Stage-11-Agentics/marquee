# MRQ-127: Create-submission pickers and honest errors

No rubric item names this screen — it is the fallback the judge reaches when the public path fails, and 10 weighted points of run-1 damage flowed through it (CFP-06/13/15). (1) CreateSubmissionPage: track multi-select and format select fed from the existing settings endpoints (event-settings.routes.ts:228,339) replacing raw 'track_agents'/'format_talk' text inputs. (2) SUBMITTER: person search/typeahead over people with inline create-person fallback and a REQUIRED choice — the blank 'Submitter person ID' field is what made 'AIE Program Committee' the speaker of record across three judged items. (3) Field-level 422 surfacing: api-client.ts:89 currently flattens every constraint failure into 'That change would leave the program in a state it cannot be in.' — surface the API's field-level detail on the field. Human lens: an organizer entering a phoned-in proposal at 11pm knows the speaker's NAME, not a ULID; the opaque error does not just block, it refuses to say why. Full spec: section T-N3. Register row 50.

## Scope and non-goals

- Replace raw track IDs and format IDs on `CreateSubmissionPage` with live controls backed by the event settings endpoint. Tracks remain optional and multi-select; format remains optional and single-select.
- Replace the opaque submitter ID input with an event-scoped person typeahead, a required existing-person selection, and an inline new-person fallback that collects the human name and email and uses the existing admin-submission `submitter` input.
- Preserve the API's field and detail data in the browser and render matching 422 messages beneath the affected create fields while retaining a concise global recovery message.
- Give every agenda builder drop target a stable accessible role and a day/time/room (or track) label so the placement surface is discoverable.
- Do not edit contract documents, add migrations, change the public form, or redesign the global search result taxonomy. Do not weaken form-admin event/form scoping.

## Implementation plan

1. Add field-aware error extraction to `src/ui/shell/api-client.ts`, with unit coverage for direct `error.field` and detail-list messages. Keep `errorSummary`'s organizer-friendly recovery sentence for the form-level alert.
2. Extend `src/routes/search.routes.ts`'s event-scoped person candidates to include submitters as well as participants. The existing submission/form visibility predicates remain the source of truth, so restricted form admins cannot discover people through records they cannot read. Add a positive search test for a submitter-only person.
3. Rebuild `src/ui/submissions/CreateSubmissionPage.tsx` around settings loading, stable loading/error states, live format/track options, person search with selection and inline creation, submitter-required validation, and field-level API errors. Update `record.css` for fixed/reserved picker and error regions so elements do not jump.
4. Add explicit accessible labels and roles to day, week, room, and track agenda drop cells in `src/ui/agenda/AgendaPage.tsx` and `src/ui/agenda/track-board.tsx`; preserve existing drag/drop behavior and add static source coverage for all placement variants.
5. Run targeted unit/integration/node tests for the touched paths, typecheck/build as proportionate, self-review the exact HEAD, run the load-aware MRQ-127 PR gate, record validation evidence, then open the GitHub PR and stop at `pr_open`.

## Verification matrix

- `tests/unit/client-error-handling.test.ts`: field-level 422 extraction retains the API message and maps details to the named field.
- `tests/integration/api/search.AC-101-104.test.ts`: submitter-only person is found for an organizer, while existing event/form visibility behavior remains intact.
- New MRQ-127 node/source checks: picker controls are settings-backed and required; no raw ID placeholders or actor-default submitter path remains in the UI; agenda drop-cell labels cover each board.
- Targeted Vitest only for changed test files; no full `npm test` under fleet load. Before `npm run pr-gate -- --ticket MRQ-127`, inspect `uptime` and wait/retry if one-minute load exceeds 24.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- Accepted: the screen will use an explicit API-field-to-control map. `person_id` and `participants` map to the submitter picker/new-person fields; `track_ids` maps to tracks; `format_id` maps to format; `title` and `abstract` map directly. An unmapped 422 remains visible in the form-level alert with the server's message, so no field detail disappears.
- Accepted: submitter-only people intentionally join the existing event search candidate set because the typeahead reuses that endpoint. The result type stays `Speaker` for compatibility, but the fallback subtitle says `Conference person` rather than falsely calling a submitter-only record a speaker; the positive test asserts this choice.
- Clarified: submitter selection is required in the UI and the UI always sends either `submitter_person_id` or an explicit inline `submitter` object. The API's actor fallback remains for backwards-compatible direct callers and is not claimed as removed.
- Accepted: the typeahead sends ordinary query requests without the global-search prefetch/session cache headers, so it sees an inline-created person on the next query. The server's five-second cache remains limited to the existing explicit prefetch path.

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

- Fixed: the field-detail helper now handles both `unprocessable` and schema `malformed_request` envelopes, and the create form preserves the server message for either code in its global alert. The unit contract covers a dotted `submitter.email` issue.
- Fixed: the tracks multi-select is controlled through each option's `selected` state rather than an array-valued select prop, so multi-selection survives Preact rerenders. Control edits clear their own stale field errors.
- Fixed: inline person creation reuses an existing organization person on case-insensitive email match, avoiding the misleading conflict treatment and allowing event participation to be attached without duplicate people.
- Fixed: the event search person query uses separate participation and submitter branches under the existing visibility scope, includes email in search text, and removes the unrelated membership-wide `Speaker` taxonomy expansion. The compound query is wrapped for SQLite ordering.
- Fixed: agenda placement targets use labelled `group` roles rather than dozens of landmark `region`s, and a new source-contract test covers the picker controls and all board drop-cell call sites.
