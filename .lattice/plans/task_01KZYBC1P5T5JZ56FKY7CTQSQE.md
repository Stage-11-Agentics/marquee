# MRQ-165: Import-roster bridge: CSV-imported speakers never join the conference roster; plus ABS-14 agent-native note

Verified bug (sbek round-4 SPK-03; live repro 2026-08-13 in a worktree at 122c17ca, local seeded Worker).

SYMPTOM — The /import speakers CSV wizard reports "created: 1" for a new person (fixture: Dana Kowalski). She then exists in the org-level People list but never appears on the conference roster (/roster): count unchanged, search empty. Repro artifact: person_import_fac454e2 with 0 memberships, 0 participations.

ROOT CAUSE — Roster membership is memberships(event, role='speaker') UNION participations-on-live-submissions (src/lib/roster-source.ts). runSessionizeImport (src/lib/sessionize-import.ts) inserts bare people rows; participations are created only from session rows; it never writes memberships. src/lib/speaker-membership.ts is the documented bridge (speakerMembershipStatement, idempotent via ON CONFLICT DO NOTHING) with exactly two callers today: organizer hand-add and the acceptance cascade. The import is a third place a person becomes a speaker of the conference and does not call the bridge. The bridge docstring names the four surfaces that break without the row: roster, speaker portal sign-in, onboarding lists, bulk-comms audiences. The roster page's own copy ("everyone who submitted, was accepted, was imported, or was added by hand") promises the behaviour the import does not deliver.

FIX SHAPE — Call speakerMembershipStatement in the import's speaker-reconciliation path, for created AND updated speaker rows (importing a speaker into this conference expresses intent that they speak here; the conflict clause absorbs existing rows). Undo: extend the import undo path so a membership the import itself created is removed on undo — and only such a membership (snapshot or attribute accordingly; undo already checks memberships before person deletion, so keep that ordering coherent).

ACCEPTANCE
1. A speakers-only CSV import (sessions_csv absent): each imported person appears on the conference roster (GET /api/v1/events/{eventId}/speakers) immediately after run, and the roster count reflects them.
2. Import undo removes exactly the memberships the import created — no more, no less; a pre-existing membership survives undo.
3. Re-running the same import is idempotent: no duplicate memberships (uq_memberships_event holds), rows report skipped/matched as today.
4. An import-created speaker can reach the speaker portal (the sign-in reader named in the bridge docstring) — at least one route-level test proves it.
5. Tests are red before the fix and green after; npm run pr-gate passes within budget.

GROUPED SECONDARY (docs, same PR) — Add the ABS-14 agent-native paragraph to sequence/submission/SUBMISSION-NOTES.md, inside the paste block after the demo-safe mail paragraph, obeying that file's own rules (machine-reader voice, every claim verifiable on the live build):

"Agent-assisted review is deliberately agent-native rather than bundled. On /evaluation, Add Agent evaluator creates an agent person, reviewer seat, committee membership, track scope, and a narrowly scoped credential in one transaction, and agent-produced scores render distinguishably as an asterisked value with an Agent score annotation. There is intentionally no in-app model generating first-pass scores or rationale: any agent, including you, reviews through the same credentialed surfaces and REST API humans use. A conference platform should host and mark machine judgement, not manufacture it."

Also update the "Rules this text follows" list if needed so rule 1 (every claim verified against the deployed build) stays true.

CONSTRAINTS — Work only in a linked worktree (the primary checkout at deployments/Marquee is the Lattice board home; never branch, edit, or clean there). Branch off github/main. PR via gh to Stage-11-Agentics/marquee base main. Do NOT deploy (deploys are owned elsewhere; merging does not ship). Do NOT touch the live site; NEVER click Reset demo. Full analysis context: .eval-kit-agent/CEILING.md in the primary checkout.

## Reset 2026-08-13 by agent:luna-mrq-165

## Reset 2026-08-13 by agent:luna-mrq-165
