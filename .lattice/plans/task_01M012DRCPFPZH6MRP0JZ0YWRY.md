# MRQ-214 — Sponsor portal: plan

**Delegator:** `agent:mrq-214-opus` (Claude Opus, high effort; operator-authorized 2026-08-14)
**Worktree:** `Marquee-worktrees/mrq-214-sponsor-portal`, branch `mrq-214-sponsor-portal`, cut from `github/main` @ `2f659904`.
**Binding design contract:** `prototypes/sponsor-portal/index.html` (commit `6ab0b7ee`), plus
`sequence/sponsors-design.md` §3 and §5, `DESIGN.md`, `PHILOSOPHY.md`, SPEC §3.7 / §5.6.

---

## 0. Scope, held

**IN** — the minimal sponsors data layer the portal needs, and the portal:

- migrations + row types for `companies`, `sponsor_tiers`, `sponsorships`, `sponsorship_contacts`
- the deliverables join (`speaker_tasks.sponsorship_id`) and the Sessions join (`submissions.sponsorship_id`)
- the completion-attribution field (`speaker_tasks.completed_by_person_id`) — the SPEC amendment the ticket anticipates
- sponsor-contact magic-link entry (sign-in destination + the `/sponsor-portal` route)
- the portal surface itself, one-to-one with the prototype
- seed data carrying BOTH prototype views
- tests + real-browser validation

**OUT** — its own ticket later: organizer-side Sponsors list, sponsorship record, tier settings,
chase-board sponsor grouping, People-CRM companies facet, per-tier deliverable **template sets**
(the `reconcileTaskSet`-on-commit weave), company logo uploads, tier-scoped portal content variation.

Two consequences of holding that line, recorded deliberately so the later ticket is not surprised:

1. **No `task_templates.sponsor_tier_id`.** Tier template sets belong to the surface that authors
   them; a nullable column with no writer is dead weight, and half a reconciliation is worse than
   none. The seed writes sponsor deliverables directly, exactly as `ugliness.ts` writes speaker ones.
2. **No `companies.logo_attachment_id`.** The prototype's company profile shows an initials avatar
   and no logo upload; the logo arrives as a *file deliverable* (`task_upload`). The column lands
   with the organizer surface that needs it.

## 1. Data layer — `migrations/0022_sponsors.sql`

Additive only; 0001–0021 are immutable. Four tables, three columns.

```
companies              org-scoped: org_id, name, website, domain, blurb, notes, is_demo
sponsor_tiers          event-scoped: event_id, name, position          UNIQUE (id, event_id)
sponsorships           event-scoped join: event_id, company_id, tier_id,
                       status ∈ courting|committed|fulfilled, passes,
                       booth_number, booth_size, booth_hall, booth_building_id,
                       booth_load_in, booth_access_note, booth_leave_note, notes
                       FK (booth_building_id, event_id) → buildings(id, event_id)
sponsorship_contacts   sponsorship_id, person_id, is_primary
```

- `people.company_id` (nullable FK) — coexists with the legacy `people.company` string exactly as
  ruling 1 says; the reconcile migration stays a later band.
- `speaker_tasks.sponsorship_id` (nullable FK) — the deliverables join. Person-assigned tasks
  (ruling 2) *grouped* by sponsorship. No company-owned task type.
- `speaker_tasks.completed_by_person_id` (nullable FK → people) — **the attribution field**. Null on
  every pre-existing row and on any task completed before this ships; set on every completion after.
- `submissions.sponsorship_id` (nullable FK) — the linked-Sessions shape §3.1 left to contract time.

Indexes: `idx_companies_org_name`, `idx_sponsor_tiers_event_position`,
`idx_sponsorships_event_status`, `uq_sponsorships_event_company`,
`uq_sponsorship_contacts_sponsorship_person`, `uq_sponsorship_primary_contact`
(partial, `WHERE is_primary = 1` — one primary per sponsorship, enforced by the database),
`idx_sponsorship_contacts_person`, `idx_speaker_tasks_sponsorship_status`,
`idx_submissions_sponsorship`.

**Doctrine held.** Contacts are `people` rows joined by `sponsorship_contacts` — never a parallel
contact table. No workflow status on `people`: `sponsorships.status` is the deal's state and it is
event-scoped, so the same company is `committed` here and `courting` there. Booth is columns on
`sponsorships`, not a record type (ruling 5) — and the boothless Silver sponsorship is those columns
being null, not a branch.

