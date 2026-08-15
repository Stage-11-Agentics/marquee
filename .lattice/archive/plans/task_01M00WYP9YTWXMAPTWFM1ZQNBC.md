# MRQ-202: Attendee schedule prototype v0.3 — v0.2 review fixes (counts, unlink, demand gauge, agent signal)

One ticket of small fixes to the attendee-schedule prototype and its design contract, from the v0.2 adversarial review (prototypes/attendee-schedule/REVIEW-v0.2.md, in the working tree — deliberately uncommitted) as ruled by Atin, 2026-08-14, in conversation with the review agent. This ticket is self-contained: everything needed is below; the review file is background only.

SCOPE
- prototypes/attendee-schedule/index.html: v0.2 → v0.3 (bump the badge + header comment)
- sequence/attendee-schedule-design.md: two §7 ruling amendments (text provided below)
- No src/ changes. This is prototype + design-doc work; the build inherits it later.

FIXES + ACCEPTANCE

1. Move the public star count out of the star rail.
   The count currently renders under the star button, where it reads as a like counter that never moves when you tap. Move it to the right-hand meta column as a quiet "★ 412" beside the format/track chips (same register as the detail page's "★ 176 attendees"). The star cell goes back to button-only. Threshold/off states still reserve space — elements never jump. Detail page unchanged.

2. Unlink honesty (ruling + copy).
   Ruled semantics (add to §7, wording below): unlink deletes what the claim created and only that — the email↔schedule-code linkage always; the claim-sourced event_attendances row; the person row only if this claim minted it and nothing else is attached. Import-sourced rows are untouched.
   Prototype: after Unlink, show one plain confirmation line in the claim row (same honesty register as the claim disclosure): "Unlinked — your email and picks are removed from the organizers' records." before returning to the empty-input state (or as a transient state of it). No jump: the row keeps its reserved height.

3. Organizer door marked as a demo surface.
   Footer link text → "Organizer view (demo) ↗". The demand view opens with one line under the heading: "Admin surface — shown in the prototype for the walkthrough; behind organizer sign-in in the product."

4. Demand bar re-gauged to capacity.
   The bar currently scales to the max-starred session while the chip shows % of capacity — two scales in one row, and the one over-subscribed session gets one of the shortest bars. Make the bar = % of room capacity with a hairline tick at 100%; fill past the tick renders in the warn/alarm tone. Sort order and the count column keep carrying popularity. (Keep tones as CSS in the prototype; note for build: status-trio tokens, no literals.)

5. Agent-built schedules feed the demand signal (ruling + copy).
   Ruled mechanism (add to §7, wording below): demand count = distinct beacon devices + distinct API-created schedule codes containing the session. Web clients send their device hash with POST/PUT /schedules so synced codes de-dup against their own device; an agent's POST carries no device hash and counts as one.
   Prototype: For-agents sheet gains the line "Building a schedule counts toward the session demand signal (anonymously)." Organizer stats row gains a "via agents" figure so the board shows the signal exists.

6. Mock numbers reconcile.
   The org stats say 2,570 stars placed; the demand board sums to 1,950. Make the gauges agree (adjust the stat, or rebalance STARS — keep the two seeded sub-threshold sessions and the one over-capacity room). Keep the mini-table arithmetic consistent (3 shown + 2,057 more = 1,847 imported + 213 claimed). If a "via agents" stat is added (#5), fold it into the same arithmetic.

7. Polish batch (all ruled in):
   - Resend → "Sent" swap must not shift the Unlink button: give the quiet buttons a fixed/min width (elements never jump).
   - Import prompt step 3: active voice, state the contract — the import endpoint writes the attendance rows itself when the event is passed; the agent does not make a second call.
   - Demand-board session titles get a hover affordance (underline on hover/focus, like agenda titles).
   - Aria/tooltip: org toggle role="switch" uses aria-checked (not aria-pressed); star button aria-label keeps the session title after toggling; the public count gets screen-reader-accessible text; count tooltip copy becomes "N schedules include this session" (honest vs the distinct-devices/codes truth — replaces "N attendees have starred").

§7 AMENDMENT TEXT (append under a "Round-2 review rulings (Atin, 2026-08-14)" subheading; adjust prose to fit the doc voice):
- Unclaim: Unlinking deletes what the claim created and only that — the email/schedule-code linkage always, the claim-sourced attendance row, and the person row only if the claim minted it and nothing else references it. Import-sourced people and attendance rows are never touched by unlink. The unlink confirmation states this plainly, in the same register as the claim disclosure.
- Agent demand: the demand aggregate counts distinct beacon devices plus distinct API-created schedule codes containing the session. Web clients pass their device hash when creating/updating a schedule so a synced code de-dups against its device; agent-created codes (no device hash) count as one. The For-agents doc discloses that building a schedule contributes anonymously to the demand signal.
- Public count semantics: the viewer's own star is part of the aggregate (their device is a distinct device) but the number is a server aggregate refreshed on render, not a live tally; the count renders as session metadata (beside the chips), not under the star button, precisely so it does not read as a like counter.

EXPLICITLY OUT OF SCOPE (operator rulings, same session):
- Threshold n=0 showing "0"s: fine as is.
- Prototype dates stay Oct 13–15; demo data, no shift to Oct 12–14.
- CRM mock emails in the organizer view: demo data, fine as is.

VALIDATION (in_validation gate)
Drive http://127.0.0.1:8123/attendee-schedule/index.html (c11 embedded browser or equivalent): star a counted session and confirm the count sits with the chips and the star cell doesn't move; run claim → unlink and read the confirmation line; check the demand board's over-capacity row now has the longest-past-tick bar; flip the public-counts toggle both ways; confirm Resend/Sent doesn't shift Unlink. Then clear the three localStorage keys (marquee:proto:attendee-schedule, :org, :claim) so the operator's next drive is a cold start with the demo defaults (counts ON via the seeded default).
