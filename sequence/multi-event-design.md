# Multi-event — archaeology and clean-eye design

**Status:** **Ratified by Atin, 2026-08-12** (live session — all five decisions in §3 approved as recommended). Supersedes/refines the unminted T-M draft in `sequence/eval-response-tickets.md`.
**Code truth:** worktree `Marquee-worktrees/eval-triage-ro`, github/main @ `4b2dc09`. Every claim below carries file:line evidence from that tree.
**Rubric stake:** CFP-17 (w2, second event coexists + reachable via list/switcher) and CFP-18 (w2, per-event scoping observable), both `not_found` in run 1 ≈ **+3.0 overall points**. But the design below is for the product — conferences are serial, AIE runs ~4/year — with the rubric as a floor, not a ceiling.

---

## 1. Archaeology — what actually exists

The headline: **multi-event was never "crutched in" at the data layer — it was deliberately modeled and deliberately not built in the UI.** `SPEC.md:72`: *"Multi-event is modeled; the UI ships single-event (§10)."* `SPEC.md:605` lists "multi-event UI (modeled, not built)" as ratified out-of-scope (2026-08-08/09). What *is* scattered across prompts is the surface layer — and, as of this morning, a second design lineage nobody has reconciled (§1.7).

### 1.1 Schema: fully event-scoped, shaped for copying

- Every substantive table carries `event_id NOT NULL REFERENCES events(id)`; cross-row integrity uses composite FKs (`UNIQUE (id, event_id)` on tracks/buildings at `migrations/0001_init.sql:56,69`, and children reference the pair).
- `events`: `org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, logo_key, accent, status ('draft'|'live'), demo_mode` (`0001_init.sql:14–31`). Slug is **unique per org** (`uq_events_org_slug`, `0001_init.sql:727`).
- Org-scoped (shared across events, copy never needed): `organizations`, `people`, `memberships`, `api_tokens`, `auth_sessions` (`SPEC.md:72`). People and their emails are org-level — a returning speaker is already the same person row next year.

### 1.2 Authorization: already per-event, org-wide owner in place

- Every API request resolves role per event: `router.ts:165–186` → `roleForEvent` (`src/lib/auth/scope-resolution.ts:62–75`). Org-wide memberships (`event_id NULL`) grant staff roles on **every event in the org**; reviewer memberships never inherit cross-event (schema CHECK + `scope-resolution.ts:69`, AC-214).
- The seeded demo organizer holds an org-wide owner row (`mem_demo_organizer_org`, `event_id: NULL` — `demo-fixture.ts:114–125`). **The demo organizer can already administer any event created in the demo org, zero membership plumbing needed.**
- API tokens are already multi-event aware: `tokenEventAllowed` handles org-wide and event-list-scoped tokens (`scope-resolution.ts:105–109`).

### 1.3 API and CLI surface

- **No collection endpoints.** Only `GET/PATCH /api/v1/events/{eventId}` exist (`event-settings.routes.ts:172,186`). No `POST /events`, no `GET /events`, no runtime `INSERT INTO events` anywhere outside the seed fixture and a schema-verify script.
- The CLI is already event-parametric: positional / `--event-id` / `MARQUEE_EVENT_ID`, falling back to the auth response's `demo_event_id` (`cli/marquee.mjs:157–170`). It lacks only `events list` / `events create` verbs and their endpoints.
- The **public** side is already multi-event addressable: public routes accept `?event=<slug>` (`public.routes.ts:18,45`) and slug-scoped embed paths exist (`src/ui/app.tsx:28`).

### 1.4 UI: 16 hardcoded props, no context, event-less URLs

