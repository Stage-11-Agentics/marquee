# MRQ-142: Conference dates and session dates can diverge silently, publishing day tabs that match nothing

POST-DEADLINE. Operator ruling 2026-08-12: file, do not work tonight.

SURFACE: /agenda (public day tabs) and /agenda-builder (day selector + grid).

WHAT BREAKS: Day navigation is derived from the conference date window while session data lives in its own window, and the app neither reconciles the two nor warns. During the evaluation the public agenda advertised day tabs 'Wed, May 12 / Thu, May 13 / Fri, May 14' while every session card underneath was dated 'MON, OCT 12' -- so all three day tabs matched zero sessions and ?day=1 and ?day=2 both showed 'No published sessions match', while the All-days view of the same page listed seven sessions. The same divergence emptied the organizer's builder grid: with the DAY selector on 'Wed - May 12', every time x room cell rendered blank though 25 sessions were scheduled.

HONESTY ABOUT PROVENANCE -- THIS WAS SELF-INFLICTED: the evaluation renamed and redated the conference to a fixture, which is what pushed the two windows apart. It is NOT currently reproducible. Verified on live 75b871d94c6f after the demo reset: GET /api/v1/public/agenda returns startsOn 2026-10-12 / endsOn 2026-10-14 with days [Mon Oct 12, Tue Oct 13, Wed Oct 14], and /agenda renders Oct 12/13/14 -- tabs and sessions agree. No judge can hit this without redating the conference themselves.

WHY IT IS STILL A REAL DEFECT: the trigger was artificial, the weakness is not. The product allowed the two windows to diverge, said nothing, and then published day-by-day navigation to attendees that resolved to nothing. An organizer who moves a real conference's dates -- an ordinary thing to do -- silently ships a blank agenda on every day.

FIX SHAPE: on a conference date change, either reconcile scheduled sessions into the new window or refuse silence -- name how many sessions now fall outside it, on the settings surface that made the change and on the builder. A day tab that matches no sessions should say why rather than render an empty programme.

SIZE: medium.

PROVENANCE: sbek run 2026-08-12T15-33-34, ai-agenda judgement defects[0] and public-widgets judgement defects[0].

## Current implementation plan

The operator cleared this ticket on 2026-08-14. The accepted behavior is to keep every day in the
conference date window, label days with no published or scheduled sessions, and surface the count
of sessions outside the window after a date change on both settings and the agenda builder.

1. Trace the public agenda, agenda-builder, and conference-date update paths to identify the shared
   date/session-window seam and reproduce the defect with a fixture that has one populated day and
   one empty conference day.
2. Implement one canonical divergence calculation and use it for the public empty-day state, the
   builder day state, and the organizer-facing outside-window warning. Preserve stable geometry for
   populated and empty day views; do not add a migration or deploy.
3. Add regression coverage whose test names begin with `CONTRACT` or `AC-`, covering paired public
   populated/empty days, the builder, and date changes with out-of-window session counts.
4. Run focused tests, `npm test`, and the gated `npm run pr-gate`; push before verification. Record
   the root cause, exact commands, and PR on MRQ-142, then leave the ticket at `pr_open` for the
   coordinator and merge warden.