**Mirror obligations** (`check:schema` reads them): `src/db/schema.ts` gains four `*Row` interfaces,
four `CORE_TABLE_NAMES` entries, four `CoreTableRows` and `CoreDefaultColumns` rows, four
`CoreInsert` aliases, the new columns on `PersonRow` / `SpeakerTaskRow` / `SubmissionRow`, and the
exact-count assertions move 53 → 57. `scripts/schema-verify.mjs` moves its two 53s to 57 and adds
the new required indexes.

## 2. SPEC amendment — attribution, and the portal's own section

`SPEC.md` gains **Amendment 23 — the sponsorship and the contact who completes its work**:

- §3.7 delta: `speaker_tasks.completed_by_person_id` NULL — *who* completed, beside `completed_at`'s
  *when*. Nullable because history has no answer for it, and inventing `person_id` as the completer
  would be a lie on every row that a colleague finished. Writer: every task completion, speaker and
  sponsor alike. Reader: the portal task row, the organizer task view.
- §3.7 delta: `speaker_tasks.sponsorship_id` NULL — the grouping join. `owes` is unchanged.
- new §3.11: the four sponsors tables as above, with the two out-of-scope notes from §0.
- new §5.14 **Sponsor portal `/sponsor-portal`** — the page order, the read-only-Sessions ruling, the
  anyone-completes-with-attribution ruling, and the honest empties, in the same register as §5.6.
- §4.2 delta: the three routes in §4.
- Also fixed while here: **Amendment 22 is duplicated verbatim at the tail of SPEC.md.** One copy
  goes. Noted in the PR body so it reads as tidiness, not a contract change.

No AC IDs are minted (ticket rule: stable AC IDs at consolidation only). `tests/ac-claims/MRQ-214.json`
declares `owns: []`, the ACs it exercises, and a note that ACs 1–9 are ticket-local.

## 3. API — `src/routes/sponsor-portal.routes.ts` (glob-registered)

| Method | Path | What |
|---|---|---|
| GET | `/api/v1/me/sponsor-portal` | the whole snapshot for the signed-in contact |
| PATCH | `/api/v1/me/sponsorships/{sponsorshipId}/company` | org-level company facts (AC 7) |

and **one widened existing route**, because the task machinery must stay the single write path:

- `POST /api/v1/me/tasks/{taskId}/complete` (`portal.routes.ts`) resolves the task through the
  speaker predicate **or** the sponsorship-contact predicate. Speaker resolution is untouched,
  byte for byte; the sponsor arm is additive and separately tested.
- `POST /api/v1/me/uploads/sign` (`uploads.routes.ts`) — `task_upload` currently demands
  `task.person_id === session.person_id`. Widened the same way, or a sponsor contact cannot upload
  the logo their colleague was assigned. This is the *same* predicate, so it lives in one place:

```
src/lib/sponsors/task-access.ts
  sponsorContactTaskAccess(db, personId, taskId) → { eventId, sponsorshipId, ownerPersonId } | null
```

Join: task → sponsorship (same event) → sponsorship_contacts (this person) → events → people
(`people.org_id = events.org_id`). Org-scoped, event-scoped, and it cannot reach a task with a null
`sponsorship_id`. Cancelled tasks are found and then refused with 409, not hidden as 404 — the
speaker path's semantics, unchanged.

**Snapshot shape** (one query set, `Promise.all`, server-side everything — R7):

```
{ seat: "sponsor_contact",
  event, viewer,
  sponsorship: { id, status, tier, company, passes, organizer_contact,
                 booth: {...} | null, deal_line: [chips] },
  contacts: [{ person_id, name, title, is_primary, is_you }],
  tasks:    [ …the portal task projection, plus assignee{} and completed_by{} ],
  sessions: [{ id, title, format, speakers[], slot|null, is_published, speaker_task_id|null }],
  handbook: { pages: [...] } }
```

`deal_line` is **derived** — `N Session(s)` from the joined submissions, `Booth <number>` when booth
data exists, `<passes> conference passes` — never a per-tier blurb (AC 6). The organizer contact is
resolved from the event's `program_lead`/`owner` memberships, so it is a real person, not a constant.

**No new snapshot for tasks.** `listTasks`'s projection in `portal.routes.ts` is extracted to
`src/routes/portal-tasks.queries.ts` and called by both portals with a different scope predicate
(speaker: `person_id = ?`; sponsor: `sponsorship_id = ?`). One projection, so a payload fix cannot
land on one portal and miss the other.

**The single write path, made real.** Three template-identified write-backs, all applied inside the
completion transaction by `src/lib/sponsors/session-writeback.ts`, keyed on deterministic template
ids exactly as `PortalPage`'s `FINALIZE_TALK_TEMPLATE_ID` precedent does:

| template | on completion |
|---|---|
| `tpl_sponsor-name-your-speaker` | find-or-create the `people` row by email in the org, insert a `participations` row (`speaker`), bridge a `memberships(role='speaker')` row through the existing `speakerMembershipStatement` — the named speaker genuinely holds the seat the copy promises. Audit `sponsor_session_speaker_named`. |
| `tpl_sponsor-session-content` | `UPDATE submissions SET title/abstract` + `search_blob`, audit `speaker_talk_updated` (the same action the speaker portal writes, so the record's history reads as one story) |
| `tpl_sponsor-company-details` | `UPDATE companies SET name/website/blurb`, audit `sponsor_company_updated` |

No mail is sent for the named speaker — inviting is the organizer's existing machinery, and this
ticket does not reach into it. The write-back is skipped silently for any task whose template is not
one of the three, so an ordinary sponsor form task behaves exactly like a speaker one.

## 4. Entry — the magic link lands where the seat is

`src/lib/auth/role-home.ts` gains `ROLE_HOME.sponsor = "/sponsor-portal"`.
`roleHome(roles, { sponsorContact })` returns it **only** when the person holds no staff, reviewer,
or speaker role — so a person who is both a speaker and a sponsor contact still lands on `/portal`,
and a person with no roles at all still lands on `/portal` (the surface that explains itself). Purely
additive; every existing answer is unchanged.

Callers: `auth.routes.ts` `requestMagicLink` (one extra `EXISTS` query beside the memberships load)
and `signin.route.tsx`'s already-signed-in `home`. The mint-time event-scoping regexp gains
`/sponsor-portal` so the link is event-owned and dies with the conference (Amendment 22's cascade).

**No new demo door.** `DEMO_ROLE_TO_MEMBERSHIP` maps a demo role to a *membership* role, and a
sponsorship contact is not one — bending that map would be a worse lie than the convenience is
worth. Instead every seeded contact carries `is_demo = 1`, so on a demo instance the sign-in form
returns the magic link on screen for their address: the real loop, ten seconds, no new machinery.
`SEED-DATA.md` names the four addresses.

## 5. UI

- `src/ui/portal/SponsorPortalPage.tsx` + `src/ui/portal/sponsor-portal.css`.
- Route: `AppShell` answers `/sponsor-portal` before it draws organizer chrome, beside `/portal`;
  `wallAllowed` excludes it (it owns its own 401); the ⌘K/`/` suppression list gains it;
  `route-table.ts` gains a `utility` row so `check:routes` documents it and no sidebar row appears
  for a seat organizers do not hold. `docs/ROUTES.md` regenerated with `check:routes -- --write`.
- **The task machinery is extracted, not copied.** `TaskRow`, `CancelledTaskRow`, `GenericTaskSurface`,
  `FormField`, `versionListFor`, `uploadFile`, `taskKindLabel`, `requestJson` move to
  `src/ui/portal/task-machinery.tsx`; `PortalPage` imports them and keeps its speaker-only subject
  surfaces (talk, profile) by passing a `renderSurface` prop. `TaskRow` gains two optional props —
  `assigneeLabel` and `completedByLabel` — which the speaker portal does not pass and therefore does
  not render. A second copy of file-upload-with-progress-and-retry is exactly the drift this repo
  keeps paying for.
- Page order, one-to-one with the prototype: head (welcome + `N of M deliverables done` meter) →
  sponsorship hero (dark canvas, tier · status eyebrow, company, conference line, derived deal-line
  chips, organizer contact right) → booth card (rendered only when booth data exists; `loc-lines`,
  the load-in leave-by accent box, `VenueMap` as the receipt, Directions ↗) → two columns:
  Deliverables left (task rows, per-row assignee, overdue marker, dashed cancelled block with the
  reason stated **once**, excluded from the meter), right rail Sessions (read-only) → Company profile
  (initials avatar, facts, contact roster with Primary/You chips, Edit modal) → Sponsor handbook.
- Flight Deck via the shipped tokens (`--canvas`, `--rule`, `--accent-wash`, …), never the
  prototype's literal hexes — `check:design` and Night both depend on that.
- **Elements never jump:** fixed-width task action buttons (the shipped `.portal-task-action` is
  already `width: 124px`), `min-height` on the deal-line row and every swapped-text span, tabular
  numerals on the meter and every count, `min-height` reserved for the per-row attribution line.
- Honest empties, all of them: no booth → the card is absent (ordinary composition, ruling 5);
  no speaker named → "Speaker not named yet" linking to its task; no slot → "Not scheduled yet —
  the agenda team places Sessions in late September"; unpublished slot → "Not yet public";
  no deliverables → a stated empty; 401 → sign-in; 404 → a true "no sponsorship at this conference"
  answer with routes out, in the register of `NoSeatNotice`.

## 6. Seed — `scripts/seed/sponsors.ts` (order 70, after `ugliness`)

Both prototype views, both demonstrable end-to-end (AC 8, operator ruling):

- **Gold — Ashworth–Meridian Capital Intelligence Group**, `committed`, 6 passes, Booth 214 in the
  Sheraton (the seeded primary building, so the map has a real pin and the load-in copy is true).
  Three contacts: Dana Okafor (primary), Priya Raghunathan, **Grzegorz Włodarczyk-Ó Braonáin** —
  the diacritic name is the point (DESIGN: real-ugly data always). Eight deliverables: two done with
  attribution, one **overdue** (the vector logo, assigned to Grzegorz — the anyone-completes demo),
  a name-your-speaker form, two more open, one done by a colleague, and one **cancelled** with its
  reason. Two Sessions: one scheduled + published, one **speakerless and unscheduled** carrying the
  name-your-speaker task.
- **Silver — Tapestry Small-Business Lending**, `committed`, 2 passes, **no booth**, single contact
  Mona Haddad, four deliverables (two done, logo open, session-description form), one Session
  scheduled but **not yet public**.
- Deterministic `seedId`s throughout, `is_demo = 1` on every person and company, upsert-convergent
  like every other seeder. Registered in `DEMO_SEED_MODULES` (the manifest drift check demands it),
  so `reset:demo` reseeds sponsors with everything else. `SEED-DATA.md` gains a sponsors section
  with provenance: **both companies and all four contacts are fabricated**, and the seed says so.

## 7. Tests (inside the 45s objective; read the `status` field, not the clock)

- `tests/node/` (pure, no Worker — where the cheap coverage belongs):
  `roleHome` sponsor precedence (six cases incl. speaker-and-sponsor and no-roles);
  the derived deal line; the booth-present/absent projection; the write-back template dispatch.
- `tests/integration/sponsor-portal.test.ts` — **one** Worker-backed file:
  a contact's snapshot carries the whole sponsorship with every assignee named;
  a contact completes a task assigned to a *different* contact and `completed_by_person_id` is the
  completer (AC 2); a person who is not a contact gets 404 from both routes and from the widened
  upload signer; a cancelled task refuses with 409 and its `completed_at` is untouched (SPEC §3.7);
  the name-your-speaker completion fills the Session (AC 4); the company PATCH writes org-level
  facts and refuses a foreign sponsorship; the boothless snapshot composes down (AC 5).
- `tests/unit/` — the sponsor task row renders assignee and attribution; the speaker row still
  renders neither (the extraction changed nothing for the speaker portal).
- Every title prefixed `CONTRACT · ` (`trace:ac`'s sanctioned vocabulary).

## 8. Validation — required before `pr_open`

Local Worker driven in the **c11 embedded browser** (WKWebView), `INSECURE_LOCAL_COOKIES=1` on the
dev command or the session dies after a 200 login and only in the browser:

1. Sign in as Dana Okafor by magic link → land on `/sponsor-portal` (not the speaker portal).
2. Gold view: hero, derived deal line, booth card with its map, eight deliverables with assignees,
   the overdue marker, the cancelled block and its single reason, both Sessions.
3. Complete the acknowledge task, the file request **assigned to Grzegorz** (attribution shows
   "completed by Dana Okafor"), and the name-your-speaker form → the Session card fills.
4. Sign in as Mona Haddad → Silver view: no booth card, single contact, its own deliverables.
5. Company profile edit saves and persists across a reload.
6. Console clean; no layout jump on any action.

Screenshots + a written pass/fail per step attached with
`lattice attach/comment --role validation`.

## 9. Gates and order of work

Order: migration + schema mirror → seed → API + write-backs → entry → UI → tests → validation.
Commit at every one of those boundaries; never `git stash` (shared stash stack).

Before the PR: `tsc --noEmit`, `npx vite build`, `npm test`, `npm run check:schema`,
`npm run check:routes`, `npm run check:api`, `npm run check:design`, `npm run check:seed`,
`npm run trace:ac`, then `npm run pr-gate`. `fail` blocks; `pass-over-budget` is a warn;
a local `timeout` means re-run, not pass.

Then: PR → an independent review (a clear reviewer agent on the diff) → address findings →
**merge on green + review**, per `CLAUDE.md`. Merging does not deploy, and this ticket does not deploy.
