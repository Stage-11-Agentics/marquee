# MRQ-129 — Multi-event, end to end · implementation plan

**Delegator:** `agent:delegator-mrq-129`. **Branch:** `mrq-129-multi-event`, cut from `mrq-105-cold-start` (`2da16c4`), stacking on MRQ-105's PR.
**Contract:** the ticket description (authoritative) + `sequence/mrq-129-audit.md` (evidence) + `sequence/multi-event-design.md` §2/§3 (intent) + `prototypes/multi-event/index.html` (visual).
**Note on the contract docs:** all three live **uncommitted in the primary checkout** and are not in git on any branch. Read them from `/Users/atin/Projects/Stage11/deployments/Marquee/`; do not expect them in this worktree.

Every file:line below was re-read on this branch (post-MRQ-105), not inherited from the design's `4b2dc09` archaeology.

---

## 0. What MRQ-105 already ships, which I extend and do not rebuild

- `createEvent` — `src/routes/event-settings.routes.ts:228–280`. `policy: authenticated` + `requireOrgAdmin` (`src/lib/auth/org-admin.ts:21`), `uniqueEventSlug` scoped per org (`:124`), `demo_mode` inherited from `SHIPPED_DEMO_ORGANIZATION_ID` (`:260`). I extend its request body and its response `data`; I do not move it, rename it, or change its authority.
- `CreateConferencePage` — `src/ui/setup/CreateConferencePage.tsx`. I extend it with the three choice cards and the clone checklist, and pre-fill its date fields.
- The sidebar `＋` — `src/ui/shell/Sidebar.tsx:25`. Stays exactly as it is. The **caption beside it** (`:24`, `div.event-context`) is what I promote to the popover control.
- `remove-demo.ts` already demonstrates the org-sweep shape I need (enumerate demo events → R2 prefix per event → one batch). The reset sweep mirrors it.

---

## 1. `GET /api/v1/events` (new)

`src/routes/event-settings.routes.ts`, `operationId: listEvents`, `policy: { auth: { kind: "authenticated" }, rateLimit: "read" }`.
A `grants` policy 403s every caller on a collection route (`src/api/router.ts` `principalHasGrant`: `if (eventId === undefined) return false`), so authority is answered in the handler.

Handler:
1. `SELECT id, name, slug, status, demo_mode, starts_on, ends_on, timezone, venue FROM events WHERE org_id = ? ORDER BY starts_on DESC` on `auth.orgId`.
2. Keep an event iff `roleForEvent(auth.memberships, id) !== null`; for `auth.kind === "token"` additionally require `tokenEventAllowed(auth, id)` (`scope-resolution.ts:105`), so an event-restricted token sees only its events. A token with a `legacyRole` and no membership rows keeps the legacy path the same way `authHasRole` does.
3. Submission counts in one grouped query over the surviving ids.
4. Order: upcoming (`ends_on >= today`) ascending by `starts_on`, then past descending. `today` from the request clock, UTC date string — the same shape `starts_on` is stored in.

Response: `{ data: [{ id, name, slug, status, demo_mode, starts_on, ends_on, timezone, venue, role, submission_count, past }] }`.

**Zero and one event (audit M6).** The endpoint is honest about both, and the UI has a defined answer for each — see §4.

## 2. `GET /api/v1/events/{eventId}/copy-plan` (new)

`operationId: getEventCopyPlan`, `policy: grants ["program:read"]` (it has `{eventId}`, so the pipeline can answer it).
One round trip that tells the create screen the truth *before* it offers a checkbox: per-set counts, which sets are locked as prerequisites and why, and how many task templates will be skipped. Without it the checklist would either invent counts or discover its 422s after the organizer pressed Create.

```
{ data: {
    event: { id, name },
    sets: { formats: n, tracks: n, forms: {forms, fields, admins}, task_templates: {copied, skipped_fixed_due},
            email_templates: n, evaluation_plan: {plans, rounds, criteria}, venues: {buildings, rooms} },
    requires: { forms: ["formats","tracks"] | [], task_templates: ["forms"] | [] },
    reasons: { forms: "…bound dropdowns…", task_templates: "…form-kind templates…" }
} }
```

`requires.forms` is non-empty iff any copied field carries `config.source` (`migrations/0010_bound_form_options.sql`; the submit path resolves the answer back to a formats/tracks row **by name**). `requires.task_templates` is non-empty iff any source template has `kind = 'form'`.

