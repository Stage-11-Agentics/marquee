# MRQ-153: V2-4: the organizer sees the speaker Marquee already knows

Source: .briefs/eval-gap-v2-human-lens.md section 4, authored by Fable (Eval V2 Audit, surface:55). Operator-approved 2026-08-12. Read that section for the full human-problem framing before starting. (V2-4, ~60 min.)

HUMAN PROBLEM. A speaker uploads a headshot and writes a bio in the portal. The organizer's record still shows an initials tile, offers no way to fix the photo themselves, and no way to see what the speaker is seeing when they call confused.

GOOD LOOKS LIKE.
(a) SpeakerAvatar renders the image through the existing serve endpoint, following onboarding's pattern (an img with initials fallback on error). The roster AND the record both get it from this one change, by design of that component.
(b) The record gains an 'Upload headshot' control writing the same attachment field the portal writes.
(c) The record header gains 'Open portal as this speaker' — an organizer-only preview using the magic-link machinery invites already use, clearly labelled as viewing-as.

CLOSES. SPK-08 (w3 partial), CNT-10 (w2 cannot_judge — and cannot_judge is mandatory work for 100%, since it is excluded from the denominator and blocks a perfect score), CFP-13 (w2 partial — decisions become observable on any speaker's portal).

COORDINATE. MRQ-138 (speaker files panel) merged as #125 and touches adjacent surface. Rebase on current github/main and read what it shipped before adding a second file-rendering path.

VERIFY. Portal-upload a headshot -> roster row and record header both show it. Admin-upload replaces it after reload. 'Open portal as' shows an Accepted and a Rejected speaker's own status cards.

## Implementation plan

1. Baseline the rebased branch, then inspect the merged speaker-files panel and the existing portal upload, headshot serve, speaker patch, and magic-link invite seams.
2. Make `SpeakerAvatar` accept `eventId` and `personId`, render the served headshot when an attachment exists, and retain initials after an image error.
3. Add an organizer-authorized headshot upload path that uses the existing `person_headshot` policy, presign/local shim, PUT, and completion verification; wire the record's `Upload headshot` control to attach the ready id through the existing speaker PATCH.
4. Add an organizer-only viewing-as action that mints the existing one-time portal magic link, opens its exchange URL in a new tab, and labels the action as a preview.
5. Add `CONTRACT · ` tests covering avatar image/fallback behavior and the admin upload/attachment write path, including ownership and ready-state guards.
6. Run focused tests, type/build/static checks, the documented PR gate, and a real local-browser flow for portal upload, organizer replacement, and accepted/rejected viewing-as status. Record observed evidence separately from inference.
