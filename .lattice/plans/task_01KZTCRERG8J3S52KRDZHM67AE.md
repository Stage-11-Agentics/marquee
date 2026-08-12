# MRQ-113: Portal invite control and speakers CSV

SPK-06 (w2), SPK-03 (w2), plus coverage protection for SPK-07/09 + CNT-02/03 (the on-screen demo magic link is the most reliable way the judge reaches the portal at all). (1) 'Invite to portal' on the speaker-facing surfaces (onboarding drawer now; speaker record when the roster ticket lands) + bulk action: existing POST /auth/magic-link machinery, organizer-authenticated variant; demo mode already returns the link on screen; the outbox row makes 'logs the send' free. Stamp participations.invited_at (already written on the co-speaker path). (2) CSV: make external_ref OPTIONAL for speakers (importer already synthesizes identity from email; the eval kit's own fixture speakers.csv has NO external_ref column and fails today's UI validation at SessionizeImportPage.tsx:81), accept a speakers-only manifest (sessionize-import.ts:948 currently requires both), entry point 'Import speakers' reachable from the speaker area (the only in-app /import link renders solely when the program is empty, DashboardPage.tsx:86-92). Importer-created speakers must land visible (coordinate with the roster ticket's membership decision — read its plan comment on the board before finalizing). Full spec: section T-D3. Register rows 18,23.

## Plan

### Scope and rubric contract

- Deliver the honest T-D3 loop for SPK-03 (speakers CSV import) and SPK-06 (explicit invite control with a visible success result), with the invite path preserving the existing demo-safe magic-link behavior and outbox history that protects SPK-07/09 and CNT-02/03.
- Do not edit SPEC/EVALUATION/BUILDPLAN/USER_STORIES/DESIGN or `.eval-kit`. The YAML is authoritative: a speaker CSV may omit `external_ref`; email is an acceptable dedupe/identity fallback; invitation delivery itself is manual-half evidence, so the UI must report only durable facts (queued outbox row, on-screen link in demo mode).
- Respect MRQ-111's roster contract: imported people must remain usable by whichever participation-derived or membership-derived roster implementation lands there. This ticket will not invent a parallel speaker table or assume a new membership writer.

### Implementation

1. Add an organizer-authenticated, event-scoped invite route under `src/routes/*.routes.ts` accepting one or more speaker person IDs. Reuse `mintMagicLink`, `renderMagicLinkLoginMail`, `enqueueAuthMail`, and `enqueueMailMessage`; resolve only people belonging to the event through speaker memberships or event participations; stamp every matching event participation's `invited_at`; return per-person queued/outbox status and the raw link only for demo events. Keep the existing public login request unchanged.
2. Add explicit discoverability to the onboarding speaker drawer and bulk selection toolbar: `Invite to portal` for one speaker and `Invite to portal (N)` for selected speakers. Show a stable, accessible success/error state, queued/duplicate facts, and demo links when returned. Add an `Import speakers` action from this speaker-facing area and rename the utility route label to that exact noun; do not pretend a send happened when the request failed.
3. Make the Sessionize manifest accept an optional/empty sessions CSV while retaining the required speakers CSV. Update upload/mapping/run/manifest parsing and previews so a speakers-only manifest reaches the real `importSpeaker` path, and make `external_ref` optional in the UI's speaker required-field check with a truthful normalized-email fallback note. Preserve existing sessions imports, idempotent matching, audit manifest retention, and undo behavior.

### Verification

- Add focused AC-tagged tests for the invite route: unauthorized/event-crossing speaker rejection, single and bulk demo invites, `invited_at` writes, on-screen link shape, outbox rows, and no duplicate person rows. Add focused importer coverage for speakers-only manifests and the optional external reference while preserving the existing import contract.
- Run only targeted Vitest files touched by this change (never the full `npm test` in the shared fleet), then run type/build checks as proportionate. Exercise the real local Worker/API flow for invite and speaker-only import during `in_validation`; record observed responses and database facts separately from static/test inference.
- Before `npm run pr-gate -- --ticket MRQ-113`, check one-minute load with `uptime`; if above 24, wait and retry. Paste the gate output into the MRQ-113 completion comment and PR body. Fast-track uses adversarial self-review, with a PASS review artifact naming the exact branch HEAD before `pr_open`.

## Plan self-review — fast-track

- The invite route must not use the public email lookup as authorization: event membership/participation joins are the resource boundary, and the route policy remains organizer `program:write`.
- A partial invite response is honest only if each returned result identifies queued/duplicate state and the demo-only link; no success copy may claim provider delivery.
- The speakers-only path must skip session loops rather than manufacture sessions, while a real sessions CSV continues to require its existing session identity/title/speaker-email mappings. `external_ref` remains an optional match key, never a required synthetic value.
- UI controls reserve their result area and use the exact rubric nouns; no route is exposed unless the underlying flow is live.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- The first gate pass identified two contract guards: direct portal-route magic-link minting would create a third enumerated auth writer, and a dynamic `IN (...)` placeholder list needed a D1-cap classification. Resolved by routing organizer invites through the shared `mintPortalMagicLink` helper over the canonical writer and using JSON1 `json_each(?)` for the bounded person-ID set. Static guards pass with no allowlist edits.

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

- The exact gate reached merged AC tracing after all 543 tests passed, and rejected six new test names because custom SPK labels are not trace prefixes. Resolved by mapping the invite assertions to the existing AC-282/AC-283 invite and mail contract, and the speakers-only import assertions to AC-110/AC-113 import and undo contracts. No product behavior changed.
