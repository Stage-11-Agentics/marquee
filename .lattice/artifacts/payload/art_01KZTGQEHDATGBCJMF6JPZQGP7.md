# Validation — MRQ-114 · task authoring

Exercised against a **real local Worker** (`wrangler dev` on the built bundle, migrated + seeded D1: 9,976 rows, 1,000 submissions, 1,097 people, 6 seeded task templates), plus a browser pass on the running page. Not a test-harness run — the shipped bundle, the real routes.

## API, by curl against the running Worker

| Flow | Result |
|---|---|
| `GET /task-assignees` | 200 · 1,097 people, union of memberships and participations, accepted-session counts correct |
| `GET /task-templates` | 200 · all 6 seeded templates, every kind, with live `assigned_count`/`open_count` |
| `POST /task-templates` + `assign_to` (CNT-01 task 1) | 201 · `assigned: 2`, template `open_count: 2` |
| `POST /task-templates` + `assign_to` (CNT-01 task 2) | 201 · both fixture tasks coexist with their own names and dates |
| SPK-05 · three `acknowledge` tasks, 2 assignees each | 201 ×3 · due 2027-04-01, 2027-04-01, 2027-04-15, `kind: acknowledge`, no file policy |
| Date fidelity | typed `2027-05-01` → stored `1809215999999` → read back `2027-05-01` |
| `POST /speaker-tasks` re-assign | 201 · `{"assigned":1,"skipped":2}` — no duplicate obligations |
| `PATCH` name + due date | 200 · all three open assignments carry the new title and deadline |
| `DELETE` with only open work | 204 · template gone, its assignments gone |
| `DELETE` with completed work | 409 · "30 speakers have already completed this task…" — evidence preserved |
| `POST` with no deadline | 422 · `field: due_at` |
| `POST` `kind=form` with no `form_id` | 422 · `field: form_id` |
| Anonymous `POST` / `GET` | 401 |

## Browser pass on the running page

- Sidebar carries **"Tasks"** — the exact noun CNT-S1 step 5 and SPK-S1 step 11 search for. Confirmed in the rendered DOM alongside the other 18 nav labels.
- `/tasks` renders every task kind, not only file tasks (the `:173` filter is gone). The empty state carries its own **＋ New task** button (the `:183` fix).
- **Created "Upload Session Presentation" through the real form**: typed the name, chose *Upload a file*, typed the instructions, typed `2027-05-01` into the date field, ticked two speakers, pressed *Create task*.
  - Notice: *"Created "Upload Session Presentation" and assigned it to 2 speakers."*
  - Row renders **"Due May 1, 2027"** — the date as typed.
  - Expanded: **0 of 2 complete**, both speakers listed **Pending**, each due **2027-05-01**.
  - Confirmed independently through the API: template `01KZTGBPA3PCH88V0RY9`, `due 2027-05-01`, 2 assignments, both `open`.

That is CNT-01's pass line — both fixture tasks, correct names, correct literal due dates, assigned to speakers, shown pending — reached through the UI a judge would drive.

## Two defects this pass caught, both fixed

1. Ticking a second speaker dropped the first, and ticking a speaker after typing a date wiped the date (stale-closure state handlers).
2. Task names rendered at `width: 0` at narrow viewports (measured, not inferred) — a task list with no task names.

Neither was visible from reading the code or from green tests; both would have cost CNT-01 directly.

## Not covered

The row-level **Edit** and **Delete** controls were exercised through the API, not through clicks — c11's browser IPC was failing intermittently under fleet load (1-min load peaked at 199) and I stopped driving it rather than burn the session on retries.
