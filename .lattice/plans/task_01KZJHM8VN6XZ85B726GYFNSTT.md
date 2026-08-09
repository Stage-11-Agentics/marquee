# MRQ-16: Speaker portal

BUILDPLAN: M-15 — Wave 1 (§4), walkthrough step 6

Scope (verbatim): Status hero and concrete wave/slot; task list where acknowledge/form/file open and validate their actual payload surface; profile/headshot edit; organizer-controlled talk title/description edit + history; handbook pages (AC-233 cuttable if named). **Does not own AC-235/236** — it renders the decision-feedback slot that M-52 fills, and **role confirm/decline is M-42's** (AC-152–154, rank 23), not duplicated here in prose. Three tickets writing `src/ui/portal/*` against one AC is exactly the failure §7 exists to prevent, and an AC owned by everyone is owned by no one when `trace:ac` asks who covers it.

Ownership boundary (binding): this ticket renders slots; **M-52 owns AC-235/236 end to end** and **M-42 owns AC-152–154**. Do not claim their IDs in test names.
AC-233 (Speaker Handbook) is the one cut-line criterion sitting on a Tier A story — if cut, gate 19 must name it explicitly.

File surface: `src/routes/portal.routes.ts`, `src/ui/portal/*`

ACs: AC-43 – AC-52, **AC-237, AC-240**, AC-233 (cuttable if named)
Hours: 7
Workflow: sub-agent-full (≥7 h)
Shared files: `src/ui/portal/*` is written by M-15, M-42, and M-52 — **one file per concern**, and the AC ownership above is what keeps them from colliding.
Deps: M-13, M-11
Plan: filled in by delegator's plan phase
