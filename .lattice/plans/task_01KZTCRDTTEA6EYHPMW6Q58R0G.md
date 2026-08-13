# MRQ-111: Speaker roster and person CRUD

SPK-01 (w3), SPK-02 (w3), SPK-04 (w2), SPK-15 (w1 rider), CNT-10 share. (1) FIX THE MEMBERSHIPS GAP FIRST: grep 'INTO memberships' src/ returns only the demo reseeder — runtime-created speakers are invisible on any memberships-derived surface. Either write memberships(role=speaker) at the acceptance boundary or make the roster participation-derived; the onboarding board must read the same truth. Remove owedCount===0 vanishing for roster purposes (onboarding.queries.ts:300). (2) /speakers route + sidebar 'Speakers', new speakers.routes.ts over people JOIN participations JOIN submissions(event) — same join quick-search uses. Search + filters. (3) Add/edit speaker incl BIO (admin create currently inserts bio as literal NULL, submission-record.routes.ts:671); SHARE the portal's updateProfile normalizer (portal.routes.ts:1303) — two normalizers = SPK-08 divergence. Audit rows on organizer edits. (4) Status: per-session confirmation_status rollup badge + filter + organizer override; NO new person-level status column. (5) Riders: custom_fields JSON + logistics section; wire the dead ?person= quick-search deep link on roster + onboarding. Constraint from CRM scoping: keep the model person-centric so a future CRM layers on cleanly. Full spec: section T-D1. Register rows 16,17,19,20,24n.

---

## Plan (delegator, 2026-08-12) — working against `github/main @ 23a06b0`

### The problem in one paragraph

`memberships` has no runtime writer (`grep "INTO memberships" src/` → only `src/lib/reset-demo/demo-fixture.ts`).
That single gap is load-bearing in four places, not one: the onboarding board's
person list (`onboarding.queries.ts:397`), **portal sign-in** (`portal.routes.ts:291` —
a runtime-created speaker literally cannot reach their own portal), headshot
ownership (`uploads.routes.ts:411`), and the bulk-comms speaker audience
(`comms.routes.ts:488`). So "make the roster participation-derived" alone would
paint over the gap and leave SPK-S2/SPK-S3 broken. Both halves of the ticket's
either/or are needed, with a rule that says which is authoritative.

### Decisions

**D1 — Roster truth: membership is the fact, participation is the safety net, one shared derivation.**
New `src/routes/speakers.queries.ts` owns the single person-source SQL used by *both*
the roster and `onboarding.queries.ts`:

```sql
SELECT person_id FROM memberships WHERE event_id = ? AND role = 'speaker'
UNION
SELECT part.person_id FROM participations part
  JOIN submissions s ON s.id = part.submission_id
 WHERE s.event_id = ? AND part.role IN ('speaker', 'co_speaker')
```

and we *write* `memberships(role='speaker')` at the runtime boundaries so the four
memberships-derived surfaces above start telling the truth:

- organizer **add speaker** (new `POST`) — the only way a session-less speaker exists at all;
- the **acceptance boundary** (`src/jobs/cascade/decisions.ts`, where acceptance already
  mints tasks) — bridging speaker/co_speaker participants of newly-accepted submissions.

The `UNION` is not redundancy for its own sake: it is the guarantee that *no speaker is
ever invisible on the roster* even via a creation path this ticket does not own (the
Sessionize importer, a future CRM import). Documented in the module header. Membership
writes are guarded with `INSERT … SELECT … WHERE NOT EXISTS` rather than a new unique
index, because an index would fail the migration on any pre-existing duplicate row.

**D2 — Status: a rollup with a defined precedence, and an override that writes every place it reads.**
`rollupSpeakerStatus(participations, membership)` in `speakers.queries.ts`, one exported
pure function, precedence fixed and tested:

1. any participation `declined` → **Declined**
2. else participations exist and all `confirmed` → **Confirmed**
3. else participations exist → **Invited** if any `invited_at`, else **Pending**
4. else (no sessions yet) → the membership row's own `confirmation_status` / `invited_at`

