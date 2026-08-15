# MRQ-214 code review — sponsor portal + sponsors data layer

Reviewed: `git diff github/main...HEAD` (52 files). Verified against the running
code, not just the diff, for every finding below.

## BLOCKING

### 1. Event deletion (including the demo reset) will 500 the moment sponsor data exists

**File:** `src/lib/events/delete-event.ts` (not touched by this diff — confirmed
via `git diff github/main...HEAD -- src/lib/events/delete-event.ts`, empty).

`deleteEventCascade` hand-enumerates "each event-owned table" for a `db.batch()`
transaction, and it was never taught about the four tables this migration adds.
Concretely, in the order they run:

- `DELETE FROM buildings WHERE event_id IN (...)` (line 242) — `sponsorships.booth_building_id`
  references `buildings(id, event_id)` (migration `0023_sponsors.sql` line 65),
  and no sponsorship row is ever deleted first.
- `DELETE FROM people WHERE id IN (demo people)` (line 292, `removeDemoPeople`
  path) — `sponsorship_contacts.person_id REFERENCES people(id)` (0023:71), and
  no `sponsorship_contacts` row is ever deleted.
- `DELETE FROM events WHERE id IN (...)` (line 319) — `sponsorships.event_id`
  and `sponsor_tiers.event_id` both reference `events(id)` (0023:49, 34), and
  neither table is ever touched.

None of `companies`, `sponsor_tiers`, `sponsorships`, or `sponsorship_contacts`
appear anywhere in `delete-event.ts` (`grep -in "sponsor\|companies\b"` returns
nothing). This repo enforces foreign keys for real — `migrations/0018_event_deletion.sql`
sets `PRAGMA defer_foreign_keys = ON` specifically to make a similar cascade
possible, and the entire multi-hundred-line ordering in `delete-event.ts` exists
*because* FK violations abort the batch.

This is not a hypothetical: `scripts/seed/sponsors.ts` imports `EVENT_ID` from
`./event.ts` and seeds companies, two sponsorships, tiers, and contacts onto
**that same demo event** (lines 27, 131, 475, 539, 553, 607…). `src/lib/reset-demo/remove-demo.ts`
selects `events WHERE demo_mode = 1` and calls `deleteEventCascade(..., {
removeDemoPeople: true, ... })` on exactly that event. So `removeDemoData()` —
and the general `DELETE /api/v1/events/{eventId}` path for any organizer event
that has taken on a sponsor — now fails with `FOREIGN KEY constraint failed`
inside the batch, and the event cannot be deleted at all.

**Fix:** add `sponsorship_contacts`, `sponsorships`, and `sponsor_tiers` deletes
to `delete-event.ts`, scoped and ordered ahead of `buildings`, `people`
(demo path), and `events` — matching the domain doctrine already in the
migration's own comment (companies are org-level and should very likely
*survive* an event delete; sponsorships/tiers/contacts are event-scoped and
must not). `tests/node/conference-delete.MRQ-204.test.mjs` is source-regex only
and would not have caught this; there's no integration test that deletes an
event holding sponsor data.

### 2. Cross-organization PII leak: a sponsor can be shown a stranger's name and email from another org

**File:** `src/routes/sponsor-portal.routes.ts:209-227`, `organizerContactFor`.

```sql
SELECT person.id, person.name, person.email, membership.role
FROM memberships membership
JOIN people person ON person.id = membership.person_id
WHERE (membership.event_id = ? OR membership.event_id IS NULL)
  AND membership.role IN ('program_lead', 'owner', 'ops')
ORDER BY CASE membership.role
    WHEN 'program_lead' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END,
  person.name COLLATE NOCASE ASC, person.id ASC
LIMIT 1
```

