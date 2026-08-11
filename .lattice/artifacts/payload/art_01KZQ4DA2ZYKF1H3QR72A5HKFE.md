# MRQ-4 validation evidence — live D1, re-run independently by the delegator (Opus)

Not a re-read of the implementer's report. Fresh throwaway D1 under scratch,
`migrations/0001_init.sql` applied, then `npm run seed -- --persist-to <tmp>`,
then queried back through `node:sqlite` with invariants written independently
of the implementer's test file.

seeded 374 rows — buildings=3 events=1 form_fields=3 formats=4 forms=2
organizations=1 participations=77 people=76 rooms=10 submission_decisions=60
submission_tracks=60 submissions=60 task_templates=6 tracks=8 waves=3

formats                     4
tracks                      8
buildings                   3
rooms                      10
rooms_orphaned              0
waves                       3
task_templates              6
people                     76
BAD_real_emails             0
BAD_headshots               0
submissions                60
subs_accepted              60
participations             77
BAD_subs_no_speaker         0
BAD_orphan_particip         0
BAD_dup_person_email        0
BAD_break_seeded            0

failed invariants: 0
PRAGMA foreign_key_check -> 0 violations

IDEMPOTENCY (the property MRQ-5 inherits): seed run a SECOND time against the
same populated database, row counts snapshotted across every populated table
and compared as whole objects ->
  IDEMPOTENT: identical row counts across every populated table

`BAD_break_seeded` is the regression guard for the inherited selector defect:
the pre-fix filter would have seeded "Workshop Afternoon Break" as an accepted
conference abstract. It reads 0.

GATE: `npm run pr-gate -- --ticket MRQ-4` -> pass, 5396 ms.
trace:ac merged scope: 197 live criteria, 0 uncovered, 0 errors, 0 warnings.
Default suite 2.55 s against a 30 s budget.