Rule 4 is why `memberships` gains `confirmation_status` / `confirmed_at` / `invited_at`
with the *same three-value vocabulary* as `participations` (`pending|confirmed|declined`;
"Invited" is `pending` + `invited_at`, exactly as the per-session chips already read).
This is **not** a person-level status column — it is on the person↔event membership, it
is consulted only while the person has no sessions, and it can never disagree with the
per-session facts because the organizer override writes **both** the membership row and
every participation of that person in the event in one `batch()`. The record surface
lists the per-session statuses under the badge, so the composition is visible rather than
hidden. Flagged in the completion comment as a deliberate reading of "NO new person-level
status column": SPK-S1 changes Priya's status at step 8, two steps *before* she is linked
to a session, so a purely participation-derived status has nowhere to land and the honest
product (organizer marks an invited speaker Confirmed before scheduling) needs this grain.

**D3 — One normalizer.** New `src/lib/person-profile.ts` holds `parseSocialLinks`, the
zod field shape, and `resolvePersonProfile(current, patch)` + the single `UPDATE people`
statement builder. `portal.routes.ts`'s `updateProfile` is refactored onto it; the new
organizer edit path calls the same function. Headshot *validation* stays at each call
site (it is auth-scoped: the portal checks `owner_id = auth.personId`, the organizer path
checks the roster person). No second normalizer is created — that is the SPK-08 divergence
this ticket names.

**D4 — Riders.** `people.custom_fields TEXT NOT NULL DEFAULT '{}'` (json-valid checked),
rendered as a "Logistics & notes" section on the speaker record with named fields
(arrival, departure, dietary, accessibility, shirt size) plus free notes. No
field-definition engine (SPK-15 is w1).

**D5 — Deep link.** Quick-search speaker hits currently point at `/onboarding?person=`,
which nothing reads. Repoint to `/speakers?person=` and *implement* `?person=` on both
`/speakers` (opens the record) and `/onboarding` (opens its existing, currently
unreachable `SpeakerDrawer`). Opening a record pushes `?person=` into the URL, so
SPK-S1 step 9's "save, reload, verify the sentinel" lands back on the same record.

**D6 — `owedCount === 0`.** Removed from `onboarding.queries.ts:300`. The board keeps its
chase semantics through its existing `incomplete` filter; "All" now genuinely means all,
so a completed speaker stops vanishing from the surface that claims to list speakers.

**D7 — Bio on admin create.** `submission-record.routes.ts:671` inserts `bio` as a literal
`NULL`; widen the participant input to carry `bio` (and `title`/`company` already present)
so a speaker created as a submission side-effect is not born with a hole in their profile.

**D8 — MRQ-112 coordination (operator instruction, mid-run).** MRQ-112 owns the headshot
serve path, `uploads.routes.ts` read/serve handlers, and the files panel. This ticket
therefore: projects `headshot_attachment_id` on every speaker payload (list + record),
and renders the avatar through a single `SpeakerAvatar` component that draws the initials
fallback today and has the `<img>` slot ready. **No edits to `uploads.routes.ts`.**

### Files

| File | Change |
|---|---|
| `migrations/0009_person_custom_fields.sql` | new — `people.custom_fields`, `memberships.confirmation_status/confirmed_at/invited_at` |
| `tests/integration/apply-migrations.ts` | register 0009 |
| `src/routes/speakers.queries.ts` | new — shared person source, rollup, list/detail projections |
| `src/routes/speakers.routes.ts` | new — list / detail / create / patch (`*.routes.ts`, glob-registered) |
| `src/lib/person-profile.ts` | new — the one normalizer |
| `src/lib/speaker-membership.ts` | new — the guarded membership bridge statement |
| `src/routes/portal.routes.ts` | `updateProfile` + `parseSocialLinks` onto the shared normalizer |
| `src/routes/onboarding.queries.ts` | shared person source; drop `owedCount === 0` |
| `src/routes/search.routes.ts` | speaker href → `/speakers?person=` |
| `src/routes/submission-record.routes.ts` | participant `bio` reaches the `people` insert |
| `src/jobs/cascade/decisions.ts` | membership bridge at acceptance |
| `src/ui/shell/route-table.ts` | `{ id: "speakers", path: "/speakers", label: "Speakers" }` |
| `src/ui/shell/AppShell.tsx` | route branch |
| `src/ui/speakers/` | new — `SpeakersPage.tsx`, `SpeakerRecord.tsx`, `SpeakerAvatar.tsx`, `speakers.css` |
| `src/ui/onboarding/OnboardingPage.tsx` | honour `?person=` |
| `tests/unit/speaker-status-rollup.MRQ-111.test.ts` | new |
| `tests/unit/route-table.test.ts` | sidebar order expectation |
| `tests/integration/api/speakers-roster.MRQ-111.test.ts` | new |

