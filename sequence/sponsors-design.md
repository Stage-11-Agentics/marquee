# Sponsors — design round (research digest, rulings, IA, prototype scope)

**Date:** 2026-08-14 · **Participants:** Atin + sponsor-design interview surface
**Status:** Rulings signed; organizer-side prototype scope banded below; the sponsor
portal is being designed in its own dedicated surface (ruling 3).
**Context:** Sessionboard's Groups module was ruled *skip* for the competition
(gap-analysis item 22, 2026-08-10). That ruling covered the competition only; this
round revisits sponsorship for the real conference — AIE NYC 2026 (Oct 12–14, Wall
Street theme, sponsor-heavy). Sponsor/exhibitor groups was also a competitor question
swyx never answered in Discord.

---

## 1. Research digest

### 1.1 The incumbent's model (Sessionboard, from its own docs)

Sessionboard's sponsor feature is the **Groups** system:

- **A Group is a company record** — "all of the Sponsoring organization's information
  (i.e. name, phone number, address)" — in a Sponsors module (Exhibitors is a parallel
  module). Group fields are the third field family beside Session and Speaker fields,
  customizable per event via Settings → Record Settings → Layouts → Group Fields.
  ([adding sponsor groups & contacts](https://learn.sessionboard.com/en/knowledge-base/8117973-adding-sponsor-groups-contacts))
- **Contacts attach to groups**, one designated **primary contact** who "will be the
  person to receive any communications the event admin sends." Contacts can be granted
  portal login.
- **Tier is a standard field on sponsor groups** — Gold/Silver/Bronze by default,
  renameable and extendable, bulk-assignable "when tiers change post-sale." Their own
  pitch is the chase-board shape verbatim: *"Gold gets extra deliverables — filter
  Gold, bulk-assign tasks, and track completion in one place."*
  ([sponsor settings](https://learn.sessionboard.com/en/knowledge-base/8399524-sponsor-settings))
- **Portals:** three defaults (People / Exhibitor / Sponsor) plus custom portals scoped
  by contact role, session type, or **sponsor tier**; assignable content = Tasks, File
  requests, Forms, Files, Wiki pages; per-portal branding (welcome, accent, logo,
  background). ([portals 101](https://learn.sessionboard.com/portals/portals-101))
- **Tasks target Contacts / Groups / Sessions** — a task can be owed by the company,
  not just a person. ([assign tasks](https://learn.sessionboard.com/portals/assign-tasks))
- **Sponsor intake form:** three pages — Welcome & Terms → Group info → Contact info;
  "when sponsors complete the intake form, a new sponsor contact and group are created."
  The whole Sponsors/Exhibitors module is gated behind "contact support to enable."
  ([sponsor intake form](https://learn.sessionboard.com/sponsors-exhibitors/sponsor-intake-form))
- Event details ships the toggle card: "Which group types do you want to manage for
  this event? [Exhibitors] [Sponsors]" (competition-requirements screenshot facts).

Sessionboard's *tracking* of all this remains its weak half: filtered Contacts views
plus a Monday-07:00-UTC weekly digest — the same gap our chase board already beats for
speakers (landscape-features §2.2).

### 1.2 What Marquee already holds

The three atoms of sponsorship exist; only the surface tying them together is missing:

| Atom | Where it lives today | State |
|---|---|---|
| The deliverable session | `submissions.kind = session` + `bypass_evaluation` (R9); ~25–40 sponsor Sessions in the seed | Fully handled |
| The contact | `participations.role = sponsor_contact` (SPEC §3.2) — in conflict detection (AC-77), per-role confirm (AC-153), role labels (AC-224) | Session-scoped only |
| The company | `people.company` — a string column | Not an entity |

Adjacent machinery that carries the load: `task_templates` / `speaker_tasks` /
`reconcileTaskSet` and the chase board (SPEC §3.7, §5.10); the speaker portal
(magic link, tasks, file requests, forms); org-scoped `people` doctrine
(`speaker-crm-scope.md` §2); the attendee precedent of an event-scoped join over
org-level people (`attendee-schedule-design.md`, ruled 2026-08-14). `max_sponsors`
is a dormant schema column — builder control ruled out 2026-08-10 (gap verdict 22).

---

## 2. Interview rulings (Atin, 2026-08-14)

1. **The scoping split is signed: org-level `companies` + per-conference
   `sponsorships`.** Sponsorship is per-conference commerce over an org-level company
   relationship — structurally parallel to Outreach over People. The company and its
   history survive across conferences; the deal (tier, status, deliverables, sessions)
   is this conference's record. *Agent default, not separately ruled:* `people.company`
   (string) and `company_id` coexist for now; the reconcile is a later-band migration.
2. **Deliverables are person-assigned tasks on the existing machinery.** No
   company-owned task type — "this is already an above-and-beyond feature; no need to
   add extra complexity." Sponsor deliverables are `speaker_tasks`-shaped tasks
   assigned to contact people, *grouped by sponsorship* on organizer surfaces.
3. **Sponsors get a portal — designed in its own round.** A dedicated design surface
   (Claude Fable, high effort) owns the sponsor-portal design; this doc is its brief.
4. **Sidebar placement signed:** a **Sponsors** row in the Conference nav group
   (beside Speakers); **companies surface inside People CRM as a facet** (the same
   pattern as the Lists ruling) — no separate org-level nav row.
5. **One Sponsors module — and it must handle booth/exhibitor cleanly inside itself.**
   No parallel Exhibitors module. Booth is expressible as sponsorship data +
   deliverables (e.g. a booth field/deliverable set), not a second record type. Design
   surfaces should not paint themselves into a sponsors-only corner.
6. **No public intake form.** Sponsors are sold by humans and entered post-sale:
   organizer/agent entry plus agent-native import (the skill-file pattern ruled for
   attendee ticketing). A "confirm your details" *portal task* reusing the form
   machinery replaces the public door.
7. **Bands signed as proposed** (§4).

Standing dispositions, reaffirmed: `max_sponsors` stays dormant (sponsorships do not
enter through CFP forms); `sponsor_contact` stays as the session-level participation
role, now complemented by the sponsorship-level contact link.

---

## 3. Information architecture

Prototype-mock level — tone-architect finalizes names and constraints at contract time.

### 3.1 Entities

- **`companies`** (org-scoped): name, logo, website, domain, notes. The CRM's second
  noun. People link to companies (`company_id`, coexisting with the legacy string).
- **`sponsor_tiers`** (event-scoped): name, position; Gold/Silver/Bronze seeded,
  renameable, extendable. Each tier carries a **deliverable template set** — the weave:
  committing a sponsor at a tier runs the same `reconcileTaskSet` idempotent
  reconciliation that acceptance runs for speakers.
- **`sponsorships`** (event-scoped join): company_id, tier_id, status
  (courting → committed → fulfilled), notes. Booth data lives here when needed (ruling
  5) — fields/deliverables, not a record type.
- **`sponsorship_contacts`**: person_id per sponsorship, one primary. Contacts are
  `people` rows — never a parallel table (speaker-CRM doctrine).
- **Deliverables**: existing task machinery, person-assigned (ruling 2), joined to the
  sponsorship for grouping. Tier templates auto-assign to the primary contact.
- **Linked Sessions**: the sponsorship record lists its guaranteed Session(s)
  (`kind = session`); honest link shape (e.g. nullable `sponsorship_id` on
  submissions) is a contract-time call.

### 3.2 Surfaces (organizer side)

- **Sponsors list** (`Conference → Sponsors`): tier, status, primary contact,
  deliverable progress, linked sessions. Same table machinery as everything else
  (saved views, filters, server-side everything — R7).
- **Sponsorship record**: company header, tier control, contacts (add from People CRM),
  deliverables checklist with chase affordances (nudge, due dates, overdue state),
  linked Sessions, comms history.
- **Tier settings** (Conference settings): ordered tier list + per-tier deliverable
  template set.
- **Chase integration**: sponsor deliverables appear in the chase machinery grouped by
  sponsorship — "who is behind" answers for sponsors exactly as it does for speakers.
- **Companies facet in People CRM** (org level): company list, people at each, and
  sponsorship history across conferences.

### 3.3 Sponsor portal (dedicated round — ruling 3)

Brief for the portal design surface: a sponsor contact enters by magic link (existing
auth), sees this conference's deliverables (tasks / file requests / forms — logo due,
session title due, contact confirmation), their linked Session(s), and completes work
in place. Person-assigned tasks (ruling 2); booth-bearing sponsorships must render
cleanly (ruling 5); judge's-language and Flight Deck rules bind as everywhere.

---

## 4. Prototype-mock scope bands (ruled 2026-08-14)

**Now — this prototype round:**
- `companies` + `sponsorships` + event-scoped tiers with deliverable template sets
- Sponsors list + sponsorship record screens; tier settings
- Chase-board integration (deliverables grouped by sponsorship)
- Sidebar: Sponsors row in Conference group; companies facet in People CRM
- Sponsor-contact portal view (designed in the dedicated portal round)

**Later:**
- Tier-scoped portal content variation; portal branding per audience
- Self-serve intake of any kind
- Booth/floor management beyond basic booth data (natural venue-map tie-in)
- `people.company` → `company_id` reconcile migration
- Airtable mirror coverage for sponsor tables

**Not:**
- Payments / invoicing (R32 territory — "we don't really care about payment")
- A parallel Exhibitors module (ruling 5)
- Swoogo-style integrations
- A custom group-field builder (reuse existing custom-field patterns if the build
  needs them)
