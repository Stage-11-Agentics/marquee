Shipped and merged as PR #38, squash edfaf6c1 on main.

THE FINDING WAS WORSE THAN FILED. The avatar was not missing identity — it was the literal string 'MC', a hardcoded default prop on both AppShell and DeliveryHealthShell, rendering the same two letters for every person who ever signed in. Wrong identity, shown confidently. The account menu called unavailable('Program lead', ...), and OverlayHost hardcodes a 'Not installed' eyebrow so it could not have hosted a real menu. /auth/me returned person_id but no name, so the shell had nothing true to render.

FIX. /auth/me now carries person_name and person_email. The topbar renders name and role in a reserved 168px slot with real initials. The avatar opens a real account menu — name, email, role, Sign out — whose Sign out POSTs /auth/logout and genuinely ends the session. Both Flight Deck shells read the same identity, so neither can drift back to a placeholder. The role shown is the widest standing held, not memberships[0]: the seeded program committee holds owner/owner/program_lead/reviewer and the API promises no ordering, so labelling an owner 'Reviewer' was a live risk.

TWO DEFECTS FOUND BY DRIVING THE RUNNING APP, NOT BY READING IT.
1. My own regression: the new slot squeezed .global-search until its full-sentence placeholder wrapped to three lines and burst out through the top of the 52px topbar. Measured at 1185px: search 330->198 wide, 37->73 tall. Search now truncates; the written identity folds away below 1220px where there is not room for both. The avatar never folds at any width — it is the only door out of a session, and the previous rule hid it below 1000px, which would have meant no way out on a phone.
2. Elements-never-jump proven by measurement rather than assertion: replacing the name with a 47-character diacritic name leaves the slot at exactly 168px and the avatar at exactly the same x.

VERIFIED END TO END, seeded local Worker (9,958 rows), real browser: enter as organizer -> 'AIE Program Committee / ORGANIZER' on screen -> menu -> Sign out -> landing, with /auth/me returning 401 and the shell showing its em-dash placeholder again. Persona switch on one cookie jar flips the name to the speaker and the role to speaker.

GATE. 3x tsc --noEmit, vite build, check:design, check:api, trace:ac (0 errors), 28 vitest across the four affected files, 91/91 node, CI fast-gate SUCCESS. cli/api-registry.json regenerated because the response schema changed; the diff is the hash line only.

OPEN CAVEAT: merging does not deploy. This is judge-facing chrome and reaches nobody until someone redeploys.