## 3. The copy engine — `POST /api/v1/events` extension

Body gains:

```ts
copy_from?: string                       // an event id in the caller's org
copy?: { formats?, tracks?, venues?, forms?, task_templates?, email_templates?, evaluation_plan?: boolean }
```

Defaults when `copy_from` is present and `copy` is omitted: everything true **except `venues`** (design §2.3 — AIE may or may not return to the Sheraton).
`copy_from` that is not an event in the caller's org → `404 not_found` (never disclose another org's ids).

### 3.1 Copy by discovered columns, never a literal list

`copyRowsFor(table)` reads `SELECT * FROM <table> WHERE <scope>` and derives the column list from `Object.keys(row)` — the row itself is the schema. A column added by migration N+1 is copied without anyone remembering to update a list (audit B3).

The safety half: `src/lib/events/copy-manifest.ts` declares, per table, `{ key, scope, remap, nulls, constants, verbatim }` where `verbatim` names every column expected to travel unchanged. `tests/integration/multi-event.MRQ-129.test.ts` asserts, for each table, that `PRAGMA table_info(<table>)` equals `key ∪ remap ∪ nulls ∪ constants ∪ verbatim`. So: discovery means a new column is never silently *dropped*; the manifest test means a new column is never silently *leaked* — the migration that adds one trips the test and forces an explicit ruling.

### 3.2 The manifest, table by table, against the live schema

Everywhere below: `id` → fresh ULID, `created_at`/`updated_at` → `now`.

| Table | Set | `event_id`/parent | Nulled | Forced | Verbatim |
|---|---|---|---|---|---|
| `formats` | Formats | → new event | — | — | name, default/min/max_duration_min, position |
| `tracks` | Tracks | → new event | — | — | name, color, position |
| `buildings` | Venues (default **off**) | → new event | — | — | name, address, position, **lat, lng, access_minutes, access_note** (0002/0003) |
| `rooms` | Venues | `event_id` → new; `building_id` → copied building | — | — | name, capacity, position, av_capabilities, notes |
| `forms` | CFP forms | → new event | **`opens_at`, `closes_at`** (M9 — last year's window on next year's form) | **`status = 'closed'`** | name, slug (`uq_forms_event_slug` is per-event), kind, welcome_md, per_submitter_limit, min/max_speakers, max_sponsors, **password_hash**, reminder_offset_hours, thankyou_template_key, admin_notify_person_ids, turnstile_required |
| `form_fields` | CFP forms | `form_id` → copied form | — | — | key, label, help_text, type, required, position, **config**, **condition** — no id remap needed inside either blob: `condition` keys on `fieldKey` (`src/lib/form-conditions.ts:27`), `config` carries only `source`/`minItems` (audit m5) |
| `form_admins` | CFP forms | `form_id` → copied form | — | — | `person_id` verbatim — people are org-scoped |
| `email_templates` | Email templates | → new event | — | — | key (`uq_email_templates_event_key` is per-event), name, subject, body_md, enabled |
| `evaluation_plans` | Evaluation plan | → new event | — | **`status = 'draft'`** (M10 — column has no CHECK; `evaluation.routes.ts:1029` refuses assignment unless `open`, so draft is genuinely inert) | name, instructions, scale_min, scale_max |
| `evaluation_rounds` | Evaluation plan | `plan_id` → copied plan | **`committee_id`** (B3 — cross-event reviewer authority + a dangling FK after the org sweep), **`opens_at`, `closes_at`** (M9) | — | position, name, mode, anonymized, target_reviews_per_submission |
| `rubric_criteria` | Evaluation plan | `round_id` → copied round | — | — | name, weight_pct, position, **kind, options, scale_min, scale_max** (0009) |
| `task_templates` | Task templates | `event_id` → new; **`form_id` → copied form** (B4 — missing from every version of the design's remap list) | — | — | name, kind, description, due_offset_days, file_config, position, auto_assign |

**`password_hash` travels deliberately.** A form that was password-gated must not silently lose its gate when next year's organizer opens it. The form arrives `closed`, so nothing is exposed in the meantime.

**`form_admins` travel deliberately** and the screen says so. They are org-scoped teammates administering a form, not reviewer authority over content — which is exactly why committees do not travel. Contract text on the create screen names them so it is a stated decision, not a silent one (audit m10).

### 3.3 The two dependent-set rules, and the CHECKs that make them mandatory

- **`task_templates` → CFP forms.** `CHECK (kind <> 'form' OR form_id IS NOT NULL)` means nulling `form_id` **rolls back the whole `db.batch`** — a 500 on a checkbox combination the UI offered. So: when any source template has `kind = 'form'`, the CFP-forms set is a hard prerequisite. The checklist auto-checks and locks CFP forms with an inline reason; the API returns **422** naming the offending templates. Never 500.
- **CFP forms → Formats + Tracks.** Bound options resolve by name (`0010_bound_form_options`). Copying forms without them yields a form over an empty dropdown that cannot be submitted. Same treatment: locked in the checklist, **422** naming the bound fields.

### 3.4 `task_templates.due_at` — the ruling

`CHECK ((due_at IS NULL) <> (due_offset_days IS NULL))` forbids nulling `due_at` alone, and `due_offset_days` is **counted from the moment the task is assigned**, not from the conference start (`src/lib/task-due.ts:57`, `src/jobs/cascade/decisions.ts:330`). A derived offset would therefore be a fabricated number wearing a real column's name.

**Ruling: a template carrying an absolute `due_at` is not copied.** The count is reported per-set in the copy-plan and in the create receipt: *"3 templates with a fixed calendar deadline were not copied — their date belongs to last year's conference."* Templates on `due_offset_days` — which is what the chase work actually uses — copy normally.

### 3.5 Transaction, and the caveat worth stating

The event row and every copied row go into **one `db.batch()`**. The read phase (the `SELECT *`s) runs before that batch, so a concurrent edit to the source event during a copy yields a copy of a slightly-earlier state (audit m6). That is acceptable; it is stated rather than implied away. D1's real cap is 100 **bound parameters per statement**, not per batch (MRQ-56's `spikes/s3-d1-chunking/VERDICT.md`) — per-row inserts are far under it, and `reseedDemo` already commits a multi-hundred-row batch.

