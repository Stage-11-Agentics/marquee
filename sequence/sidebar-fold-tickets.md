# Sidebar-reorg round — build-fold ticket drafts

**Status: DRAFTS.** Written 2026-08-14 for the orchestrator to mint (ticket minting is
single-writer; these are not Lattice tickets yet). Grouping ruled by Atin the same day:
inventory items B1+B2+B3 are one ticket, B4 one, B5 one, B6 one. All four gate on
**Atin's love pass over the prototype** (v1.15+, still being driven). The org-settings,
attendee-schedules, and sponsor rounds carry their own fold plans in their design docs
and are deliberately not duplicated here.

Every ruling referenced below is logged in `sequence/run-state.md` (2026-08-14, sidebar
round) and demonstrated in the prototypes: `prototypes/pipeline-v1.1/` (live draft),
`prototypes/crm/` (People area), `prototypes/sidebar-reorg/` (ruling record R1–R5).

---

## T1 · Sidebar reorg: nav structure, stage flyout, Lists into People

**Why.** The build ships a 30-row sidebar that accreted ticket-by-ticket; the ruled
design is ~23 rows in named groups, with the seven-stage ladder returning to the
surfaces that already do it better (dashboard strip with counts, board columns, list
status filter) and a hover flyout restoring direct stage jumps.

**Scope — nav structure** (`src/ui/shell/route-table.ts`, `Sidebar.tsx`, `register.ts`):
- Remove the seven `pipeline`-group rows. Groups become: `organization` (Home ·
  People CRM · Outreach · Settings — the v1.15 org-concept shape), the conference core
  (Program pipeline · Program board · Abstracts & sessions · Agenda · Speakers),
  `speaker-ops` (Onboarding · Tasks · Communications · Files · Follow-ups),
  `cfp` (Forms · Evaluation · Reviewer), `public-links` (Conference site · Speaker
  portal · Embeds, ↗ leading in the icon column), Settings standalone, footer
  (API & CLI · System health · Reset demo).
