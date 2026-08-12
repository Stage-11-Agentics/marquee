# MRQ-114: Task authoring: templates and assignment

CNT-01 (w3, the content area's entry point) + SPK-05 (w2); 16 of CNT's 31 item-weight flows downstream (CNT-02/04/05/07/08/13 evidence needs a created task). The acceptance cascade already mints tasks at runtime (jobs/cascade/decisions.ts:362) — this is AUTHORING + ad-hoc assignment, not a task engine. (1) Full CRUD on task_templates: POST/DELETE + PATCH beyond file_config (task-templates.routes.ts currently GET + file-config-PATCH only). Fields: name, kind acknowledge|file|form, description, due_at OR due_offset_days (CHECK makes them mutually exclusive — the eval wants literal dates like 2027-05-01, so the UI must expose due_at); kind=form requires form_id. (2) POST for direct speaker-task assignment: title, due date, MULTI-speaker select, bypassing auto_assign. (3) Fix TaskTemplatesPage: remove the file-kind-only filter (:173), give the empty state the control it instructs you to use (:183), sidebar/settings link (EventSettings links venues but not tasks). Full spec: section T-E. Register rows 24,25.

---

## Plan

Working against `github/main @ 23a06b0`. Worktree `../Marquee-worktrees/mrq-114-task-authoring`, branch `mrq-114-task-authoring`.

### What the graders actually require

| Rubric | Weight | Pass line (from the YAML — the rubric) |
|---|---|---|
| **CNT-01** | w3 | Both fixture tasks ("Upload Session Presentation" due **2027-05-01**, "Upload Final Headshot (print quality)" due **2027-04-14**) exist after creation with correct **names, due dates, and speaker assignment, shown as incomplete/pending**. Evidence: the filled creation form + a task/deliverables list showing both tasks with due dates and assignees. |
| **SPK-05** | w2 | Task creation supports **title, due date, and assignment to at least two speakers**. Three fixture general tasks ("Confirm participation" 2027-04-01, "Complete bio and profile" 2027-04-01, "Sign speaker release form" 2027-04-15) appear in an organizer task list with due dates and assignees. Explicitly: **no file-request type required here** — plain mark-complete tasks. |

Scenario steps that shape the UI: CNT-S1 step 5 ("find the content/file-collection settings — may be called Files, Content, Deliverables, Tasks, or Speaker Tasks"), step 6/7 (create both file tasks), step 8 ("open the deliverables/task tracking dashboard … verify both tasks appear **for both speakers** with due dates and an incomplete/pending status"). SPK-S1 step 11 (three general tasks, each assigned to BOTH speakers, "use multi-select or bulk assignment if offered").

### The load-bearing decision: the page carries its own task list

`GET /onboarding` — the existing chase board — is **memberships-derived** (`onboarding.queries.ts:395` joins `memberships … role='speaker'`) and **drops speakers who owe nothing** (`:299-300`). Register row 24n confirms runtime-created speakers get no membership row. So a task I assign to a speaker the judge just created can be invisible on the only existing "task dashboard". CNT-01's whole w3 rides on the list showing both tasks × both speakers.

Therefore the task page renders its own assignment list from `speaker_tasks` directly, joined to `people` — no memberships dependency. That is also the honest product answer: the screen where you author tasks is the screen where you see who owes them.

Same reasoning drives the assignee picker: assignable people = **union** of `memberships(role='speaker')` and `participations(role IN speaker, submitter)` on this event's submissions. Either door a speaker entered by, they are pickable.

### Cross-ticket collisions (SECTION 4 file-ownership rules)

- `task-templates.routes.ts` — **T-E owns it outright.** No other ticket lists it.
- `TaskTemplatesPage.tsx` — T-E owns it (named in the ticket).
- `route-table.ts` — rule 6: "touched by Z, D1, F1, K, N — trivial conflicts, rebase freely." I add one row and relabel one; rebase freely.
- `EventSettings.tsx` — not claimed by any other ticket in section 4.
- **No new `/people` or `/speakers` endpoint.** T-D1 owns speaker roster + person CRUD. My assignee list lives at `/events/{id}/task-assignees` inside my own route module so the two cannot collide.
- `onboarding.routes.ts` — T-E "owns the new assignment route" per the ticket. **Deviation, flagged:** I put `POST /speaker-tasks` in `task-templates.routes.ts` instead. Reason: the assignment endpoint is coupled to templates (`speaker_tasks.template_id` is `NOT NULL`, so every assignment resolves a template), shares its validation helpers, and lands in the file I already own outright — while `onboarding.routes.ts` is read-only projection code with a different concern. Zero behavioural difference; strictly less collision surface. Left `onboarding.routes.ts` untouched.

### Schema facts I must respect (no migration — none needed)

`task_templates` (`0001_init.sql:578`):
- `CHECK ((due_at IS NULL) <> (due_offset_days IS NULL))` — **exactly one**, never both, never neither.
- `CHECK (due_offset_days IS NULL OR due_offset_days >= 0)`, `CHECK (position >= 0)`, `CHECK (kind <> 'form' OR form_id IS NOT NULL)`.
- `file_config` must be valid JSON or NULL.

`speaker_tasks` (`:598`): `due_at INTEGER NOT NULL`, `template_id NOT NULL REFERENCES task_templates(id)`, `submission_id` **nullable** (so an ad-hoc task needs no session), `status IN ('open','done')`, `cancelled_at` (added 0004).

Date convention: epoch-ms on the wire everywhere else in this codebase (`FormsPage.tsx:330`, `SubmissionRecordPage.tsx:168`). A due date is a **day**, not an instant, so I store **23:59:59.999 UTC of that date** and format with UTC accessors. That round-trips `2027-05-01` → epoch → `2027-05-01` in every browser timezone (a local-midnight parse would show `2027-04-30` west of Greenwich and fail the screenshot), and it means "due by end of that day" rather than "due at the stroke of midnight that morning". One shared helper, `src/lib/task-due.ts`, used by both the route and the page.

### API — all in `src/routes/task-templates.routes.ts`

1. **`POST /api/v1/events/{eventId}/task-templates`** → 201. Body `{ name, kind, description?, due_at? | due_offset_days?, form_id?, file_config?, auto_assign?, assign_to?: string[] }`.
   - Zod refinement enforces the mutual exclusion **before** SQLite does, so the operator gets a 422 with a field, not a 500 from a CHECK.
   - `kind='form'` ⇒ `form_id` required **and verified to belong to this event** (a cross-event form id would otherwise pass the FK and leak a form across the scoping boundary).
   - `kind!=='file'` ⇒ `file_config` must be absent/null (an accept-list on an acknowledge task is a lie the portal would render).
   - `position` = `MAX(position)+1`.
   - `assign_to` non-empty ⇒ the template row **and** one `speaker_tasks` row per person land in one `batch()` with their audit rows. One user action, one atomic write. This is what makes CNT-01 reachable in ~2 turns instead of ~6.
2. **`PATCH .../{templateId}`** — every field optional: `name`, `description`, `due_at`/`due_offset_days`, `form_id`, `auto_assign`, `file_config`. The existing file-config-only body keeps working unchanged (MRQ-96's tests must stay green). `kind` is **immutable once any `speaker_tasks` row references the template** — 409 with the count; changing an acknowledge task into a file task under speakers who already completed it silently invalidates their evidence.
3. **`DELETE .../{templateId}`** → 204. Deletes the template and its **open, uncancelled** tasks in one batch. **409 if any referencing task is `done`** — those rows carry completion evidence (and possibly an `attachment_id`); deleting them is data loss wearing a tidy-up costume. The error names the count and tells the operator what to do.
4. **`POST /api/v1/events/{eventId}/speaker-tasks`** → 201. Body `{ template_id, person_ids: [1..200], due_at?, submission_id? }`. Assigns an existing template to N more people, bypassing `auto_assign` entirely. Skips people who already hold an **open** task for that template and reports `{ assigned, skipped }` — re-assigning must not mint duplicates, and must not silently pretend it did nothing.
5. **`GET /api/v1/events/{eventId}/speaker-tasks`** → the assignment list: task id, template id, title, kind, due_at, status, cancelled, person `{id, name, email}`, session title. Ordered by due date then name.
6. **`GET /api/v1/events/{eventId}/task-assignees`** → the picker's people: union described above, with each person's accepted-session count. Read-only, `program:read`.

`listTaskTemplates` (existing GET) grows the fields the editor needs: `due_at`, `due_offset_days`, `form_id`, `auto_assign`, plus derived `assigned_count` / `open_count`. Additive only — the response schema stays backward-compatible.

Every mutation writes an audit row through `auditStatement` composed into the same `batch()` as the write (cross-cutting fact 6), actions `task_template.created|updated|deleted` and `speaker_task.assigned`.

### UI — `src/ui/settings/TaskTemplatesPage.tsx`

The page becomes **Tasks**, an organizer area rather than a file-policy panel.

- **Header + "＋ New task" button.** The create form is **inline, not a modal** (cross-cutting fact 2: turn budget), and **auto-expanded when no templates exist** — so the empty state and the control it instructs you to use are the same thing (fixes `:183`).
- **Create form fields:** Task name · Task type (segmented: *Mark complete* / *Upload a file* / *Fill a form*, **fixed-width buttons**) · Instructions (textarea) · Due date — a `type="date"` input, the literal `2027-05-01` the eval types — with a *Fixed date* / *Days after acceptance* toggle exposing `due_offset_days` · **Assign to** (checkbox list of assignable speakers, name + email, with *Select all* / *Clear*, live "N selected" count) · file policy when kind=file · form picker when kind=form.
- **Task list — all kinds** (deletes the `:173` file-only filter). Each row: name, kind badge, due date, `N of M complete` in tabular numerals, and an expander showing every assignment (speaker · due · **Pending/Complete**). Per-row: *Assign to speakers* (the same multi-select, calling endpoint 4), *Edit*, *Delete*. File rows keep the existing accept/size editor intact.
- **Elements never jump** (house rule): fixed-width segment buttons, `min-height` on the notice/error slot, reserved space for the assignment counts, tabular numerals on every count and date, and `—` rather than a removed row for an empty assignment list.
- Save/error handling reuses `apiFetch` + `errorSummary`; field-level 422s surface next to the field, not as a blanket sentence.

### Discoverability (cross-cutting fact 2 — the exact nouns)

- `route-table.ts`: new row `{ id: "tasks", path: "/tasks", label: "Tasks", group: "modules", sidebar: true }` — the sidebar noun the specs enumerate, sitting with Forms / Evaluation / Agenda / Communications. `/settings/tasks` stays as a working alias (utility, non-sidebar) so no existing link breaks. `app.all("*")` serves the SPA shell for any path (`index.ts:163`), so `/tasks` needs no server route.
- `AppShell.tsx`: mount `TaskTemplatesPage` for both route ids.
- `EventSettings.tsx`: a "Speaker tasks" link card beside the Venues card, with the live template count → *Open Tasks →*.

### Tests

- `tests/integration/api/task-authoring.MRQ-114.test.ts` — create (fixed date **and** offset), the mutual-exclusion 422, `kind=form` without `form_id`, cross-event `form_id` rejection, `file_config` on a non-file kind, create-with-`assign_to` (rows land, due dates exact), PATCH name/due/auto_assign, PATCH kind blocked when assigned, DELETE cascading open tasks, DELETE 409 on a completed task, assign to two speakers, duplicate-assign skip, both GETs, and 401/403 for an unauthorized caller.
- `tests/unit/task-due.MRQ-114.test.ts` — the date helper round-trips `2027-05-01` under several `TZ` values.
- `tests/node/task-authoring-ui.MRQ-114.test.mjs` — following `task-templates-ui.MRQ-96.test.mjs`: asserts the file-only filter is gone, the empty state carries a create control, and the fixed-width/tabular-numeral stability rules hold.
- Existing `task-templates.MRQ-96.test.ts` and `task-cancellation.AC-264-267.test.mjs` must stay green — targeted vitest only (fleet load rule; **never** full `npm test`).

No AC IDs exist for this ticket (eval-response tickets carry rubric IDs, not minted ACs), so test names cite `MRQ-114` and the rubric IDs `CNT-01` / `SPK-05`.

### Traps I am deliberately avoiding

1. **Cross-cutting fact 3** — never ship the discovery affordance without the flow. The sidebar "Tasks" entry lands in the *same* commit as working create + assign + list. A findable page that cannot create a task converts a `cannot_judge` into a `fail`.
2. **Fact 4 (manual half)** — the list reads real `speaker_tasks` rows. No optimistic client-only row that survives until reload.
3. The **CHECK constraint** is validated in Zod first; a raw D1 CHECK violation would surface as a 500.
4. **`due_at` vs `due_offset_days`**: the UI defaults to a fixed date because that is what the eval types, but the offset mode stays reachable — it is the better product for a recurring conference, and the cascade already computes it (`decisions.ts:~316`).
5. **DELETE must not eat evidence** — 409 over completed tasks.
6. **Timezone**: end-of-day UTC + UTC formatting, or the screenshot shows the wrong date west of Greenwich.

### Sequence

1. Commit + push this plan (first commit, before any code).
2. `src/lib/task-due.ts` + its unit test.
3. Routes + integration tests.
4. UI + nav + settings link + node UI test.
5. Targeted vitest; `npm run pr-gate -- --ticket MRQ-114` (check `uptime` first — load was **199** at session start; wait for < 24).
6. Validation: `vite dev` + curl the endpoints, c11 browser through the real create → assign → list flow with the actual fixture names and dates.
7. Single headless reviewer over the diff (`timeout 600`), triage, attach, then PR.

---

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Self-review, inline (COMMON.md inline-full: self-review the plan or spawn one reviewer). Six findings; all accepted.

1. **Two assignment code paths.** `POST /task-templates` with `assign_to` and `POST /speaker-tasks` would each build `speaker_tasks` rows. **Resolution:** one non-exported helper, `assignmentStatements(db, template, personIds, now, actor, requestId)`, returns the statements both routes compose into their own `batch()`. One place computes `due_at`, one place skips duplicates.

2. **`task-assignees` must not filter to accepted submissions.** The draft plan implied accepted-only. A speaker whose session is still in review is a real speaker an organizer needs to chase. **Resolution:** union of `memberships(role='speaker')` with `participations(role IN ('speaker','submitter'))` over **all** of the event's submissions. The per-person session count reports accepted sessions specifically, labelled as such.

3. **A changed due date must reach the people who owe the task.** `speaker_tasks` copies `title`/`description`/`due_at` at assignment time. Silently leaving them stale means the organizer moves a deadline and every speaker portal still shows the old one — exactly the "control that lies" failure mode fact 4 warns about. **Resolution:** PATCH propagates changed `name → title`, `description`, and resolved `due_at` to that template's **open, uncancelled** tasks, in the same `batch()`. Completed tasks keep their historical values — they are evidence of what was asked at the time. The response returns `propagated_count`; the UI states "Updated N open assignments."

4. **Deleting a template with completed work.** Confirmed as planned: 409 naming the count. Additionally the DELETE must remove `cancelled` open rows too, not just uncancelled ones, or the template row cannot be removed while a cancelled child still references it. **Resolution:** delete every referencing task whose `status = 'open'` (cancelled or not); refuse only on `status = 'done'`.

5. **`position` on create.** `MAX(position)+1` read-then-write races under concurrent creates. `position` has no UNIQUE constraint and the list orders by `position, id`, so a tie is cosmetically stable. **Resolution:** accepted as-is; no locking.

6. **Response-shape compatibility.** MRQ-96's integration test asserts the existing GET/PATCH shapes. **Resolution:** all new fields are additive and all new PATCH body fields optional; the MRQ-96 suite runs unchanged as the compatibility gate, not a rewritten copy of it.

---

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

Lattice auto-fired plan review (`art_01KZTDNCRM5G5NGMYNEMF59Q8P`) — verdict **PASS**, five MINOR findings. All five triaged; two required code changes.

1. **Offset anchor for ad-hoc assignment was undefined.** *Already resolved as recommended:* `resolveTaskDueAt` (src/lib/task-due.ts) defines it as `now + offset_days`, documented at the helper, and it is the single path both assignment doors take. No change.

2. **Offset-mode propagation had no per-row anchor.** *Real gap, fixed.* PATCH previously recomputed `now + offset` for every open row, which meant editing a task's wording silently handed every speaker a fresh extension. Now: a fixed date writes the same literal to every open row; an offset recomputes against **each row's own `created_at`** — the anchor that row was actually assigned on. Covered by "editing an offset task recomputes each deadline from that assignment, not from the edit".

3. **PATCH merged-state CHECK validation.** *Already correct:* setting one deadline mode nulls the other, both in one body is a 422, and `assertDeadline` runs on the merged values before the write. Added the missing regression test ("switching deadline mode clears the other column instead of tripping the CHECK") rather than changing behaviour.

4. **End-of-day UTC renders as the next day on surfaces that format locally.** *Real cross-surface lie, fixed.* Confirmed by grep: `PortalPage.tsx:162` and `OnboardingPage.tsx:65` both format with the browser's local zone, so a Berlin speaker would read "May 2" for the deadline the organizer typed as May 1. Rather than move the stored instant (any instant renders as two different calendar days somewhere), the three task-due-date call sites now share `formatDueDate` from `src/lib/task-due.ts`. Three one-line changes, no behavioural change to any other date on those pages. Locked by a node test that fails if a due date goes back to the local formatter.

5. **Ticket says "title", endpoint takes `template_id`.** *No code change* — `speaker_tasks.template_id` is `NOT NULL`, so a titled ad-hoc task without a template is impossible without a migration the ticket does not authorize. Create-with-`assign_to` makes it one atomic action from the operator's side. Carried into the PR body as a named deviation.

## Code review: fell back to self-review

The auto-fired code review (`lattice code-review`, single mode) **timed out after 600s** under fleet load (1-min load average 199 at the time). Per COMMON.md's timebox rule the fallback is a self-review, recorded below and attached with `--role review`.
