# MRQ-139: A submission's participants are read-only: no way to add a co-presenter after intake

SURFACE: /submissions/<id> PARTICIPANTS panel, and /submissions/new.

WHAT BREAKS: Co-presenters cannot be attached to a submission from the organizer side at all. The record renders a full PARTICIPANTS panel but offers no add/remove/edit affordance, and the organizer create form has exactly one person slot ('Submitter REQUIRED'). The only participant-entry path is the public form's single fixed co-speaker name/email pair, which has no role picker.

CONFIRMED AT LIVE SHA 75b871d94c6f:
- src/ui/submissions/SubmissionRecordPage.tsx:231 -> the Participants Card maps record.participants and renders an empty state; there is no mutation control anywhere in the file. grep for add-participant across src/ui/submissions/ returns nothing.
- The public CFP form exposes exactly one co-speaker pair: fields co_speaker_name and co_speaker_email (GET /api/v1/public/forms/cfp on live).
- Yet that same live response declares form.max_speakers: 4. The form's own contract allows four people; the form can only ever collect two.

FIX SHAPE: an add-participant control on the record (person picker + role), and either honour max_speakers with repeatable co-speaker slots on the public form or stop advertising 4.

WHY URGENT: multi-presenter sessions are ordinary at a conference of this kind, and the max_speakers:4 vs one-slot contradiction is a self-inflicted inconsistency a reader of the API will notice.

SIZE: medium.

PROVENANCE: sbek run 2026-08-12T15-33-34, abstract-management judgement, defects[3]. Validated live.
