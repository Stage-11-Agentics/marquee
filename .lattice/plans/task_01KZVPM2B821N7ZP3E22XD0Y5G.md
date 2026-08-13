# MRQ-138: The organizer's Speaker files panel ships as an empty placeholder

SURFACE: /roster?person=... (organizer speaker record), 'Speaker files' region; and /files.

WHAT BREAKS: A headshot a speaker uploads through their portal is stored and rendered as the /onboarding row avatar, but the organizer has no filename, uploader, timestamp or download for it anywhere. The record's 'Speaker files' region is an empty labelled section, and /files is scoped to file-request tasks only (it reported 'Received 0 of 159').

ROOT CAUSE (confirmed at live sha 75b871d94c6f) -- src/ui/speakers/SpeakerRecord.tsx:204-205:
    {/* Reserved for MRQ-112's speaker files panel; it owns the serve path and the render. */}
    <section class="speaker-section speaker-files" aria-label="Speaker files" />
A self-closing section with no children. The panel was never built, so the surface ships an empty region that announces itself to assistive technology as 'Speaker files'.

BOARD ACCURACY NOTE: MRQ-112 ('Headshots render and speaker files panel') is marked done. It closed with this placeholder still in the tree. Linking this ticket to MRQ-112 rather than reopening it, per operator ruling.

FIX SHAPE: render the speaker's profile-photo and portal uploads in that section (filename, uploader, timestamp, download), or fold profile photos into the deliverables model so /files can show them. Decide which of the two file systems owns profile photos -- today they are separate and only the deliverables one is surfaced.

WHY URGENT: 'the system does the chase work' is a stated principle; an organizer who cannot see what a speaker sent cannot stop chasing it.

SIZE: medium.

PROVENANCE: sbek run 2026-08-12T15-33-34, speaker-management judgement, defects[1]. Validated by reading live source.
# MRQ-138 — the organizer's Speaker files panel

## Decision
Option (a) from the ticket: render the speaker's profile photo and portal uploads in the
record's Files section directly. Profile photos keep their own owner type
(`person_headshot`); the record unions the two owners at read time. Option (b) — folding
photos into the deliverables model — would mean minting a synthetic file-request task per
person, which changes what `/files` counts as expected and what the chase board says is
owed. That is a data-model change hours before a deadline, for no gain on this surface.
The union lives in one query module, so (b) stays open later without a rewrite.

## Steps
1. `src/routes/speaker-files.queries.ts` — union `person_headshot` attachments with the
   `task_upload` attachments of the person's file-request tasks, read through
   `lib/files/versions` so "current" is the same pointer-derived judgement the portal and
   the library already use. Never re-derive a latest.
2. `GET /api/v1/events/{eventId}/speakers/{personId}/files` in `speakers.routes.ts`, same
   `program:read` grant and event/person guards as `readSpeaker` beside it.
3. `src/ui/speakers/SpeakerFilesPanel.tsx` — render with the existing `FileVersions`
   component so a file reads the same on both sides of the conference. List the
   profile-photo row even when empty: "no headshot yet" is the most-chased fact about a
   speaker, and a row that disappears cannot be chased.
4. Replace the self-closing placeholder in `SpeakerRecord.tsx`.
5. Regression tests named for the ticket, proven to fail on the pre-fix tree.
6. Validate against the built worker, driving the real speaker upload lifecycle.

## Done when
An organizer opening a speaker record sees what that speaker has sent — filename, when it
arrived, a way to open it — and sees an honest sentence when they have sent nothing.