### AC (ticket, restated as checks)

1. A speaker created via **admin submission create**, the **public form**, and the
   **acceptance cascade** each appears on `/speakers`.
2. **Completed** speakers remain listed (no `owedCount` vanishing).
3. **Bio** accepted on create and on edit; a sentinel edit survives reload.
4. **Status** override persists and the status filter narrows correctly.
5. `custom_fields` value survives save + reload.
6. Search narrows and restores on clear.
7. Organizer edits emit **audit rows**.
8. `headshot_attachment_id` is projected for MRQ-112.

### Risks

- **Migration number collision** — ~20 delegators are live; if another lands `0009`,
  renumber on rebase and re-register in `apply-migrations.ts`.
- **`check:api`** — the new module is glob-registered; confirm the e2e-parity half does
  not demand a Playwright path for brand-new routes before opening the PR.
- **Fleet load** — `uptime` was 244 at planning. Gate only under load < 24.

### Order of work

plan commit+push → migration + shared modules → API + tests → membership bridges →
UI page/record → onboarding + search wiring → targeted vitest → review → gate → PR.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Self-reviewed inline rather than spawning a headless reviewer: `uptime` reported a 1-minute
load average of **244** on a box shared by ~20 delegators, and adding a second Claude
process to that is a worse trade than fresh eyes are worth. Noted in the completion comment.

**R1 (correctness, must fix) — switching the onboarding board onto the roster person source
would silently drop submitter-only people.** The acceptance cascade mints tasks for
`part.role IN ('speaker', 'submitter')` (`decisions.ts:176-186`), so the board today can
carry a person who is a *submitter* and never a speaker. The roster union is
`speaker|co_speaker` only — correct for a roster (a program-committee submitter is not a
speaker; that conflation is exactly finding #50's complaint) but a regression for the board.
**Resolution:** `speakers.queries.ts` exports two sources, and the difference is named, not
accidental — `speakerRosterPersonSource(eventId)` (membership ∪ speaker/co_speaker
participation) and `onboardingPersonSource(eventId)` (that, ∪ anyone holding a
`speaker_tasks` row for the event). The board is the roster plus everyone the conference
owes work to. Both are one query in one module, so the two screens cannot drift.

**R2 (correctness) — `OnboardingPage` never receives the query string.** `AppShell` passes
`location.search` to `SubmissionsPage`/`FormsPage` but calls `<OnboardingPage navigate={…}/>`
(`AppShell.tsx:164`). `?person=` cannot be honoured without it. **Resolution:** pass
`search={location.search}` to both `OnboardingPage` and the new `SpeakersPage`.

**R3 (route collision, accept + flag) — T-I2 will likely want `/speakers` for the public
speaker directory.** Nothing serves `/speakers` today (`app.all("*")` hands it to `ASSETS`,
so the SPA picks it up), and the public site currently lives at `/agenda` + `/p/:slug`.
SPK-01 is explicitly the *organizer* surface and this ticket is told the label is exactly
"Speakers", so the organizer roster takes `/speakers`. **Resolution:** take it, and name the
collision in the PR body so T-I2 lands its directory under the public site's own prefix
rather than discovering the clash at merge.

**R4 (migration) — `ALTER TABLE … ADD COLUMN` cannot carry `UNIQUE`,** which is why the
membership bridge is an `INSERT … WHERE NOT EXISTS` guard and not `INSERT OR IGNORE`.
Confirmed `CHECK` and `NOT NULL DEFAULT` are both legal in `ADD COLUMN`; `json_valid`
stays on `custom_fields`.

**R5 (test naming) — this ticket mints no AC IDs** (COMMON.md: only consolidation mints
them). Test names therefore carry `MRQ-111` plus the rubric ID they defend
(`MRQ-111 · SPK-02 · …`), matching the eval-response convention, and `trace:ac` is checked
for a scope complaint before the PR rather than after.