Response `201`: MRQ-105's `{ data: { event, formats, tracks } }` **plus** `data.copied` — per-table counts and `task_templates_skipped_fixed_due`. That object is the receipt the toast renders. MRQ-105's existing `created.data.event.id` read keeps working.

## 4. Reset — the org sweep (D1 **and** R2)

`src/lib/reset-demo/reseed-demo.ts`. Walked table by table rather than pattern-matched, because three of the 46 entries are not the shape the rewrite rule assumes:

- Every `WHERE event_id = ?` bound to `DEMO_EVENT_ID` → `WHERE event_id IN (SELECT id FROM events WHERE org_id = ?)` bound to `SHIPPED_DEMO_ORGANIZATION_ID`. **Never a literal** — the design's `'org_demo'` is the legacy seven-row fixture (`demo-fixture.ts:21`, "intentionally not used by reseedDemo"); the shipped org is `org_aie-ny` (audit m1).
- `mirror_outbox` (`:260`) is payload-JSON-scoped: `json_extract(payload,'$.event_id') IN (SELECT id FROM events WHERE org_id = ?) OR json_extract(payload,'$.org_id') = ?`.
- `api_tokens` (`:240`) and `memberships` (`:244`) already delete by org; their `OR event_id = ?` half becomes the subquery form.
- `events` (`:264`) becomes `WHERE org_id = ?`.
- `mirror_state` stays global and must keep surviving (`:75`).
- `magic_links`, `auth_sessions`, `people`, `organizations` are already org-scoped — unchanged.

**R2 (audit M4).** `deleteDemoObjects` (`:289`) is prefix-scoped to `uploads/<seeded event>/` and runs *before* the batch. New `deleteDemoOrgObjects(db, media, orgId)`: enumerate `SELECT id FROM events WHERE org_id = ?`, sweep each `uploads/<id>/` prefix, then run the batch — the same shape `remove-demo.ts:100` already uses. **R2 and D1 are not atomic with each other**: an event created between the enumeration and the batch leaves objects behind. Acceptable, stated, and the nightly `runUploadOrphanSweep` is the backstop.

Pre-existing and worth one line so nobody reads it as a multi-event regression: the reset already deletes every demo-org API token and auth session (audit n3).

## 5. Event context — `EventProvider` in `ShellEntry`

