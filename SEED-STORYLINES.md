# Seed storylines

The demo seed is deliberately awkward in a few places so the organizer's
walkthrough can reach conflicts, edge-case layouts, and otherwise easy-to-miss
workflow states. Those records are not mistakes to “clean up.” This register is
the explanation that travels with the seed, and the `// STORYLINE:` comments at
the producers point here from the code.

> anything deliberately broken gets a storyline entry, otherwise the next agent fixes it.

Line references below describe this revision. If a future edit moves one of the
anchors, update the register and its nearby `STORYLINE` comment in the same
change.

## Day-one conflict placements

Source anchors:

- `scripts/seed/agenda.ts:29-37` — `DAY_ONE_PLACEMENTS` puts two pairs at the
  same times: 13:00 in Sheraton's Metropolitan Ballroom and Marriott's Marquis
  Room A, then 14:00 in Sheraton's New York Ballroom and Expo Stage.
- `scripts/seed/agenda.ts:77-103` — `addConflictParticipation` reuses the
  source submission's lead speaker as a confirmed moderator on the target
  submission.
- `scripts/seed/agenda.ts:241-246` — the two keyed calls connect the placements
  to the two intentional person-conflict pairs.

Why they exist:

1. `agenda.day-one.transit-person` is the 13:00 pair. The reused speaker is in
   two buildings at once, so the generated agenda has a live Transit conflict
   and a person conflict. The rooms remain distinct, so this is not a room
   double-booking.
2. `agenda.day-one.same-building-person` is the 14:00 pair. It keeps a second
   person conflict visible inside Sheraton, independent of the cross-building
   case. It proves the conflict surface is not only a map/geography fixture.

Owning guards:

- `scripts/checks/check-seed.mjs:39-68` asserts a live Transit conflict and no
  room overlap; its local API phase also checks the visible person-conflict
  count in `scripts/checks/seed.ts:201-211`.
- `tests/node/venue-transit.test.mjs:10-41` asserts the generated Transit
  details, and `tests/node/seed-pool.AC-3.test.mjs:168-178` asserts at least two
  generated person conflict pairs.

Staging recipe: change only the placement literals or the two conflict keys,
then run the two node tests above and `npm run check:seed`. Keep the 13:00 pair
cross-building, the 14:00 pair same-building, and every room unique at a given
time. If a new deliberate conflict is added, give it a named entry and a keyed
comment before changing the guard expectations.

## Edge-case people

Source anchors:

- `scripts/seed/ugliness.ts:13-20` — `EDGE_PEOPLE` contains Casey O'Connell-
  Singh, Mei-Ling de la Fontaine, Aïcha Ndiaye-Kovács, and Łukasz Żółć-
  Wiśniewski.
- `scripts/seed/ugliness.ts:66-74` — Casey appears on three synthetic pool
  submissions; the other three names form a four-person panel with the pool's
  lead speaker.

Why they exist: long hyphenated names, non-ASCII characters, initials avatars,
and a high-cardinality panel are layout and data-shape fixtures. They ensure
that truncation, sorting, identity allocation, and the speaker task surfaces
are exercised with names that are awkward on purpose. Their company and bio are
synthetic; none is a source-program identity.

Owning guard: `tests/node/seed-pool.AC-3.test.mjs:148-179` checks the named
people, non-ASCII coverage, long title, Casey's three submissions, a four-person
panel, overdue tasks, and the two generated conflict pairs. The generated seed
also remains covered by `npm run check:seed`.

Staging recipe: edit the `EDGE_PEOPLE` tuple only when the desired edge case is
still represented; rebuild with `buildSeedRows()` through the targeted node
test, then run `npm run check:seed`. If a name or key changes, update the
relationship literals and test expectation together. Do not replace these
records with real contact data.

## Filter reachability fixtures

Source anchor: `scripts/seed/pool.ts:218-230`, specifically the two boundary
branches in `poolStatus()`:

- index `IN_REVIEW_COUNT - 1` is the lone synthetic `submitted` row;
- index `IN_REVIEW_COUNT + REJECTED_COUNT - 1` is the lone synthetic
  `withdrawn` row.

Why they exist: the 1,000-row synthetic pool otherwise has enough scale to make
both organizer filters easy to miss. One row must remain in each status so the
Submitted and Withdrawn paths are reachable without changing the accepted core
or inventing a real speaker's submission.

Owning guards:

- `tests/node/seed-pipeline-coverage.MRQ-100.test.mjs:18-35` checks that both
  statuses exist, are public CFP rows, and carry realistic titles.
- `npm run check:seed` checks the resulting API status counts and the full seed
  reachability.

Staging recipe: change the two boundary literals only if the status distribution
must change, then run the targeted node test and `npm run check:seed`. Preserve
one row of each status and the synthetic `external_ref`; otherwise the next
agent may mistake a missing filter state for a UI defect.

## Shipped demo-login speaker

Source anchors:

- `src/lib/reset-demo/demo-fixture.ts:15-19` —
  `SHIPPED_DEMO_SPEAKER_PERSON_ID` is the generated ID for the first named
  accepted-core speaker, Aarush Selvan.
- `src/lib/auth/demo-seat.ts:64-68` — the speaker demo seat prefers this ID,
  so a fixture mismatch makes the speaker sign-in path fall through to the
  legacy fixture or return no persona.
- `tests/node/seed-demo-login.MRQ-251.test.mjs:13-28` — the behavioral guard
  resolves the ID against generated `people` rows and the speaker membership
  for the shipped event.

Why it exists: the full reset seed and the demo-login persona preference must
name the same person. The ID is derived from the seeded name in
`scripts/seed/accepted-core.ts`; renaming that source record silently changes
the generated ID unless this fixture is updated. **DO NOT RENAME the source
speaker casually.** If the public source spelling genuinely needs to change,
update the fixture and this guard in the same change, then prove the demo seat
still resolves.

Owning guard: `tests/node/seed-demo-login.MRQ-251.test.mjs` is the direct
generated-seed relationship guard. It is intentionally behavioral: it imports
the fixture constant, builds the seed, and checks the resulting rows rather than
matching source text. The real auth path remains covered by the demo-seat
resolver and the normal integration suite.

Staging recipe: for a deliberate rename, change the source speaker name in the
captured accepted-core payload, run the MRQ-251 node test and observe its
relationship-specific failure, then update the fixture ID and rerun until it
passes. Run the targeted seed guard set and `npm run check:seed` afterward. A
temporary rename is the required mutation proof for this ticket; the mutation
itself must never be committed.

## Count and future changes

`SEED-DATA.md:86-94` records the generated agenda as **26 scheduled sessions
plus one break**. The existing seed guard separately counts 24 non-sponsor
scheduled sessions; those are not contradictory numbers because the generated
agenda also contains two sponsor Sessions.

This document does not authorize a hand-editable JSON loader or a second
conference seed. If a future collaborator needs one, that is a separate design
decision and ticket. Until then, keep the deterministic modules, generated SQL,
and reset path as they are; add a storyline entry before deliberately changing
an awkward record.