This is bound with only `eventId` — there is no `org_id` predicate anywhere,
even though `memberships.org_id` is a real, `NOT NULL` column that every other
membership-scoped query in this same diff uses (e.g. `requireProfileSession` in
`portal.routes.ts:278-287` filters `WHERE org_id = ? AND person_id = ? ...`).
An org-wide membership row (`event_id IS NULL`, used elsewhere in the codebase
for org-scoped roles like `owner`) in **any organization** with a role in
`('program_lead', 'owner', 'ops')` is an eligible candidate here, and the
`ORDER BY` does not prefer "this event's own staff" over "a same-named row
from an unrelated org" — it sorts purely by role rank then name. A lexically
earlier name from a completely different Marquee customer can outrank this
event's real organizer contact.

**Failure scenario:** Organization B has any person with an org-wide
`program_lead`/`owner`/`ops` membership (`event_id IS NULL`). A sponsor contact
signed in to Organization A's sponsor portal calls `GET /api/v1/me/sponsor-portal`.
If that Organization B person's name sorts before Organization A's real staff
(or if Organization A's event genuinely has none), the response's
`sponsorship.organizer_contact` — and the "email your organizer contact" line
in the handbook FAQ chapter (`src/lib/sponsors/handbook.ts:61-64`) — leaks a
stranger's name and email address across tenants.

**Fix:** join `person.org_id = ?` (or `membership.org_id = ?`) bound to the
event's own `org_id`, same as every other query in this file.

## SHOULD-FIX

### 3. Session write-back trusts `task.submission_id` without checking it belongs to the task's own sponsorship

**Files:** `src/lib/sponsors/session-writeback.ts` (`nameSpeakerStatements` lines
72-138, `sessionContentStatements` lines 147-177), and the generic "form" branch
of `completeTask` in `src/routes/portal.routes.ts` (~1166-1206) which writes
`submission_answers` for *any* form-kind task, sponsor or speaker, keyed purely
by `task.submission_id`.

`task-access.ts` is explicit and careful that a sponsor contact may only reach
a task whose `sponsorship_id` matches a sponsorship they hold. But nothing
after that point checks that `task.submission_id` — the submission the
write-back and the generic form-answer write both target — actually belongs to
*that same* `sponsorship_id`. Both `nameSpeakerStatements` and
`sessionContentStatements` look the submission up by `id = ? AND event_id = ?`
only:

```ts
const submission = await db
  .prepare("SELECT id FROM submissions WHERE id = ? AND event_id = ?")
  .bind(task.submission_id, task.event_id)
  .first<{ id: string }>();
```

Nothing here (or in the migration) ties `speaker_tasks.submission_id` to
`speaker_tasks.sponsorship_id` at the database level — they're two independent
nullable FK columns (0023_sponsors.sql lines 82, 90). Today this is not
reachable: the only writer that sets `sponsorship_id` on a `speaker_tasks` row
is `scripts/seed/sponsors.ts` (confirmed — `grep` of every `INSERT/UPDATE`
touching `speaker_tasks.sponsorship_id` outside tests found only that seed
module), and it always pairs a sponsor deliverable with that same sponsorship's
own placeholder submission. The generic organizer task-assignment path
(`assignmentStatements` in `task-templates.routes.ts:399`) never sets
`sponsorship_id` at all, so an organizer assigning a sponsor-flavored template
to an ordinary speaker produces a task with `sponsorship_id = NULL`, and
`applySponsorWriteback` explicitly early-returns on that (`session-writeback.ts:248`)
— so that particular cross-path is safe today.

**Why this still matters:** the moment anything else can set both
`sponsorship_id` and `submission_id` on a task — organizer-facing sponsor task
authoring, a bulk edit, a bugfix that reuses `assignmentStatements` for sponsor
tasks — a mismatched pair lets a sponsor contact silently overwrite an
unrelated submission's title/abstract, or add themselves/a colleague as a
`speaker` participation on a talk that isn't theirs, just by completing "Name
your speaker" or "Session content" on their own deliverable. The fix is cheap
and matches the invariant `task-access.ts` already enforces one layer up: check
`submission.sponsorship_id = task.sponsorship_id` in both statements builders
(and, ideally, in the generic form-answer branch of `completeTask` too, since
that path is shared and not template-gated at all).

### 4. Several seed assertions got strictly weaker while the commit history frames this round as sharper

Verified before/after logic directly (not the framing in the commit messages).

- **`tests/node/mrq-23-seed-check.AC-3.test.mjs` — weaker, no compensation.**
  `submissions.length === 1000` became `competitive.length === 1000` with no
  assertion anywhere in the file about the sponsor-submission population. Any
  number of `sponsorship_id` rows, in any state, now passes silently.
- **`tests/node/seed-pool.AC-3.test.mjs` — weaker.** The sponsored partition is
  bounded only by `sponsored.length > 0`, so a seeder emitting 300 sponsor
  Sessions (or collapsing to a single one, losing the Gold/Silver pair ruling
  5.4 depends on) still passes. More importantly, the *unchanged* lines 47-50
  ("accepted Session `can_schedule`/`can_publish` remains reachable") still run
  against the unscoped `submissions` array, so those invariants can now be
  satisfied **entirely by the two sponsor Sessions** — a seeder bug that breaks
  scheduling/publishing for every competitive Session would no longer be
  caught.
- **`tests/node/seed-spine.test.mjs` — weaker, partially compensated.** The
  accepted-core check (`=== 60`) is now scoped to `!sponsorship_id`, which is
  reasonable, but three of its per-row invariants — `tracks.has(primary_track_id)`,
  `Number.isInteger(decided_at)`, and `submitted_at < decided_at` — are no
  longer checked for sponsor submissions at all, and nothing new replaces them.
  Note `sponsors.ts` sets `submitted_at === decided_at` for its sponsor rows,
  which would have *failed* the old `submitted_at < decided_at` invariant —
  i.e. the exclusion isn't incidental, it's load-bearing for the new seed data
  to pass.
- **`scripts/checks/seed.ts` — roughly equivalent, one blind spot.** Adds a real
  floor (`sponsored.length >= 3` plus a guaranteed-placement property), but the
  exact total assertion is gone, and the emitted evidence field `submissions`
  now reports `1000` while the table actually holds `1003` — a human or agent
  reading the evidence output sees a number that is no longer the row count.
- **`tests/integration/reset-demo.test.ts` is now the only gate in the default
  suite that pins the real sponsor row counts** (`submissions: 1003`,
  `agenda_items: 27`, plus the four new WIPE_ORDER tables). That's a real,
  correctly-strengthened check — but it means one table-count assertion is now
  covering for three pool/spine assertions that used to catch the same class of
  regression more directly and no longer do.

Net: `tests/node/api-tokens.MRQ-78.test.mjs` (161→163) and
`tests/node/public-write-inventory.test.mjs` were both re-baselined correctly
and are genuinely equivalent — call those out as fine. The other three are the
ones to tighten: add an explicit sponsor-scoped assertion set that covers what
was dropped (track/decision/date invariants, an exact or tightly-bounded
sponsor submission count) rather than relying on `reset-demo.test.ts` alone.

### 5. `sponsorships.tier_id` is a single-column FK; a tier from another event can attach silently

**File:** `migrations/0023_sponsors.sql` lines 33-39 (`sponsor_tiers`), 51
(`tier_id TEXT REFERENCES sponsor_tiers(id)`).

`sponsor_tiers` carries `UNIQUE (id, event_id)`, which is the exact pattern
`buildings` (0001:69) uses to back a **composite** FK, and which
`sponsorships.booth_building_id` correctly consumes two lines below
(`FOREIGN KEY (booth_building_id, event_id) REFERENCES buildings(id, event_id)`,
0023:65). `tier_id` doesn't follow the same pattern — it's a bare
single-column FK to `sponsor_tiers(id)`, so nothing at the database level stops
a sponsorship in event A from pointing at a tier that belongs to event B.

Failure is silent, not loud: `sponsor-portal.routes.ts:148` joins
`tier.id = sponsorship.tier_id AND tier.event_id = sponsorship.event_id`, so a
mis-scoped tier just renders `tier: null` in the portal with no error anywhere
— the sponsor's tier quietly disappears. Fix: `FOREIGN KEY (tier_id, event_id)
REFERENCES sponsor_tiers(id, event_id)`, same shape as `booth_building_id`.

### 6. "Elements never jump" violation: the overdue chip in the sponsor portal's task panel

**Files:** `src/ui/portal/SponsorPortalPage.tsx` (~line 499), `src/ui/portal/sponsor-portal.css`
(~line 93, `justify-content: flex-end` row).

The prototype (`prototypes/sponsor-portal/index.html:442`) always renders the
overdue chip, including "0 overdue". The build renders it only when the count
is `> 0`. In a `flex-end`-justified row, the sibling "N/M complete" text slides
horizontally the moment the last overdue task is completed and the chip
disappears — exactly the class of defect CLAUDE.md's "UI: Elements Never Jump"
rule and DESIGN.md both call out by name, and every other stateful element on
this same page (`.portal-task-action` fixed width, `.portal-task-owner`
`min-height`, `.sponsor-deal-line` `min-height`, etc.) correctly reserves space
for. Reserve the chip's slot (render it always, or reserve its width) so
completing the last overdue task doesn't move anything else in the header.

### 7. Undeclared divergences from the binding prototype

The PR declares exactly three intentional divergences (modals → in-place
expansion, fake → real conference switcher, "SVG or EPS" → "vector PDF"). All
three verified faithful. Beyond those three, the build also drops or changes,
without being declared:

- A designed control does not ship: the prototype gives a scheduled sponsor
  Session an "Add to calendar" button (`index.html:412`); the build shows
  static text instead (`SponsorPortalPage.tsx:248`).
- The progress bar is dropped — prototype has a `.progress-track` fill bar
  (`index.html:137-139, 438`); the build shows only a numeral, label, and note
  (`SponsorPortalPage.tsx:461-465`).
- No completion confirmation — the prototype toasts on save (`index.html:493,
  518`); the build has no toast anywhere in `src/ui/portal/` and relies on a
  silent refresh.
- `.chip` gains `text-transform: uppercase` (`sponsor-portal.css:146`) that the
  prototype's `.chip` (`index.html:105`) doesn't have — SESSION/PRIMARY/YOU
  instead of Session/Primary/You. Vocabulary is right; casing isn't the
  prototype's.
- Sponsor Session cards show the pre-existing format label "Stage Talk"
  (from `scripts/seed/event.ts`) where the prototype's copy read "Sponsored
  Talk"/"Sponsored Lightning" — putting the word "Talk" on a page that's
  otherwise disciplined about "Session" vocabulary.
- Minor sizing/typography drift throughout (heading level swapped h1↔h2 vs.
  the welcome block, several font sizes 0.5-1px larger than the prototype, the
  location-label column 84px vs 74px, the responsive breakpoint 820px vs 900px).

None of these are crashes, and the build's empty/loading/error-state coverage
actually *exceeds* the prototype's (which has none) — that part is a genuine
improvement, not a divergence to flag. But DESIGN.md's contract is
one-to-one reproduction outside declared exceptions, and this list is longer
than the three declared ones; worth a pass to either fix or explicitly ratify.

## CLEARED

Checked, and found sound:

- **`sponsorContactTaskAccess` (`task-access.ts`)** — tried to break it across
  cross-org, cross-conference, cross-sponsorship, cancelled-task, api-token,
  and co-speaker-`roleHint` angles. The join chain (`sponsorship.event_id =
  task.event_id`, `contact.person_id = ?`, `person.org_id = conference.org_id`)
  holds in every case tried; cancelled tasks are deliberately still found and
  answered with a true 409 rather than a misleading 404, exactly as documented.
- **`uploads.routes.ts` authenticated sign (`handleAuthenticatedSign`)** — uses
  the identical `sponsorContactTaskAccess` predicate the completion route uses,
  so a task that validates for completion cannot fail at the presign step. The
  route reads its own session cookie directly rather than going through the
  shared API-token-capable auth context, so an api-token principal cannot reach
  it at all.
- **Speaker portal read/completion path is behaviorally unchanged.** Traced the
  `task-machinery.tsx` / `portal-tasks.queries.ts` extraction line-by-line
  against the pre-diff inline versions: the new shared `listPortalTasks` adds
  only additive JSON fields (`sponsorship_id`, `assignee`, `completed_by`) that
  are always self-referential for a speaker task (assignee === completer ===
  the caller, since `speakerTaskFor`'s join forces `task.person_id =
  auth.personId`); the extracted `TaskRow` renders identically for the speaker
  seat because the speaker call site never passes `ownerLabel`, and the
  attribution/owner `<div>` is gated on that prop being defined.
- **The completion `UPDATE`'s scoping change** (from `WHERE ... person_id =
  auth.personId` to `WHERE ... person_id = task.person_id`) is inert for
  speaker tasks for the same reason (`task.person_id === auth.personId` always,
  by construction of `speakerTaskFor`), and is the correct, deliberate widening
  for sponsor tasks per ruling 1 ("whole sponsorship, anyone completes") —
  entitlement to touch the row was already proven by `sponsorContactTaskAccess`
  before this UPDATE runs.
- **`companyDetailsStatements` (`session-writeback.ts`)** — correctly scoped by
  `sponsorship.id = ? AND sponsorship.event_id = ?` joined through to
  `company.org_id = ?`; unlike findings #3, this one can't cross into another
  sponsorship's company because the join walks from the task's own
  `sponsorship_id`, not a caller-suppliable id.
- **`reseed-demo.ts` WIPE_ORDER** — independently verified FK-safe in both
  directions for the full-database wipe-and-reseed path. This is a *different*
  code path from BLOCKING #1's `delete-event.ts` (the single-event deletion
  cascade) — the former was correctly updated by this diff, the latter was
  missed entirely. Don't read the two as contradicting each other.
- **`scripts/checks/check-routes.mjs`'s new Node resolve hook** — confirmed it
  does not mask a genuine broken import (verified empirically: an injected
  bad import still fails the gate with `ERR_MODULE_NOT_FOUND`), and doesn't
  leak into other tooling (no `NODE_OPTIONS`/global loader registration
  found). Two latent breadth concerns for awareness, neither live today: it
  also intercepts CJS `require()` (not just ESM `import`), and its `.ts`-before-`.tsx`
  extension priority diverges from Vite's actual default order — both harmless
  until a `.js`/`.ts` basename collision or a CJS dependency enters this
  specific import graph.
- **Migration constraints otherwise correct**: every other FK, the partial
  unique index enforcing at-most-one primary contact per sponsorship
  (`uq_sponsorship_primary_contact ... WHERE is_primary = 1`), NOT NULL/CHECK
  constraints, and column types/defaults all matched what the application code
  reads and writes.
- **Null-safety on the read side** — `dealLineChips`, `sponsorHandbookChapters`,
  `boothFor`, and `organizerContactFor`'s null case (distinct from its org-scoping
  bug above) all degrade to honest empty output rather than throwing, for a
  null tier, no booth, no organizer staff, or an empty deal line.
- **Design tokens** — `sponsor-portal.css` uses only `var(--...)` references,
  zero hardcoded hex/rgb.

## Minor / not worth blocking on

- `boothFor` treats "has a booth" as `booth_number || booth_hall ||
  building_id`; a sponsorship with only `booth_size`/`booth_load_in`/`booth_access_note`
  set renders no booth section at all. Cosmetic, not a crash — worth a `CHECK`
  or a fourth condition if it ever matters.
- No `UNIQUE` on `sponsor_tiers(event_id, name)` or `companies(org_id, name
  or domain)` — two "Gold" tiers or two "Acme Corp" companies are both
  currently possible, and a duplicate company would defeat
  `uq_sponsorships_event_company`'s intent.
