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