- Renames: "Program home" → **Program pipeline** (agrees with the page's own title);
  "People" → **People CRM** (judge-legibility ruling — rewrite route-table's comment
  arguing against "CRM"; it is superseded); "Sourcing pipeline" → **Outreach**;
  labels shortened by their group (Forms, Evaluation, Reviewer, Follow-ups, Settings).
- Icon curation: geometry glyphs go; 16px column stays reserved on every row (labels
  never shift); survivors: leading ↗ on external rows, ✉, ⚙, ⌘, ↻. Narrow rail falls
  back to first letters where a row has no glyph.
- Conference picker sits under a "Conference" group label styled like the other
  groups; the eyebrow inside the switcher button goes. Picker-to-first-row gap is 6px.
- "Add a session" leaves the nav; a `+` affordance on the Abstracts & sessions row
  navigates to the create screen (stopPropagation from the row link).
- `register.ts`: rework `navLabels` keys for the new ids; the AI Engineer register's
  `zeroPadNavIcons` chrome assumed the numbered ladder — retire it or repoint it at
  the flyout's stage numerals. Audit all three registers against the new structure.

**Scope — stage flyout** (new component in `src/ui/shell/`):
- Hovering the Program pipeline row raises a fixed-position panel: cap, an
  **"Overview · all stages"** row pointing where the row's click points, then stages
  1–7 with live counts, each a direct jump to its filtered view (Onboarding → the
  chase board). Counts from the dashboard snapshot endpoint the strip already uses.
- Hover intent: ~150ms in, ~220ms out, one shared timer; opens on keyboard focus
  too; never the only path to anything; retires below 1000px viewports.

**Scope — Lists into People** (builds on PR #224, which removes the Lists nav row):
- `/lists` becomes a tab (or equivalent surface) inside the People CRM screen;
  the People row stays active while on it; existing `/lists` URLs keep working.
- The People toolbar carries a visible Lists entrance (prototype: `Lists · N` beside
  "Save filter as list", which already lands there).

**Acceptance sketch.** Sidebar renders the ruled groups exactly (snapshot test on
`routesFor` output per group); no route that existed loses reachability (route-table
completeness test); flyout opens on hover/focus with counts matching the dashboard
snapshot, closes on stage click, absent under 1000px; `/lists` renders inside People
with the People row active; register themes render without referencing removed ids.
**Dependencies.** PR #224 (merge or absorb); love pass. Speed budget R7 applies to the
flyout (no fetch on hover if snapshot is already cached).

---

## T2 · Delete conference (contract first, then build)

**Why.** A created conference cannot be deleted anywhere; ruled in with the
"Your program starts here" flow in mind. Prototype demonstrates the ruled UX in
Conference settings' Danger zone.

**Contract work (SPEC/USER_STORIES/EVALUATION amendments before build):**
- New route (e.g. `DELETE /api/v1/events/:id`), organizer-only, org-scope aware.
- Cascade semantics enumerated explicitly: dies — submissions (both kinds), forms and
  their public links, agenda slots, published site pages, portal magic links, queued
  outbox mail and calendar invites, embeds for that event; survives — `people`, notes,
  tags, attachments' org-level subjects (mind the `attachments.event_id` wart — do not
  deepen it), audit log (the deletion itself is audited with actor).
- Relationship to the existing `remove-demo` verb (SPEC Amendment 19): same shape,
  demo conference is just the seeded case — unify rather than fork.
- AC mint for: type-the-name confirm gate; the dies/stays disclosure in the dialog;
  post-delete landing (another conference if one exists, else the fresh-install
  landing); irreversibility.

**Build.** Danger zone card at the foot of Conference settings; modal per the
prototype (name typed back exactly unlocks; wrong name stays locked — tested both
ways in the prototype); CLI verb + skill-file mention (agent-native parity).

**Acceptance sketch.** Deleting an event removes every event-scoped row and no
org-scoped row (counted before/after in a test); people/notes/tags byte-identical;
audit row written; UI gate provably locked on name mismatch.

---

## T3 · Outreach: rename, target conference, card hygiene, person linkage

**Why.** "Sourcing pipeline" collided with Program pipeline and baked a year into its
copy; long names overflowed cards; the funnel and the person record didn't reference
each other.

**Scope** (`src/ui/people/SourcingPipelinePage.tsx`, `PeoplePage.tsx`,
`PersonDrawer.tsx`, `pipeline-stages.ts`, migration):
- Rename the surface **Outreach** (nav rename lands in T1; this ticket owns page
  title, breadcrumb, copy). Definition copy, no baked-in year: "People you want on a
  stage before any submission exists. Outreach is org-level — one relationship,
  courted across years — and each card names the conference it is currently aimed at."
- Schema: outreach cards gain a **target conference** (`target_event_id` FK, nullable
  for legacy rows); card renders `→ <conference name>`; People-page KPI copy loses
  "for <year>" phrasing.
- Card overflow: name truncates with full-name tooltip; target line truncates; stage
  selector never escapes the card (long-name fixture in tests — use a von-Habsburg-
  length name).
- Button reads **"+ Add prospect"**.
- Person drawer/card shows outreach status when the person has a live card:
  `Outreach: <stage> → <target> · Open board`, linking to the funnel.
- v1.15 org-concept additions demonstrated in the crm prototype ride with this
  surface if ruled in at love pass: next-touch dates with overdue tint/sort,
  do-not-contact (drawer toggle + compose exclusion), Export CSV.

**Acceptance sketch.** List/board/drawer render target conference; overflow fixture
stays inside card bounds; drawer link round-trips; no occurrence of a hardcoded year
in outreach copy (grep-able assertion).

---

## T4 · Sessions vs abstracts legibility

**Why.** The capability existed (kind filter + Type column) but was illegible: the
kind filter was one anonymous dropdown among five, and the board under a Sessions
filter showed empty early columns with no explanation — model-correct, looks broken.
Judges' language ruling: chips stay "Abstract" / "Session".

**Scope** (`src/ui/submissions/SubmissionsPage.tsx`, board view):
- A segmented **All · Abstracts · Sessions** control leads the list toolbar,
  replacing the kind dropdown; fixed button widths (elements never jump); state
  round-trips through the existing `kind` query param and saved views.
- When the board is filtered to Sessions, a quiet explainer band:
  "Sessions are guaranteed — they skip evaluation and enter at Ready to place.
  The earlier columns are empty by design."
- Server-side filtering unchanged (R7); no new query shape.

**Acceptance sketch.** Segment reflects and writes the `kind` param; saved views
capture it; board band appears only under the Sessions filter; toggle interaction
budget within the R7 objectives.
