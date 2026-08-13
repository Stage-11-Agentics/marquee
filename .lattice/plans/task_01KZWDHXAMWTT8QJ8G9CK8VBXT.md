# MRQ-160: The submitter seat opens the wrong conference, and offers no way to the right one

A person who submitted to this year's CFP can land on last year's conference, with no way to reach the one they just submitted to.

`findSubmitterEvent` (src/routes/portal.routes.ts:341) resolves the seat with `ORDER BY e.starts_on ASC` — the EARLIEST event the person has a participation in. For a speaker that is merely arbitrary; for a submitter it is systematically backwards, because the conference they just submitted to is the FUTURE one. Anyone with a participation on an older event's submission (a past speaker, a co-presenter, anyone the organizer added) plus a fresh CFP submission gets the old conference.

There is no way out of it. `GET /api/v1/me/portal` accepts an `eventId` query parameter, but the portal UI never sends one (src/ui/portal/PortalPage.tsx:891 — `requestJson("/api/v1/me/portal")`), and the submitter seat renders no event switcher. The CFP confirmation link does not carry the event either. So the seat silently picks one conference and the reader cannot correct it — the same dead end MRQ-150 closed, one event over.

Multi-event is a shipped shape (MRQ-129), so this is reachable, not theoretical.

Acceptance criteria:
1. A submitter with participations in two events, having just submitted to the later one, opens the confirmation link and lands on the conference they submitted to — not the earliest.
2. When a session holds submissions in more than one conference, the submitter seat lets the reader reach each of them; a seat that shows one conference while another exists must say so rather than silently choose.
3. The choice is explicit in the resolver, not an accident of `ORDER BY`: whatever ordering ships carries a comment saying why it is right for a submitter.
4. Integration coverage for the two-event case, built on the real public-form path the way tests/integration/api/submitter-portal.MRQ-150.test.ts is, not on injected memberships.

Files: src/routes/portal.routes.ts (findSubmitterEvent, :327-346), src/ui/portal/PortalPage.tsx (:891 and the SubmitterPortal shell), src/routes/public-form.routes.ts (portal_url construction, :489).

Provenance: finding 7 of the 8-finding post-merge review on MRQ-150. Note findings 1,2,3,4,8 are in open PR #160 and finding 5 shipped in PR #158 — this is the remainder.
