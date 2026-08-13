# MRQ-136: Public agenda controls do not reflect the filters actually in effect

SURFACE: /agenda (public), TRACK select and day tabs.

WHAT BREAKS: A filtered URL narrows the list correctly but the controls still describe an unfiltered view. Anyone arriving on a shared, bookmarked or embedded filtered link sees controls that misdescribe what they are looking at.

CONFIRMED ON LIVE (75b871d94c6f) by curl, not inference:
- GET /agenda            -> 134673 bytes
- GET /agenda?track=Agents      -> 101369 bytes   (filter IS applied)
- GET /agenda?track=trk_agents  -> 101382 bytes
- Yet the server-rendered markup is: <select class=public-select name=track aria-label='Filter by track'><option value>All tracks</option><option value=trk_fin>...  -- NO option carries a selected attribute, so the control renders 'All tracks'.
- Same class of bug on day tabs: with ?day=N applied, no day tab is highlighted (on the unfiltered view 'All days' is visibly highlighted).

NOTE THE INCONSISTENCY: the embed widget gets this right -- its track select shows the track carried by the URL. /agenda and the embed disagree with each other. See src/ui/public/agenda/PublicAgendaPage.tsx:767 vs src/ui/embeds/EmbedPage.tsx:348.

FIX SHAPE: mark the matching <option selected> from the request's track param and apply the active class to the selected day tab. This is server-rendered, so it also affects no-JS and crawler views.

WHY URGENT: public surface, judge-visible, sharing/embedding is a scored capability, and the fix is small.

SIZE: small. No dependency.

PROVENANCE: sbek run 2026-08-12T15-33-34, public-widgets judgement, defects[2]. Validated live.
