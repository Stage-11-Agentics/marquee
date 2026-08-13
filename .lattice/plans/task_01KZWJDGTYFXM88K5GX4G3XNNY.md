# MRQ-162: The submitter seat promises a speaker portal to exactly the people who will never get one

src/ui/portal/PortalPage.tsx:807 tells an accepted submitter: 'This page becomes your speaker portal. Tasks and session details will arrive here.' It is false for 100% of the people who can see it.

The reachability is the whole point:

1. portalSnapshot (src/routes/portal.routes.ts:1058-1061) tries the SPEAKER seat first. The submitter seat is reached only when findSpeakerEvent returns null — i.e. the person holds no memberships row with role='speaker'.
2. The acceptance cascade creates exactly that membership, for participants with role IN ('speaker','co_speaker') (src/lib/speaker-membership.ts:87).
3. So anyone accepted who holds a speaker or co_speaker participation gets the membership and lands on the SPEAKER seat. They never see this string.
4. The only people who reach submitterOutcomeDetail('accepted') are those accepted WITHOUT a speaker/co_speaker participation — submitter-only participants, reachable through the organizer's participant editor (src/routes/submission-record.routes.ts:40 includes 'submitter' in the role enum). For them the membership is never written, so the page never becomes a speaker portal, and no tasks or session details ever arrive.

The promise is structurally unreachable for its only audience.

This is a regression. Before PR #169 the accepted branch used submitterOutcomeCopy('accepted') — 'The program team accepted this abstract for the conference.' — which is true and makes no forward promise. PR #169 replaced it with the forward promise while polishing outcome copy.

It is the same defect class MRQ-150 exists to close: the portal saying something the record cannot support. It also answers, in the wrong direction, the open question left on MRQ-150's review — whether a submitter-only participant is ever bridged to a speaker seat. They are not.

Acceptance criteria:
1. The accepted branch of the submitter seat states what is true of the record and makes no promise about a speaker portal that this seat cannot keep.
2. If the product wants the promise to be true instead, the fix is the membership bridge, not the copy — decide which, and say so in the ticket before writing either.
3. A unit test renders the accepted submitter seat and asserts the absence of any claim about tasks, session details, or the page becoming a speaker portal. tests/unit/submitter-portal.MRQ-150.test.ts already renders every other status; this one is missing.

Files: src/ui/portal/PortalPage.tsx (:806-811, :921), tests/unit/submitter-portal.MRQ-150.test.ts.

Severity note: the branch is rare, so this is not judge-facing and must not hold a deploy. main e29d4bd8 gates clean (pr-gate pass, 59.5s/120s) and should ship as-is; this is follow-up work.
