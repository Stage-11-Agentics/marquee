# submissionNotes — the text the grader's harness injects into every scenario

The eval harness (`sbek`) passes a free-text `submissionNotes` field into every
scenario prompt. It is our only channel to the grading agent, it is read by a
machine, and a claim it cannot verify costs credibility on top of the wasted
turns. Everything below was verified against the deployed build
(`1f53732201aa`) on 2026-08-12. **Re-verify the seat list and URLs against the
live site immediately before submitting.**

---

## The notes (paste this)

> Marquee at https://marquee.stage11.dev is a populated instance of AI Engineer
> New York 2026 (Oct 12–14): ~1,000 submissions, a live review round, a built
> agenda, and a published public program.
>
> SIGN IN: https://marquee.stage11.dev/signin leads with three one-click demo
> seats, no password: "Enter as organizer" (full program workspace), "Enter as
> reviewer" (a track-scoped evaluation queue), "Enter as speaker" (an accepted
> speaker's portal with status, schedule, tasks, bio). The sign-in form below
> them opens the same seats for organizer@demo.com, reviewer@demo.com and
> speaker@demo.com — typed, no email round-trip. Sign out at /signin to switch
> seats.
>
> ORGANIZER surfaces (after entering as organizer): /dashboard (pipeline and
> wave planner), /submissions (the register, ~1,000 rows, server-side
> filters), /forms (CFP form builder), /evaluation (plans, rounds, scorecards,
> reviewer pools, results + CSV export), /agenda-builder (drag-and-drop; list,
> day, week, track, room views; live conflict warnings; publish gate),
> /onboarding (speaker × task chase board), /communications (templates and the
> outbox), /files (deliverables with versions), /settings (details, formats,
> tracks), /settings/api (scoped API tokens), /import (Sessionize CSV import).
>
> PUBLIC, no login: /f/cfp (the live CFP form — submissions work end to end,
> including headshot upload and saved drafts with resume links), /agenda
> (published program; day tabs; attendees can star sessions into a personal
> schedule), /speakers (directory), /api/docs and /api/openapi.json (the REST
> API the admin UI itself runs on; 195 operations).
>
> Mail is demo-safe by design: sends render and log in /communications but
> non-allowlisted addresses are never delivered, so bulk actions are safe to
> exercise. Decisions cascade — accepting queues the email, updates the
> portal, and offers calendar invites (ICS with update and cancel). The seeded
> program publishes sessions on Oct 12–13; Oct 14 is intentionally light.
> Counts drift slightly as test submissions arrive; that is expected.

---

## Rules this text follows (for whoever edits it)

1. Every URL above returns a real page on the deployed build — none of them is
   aspirational. If a deploy changes routes, walk them again.
2. It names no feature that is repo-only (`SKILL.md`, the CLI) — the harness
   drives a browser; repo artifacts waste its turns.
3. It does not claim multi-conference switching, webhooks delivery, or
   Airtable — the previous run's notes claimed unreachable things and the
   judge recorded the contradiction.
4. It tells the agent where the seats are *and* how to switch, because seat
   reachability is worth ~25 coverage points and unreached surfaces drag the
   score toward the 60% withholding cliff.
5. It pre-explains the two things an agent might misread as defects: demo-safe
   mail ("message not delivered" is honest, not broken) and the light third
   day.