**`src/ui/app.tsx`, not `AppShell`** (audit M6). `/delivery-health` is a separate render root, and `AppShell` early-returns `HandoffPage`/`PortalPage`/`CoSpeakerPage`/`ReviewerPage` (`AppShell.tsx:132–135`) before its own layout. `ShellEntry` already wraps both roots and already owns the `useEventName` read.

`src/ui/shell/event-context.tsx`:

```ts
{ status: "loading" | "ready" | "empty" | "error", events, eventId: string | null, event, switchEvent(id), refresh() }
```

- **Boot** on `GET /api/v1/events` + the memoized `loadAuthMe()` (`identity.tsx:34` — module-memoized, so it costs nothing extra).
- **Precedence:** `?event=` → `sessionStorage` (per-tab) → `localStorage` (last used) → `demo_event_id` → first listed. **Every candidate is accepted only if it appears in the fetched list**; a stored id that no longer resolves is cleared from *both* storages before falling through (audit M7 — after the org sweep the created event is gone, storage still names it, and `resetDemo` ends in `location.reload()` at `AppShell.tsx:90`).
- **Never blocks rendering.** Children render immediately; `eventId` is `null` until resolved. `/portal`, `/co-speaker`, `/handoff` must work for a seat with zero events.
- **Rename channel:** listens to the existing `EVENT_NAME_CHANGED` (`identity.tsx:10`) rather than inventing a second one (audit m8).
- **Zero events:** admin routes render an honest `EmptyState` — "No conference is open to you yet" — with a Create conference action; the seat routes are untouched. **One event:** the control still opens, showing that one row and `＋ Create conference`; no filter input.
- **Switch:** validate → write both storages → strip `?event=` → `navigate("/dashboard")`. The routed subtree carries `key={eventId}` so every page remounts, and `switchEvent` aborts in-flight requests explicitly rather than trusting the remount to make late responses harmless (audit n4).

### The 18-site sweep (18 on this branch, verified by grep — not the design's 16)

Required `eventId: string` prop, passed from `AppShell` via `useEventId()`: `FormsPage:265`, `SpeakersPage:11`, `ProgramBoardPage:9`, `DeliveryHealthPage:270`, `CommsScreen:74` (module const → prop), `DashboardPage:168`, `ReviewerPage:9`, `SubmissionRecordPage:12`, `SubmissionsPage:239`, `CreateSubmissionPage:8`, `EvaluationPage:8`, `FilesPage:24`, `AgendaPage:22`, `SessionizeImportPage:69`, `OnboardingPage:11`.
Not props: **`venue-writer.ts:4,8,13`** — `DEFAULT_EVENT_ID` is a *default function parameter* on `loadVenueModel`/`saveVenueModel`; the parameter becomes required and `VenuesPage`/`VenueMap` pass it (a module API change, not a prop drill). **`DeliveryHealthShell.tsx:22`** — the separate root, fed from the provider.
Single-line fix: **`QuickSearch`** already declares `eventId: string` required; only its call site (`AppShell.tsx:190`) hardcodes the literal.
`src/lib/ids.ts:6` names the literal in a doc comment — rewritten to the generic `evt_<slug>` shape so the new grep-gate needs no allowlist entry for it.

## 6. UI

**The switcher.** `div.event-context` (`Sidebar.tsx:24`) becomes `<button class="event-context event-switcher" aria-expanded aria-haspopup="listbox">` with a `▾`. MRQ-125 killed the old `<a class="event-switcher" href="/dashboard">` on purpose — the new control opens a popover, it never navigates to the page you are already on.

*Geometry ruling (audit M13, CLAUDE.md "elements never jump").* The prototype's `.event-switcher` is a fully bordered, `9px 10px`-padded box; the shipped `.event-context` is a flat `border-left: 2px`, `2px 10px` caption inside a `stretch` row whose height is pinned by the 32px `＋`. **Shipped geometry wins.** The button resets UA styling (`background: none; border: 0; width: 100%; text-align: left`), keeps the identical `border-left`, padding and margins, and lays the caret out with `grid-template-columns: 1fr auto` so it adds no height. Hover/expanded change `border-left-color` and `background` only. The prototype's popover is reproduced as designed; only its trigger box is reconciled to the shipped caption. A node test asserts those declarations, and the browser pass screenshots the sidebar before/after.

