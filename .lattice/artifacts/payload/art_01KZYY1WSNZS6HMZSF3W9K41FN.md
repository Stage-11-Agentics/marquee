# Code Review: MRQ-185 — PR #212 (`mrq-185` @ 086e8ad0)

## 1. Verdict

**PASS**

## 2. Summary

Reviewed the four-commit branch replacing the bare em-dash speaker fallback with a shared
"Speaker to be announced" empty state on the public agenda card, public session detail, both
embed layouts, and the publish review row. The implementation is correct, small, and respects
every guardrail the ticket set: `SPEAKING_PARTICIPATION_ROLES` and the public/program audience
split are untouched, and I independently verified the full acceptance loop — both new tests
fail against the base sources (`8a504bfc~1`) and pass on the branch, `tsc --noEmit` is clean,
and the production data flow actually carries the `role` field the new review-row logic depends
on. No blocking issues; three minor observations below.

## 3. Issues

**[MINOR] src/ui/agenda/AgendaPage.tsx:203-209 — The publish review row no longer names the attached person**

`publicationSpeakerLine` replaces the *entire* name list with `Speaker to be announced` when no
participant is on stage, so the organizer reviewing publication can no longer see that Marcus
Okafor (submitter) is attached — the builder tile still shows him, but the review row hides him.
This matches the implementer plan and makes the review row an honest preview of the public
output, so I am not blocking on it; but it sits in tension with the design note in
`participants.ts:16-18` ("a record with only a submitter must not read as a session with nobody
on it" — program surfaces keep everyone), and the ticket asked to *flag* the condition, which
could have been done alongside the name rather than instead of it.
**Fix:** None required now. If organizers ask "who submitted this?" from the review list, append
the label to the program list rather than replacing it (e.g. "Speaker to be announced — submitted
by Marcus Okafor"). Worth a line on the ticket so the choice is recorded as deliberate.

**[MINOR] src/ui/agenda/AgendaPage.tsx:203-209 — Zero-participant candidates silently changed copy**

A candidate with an *empty* `speakers` array previously rendered "No speakers listed" and now
renders `Speaker to be announced` (`some()` on an empty array is false). That is a behavior
change beyond the ticket's strict scope (the ticket is about submitter-only sessions), though the
new copy is arguably more honest and consistent. Note the sibling `speakerLine` at
`AgendaPage.tsx:188` still says "No speakers listed" for builder tiles, so the two organizer
surfaces now use different vocabulary for the same absence.
**Fix:** None required — acceptable as shipped. If copy consistency matters later, unify the two
helpers.

**[MINOR] src/ui/public/agenda/PublicAgendaPage.tsx:949 — Session detail empty state has no test**

The `PublicSessionPage` change (`<span>—</span>` → `<PublicSpeakerEmpty />`) is not covered: the
integration test asserts the agenda card and the embed but never requests
`/s/<slug>` for the submitter-only session. The path is one line and shares the component, so
risk is low.
**Fix:** Add one request + assertion for the session detail page to the existing MRQ-185
integration test (the fixture already exists).

## 4. Positive Observations

- **The guardrail held.** The tempting wrong fix — widening `SPEAKING_PARTICIPATION_ROLES` or
  reading audience `program` on public surfaces — was explicitly avoided; `participants.ts` gains
  only a label constant. The public/program split is byte-identical to base.
- **The embed config preview is covered by construction, not duplication.** I traced
  `/embed/config`: its live preview is an iframe whose `src` is the real embed endpoint
  (`embed.route.tsx:119/143` renders `EmbedPage`), so fixing the one renderer fixes the preview —
  exactly the "one renderer, not two" the ticket demanded.
- **The review-row logic is wired to real data.** `SPEAKERS_JSON` (`agenda.queries.ts:371-381`)
  projects `participation.role` at audience `program` into the publish-candidate query
  (`agenda.queries.ts:513`), so `speaker.role` is populated in production, not just in the
  hand-built test fixture. And the `role === undefined` fallback fails conservative: an untyped
  payload renders names as before rather than falsely announcing an absence.
- **The regression test is genuinely adversarial.** It seeds the judge's exact scenario (Marcus
  Okafor, submitter-only, published), then *queries the participations table directly* to prove
  the fixture is what it claims before asserting the render — so the test can't rot into passing
  on a mis-seeded fixture. Verified A/B myself: both new tests fail on base sources and pass on
  the branch.
- **Geometry was respected.** `.public-speakers` already reserved 20px; the new span pins
  `min-height`/`line-height` to match, and the embed gains `.embed-speaker-credits { min-height: 15px }`
  — cards don't jump between named-speaker and announced-absence states (Elements Never Jump).
- Hygiene: gate run was serialized through the fleet lock, result `pass-over-budget` (a warn per
  fleet rules, not a red); `tsc --noEmit` clean; no migration; no deploy; escaped-HTML assertion
  (`&amp;`) in the test shows care about what the wire actually carries.
