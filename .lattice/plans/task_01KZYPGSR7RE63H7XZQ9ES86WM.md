# MRQ-174: The speaker portal shows a set of talks, not a day — plus the seat chrome contract

## Depends on

- **MRQ-171** must be merged first. It extracts the theme switcher into one shared
  component in `src/ui/shell/`, and this ticket consumes that component rather than
  writing a third copy.
- The uncommitted `PortalPage.tsx` work in flight on 2026-08-13 (organizer-with-no-
  speaker-seat dead end, comms send disclosures, reversal counts) must be merged
  first. **Rebase on `github/main` and confirm those changes are present before you
  start**, or you will resolve conflicts in the most-seen surface in the product.

## Part 1 — a speaker with several talks

The arrival math is already right, and it is better than it looks. `arrivalForSession`
in `src/lib/venue-geometry.ts` picks the speaker's **own** most recent same-day session
that ends before this one starts, and computes the walk from *that* building. A speaker
with a 10:00 in the Sheraton and a 14:30 in the Workshop Annex already gets a leave-by
that accounts for the walk between their own two talks. **Do not touch that math.** It
is correct, it is shared with mail and ICS, and it has a test suite.

The presentation is what fails. Three defects and one missing idea.

**1a · The order is wrong.** `src/routes/portal.routes.ts:755` selects a speaker's
submissions `ORDER BY s.updated_at DESC, s.id ASC` — edit recency. Two accepted talks
therefore render in whatever order they were last touched, not the order the speaker
will give them. The chain is computed correctly and then displayed out of sequence: the
portal can show talk #2's arrival plan above talk #1's. Order scheduled submissions by
their slot start; keep a deterministic tail for unscheduled ones so the list never
flickers between loads.

**1b · Duplicate DOM ids.** `ArrivalCard` keys both `id` and `aria-labelledby` on
`slot.starts_at` (`portal-arrival-${starts_at}`, `arrival-heading-${starts_at}`). Two
participations at the same instant emit the same id twice, and a screen reader follows
the first. This is reachable in the seeded demo data, not theoretical — the seed
deliberately guarantees live double-bookings so the `person` conflict class fires. Key
on `submission.id`.

**1c · The `index === 0` framing does not survive several talks.** The first hero reads
"Current status" in an `<h1>`, the rest "Submission status". That is a
single-submission framing. Re-word so a speaker with three talks reads something true.

**1d · Nothing states the movement — build the day strip.** This is the substance of
the ticket. When a speaker has **more than one scheduled session**, render a compact
day strip above the talk cards:

```
YOUR CONFERENCE DAY · Tue Oct 13
┌──────────────────────────────────────┐
│ 10:00  Shipping agents that don't lie │
│        Metropolitan Ballroom          │
│        Sheraton · be in by 9:45       │
│   │                                   │
│   │  18 min walk · + 5 min to get in  │
│   │  leave by 14:07                   │
│   │                                   │
│ 14:30  The eval trap                  │
│        Workshop Annex                 │
│        41 Madison Ave · side entrance │
└──────────────────────────────────────┘
        [ one map, both pins ]
```

Sessions in time order; the movement between them as the connective tissue. Every
number in it already exists in the portal payload (`slot.location`,
`slot.arrival.walk_minutes`, `access_minutes`, `leave_by`, `previous_session`). **Add no
new arithmetic** — if a number you want is not in the payload, widen the payload from
the existing projection rather than recomputing anything client-side.

- **One map, not N.** The strip carries a single `VenueMap` with a pin per distinct
  building. The repeated per-talk maps collapse into it. The per-talk cards keep their
  detail (room, address, getting in, entry time, arrival plan) below, in the same order.
- **It folds.** A speaker with one scheduled session sees exactly what they see today —
  no strip. This mirrors the venue disclosure rule already in the product: venue
  surfaces show for every conference but fold when there is one building.
- **Multiple days.** A speaker with sessions on two days gets one group per day, in
  order, each with its own date heading. Movement is only ever computed within a day —
  which is already how `previousSessionFor` behaves, so follow it rather than inventing
  an overnight leg.
