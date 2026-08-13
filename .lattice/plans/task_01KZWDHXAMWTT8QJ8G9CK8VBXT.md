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

## Implementation plan

- Keep the submitter/speaker seat boundary from SPEC §10. Resolve the submitter
  seat from the public-form participation rows, choosing the latest conference
  explicitly (`starts_on DESC`, deterministic `id DESC`) because a submitter's
  newest/future conference is the one they mean when no event is requested.
- Carry the event ID through the demo CFP confirmation magic-link redirect so a
  fresh submission opens its own conference. Return the submitter's authorized
  event set in the submitter snapshot, and render those events as honest portal
  links. The browser will request `/api/v1/me/portal?eventId=...` through the
  link, while the resolver still provides a deterministic fallback for older
  links without the query.
- Add a two-conference integration test that submits through both real public
  form endpoints, follows the confirmation exchange, verifies the later event,
  and verifies that each event can be requested without leaking submissions.
- Add a submitter-seat unit assertion for the rendered event links and keep the
  existing single-event fixture behavior unchanged.

## Verification

- Run the focused unit and submitter-portal integration tests.
- Run `npm test` and `npm run pr-gate`; compare failures with the known 22
  stale-clock 401 failures on MRQ-139/MRQ-131.