- `evt_aie-ny-2026` is a default prop or module constant in **16 runtime sites**: FormsPage:188, ProgramBoardPage:9, AppShell:178 (QuickSearch), DeliveryHealthShell:22, DeliveryHealthPage:207, CommsScreen:74, DashboardPage:155, venue-writer.ts:4, ReviewerPage:9, SubmissionsPage:228, CreateSubmissionPage:8, SubmissionRecordPage:11, EvaluationPage:8, AgendaPage:20, SessionizeImportPage:67, OnboardingPage:9. None of these props is ever passed — the default *is* the wiring. Same pattern as `AppShell({ eventName = "AIE NYC 2026" })` (AppShell.tsx:41, T-N1's target).
- There is **no `createContext` anywhere in `src/ui/`** and no client store. Admin URLs carry no event segment at all (`route-table.ts` — `/dashboard`, `/submissions`, …).
- The sidebar "switcher" is a plain `/dashboard` link dressed in switcher clothes (`Sidebar.tsx:11`, class `event-switcher`) — for the eval it burns turns and yields no observation; for a human it's a small lie.

### 1.5 Demo reset: scoped to the one seeded event — created events are immortal

- `reseedDemo` deletes per-table with `WHERE event_id = 'evt_aie-ny-2026'` (or subqueries thereof), then the seeded event and org by id (`reseed-demo.ts:78–…`, WIPE_ORDER at :15). **An event created at runtime in the demo org survives every reset, forever, in the judge-visible workspace.** This is the open product decision (§3, Decision 1).

### 1.6 Mail safety rides on `demo_mode` — this constrains Decision 1

`shouldSuppress` (`src/jobs/mail/consumer.ts:143–153`): mail is suppressed only when the **event** has `demo_mode = 1` and the recipient is off the allowlist. **An event created in the demo org with `demo_mode = 0` would send real mail to whatever addresses a judge or demo visitor types.** Whatever the reset ruling, created-in-demo-org events must inherit `demo_mode = 1` for safety, not just for sweepability. (The demo login's event resolution is stable regardless: oldest `demo_mode=1` event, `auth.routes.ts:326`.)

### 1.7 The buried design lineage — this morning's cold-start rulings

The "bits without a design" feeling is precise: there are **two half-designs that have never met**.

1. **The eval lineage** — T-M draft (`eval-response-tickets.md:321–329`): endpoints + context + switcher + empty shell + reset coordination. Build-shaped, rubric-motivated, no UX design.
2. **The prototype lineage** — the binding prototype `pipeline-v1.1/index.html` was extended to **v1.11 this morning** (2026-08-12 cold-start interview, client rulings in `prototypes/cold-start/DECISIONS.md`), and it **already designs the switcher**: current-conference block + `＋` create button (index.html:1811–1813), a second `switcher-alt` row showing the *other* conference with a DEMO/LIVE chip (:1869–1878), `#conferences/new` create screen with a scratch-vs-Sessionize choice (:1905), and ruling **D7**: *"Next year's conference via the event switcher `＋` → same `#conferences/new` → checklist, scoped to the new conference… in the build, `POST /api/v1/events` must exist for the agent path anyway."* Ruling **D3**: demo lives side-by-side, DEMO-chipped, removable in one action. `SITEMAP.md:63–70` already draws "Conference switcher + Create conference."
3. Note: `DESIGN.md:4` still pins the binding prototype at v1.9 — stale by two iterations (v1.10 public widgets, v1.11 cold start). Worth a one-line fix when this design is ratified.

**So the clean-eye design below is not an invention — it is the reconciliation**: v1.11's ratified switcher UX + T-M's build mechanics + the pieces neither covers (create-from-existing, the reset ruling, deep links, the prop migration).

### 1.8 Empty-shell audit: what a fresh event needs to not 500

Verified page-by-page: the admin surfaces carry honest empty states and tolerate an event with zero child rows — DashboardPage renders its "Your program starts here" EmptyState (:92) and "No decision waves yet" (:115); EvaluationPage renders "No evaluation plan" with a create action (:252) rather than dereferencing `firstRound`; `GET /events/{id}` needs only the event row (`settingsFor`); forms/submissions/onboarding lists render empty. **No child-table seeding is required for a working shell.** The two real traps:

- **QuickSearch** is hardcoded (AppShell:178) — on event B it would silently search event A. Must ride the context migration or scoping is *observably wrong*, which is worse for CFP-18 than absent.
- `event_settings` has no row for a new event — safe everywhere it's read (mail allowlist defaults to empty set = suppress-all on demo events, `consumer.ts:125–130`; portal reads are LEFT JOINs).

---

## 2. The design

### 2.1 Model

One org, serial events. An event is created `draft`, flipped `live` from Conference settings (both states exist in schema today; no new lifecycle states now — "archived" is a sort order, not a status, until a real need shows). The organizer's world at any moment: one **current event**, a short list of others (upcoming first, then past), and a create action. AIE's reality — ~4/year, one team — is the sizing: the switcher is a small instrument, not a portfolio manager.

### 2.2 API + CLI (agent-native first, per PHILOSOPHY §3)

```
GET  /api/v1/events                 → events in the caller's org the caller can read,
                                      with role, status, demo_mode, starts_on, counts (submissions)
POST /api/v1/events                 → { name, slug?, starts_on, ends_on, timezone, venue?, tagline?,
                                      copy_from?: eventId, copy?: { formats, tracks, venues, forms,
                                      task_templates, email_templates, evaluation_plan } }
```

- `POST` is one transaction: event row + (if `copy_from`) the selected copy sets with fresh IDs and remapped internal references (rooms→buildings, form_fields→forms, criteria→rounds). Response reports what was copied, by count — the receipt the UI renders.
- Slug: auto-derived from name, `409` with a suggestion on per-org collision (`uq_events_org_slug`).
- `demo_mode` is **not** a request field: it inherits `1` iff the org is the demo org (§2.5). Never client-settable.
- CLI: `marquee events list`, `marquee events create --name … --from evt_… [--copy formats,tracks,forms]`. `SKILL.md` gains the "next year's event" recipe. The cold-start D7 path (`＋` → create) and the agent path are the same endpoint by construction.

### 2.3 Create-from-existing — the copy contract

"Create next year's from this one" is the highest-value organizer action here; the composite-FK schema was shaped for it. The contract must be **legible** — the organizer sees exactly what travels:

**Copies (default on):**
| Set | Tables | Note |
|---|---|---|
| Formats | `formats` | durations carry |
| Tracks | `tracks` | colors carry |
| CFP forms | `forms`, `form_fields`, `form_admins` | structure only; forms open **closed/draft** — never auto-live |
| Task templates | `task_templates` | the chase-work definition |
| Email templates | `email_templates` | |
| Evaluation plan | `evaluation_plans`, `evaluation_rounds`, `rubric_criteria` | structure only — no committees, assignments, scores |

**Copies (default off, toggle):** Venues (`buildings`, `rooms` — AIE may return to the Sheraton or may not).

**Never copies, stated on screen:** submissions, participations/speakers' event data, evaluations/scores, agenda, waves, attachments, outbox/messages, audit log, committees and reviewer scopes, embeds, routing rules, webhooks, saved views. People are org-scoped and need no copying — returning speakers are already the same person rows. Dates are entered fresh; nothing date-bearing copies, so no date-shifting engine.

(Committees deliberately don't copy: memberships are cheap to re-invite via T-A's flow, and silently carrying reviewer authority across years is a scoping smell.)

### 2.4 Event selection: where "current event" lives

**Recommendation: event-less admin URLs stay; selection is per-tab with a `?event=` deep-link override.** Precedence at boot: `?event=` param → `sessionStorage` (per-tab) → `localStorage` (last used, seeds new tabs) → auth `demo_event_id` → first listed. Switching writes all three and (for cleanliness) strips the param.

- Why not URL-path scoping (`/e/aie-sf-2026/dashboard`)? It is the eventual right answer (two tabs, two events, shareable links — the public site is already slug-scoped) but it rewrites every route, every `navigate()`, every bookmark, and the SSR admin shell — a build multiple of the whole feature for zero rubric gain and real regression risk this week. Per-tab sessionStorage gives two-tabs-two-events today; `?event=` gives shareable deep links. Path-scoping goes on the roadmap as the v2 URL scheme, adopted in one sweep when Marquee has its second *real* customer conference.
- Deep-link behavior across events: a bare `/submissions/sub_x` from another event 404s under the current event's scope (correct — scoping observable); links the product itself mints (quick-search hits, exports, mail) carry `?event=` so they always land scoped.

### 2.5 The reset/demo ruling (Decision 1, recommendation)

**Rule: events created in the demo org inherit `demo_mode = 1`, and the reset sweeps the demo org, not the seeded event id.** Concretely: `POST /events` sets `demo_mode = 1` when `org_id = org_demo`; every `DELETE … WHERE event_id = 'evt_aie-ny-2026'` in `reseed-demo.ts` becomes `WHERE event_id IN (SELECT id FROM events WHERE org_id = 'org_demo')` (org-scoped tables already delete by org). Rationale, in order:

1. **Mail safety** (§1.6): a `demo_mode=0` event in the demo workspace sends live mail. Inheritance closes this before it exists.
2. **Sweepability**: the judge's "Forward Summit 2028" dies on the next reset instead of accreting forever.
3. **Honesty**: everything in the demo org *is* demo. The alternative (flagging created events but sweeping only the seeded one) leaves immortal clutter; sweeping without flagging leaves the mail hole.

Self-hosted installs are untouched — their org isn't the demo org, `demo_mode` stays 0, cold-start D3's "demo alongside real, removable" flow is exactly this same machinery pointed at the seeded event.

### 2.6 The switcher (UI)

Lives where the fake one sits — sidebar, under the brand — honoring v1.11's ratified pattern (current-conference block + `＋`), extended from "the one other conference" to a list:

- **Closed state:** the current block (`CONFERENCE` microlabel + name) plus the `＋` — same geometry as today, so nothing jumps. The block gains a `▾` affordance; it opens the popover instead of navigating to `/dashboard`.
- **Popover:** compact instrument list — name, dates (mono), status chip (`LIVE` / `DRAFT` / `DEMO`), submission count as a gauge. Current row marked, click switches (→ `/dashboard` of the target). Upcoming above, past greyed below. Footer row: **＋ Create conference**. A filter input appears only past 8 events.
- **Keyboard:** the popover is arrow/Enter/Escape navigable; **⌘K quick-search grows event rows** ("Switch to AIE SF 2026") so the muscle-memory path is the universal one. No new global chord.
- **Create screen** (`/conferences/new`): v1.11's screen plus a third choice card — **Start from an existing conference** (scratch · from existing · Sessionize import). Choosing it shows the source select (default: current event) and the copy contract as a checklist with per-set counts, plus the never-copies line in plain text. Create → lands on the new event's dashboard, empty states showing, a toast receipt of what copied.

### 2.7 Migration from the 16 props (mechanical plan)

1. Add `EventProvider` in `AppShell` (first `createContext` in `src/ui/`): boots on `GET /api/v1/events` + §2.4 precedence; provides `{ eventId, event, events, switchEvent }`. `eventName` for Sidebar/Topbar comes from the same object — this **is** T-N1's name-wiring, coordinate so it's built once.
2. Sweep the 16 sites: delete every `= "evt_aie-ny-2026"` default; page components take `eventId: string` **required**, passed once from AppShell (leaf/module components may use a `useEventId()` hook). The typechecker then *proves* no page can render unscoped — the bug class dies at compile time, same move as T-N1's required `eventName`.
3. `DeliveryHealthShell`/`DeliveryHealthPage` and `venue-writer.ts` join the same sweep; QuickSearch takes eventId from the provider (§1.8 trap).
4. Switching = context update + navigate to `/dashboard` (full remount of page tree via `key={eventId}` — no per-page cache invalidation subtleties).
5. Grep-gate in `scripts/checks/`: `evt_aie-ny-2026` forbidden outside `seed/`, fixtures, and tests — same teeth as T-N1's forbidden-literal check.

### 2.8 The eval angle, restated as acceptance

- Create event via UI (or API) → `/submissions` on the new event renders the empty list, `/dashboard` the empty pipeline — **no 500 anywhere in the route table** (verified feasible, §1.8).
- Both events visible in one control (switcher popover = CFP-17's "list/switcher").
- Scoping observable (CFP-18): switch → counts, lists, and search all change; the second event's shell shows zeros where the first shows the seeded program. Quick-search scoped (§1.8) or this item inverts.
- Reset leaves no created events behind (§2.5).

---

## 3. Decisions — ratified 2026-08-12 (Atin, live session)

1. **Reset/demo ruling — APPROVED:** events created in the demo org inherit `demo_mode=1`; the reset sweeps the demo org, not the seeded event id (§2.5).
2. **Selection mechanism — APPROVED:** event-less URLs + per-tab selection + `?event=` deep links now; URL-path scoping (`/e/:slug/…`) is the ratified v2 URL scheme, adopted in one sweep later (§2.4).
3. **Copy contract — APPROVED as specified** (§2.3): default-on formats/tracks/forms-closed/task-templates/email-templates/eval-plan-structure; venues default-off toggle; committees and people-data never.
4. **Keyboard path — APPROVED:** ⌘K gains "Switch to …" rows + arrow-navigable popover; **no new global chord**.
5. **DESIGN.md pin — APPROVED:** binding-prototype pin updated v1.9 → v1.11; this design + `prototypes/multi-event/` extend the switcher/create surface and fold into the binding contract via T-M2.

## 4. The build ticket (supersedes T-M; one ticket by Atin's ruling, 2026-08-12)

**T-M · Multi-event, end to end** — one ticket, one delegator, one PR. The work has a natural internal sequence (API → context → UI) but no seam worth a cross-agent handoff; splitting it would manufacture a dependency between two halves of one design.

**Contract:** this document (ratified §2–§3) + the visual companion `prototypes/multi-event/index.html`. Build order inside the ticket:

1. **Events API + copy engine** — `GET /api/v1/events` (org-scoped, role-visible, with status/demo_mode/dates/submission counts) and `POST /api/v1/events` per §2.2: one transaction, optional `copy_from` + `copy` sets per §2.3 with fresh IDs and remapped internal references (rooms→buildings, form_fields→forms, criteria→rounds), copied forms arrive closed, response reports per-set copy counts. Slug auto-derived, 409 + suggestion on per-org collision. `demo_mode` inherits `1` iff org = demo org — never client-settable.
2. **Demo ruling** — reset sweeps the demo **org** (every `WHERE event_id = 'evt_aie-ny-2026'` in `reseed-demo.ts` becomes the org-subquery form, §2.5). This is the T-O coordination point.
3. **Event context** — `EventProvider` in AppShell per §2.7: boot on `GET /events`, precedence `?event=` → sessionStorage → localStorage → `demo_event_id` → first; sweep all 16 hardcoded default props to **required** `eventId` props (typechecker enforces); QuickSearch scoped; `eventName` wired from the same object (absorbs T-N1's shell-name half — coordinate if T-N1 lands first); switch = context update + navigate to `/dashboard` with `key={eventId}` remount.
4. **UI surfaces** — switcher popover in the sidebar (v1.11 geometry: current block + `＋`; list per §2.6 with LIVE/DRAFT/DEMO chips, arrow/Enter/Escape, filter input only past 8 events); ⌘K gains "Switch to …" rows; `/conferences/new` with the three-card choice (scratch · from existing · Sessionize) and the copy-contract checklist + never-copies text, landing on the new event's dashboard with a receipt toast.
5. **Agent surface** — CLI `marquee events list` / `marquee events create --name … [--from … --copy …]`; SKILL.md gains the "next year's conference" recipe.
6. **Teeth** — `evt_aie-ny-2026` forbidden-literal check in `scripts/checks/` (outside seed/fixtures/tests); API tests for slug collision, copy remapping, demo_mode inheritance, org-sweep reset; smoke: create an event via UI, open its `/submissions` and `/dashboard` — empty states, no 500 (CFP-S1 step 12).

**AC (rubric floor):** CFP-17 — second event created via switcher `＋`, both coexist and are reachable from the popover list; CFP-18 — switching observably rescopes every gauge, list, and search; reset leaves no created events behind; no live mail can originate from the demo org.