**Popover** (per §2.6 and the prototype): name, dates and submission gauge in mono, `LIVE`/`DRAFT`/`DEMO` chips, current row marked, Upcoming above / Past greyed below, footer `＋ Create conference`, hint line, arrow/Enter/Escape, click-outside to close, filter input only past 8 events. It does **not** auto-dismiss on the post-create navigation, and both rows sit above the fold at 264px — CFP-17's evidence is a screenshot with both events visible (audit n2).

**Event-scoped external links (audit M14).** `route-table.ts` ships `{ id: "event-site", path: "/agenda", external: true }` and `{ id: "portal", path: "/portal" }`; the public agenda resolves its event from `?event=<slug>` (`public.routes.ts:18,45`). On event B, "Conference site" opens event A today. The Sidebar rewrites event-scoped external rows with the current event's slug.

**⌘K.** `QuickSearch` gains "Switch to …" rows above the server results when the query matches an event name, rendered even when the server returns nothing. No new global chord (ratified §3.4).

**`/conferences/new`.** Extends MRQ-105's page with the three choice cards (scratch · from existing · Sessionize), and for "from existing" a source select (default: current event) plus the copy checklist driven by `copy-plan` — real counts, prerequisites locked with their inline reason, the skipped-fixed-due line, and the never-copies text in plain language. **Every field pre-filled and submittable with only a name changed** (audit M12 — CFP-S1 step 12 arrives at turn ~65 of a 70-turn cap; a validation bounce on a required date costs turns the scenario does not have): dates default to a sensible window, timezone defaults, venue optional. Create → new event's dashboard + receipt toast.

## 7. Agent surface

`cli/registry.mjs` + `cli/marquee.mjs`: **`event list`** (the shipped root is singular — `event create|seed|show|set` — and consistency with the shipped CLI beats the ticket's `events` shorthand), and `event create` gains `--from <event-id>` and `--copy <sets>` sugar over `copy_from` / `copy`, with both also reachable through `--set`. `renderSkill()` gains the "next year's conference" recipe; `SKILL.md` is regenerated. MRQ-105 owns `renderSkill()` under a byte-equality test — this is an additive section and a regenerated file, flagged in the PR body.

## 8. The demo-event oracle (ticket item 8 / audit B5)

`src/routes/auth.routes.ts:393` is `SELECT * FROM events WHERE demo_mode = 1 ORDER BY created_at ASC LIMIT 1` — global and age-ordered. `npm run seed` (the documented production path) stamps `FROZEN_NOW = 2026-08-20`, **in the future**, so an event created today sorts first and becomes "the demo event" for the shell caption, the CLI's default event, this ticket's own precedence chain, and every eval scenario's boot.

**Resolve by identity:** the shipped demo event id when that row exists and is `demo_mode = 1`, falling back to the oldest `demo_mode = 1` row only when it does not (self-host, legacy fixture). Test: two `demo_mode = 1` events where the created one has the earlier `created_at`, and `/auth/me` still returns the seeded event.

## 9. Teeth

- `scripts/checks/check-shell-truth.mjs` gains `evt_aie-ny-2026` beside the existing `"AIE NYC 2026"` literal, sharing the seed/fixture allowlist (audit m3 — extend the scanner that exists, do not add a second one).
- **Integration** — one new Worker-backed file, `tests/integration/multi-event.MRQ-129.test.ts` (each file costs a Miniflare isolate against a 45 s budget): the manifest ⟷ `PRAGMA table_info` drift test; `committee_id` nulled; `task_templates.form_id` remapped; forms arrive `closed` with null dates; plan arrives `draft`; both illegal copy combinations return **422, not 500**; `GET /events` org scoping and token intersection; the org-sweep reset removing a created event; the demo-event oracle.
- **Unit** — the precedence/validation resolver as a pure function; popover keyboard behaviour; ⌘K event rows.
- **Node** — CLI registry parity, the CSS geometry contract, `SKILL.md` freshness.
- **Smoke** — create an event through the UI, open its `/submissions` and `/dashboard`: honest empty states, no 500.

## 10. Explicitly not mine

`.eval-kit/evalconfig.json` — gitignored third-party, an operator handoff recorded on the ticket. Nothing under `.eval-kit/` is edited or copied.

## Build order

API (`GET /events` → copy-plan → copy engine) → reset sweep → oracle fix → provider + 18-site sweep → switcher/⌘K/create screen → CLI + SKILL → teeth → `npm run pr-gate` → live browser validation → `lattice attach` → PR.