- **Degrade honestly.** Say what is true when it is not ready: an unplaced session, a
  building with no map pin, a room whose building is unassigned. The existing
  `arrival.status` vocabulary (`ready` / `unscheduled` / `unassigned` / `unavailable`)
  already distinguishes these and the current copy says the right thing for each — reuse
  those sentences, do not write new ones that contradict them.
- **Same building, consecutive talks:** no walk leg, and do not print "0 min walk". Say
  the room changes, or say nothing.

## Part 2 — the seat chrome contract

Both non-admin seats get the two affordances the organizer already has.

**2a · The brand mark navigates to your seat home.** `src/ui/portal/PortalPage.tsx`'s
`<span class="portal-brand">Marquee · Speaker portal</span>` and
`src/ui/portal/CoSpeakerPage.tsx`'s equivalent are plain spans — not links, not
clickable. Make each a real link to that seat's home, sourced from the helper MRQ-171
put in `src/lib/auth/signin-destination.ts`, not a hardcoded second copy of the
role→home mapping. Every error and loading branch of `PortalPage` renders its own copy
of the topline (there are at least five) — fix them all, or better, render one topline
component and delete the duplicates.

**2b · The theme switcher.** The theme system is global and already correct —
`html[data-theme]`, `localStorage`, the pre-paint script in `index.html` — so a theme
chosen elsewhere already persists onto the portal. What is missing is the control. Drop
in the shared component MRQ-171 created. **Do not write another switcher**; there were
two copies before MRQ-171 and the point of the extraction was to stop at one.

## Acceptance criteria

1. A speaker with two scheduled sessions in different buildings sees the day strip, in
   time order, with the walk and leave-by between them stated once.
2. A speaker with one scheduled session sees no strip and a portal otherwise unchanged
   from today.
3. A speaker with sessions on two days sees one group per day; no movement leg is drawn
   across a night.
4. Exactly one map renders for a multi-talk speaker, with one pin per distinct building.
5. Submissions render in the order the speaker will give them, not `updated_at` order,
   and the order is stable across reloads.
6. No duplicate DOM ids for a speaker with two participations at the same instant.
   Verify against the seeded double-booking, not a hand-built fixture.
7. Unplaced, unpinned, and building-unassigned sessions each read honestly in the strip,
   using the existing `arrival.status` copy.
8. Clicking "Marquee" on the portal and on the co-speaker page lands on that seat's
   home, from a cold-opened tab, in every branch of the page including the error and
   loading states.
9. The theme switcher is present and functional on both, the choice persists across a
   reload and across navigation to another seat, and exactly one implementation of the
   control exists in the codebase.
10. Elements never jump: the strip must not shift when a leave-by resolves or a count
    changes. Tabular numerals for times and durations, reserved height for the arrival
    line.
11. Usable at 375px — the strip is the surface most likely to be read on a phone at a
    conference, so treat mobile as the primary case here rather than an afterthought.

## Do not

- Do not change `arrivalForSession`, `previousSessionFor`, or `walkingMinutes`. The
  geometry is shared with mail and ICS, and it is right.
- Do not compute a leave-by, a walk, or an entry allowance in the component.
- Do not replace the per-talk status heroes wholesale. Replacing them with one day plan
  was considered and deliberately deferred: it touches the participation
  confirm/decline actions and is a rewrite of the portal's most-seen surface. The strip
  sits above them.
- Do not add a theme switcher implementation.

## Validation

Drive it. Local dev needs `--var INSECURE_LOCAL_COOKIES:1` or WKWebView and Safari drop
the `Secure` session cookie on `http://` and every request 401s in the browser only,
while curl passes.

Find a seeded speaker with two accepted talks in different buildings and open their
portal — if the seed has none, that is itself a finding worth reporting, because it
means this whole path is inert in the demo. Then check: one talk, two talks same
building, two talks different buildings, two days, an unplaced session, and the seeded
double-booking. Screenshots of the strip at desktop and 375px in the PR.
