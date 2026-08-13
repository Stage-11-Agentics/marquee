# MRQ-144: Creating a submission silently injects an accepted talk: Bypass evaluation defaults on

SURFACE: /submissions/new -> submission record.

WHAT BREAKS: Creating a session from /submissions/new lands it as Accepted with review skipped, because the form's 'Bypass evaluation' toggle defaults ON. The resulting record shows an 'Accepted' chip, a 'Ready to place' stage and the note 'Evaluation bypassed' immediately on creation, with no confirmation step. An organizer adding a record merely to track something silently injects an accepted talk into the program pipeline.

CONFIRMED AT LIVE SHA 75b871d94c6f -- src/ui/submissions/CreateSubmissionPage.tsx:72:
    const [bypass, setBypass] = useState(true);
rendered at line 212 as the 'Bypass evaluation' checkbox with subtitle 'Ready for the working agenda after creation.'

WHY IT MATTERS BEYOND COSMETICS: acceptance is the one decision in this product that cascades -- it drives the agenda pool, participant confirmation, and the public programme. A default that grants it without the organizer choosing it is a consent defect, not a preference. 'Respect the operator' cuts against a default that makes the most consequential choice on the operator's behalf.

FIX SHAPE: default the toggle OFF so a created record enters the pipeline unaccepted, or keep the fast path but make it an explicit choice on the form rather than a preselected default. If the default stays on for a deliberate reason, say so on the control.

SIZE: small.

PROVENANCE: sbek run 2026-08-12T15-33-34, content-management judgement, defects[3]. Validated by reading live source.
