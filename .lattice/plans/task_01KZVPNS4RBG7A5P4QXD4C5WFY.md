# MRQ-143: The public speaker directory cannot be navigated: first-name ordering and no route back from a profile

SURFACE: /speakers and /p/:slug (public).

TWO SMALL DEFECTS ON THE SAME 32-CARD SURFACE, both confirmed on live 75b871d94c6f:

1. ORDERED BY FIRST NAME. The directory presents as an alphabetical directory but sorts on given name. Verified by curl against live: Aarush Selvan, Alexander Bricken, Aparna Dhinkaran, Baptiste Roziere, Barr Yaron, Barry Zhang, Beyang Liu, Bruno Passos. An attendee looking for a speaker by surname has no working way to find them.

2. NO WAY BACK. A speaker profile page offers no route to the directory -- the header carries only 'Agenda' and 'Organizer demo'. An attendee who opens a profile from the grid must use the browser back button to resume browsing.

WHY BOTH IN ONE TICKET: they compound. Together they mean the only ways to find a specific speaker are scroll-and-scan and the browser's back button.

NOTE ON A RELATED FINDING ALREADY FIXED -- DO NOT RE-FILE: the evaluation also logged that the /speakers search box was entirely non-functional. That was true of the build under test and was fixed by 864be372 ('Give the speaker directory's search a control that runs it'), which is in the live build. Search is not part of this ticket.

FIX SHAPE: sort by surname (with a sensible fallback for mononyms and non-Western name orders -- do not just split on the last token without thought), and add a 'Speakers' link to the profile header.

SIZE: small.

PROVENANCE: sbek run 2026-08-12T15-33-34, public-widgets judgement, defects[3] and defects[4]. Validated live.

## Plan

1. Add a small display-name surname key for the public directory: honor an explicit `Surname, Given` form, otherwise use the final whitespace-delimited token, and fall back to the trimmed name for mononyms/blank input. This preserves hyphenated and non-ASCII surnames as a single key without pretending the display name contains richer cultural name metadata.
2. Sort `/speakers` by that key, then full display name and id for deterministic ties. Leave the separate embed sorting and already-working search behavior untouched.
3. Add a `Speakers` link to the public speaker profile header, retaining the existing `Agenda` route and the event query so a profile visitor can return to the directory without losing conference context.
4. Add focused coverage for surname ordering with `Aïcha Ndiaye-Kovács`, `Łukasz Żółć-Wiśniewski`, and a mononym, plus the rendered profile header link. Capture rendered directory ordering before/after for the PR body, then run the exact PR gate and live content checks after any deploy.
