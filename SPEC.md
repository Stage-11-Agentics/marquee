# Marquee — Technical Specification

**Status:** v1.4 contract revision for client prototype review · updated 2026-08-09; not yet signed for orchestration.
**Authority once signed:** this file is what the build fleet implements. `EVALUATION.md` says what "done" means; this says what the thing *is*. Where the two disagree, `EVALUATION.md` wins on verification and this file wins on shape — and the disagreement is a defect to reconcile, not a choice to make at build time.
**Upstream:** `PHILOSOPHY.md` · `sequence/USER_STORIES.md` (249 live criteria through AC-250; AC-239 struck) · `EVALUATION.md` · `sequence/research/seams-feasibility.md` · `sequence/research/competition-requirements.md` (R1–R50) · `sequence/research/seed-source-2025.md` + `sequence/research/sources/aie-summit-2025-program.json` · `prototypes/PROTOTYPE-CONTRACT.md`.
**Build scope:** Tier A + Tier B = **AC-1 – AC-169, AC-225 – AC-232, and AC-234 – AC-250 except struck AC-239** (193 live criteria). AC-233 is the named cut-line criterion and AC-170 – AC-224 remain modeled where cheap, not built (§10). Tier A's no-waiver additions are **AC-231, AC-234, AC-240, and AC-244–246**. Read the tier, not the number.

**Binding design candidate:** the **v1.4 Pipeline prototype** at `prototypes/pipeline-v1.1/index.html` (directory retained for lineage; 2,221 lines at this revision), together with `prototypes/pipeline-v1.1/DIRECTION.md`. It now demonstrates every loop-critical screen and the context-closure additions interactively. It becomes binding only after client sign-off; until then, no `DESIGN.md` is minted and orchestration does not begin.

**Prototype-to-product fidelity is a taste rule (`PHILOSOPHY.md`).** What the client signs in v1.4 ships one-to-one: the same information architecture, the same screen order, the same control placement, the same copy where copy is given. Divergence is a defect, not a liberty.

---

## 1. The product in one page

Marquee runs one conference's program lifecycle end to end: **call for speakers → review → acceptance → speaker onboarding → agenda → published event site.** The organizer's home is the **pipeline** — seven stages, each a count, each clickable into the work behind it:

```
Submitted → In Review → Waved → Accepted → Onboarding → Scheduled → Published
```

Three seats use it: the **organizer** (full admin), the **reviewer** (a queue and nothing else), the **speaker** (a portal: status, tasks, profile). A fourth audience — the public — never logs in: they submit on a form and read a published agenda.

Everything a human can do, a program can do: the admin UI is a client of the same REST API that a token-holding agent or the `marquee` CLI calls (`PHILOSOPHY.md` 3, AC-105).

---

## 2. Architecture

### 2.1 Runtime, decided

| Layer | Choice | Why (already ratified upstream — do not reopen) |
|---|---|---|
| Compute | **Cloudflare Workers, Paid plan**, one Worker, static assets bound | Free's 10 ms CPU will not render a 1,000-row table; fails at deploy, not in dev (seams trap 2) |
| Data | **D1 is the source of truth** | Airtable-as-primary loses R7 outright: 5 req/s per base, 30-hop serial pagination, no aggregation, no transactions (seams §1.3) |
| Mirror | **Airtable two-way mirror over the Records API**, `performUpsert`, webhook inbound, allowlisted fields, **never on a read path** | The honest positioning after swyx's Q1 ruling ("bonus points would be Airtable as source of truth"): we deliberately trade the full Airtable bonus for the speed win — *your team keeps its Airtable view without paying Airtable's latency* — and say so in the README. The explicit **API bonus (R53)** and Cloudflare bonus carry the bonus story instead. (Amendment 4; seams §1.4) |
| Files | **R2, browser→bucket direct via presigned PUT** (never through the Worker), Cloudflare Images for headshot variants | 100 MB body cap, 128 MB isolate; direct is also faster (seams §6.2) |
| Mail | **Resend**, from `Marquee <marquee@stage11.systems>` (verified since 2026-03-11) | Zero domain-warm-up risk; a fresh domain is trap 5 |
| Calendar | **ICS `METHOD:REQUEST` + ATTENDEE**, `SEQUENCE` bump, `METHOD:CANCEL`, plus Google/Outlook deep links and a stable `/i/{uid}.ics` | OAuth calendar write is verified infeasible in the window (seams §4.3, trap 1) |
| Async | **Queues** for the email outbox drain and the mirror drain; **cron** for pre-close reminders, webhook keepalive, orphan sweep | Retry semantics we should not hand-roll |
| Cache | **KV** for rendered public fragments (agenda, embeds) and rate-limit counters; never for sessions | KV is eventually consistent; a session must invalidate instantly (seams §2.5) |
| Bot defense | **Turnstile** on every public write that a stranger can originate: **draft *creation* (`POST /drafts`), the submit, and every upload presign**. Subsequent `PATCH /drafts/:token` autosaves are authorized by the single-use-issued draft resume token and rate-limited per token in KV — a Turnstile token is single-use with a short lifetime, so gating autosave would mean a challenge per keystroke batch, and AC-41's advancing "last saved" indicator would be unusable. | R19 puts an open write endpoint on the internet |
| Auth | **Roll-our-own on D1**: single-use magic-link tokens → HttpOnly session cookie | Fastest possible auth, no third-party branding in a speaker's inbox, no SaaS at the front door of a "Kill My SaaS" entry |
| Host | `marquee.stage11.dev` (HSTS-preloaded; `https://` always). **Cookies scoped to the exact subdomain, never the parent** | Stage 11 hard rule; trap 15 |

### 2.2 Application shape

Two rendering modes in one Worker, split by audience:

- **Public routes are server-rendered** (`/`, `/f/:formSlug`, `/agenda`, `/s/:sessionSlug`, `/p/:speakerSlug`, `/embed/*`, `/i/:uid.ics`). HTML arrives complete; JS hydrates only the interactive islands (form validation, agenda filters). This is how AC-36 and AC-85 (<1 s cold to interactive) are won — an SPA boot plus a fetch cannot be relied on to.
- **The admin app is a client-rendered SPA** served from static assets, which talks to the JSON API and nothing else. This is how AC-105 is won structurally: the admin UI has no privileged channel, because it has no channel at all except `/api/v1/*`.

Stack: **TypeScript · Hono (routing, middleware, OpenAPI assembly) · Preact (SPA + `preact-render-to-string` for public SSR) · Vite build · raw SQL against D1 through a thin typed query helper · numbered `.sql` migrations applied with `wrangler d1 migrations apply`.** No ORM: a migration-tool debugging session at 3 AM is exactly the research project seams §9 says we cannot afford. CSS is lifted from the v1.4 Pipeline prototype verbatim into design tokens plus per-module sheets — the prototype's visual language *is* the product's.

**Rule the fleet must not break:** the SPA may not read `document`-embedded bootstrap data for anything a route can return. Every admin read is a GET on `/api/v1/*`; every admin write is a non-GET on `/api/v1/*`. `check:api` replays a full loop and fails on any request path missing from the public OpenAPI document (AC-105).

### 2.3 Request paths, and what may never be on them

| Path | Budget | May touch | May **never** touch |
|---|---|---|---|
| Any admin page render | §1.3 of `EVALUATION.md` | D1, KV | Airtable, Resend, R2 list, any third-party fetch |
| Any public page render | ≤1 s cold | D1, KV, R2 public reads | Airtable, Resend |
| Any API read | ≤300 ms p95 | D1, KV | Airtable |
| Any write | — | D1, Queues (enqueue only) | Airtable (synchronously), Resend (synchronously) |

Mail and mirror writes enqueue; a queue consumer or cron does the third-party call. A synchronous Resend or Airtable call on a request path is a build defect regardless of whether a test catches it (guardrail G4, G5).

### 2.4 Identity, scale, and time

- **IDs are ULIDs** in a `TEXT PRIMARY KEY`, generated in the Worker, monotonic within a millisecond. The same value is mirrored to Airtable as `marquee_id` and is the `fieldsToMergeOn` upsert key (seams §1.4).
- **Instants are `INTEGER` epoch milliseconds, UTC.** Calendar dates (event start/end) are `TEXT` `YYYY-MM-DD`. Rendering applies `events.timezone`; changing that field changes every rendered time and every generated `DTSTART` with zero per-session writes (AC-6).
- **Every table is event-scoped** (`event_id`) except `organizations`, `people`, `memberships`, `api_tokens`, and `auth_sessions`, which are org-scoped — this is what makes AC-212 free and AC-214 enforceable. Multi-event is modeled; the UI ships single-event (§10).
- **Bulk writes chunk at ≤90 bound parameters** or use `json_each()` on a single JSON parameter. D1's cap is 100 and it throws only under real data (trap 11). Spike S-3 settles the pattern before wave-scale code is written.

---

## 3. Data model

Conventions: every table carries `id TEXT PRIMARY KEY` (ULID), `created_at INTEGER`, and — where mutable — `updated_at INTEGER`. `event_id`/`org_id` are `TEXT NOT NULL REFERENCES`. "Writer" is the route, job, or job-family that sets the field; "Reader" is the screen or output that consumes it. **A field with no writer or no reader does not ship** — it is a silent hole, and the fleet must delete it or report it.

### 3.1 Organization, event, taxonomy

**`organizations`** — the tenant. One row in the demo.

| Field | Type | Writer | Reader |
|---|---|---|---|
| `name`, `slug` | TEXT | seed; `PATCH /api/v1/org` | Event switcher, public footer, email from-name |

**`events`**

| Field | Type | Writer | Reader |
|---|---|---|---|
| `org_id` | TEXT | seed | scoping on every query |
| `name` | TEXT | Event settings save (AC-5) | Sidebar event switcher, topbar breadcrumb, public site, every email subject |
| `slug` | TEXT | seed | public URLs, embed URLs |
| `tagline` | TEXT | Event settings | public site hero |
| `starts_on`, `ends_on` | TEXT date | Event settings (AC-5) | agenda day tabs, public site header, ICS bounds |
| `timezone` | TEXT IANA | Event settings (AC-6) | every rendered time, `TZID`/`VTIMEZONE` in ICS |
| `venue` | TEXT | Event settings | public site, ICS `LOCATION` prefix |
| `logo_key` | TEXT R2 key | Event settings upload | admin shell, public site, embeds |
| `accent` | TEXT | Event settings | brand moments, embed colors (AC-90) |
| `status` | TEXT `draft\|live` | seed | public routes 404 when draft |
| `demo_mode` | INTEGER bool | seed / `reset:demo` | **the `POST /api/v1/auth/demo` gate (§4.1 — 403 when 0)**, demo-safe mail allowlist (G5), on-screen magic link **[beyond v1.4 prototype — acknowledged divergence, orchestrator ruling 2026-08-09: build per spec; fidelity audit must not flag it]**, demo banner |

**`formats`** (AC-8, AC-9, AC-10) — `event_id`, `name`, `default_duration_min`, `min_duration_min`, `max_duration_min`, `position`.
Writer: Event settings → Formats card; seed. Reader: form Format select, submission list filter, agenda tile duration default, agenda pool chip, public site.

**`tracks`** (AC-11, AC-12) — `event_id`, `name`, `color` (hex), `position`.
Writer: Event settings → Tracks card; seed. Reader: every list filter, agenda swimlanes, tile left-border, public agenda chips, embed colors.

**`rooms`** (AC-11, AC-13) — `event_id`, `name`, `capacity`, `position`.
Writer: Event settings → Rooms card; seed. Reader: agenda room columns/lanes, capacity shown while scheduling, ICS `LOCATION`, public agenda time gutter.

**`waves`** (R43) — `event_id`, `name`, `decision_on` date, `target_count`, `sent_at`, `position`.
Writer: seed; wave planner; bulk accept stamps `sent_at`. Reader: dashboard wave planner rows, portal "next wave date" copy (AC-44), submission record.

### 3.2 People and access

**`people`** — org-level, so a returning speaker is one person across events (AC-212).

| Field | Type | Writer | Reader |
|---|---|---|---|
| `org_id` | TEXT | signup/seed/import | scoping |
| `email` | TEXT UNIQUE per org | public form submit, import, admin invite | magic link, outbox `to_email`, ICS `ATTENDEE` |
| `name`, `title`, `company` | TEXT | Portal profile edit (AC-50), public form, import | speaker cards, chase board, public speaker page, merge fields |
| `bio` | TEXT | Portal profile edit | public speaker page, speaker drawer, session page |
| `headshot_attachment_id` | TEXT | Portal upload (AC-52) | gallery, session page, chase drawer |
| `social_links` | JSON | Portal profile edit | public speaker page |
| `is_demo` | INTEGER | seed | `reset:demo` scope |

**`memberships`** — `org_id`, `event_id` NULLABLE, `person_id`, `role` ∈ `owner\|program_lead\|ops\|reviewer\|speaker`.
Writer: seed, committee management, acceptance (grants `speaker` for that event), demo login. Reader: every authorization check. **`reviewer` rows always carry a non-null `event_id`; a reviewer membership is never org-wide (AC-214).**

**`auth_sessions`** — `person_id`, `role_hint`, `expires_at`, `created_at`, `user_agent_hash`, `revoked_at`.
Writer: magic-link exchange, demo login. Reader: cookie middleware on every authed request. Stored in **D1, not KV** — revocation must be instant.

**`magic_links`** — `token_hash` (SHA-256 of a 256-bit random), `person_id`, `purpose` ∈ `login\|draft_resume\|cospeaker_profile\|task_link`, `redirect_to`, `expires_at` (15 min for login, 30 days for draft resume), `used_at`.
Writer: `POST /api/v1/auth/magic-link`, submission confirmation, co-speaker invite, task assignment. Reader: `GET /auth/callback`. Single-use: `used_at` set inside the same statement that reads it.

**`api_tokens`** (AC-107) — `org_id`, `event_id` NULLABLE, `name`, `token_hash`, `prefix` (shown in the UI), `scopes` JSON, `created_by`, `last_used_at`, `revoked_at`.
Writer: Settings → API tokens; `marquee auth login` does not mint, it consumes. Reader: bearer-auth middleware. A revoked token 401s on the next call.

### 3.3 Forms

**`forms`** (US-07, US-08, US-13)

| Field | Type | Writer | Reader |
|---|---|---|---|
| `event_id`, `name`, `slug` | TEXT | Form builder | forms list, public URL `/f/:slug` |
| `kind` | TEXT `abstract\|session` | Builder, **at build time**, immutable once the form has opened (AC-21) | routing at submit (AC-22), form list badge, submissions `kind` |
| `status` | TEXT `draft\|open\|closed` | Builder publish/re-open; cron at `closes_at` | public route behaviour, open/closed/resumed previews (AC-31) |
| `opens_at`, `closes_at` | INTEGER | Builder | closed copy, pre-close reminder schedule (AC-127), public "closes Sep 12" line |
| `welcome_md` | TEXT | Builder → Welcome step (AC-30) | public form, above the first field |
| `per_submitter_limit` | INTEGER (default 3, **not a constant**, AC-32) | Builder | submit guard, cap copy (AC-220) |
| `min_speakers` | INTEGER **default 1** (AC-27) | Builder | public form add-person control, server guard |
| `max_speakers` | INTEGER default 4 | Builder (AC-27, AC-149) | ditto |
| `max_sponsors` | INTEGER (AC-28) | Builder | ditto |
| `password_hash` | TEXT NULL (AC-215, post-competition UI) | Builder | public gate |
| `reminder_offset_hours` | INTEGER (AC-127) | Builder → Messages step | cron scheduler |
| `thankyou_template_key` | TEXT (AC-33) | Builder | outbox on submit |
| `admin_notify_person_ids` | JSON (AC-33) | Builder | outbox on new submission |
| `turnstile_required` | INTEGER bool | seed default 1 | public submit |

**`form_fields`** (AC-17, AC-18, AC-24, AC-132–AC-134)

| Field | Type | Writer | Reader |
|---|---|---|---|
| `form_id`, `key`, `label`, `help_text` | TEXT | Builder | public form, builder list, live preview |
| `type` | TEXT — one of **`short_text`, `long_text`, `single_select`, `multi_select`, `url`, `email`, `file`, `number`** (all eight, AC-18) | Builder | renderer registry, validator registry |
| `required` | INTEGER | Builder | client + server validation (AC-25, AC-41) |
| `position` | INTEGER | Builder drag-reorder (AC-17) | public field order — **the builder's order is the public order, asserted deep-equal (AC-19)** |
| `config` | JSON — `{options[], min, max, minLength, maxLength, pattern, accept[], maxBytes}` (AC-24) | Builder field editor | both validators, preview |
| `condition` | JSON — `{all:[{fieldKey, op, value}]}` (AC-132) | Builder | client show/hide, server "hidden ⇒ not required, not persisted" (AC-133), builder list summary (AC-134) |

**One evaluator, one file.** The condition shape, client show/hide, and the server's hidden-not-required rule are evaluated by a single shared helper, **`isFieldApplicable(field, answers)` in `src/lib/form-conditions.ts`**. Every surface that asks "does this field apply right now" calls it: the public form (§5.5), the builder preview (§5.4), server-side submit validation, and the draft queue's applicable-missing-fields computation (§3.4, AC-249). It is built with the form builder in Wave 1, not with the rank-17 builder-summary affordance — the vendor conditional is a Tier A surface and a hardcoded alternate form is a defect (§5.4).

**`form_admins`** — `form_id`, `person_id`; UNIQUE(`form_id`,`person_id`). Writer: Builder → Messages & access. Reader: draft-queue and form-response authorization. Event program staff (`owner|program_lead|ops`) are authorized independently; reviewers and speakers are not.

### 3.4 Submissions — one table, two kinds (moat M1)

**`submissions`.** Abstracts and Sessions are one table discriminated by `kind`; this is the load-bearing shape of the product and the thing the video says nobody gets right.

| Field | Type | Writer | Reader |
|---|---|---|---|
| `event_id`, `form_id` NULL | TEXT | public submit, admin create, import | scoping, provenance |
| `kind` | TEXT `abstract\|session` | inherited from `forms.kind`; chosen directly on admin create (AC-118) | type chip in every list (AC-23), evaluation eligibility |
| `bypass_evaluation` | INTEGER bool — **default 1 when `kind='session'`** | derived at insert; admin toggle (AC-119) | schedulability without an evaluation record, "complete, not missing data" rendering (AC-22) |
| `title` | TEXT | submit, admin edit, import | every list, review card, agenda tile, public session page, merge field |
| `abstract` | TEXT | submit | review card, public session page |
| `status` | TEXT — **the enum ships complete: `draft`, `submitted`, `in_review`, `accepted`, `waitlisted`, `rejected`, `withdrawn` (AC-176)** | submit, bulk accept/reject, un-accept, reviewer promotion | pipeline counts, list chips, portal status, public visibility |
| `format_id` | TEXT | submit, admin edit | filters, agenda defaults (AC-74) |
| `primary_track_id` | TEXT | submit (first selected track), admin edit | swimlane default placement, single-track surfaces (Amendment 2) |
| `origin` | TEXT `public\|admin\|import` | insert site | origin marker in lists (AC-120) |
| `vendor_affiliation` | TEXT `none\|vendor_to_fi\|vendor_with_champion` | public form field, import | routing rules (AC-137) |
| `wave_id` | TEXT NULL | bulk accept | wave planner, portal "Accepted · Wave 2" |
| `submitter_person_id` | TEXT | submit | confirmation + status mail recipient (AC-223), record display (AC-224) |
| `decided_at`, `decided_by_person_id` | INTEGER/TEXT | any status transition (AC-121, AC-178) | audit column, record header |
| `submitted_at`, `last_saved_at` | INTEGER | submit / draft autosave | "last saved" indicator (AC-41), draft vs submitted distinction (AC-42) |
| `resume_token_hash` | TEXT NULL | draft creation | emailed resume link (AC-40) |
| `is_published` | INTEGER | publish action | public agenda visibility (AC-86) |
| `external_ref` | TEXT NULL | Sessionize import | idempotent re-import matching (AC-112) |
| `search_blob` | TEXT | trigger on write | quick search (AC-102–AC-104) |

**`submission_answers`** — `submission_id`, `field_id`, `value_text`, `value_json`. Writer: submit/draft-save. Reader: review card, admin record, export, import. Hidden-by-condition fields are **absent**, not null (AC-133).

**`submission_decisions`** (AC-235, AC-236) — `event_id`, `submission_id`, `decision` ∈ `approve\|maybe\|deny`, `resulting_status` ∈ `accepted\|waitlisted\|rejected`, `feedback_md` NULL, `decided_by_person_id`, `decided_at`, `outbox_id` NULL. Writer: **every status transition into `accepted|waitlisted|rejected` writes a row** — the confirmed record-owned decision action *and* bulk accept/reject/waitlist, which carry `feedback_md = NULL`. Reader: record history, decision-email merge field, speaker portal. The feedback is rendered once into the outbox and displayed from the same row in the portal; the two surfaces cannot diverge. **This is why bulk is included:** the demo's headline action is the wave accept, and if bulk skipped the decision row, the acceptance email for the 60 accepted seed sessions and for every judge-performed wave would render from a different path than the portal — leaving the "cannot diverge" guarantee true only for one-at-a-time decisions.

**`saved_views`** (AC-247, AC-248) — `event_id`, `person_id`, `name`, `config_json` containing `{q, filters, sort, columns[]}`, `created_at`, `updated_at`; UNIQUE(`event_id`,`person_id`,`name`). Built-in views are code-defined and immutable, not rows. Column IDs are the fixed registry in AC-248; `title` is mandatory. Writer: submissions table Save/Update/Delete view actions. Reader: the same user's submissions table in the same event. Event and person are both enforced in every query.

**Draft queue is derived, not copied** (AC-249): `status='draft'` plus `last_saved_at`, submitter email, and missing required fields computed against the form's currently applicable required fields **through `isFieldApplicable()` (§3.3), never against the full required set** — a draft is not incomplete for a field its submitter cannot see. Opening or PATCHing a draft cannot call the submit transition. The route requires `owner|program_lead|ops` or explicit form-admin membership.

**`participations`** — the `(person, submission, role)` triple. **One table at the first migration; retrofitting it is expensive and it gates AC-77, AC-153, AC-222.**

| Field | Type | Writer | Reader |
|---|---|---|---|
| `submission_id`, `person_id` | TEXT | submit, co-speaker add (AC-149), admin edit, import | speaker columns, agenda tiles, ICS `ATTENDEE` |
| `role` | TEXT `speaker\|co_speaker\|moderator\|chairperson\|submitter\|sponsor_contact` | ditto | conflict detection **across every role** (AC-77), per-role confirm (AC-153), record role labels (AC-224) |
| `position` | INTEGER | ditto | display order, "+N" collapse in lists |
| `confirmation_status` | TEXT `pending\|confirmed\|declined` — **per row, so one person confirms each role separately (AC-153)** | Portal confirm/decline (AC-152) | program lead view, agenda slot flag (AC-154) |
| `confirmed_at`, `invited_at` | INTEGER | portal / invite send | portal, chase board |

### 3.5 Evaluation

**`evaluation_plans`** — `event_id`, `name`, `instructions`, `scale_min`, `scale_max`, `status`. Writer: Evaluation plan screen (AC-53). Reader: plan card, reviewer queue header. **No step in plan creation is order-dependent (AC-55); evaluators may be assigned to an open plan.**

**`evaluation_rounds`** (AC-98) — `plan_id`, `position`, `name`, `mode` ∈ `scorecard\|comparison` (AC-163), `anonymized` bool (AC-63), `target_reviews_per_submission`, `opens_at`, `closes_at`. **Round-aware from the first migration; a third round is data, not a migration.**

**`rubric_criteria`** (AC-54) — `round_id`, `name`, `weight_pct`, `position`. Server rejects a set whose weights ≠ 100.

**`committees`** / **`committee_members`** (AC-56) — `event_id`, `name`; `committee_id`, `person_id`, `role`. Reader: committee card, assignment picker, per-evaluator progress (AC-58).

**`reviewer_track_scopes`** (AC-246) — `event_id`, `person_id`, `track_id`; UNIQUE(`event_id`,`person_id`,`track_id`). A queue candidate qualifies when `submission_tracks.track_id` intersects this set. That same intersection predicate lives in one authorization helper used by queue reads, submission detail, files, exports, and evaluation writes; a guessed out-of-scope ID returns 403. Committee management is the only UI writer.

**`round_assignments`** (AC-57) — `round_id`, `submission_id`, `reviewer_person_id` NULL, `committee_id` NULL, `status`. Two distribution modes: *everyone reviews everything*, and *N reviewers per submission distributed across the committee*. Reader: the reviewer's queue, coverage progress.

**`evaluations`** — `round_id`, `submission_id`, `reviewer_person_id`, `recommendation` ∈ `approve\|maybe\|deny` NULL, `score` NULL, `criteria_scores` JSON NULL, `comment`, `abstained` bool, `created_at`, `updated_at`. UNIQUE(`round_id`,`submission_id`,`reviewer_person_id`). **Recommendation is the Tier-A path and does not require a numeric score (AC-245);** configured scorecards remain optional evidence. Reader: queue resume position (AC-60), per-round recommendations/scores together on the record (AC-100), aggregate ordering.

**`comparisons`** (AC-164, AC-165) — `round_id`, `reviewer_person_id`, `submission_ids` JSON (exactly 3), `ranking` JSON (ties permitted). Aggregate order = win count. Switching a round's mode discards nothing (AC-166).

**`round_promotions`** (AC-99) — `from_round_id`, `to_round_id`, `submission_id`, `promoted_at`, `promoted_by`.

### 3.6 Agenda

**`agenda_items`** — the schedule. A scheduled session **is** its submission plus a placement; nothing is re-keyed (AC-72).

| Field | Type | Writer | Reader |
|---|---|---|---|
| `event_id` | TEXT | scheduler | scoping |
| `submission_id` | TEXT NULL UNIQUE | drag-drop placement | tile content, public session page |
| `kind` | TEXT `session\|break` | scheduler / "+ Add break" | agenda rendering; breaks carry their own `title` |
| `title` | TEXT NULL | breaks only | agenda |
| `starts_at` | INTEGER UTC | drop (AC-74) | all five views, ICS `DTSTART`, public agenda |
| `duration_min` | INTEGER — **defaults from the submission's format, resizable per item (AC-74)** | drop / resize | tile height, ICS `DTEND` |
| `room_id` | TEXT | drop | room column/lane, capacity display, ICS `LOCATION` |
| `track_id` | TEXT NULL override | scheduler | swimlane placement (AC-81) |
| `is_published` | INTEGER | publish | public agenda (AC-86) |
| `updated_at` | INTEGER | any edit | cross-view freshness (AC-82), embed propagation (AC-89) |

**Schedulability** (AC-71): an item may be created only for a submission whose status is in `event_settings.schedulable_statuses` — default `['accepted']`, configurable. Sessions with `bypass_evaluation` qualify without an evaluation record (AC-22, AC-119).

**Conflicts are computed, never stored.** `GET /api/v1/events/:id/agenda/conflicts` returns room overlaps (AC-76) and person double-bookings over **every participation role** (AC-77). Computation is one indexed pass over ≤400 items; it runs on every agenda read and is inside the 200 ms view-switch budget. A conflict **warns and never blocks** the placement (AC-79).

### 3.7 Speaker onboarding — the chase (moat M2/M3)

**`task_templates`** — `event_id`, `name`, `kind` ∈ `acknowledge\|file\|form` (AC-47), `description`, `due_at` or `due_offset_days`, `form_id` NULL (form tasks), `file_config` JSON (`accept[]`, `maxBytes` — AC-146), `position`, `auto_assign` bool.
Writer: Event settings → Tasks. Reader: acceptance cascade, chase-board columns.

**`speaker_tasks`** — `event_id`, `person_id`, `submission_id` NULL, `template_id`, `title`, `kind`, `description`, `due_at`, `status` ∈ `open\|done`, `completed_at`, **`cancelled_at` NULL (Amendment 15)**, `response_json`, `attachment_id` NULL.
**Cancellation is a nullable timestamp, not a third `status` value (AC-264).** Null means the task still matters; set means it stopped mattering, and when. This is deliberate: adding `'cancelled'` to the status enum would leave every existing `status='open'` read site — chase board, portal list, overdue trigger, comms selector — silently including work nobody wants, until each is separately found and fixed. Inverting it into a predicate (`cancelled_at IS NULL`) makes an unconverted read site wrong in review rather than wrong in production, and it carries *when*, which an enum does not. Same shape as `magic_links.used_at` and `imports.undone_at`. **`completed_at` is never written, cleared, or overwritten by a cancellation** — finished homework survives by construction. Writer: the un-accept cascade (cancel branch) and the acceptance reconciliation (restore). Reader: every count and every trigger, all of which filter on it.
Writer: acceptance cascade (auto-assign), admin add, **speaker completion (AC-48)**. Reader: portal task list ordered by due date (AC-46), chase-board cell glyph, dashboard overdue counts, organizer task view (AC-148).
`overdue` is derived (`status='open' AND due_at < now`), never stored — a stored flag goes stale between crons and AC-94 says the board is live.

**`attachments`** — `event_id`, `owner_type` ∈ `person_headshot\|task_upload\|event_logo\|import_file`, `owner_id`, `r2_key`, `filename`, `content_type`, `size_bytes`, `status` ∈ `pending\|ready`, `sha256`, `created_at`. **`sha256` is NULLABLE and `r2_etag` joins it — see Amendment 12.**
Writer: `POST /api/v1/uploads/sign` (pending) → `POST /api/v1/uploads/complete` (HEAD-verified, magic-byte sniffed, → ready). Reader: portal, gallery, task view. A `pending` row older than 24 h is swept by cron with its object.

### 3.8 Communications

**`email_templates`** — `event_id`, `key` (trigger key), `name`, `subject`, `body_md`, `enabled` bool, `updated_at`.
Trigger keys shipped (AC-125): `submission_confirmation`, `form_closing_reminder`, `added_to_submission`, `acceptance`, `rejection`, `task_assigned`, `task_overdue`. Plus non-trigger templates used by bulk sends: `reminder_generic`, `custom`. Plus the **auth keys** `magic_link_login`, `draft_resume`, `task_link` — every outbound message Marquee sends has an outbox row, including the login email, so the auth route enqueues and never calls Resend itself (G3, A-3).
Writer: Comms → Templates (AC-126). Reader: outbox render, preview (AC-115, AC-130).

**`outbox`** — the single record of everything Marquee sends. It is also the message log (AC-131, AC-188).

| Field | Type | Writer | Reader |
|---|---|---|---|
| `event_id`, `template_key`, `person_id`, `to_email` | — | every send path | comms log, speaker record message history |
| `subject`, `html`, `text` | TEXT — **rendered at enqueue, not at send** | send path | preview, log, judge-visible content |
| `ics_uid`, `ics_body` | TEXT NULL | invite paths | ICS attachment, `/i/{uid}.ics` |
| `status` | TEXT `queued\|sent\|suppressed\|failed` | queue consumer | log chip, gate evidence |
| `send_policy` | TEXT `demo_safe\|always_live` — **default `demo_safe`** | **exactly two call sites write `always_live`**: the public-form confirmation for an address the submitter typed *in this request*, and the `smoke:mail`/`smoke:ics` harness. Everything else takes the default. | the queue consumer's suppression rule (G3) |
| `suppressed_reason` | TEXT — e.g. `demo_mode_not_allowlisted` | demo-safe filter (G5) | log; **the judge sees the full rendered message with an honest "not delivered" label** |
| `idempotency_key` | TEXT UNIQUE — `sha256(template_key, entity_id, person_id)` | send path | **AC-117: a repeated bulk action cannot notify twice** |
| `provider_message_id`, `error` | TEXT | consumer | delivery outcome (AC-189) |
| `scheduled_for` | INTEGER NULL | pre-close reminder, scheduled sends | consumer eligibility |
| `sent_at` | INTEGER | consumer | log |

**`calendar_invites`** (AC-95–AC-97, AC-124) — `submission_id`, `person_id`, `uid` (`{submission_id}.{person_id}@marquee.stage11.dev`), `sequence` INTEGER, `last_method` ∈ `REQUEST\|CANCEL`, `last_sent_at`, `status`.
Writer: schedule/reschedule/un-accept. Reader: ICS builder — same `UID`, `SEQUENCE+1` on every material change; `METHOD:CANCEL` + `STATUS:CANCELLED` on reversal.

### 3.9 Airtable mirror *(US-72, AC-225 – AC-229)*

**`mirror_outbox`** — `table_name`, `row_id`, `op` ∈ `upsert\|delete`, `payload` JSON, `status`, `attempts`, `last_error`, `created_at`, `drained_at`.
Writer: an `afterWrite` hook on every mirrored table — **except `reset:demo`, which short-circuits the change feed**: it writes with `last_write_source='marquee'` and a `suppress_mirror` flag so no per-row `mirror_outbox` entry is enqueued, then enqueues **one** reconcile job at the end. Without this, every reset would queue ~1,000 submissions plus speakers and tasks as mirror upserts and drain at 10 records/PATCH ≤4 req/s ≈ 25 s+ of Airtable traffic per reset — during judging, against the base gate 9's manual demo runs on. Reader: queue consumer batching **10 records per PATCH** with `performUpsert.fieldsToMergeOn: ["marquee_id"]`, rate-limited to 4 req/s. **A local change reaches Airtable within 60 s of committing (AC-225)** — which is affordable precisely because the drain is asynchronous and off every read path.

**`mirror_state`** — `table_name`, `airtable_table_id`, `cursor`, `webhook_id`, `webhook_expires_at`, `last_sync_at`, `local_row_count`, `remote_row_count`, `last_error`.
Writer: drain, webhook receive, daily keepalive cron (trap 7) — **the keepalive refreshes `local_row_count` and `remote_row_count` on the same pass that advances the webhook expiry**, so the counts are never staler than 24 h without a drain. Reader: **Settings → Airtable** page — connected base link, both row counts rendered **"as of `last_sync_at`"** rather than as live figures, last sync, outbox depth, Sync now (**AC-228**), with webhook expiry surfaced *before* it can cause silent data loss (**AC-229**).

**Inbound allowlist** — inbound edits apply **only** these fields, per table, and everything else in Airtable is display-only and overwritten on the next outbound pass:

| Table | Inbound-writable |
|---|---|
| `submissions` | `status`, `primary_track_id`, `tracks` (names, comma-joined), `format_id`, `vendor_affiliation` |
| `speaker_tasks` | `status` |
| `people` | `title`, `company` |

An allowlisted edit applies within one webhook cycle; **an edit to any other field is ignored and logged, never partially applied (AC-226)**. Every row carries `last_write_source` ∈ `marquee\|airtable`, so a write that originated from the mirror does not bounce back and no record can enter a sync loop under sustained two-way editing (**AC-227**). Inbound is *pull-triggered-by-ping*: the webhook POST carries no data; the Worker calls list-payloads with the stored cursor (seams §1.2).

**An inbound status change does not run the acceptance cascade.** `submissions.status` is inbound-writable, and `PHILOSOPHY.md` 2 says status change *is* the notification — so this had to be stated rather than left to the fleet. An inbound write sets the status and `last_write_source='airtable'` and stops there: **no emails queued, no task sets assigned, no invites offered.** The record then surfaces **"changed in Airtable · cascade not run"** with a one-click **"run onboarding cascade"** action for a program lead. The alternative — cascading on inbound — means an ops person's spreadsheet edit can mass-mail hundreds of speakers, which is the same blast radius G3 exists to contain.

### 3.10 Operations and provenance

**`submission_tracks`** (Amendment 2, AC-234) — `submission_id`, `track_id`, `is_primary` (exactly one per submission). Writer: public form multi-select, admin edit, import. Reader: routing rules, reviewer track scoping, list filters (a submission appears under every track it carries), track chips on records; the swimlane places a session by its primary track (or the schedule item's override). Source: Discord ruling 2026-08-08 — *"talks are submitted to one or more tracks, and reviewers review one or more tracks."*

**`routing_rules`** (AC-135–AC-137) — `event_id`, `name`, `when_json` (`{field, op, value}` over track/format/vendor flag), `then_json` (`{plan_id}` or `{committee_id}`), `position`, `enabled`. Applied at submit; the applied rule id is stamped on the submission (`applied_rule_id`) and named on the record (AC-136). A `track` condition matches if **any** of the submission's tracks satisfies it (Amendment 2).

**`imports`** / **`import_rows`** (AC-109–AC-113) — `event_id`, `source`, `file_key`, `mapping` JSON, `status`, `undone_at`; per row `row_index`, `entity`, `outcome` ∈ `created\|updated\|skipped\|failed`, `reason`, `target_id`, `before_json`. `before_json` is what makes the whole import undoable as one batch (AC-113).

**`embeds`** (AC-87–AC-90, **AC-217–AC-218, AC-273–AC-274, Amendment 18**) — `event_id`, `kind` ∈ `agenda\|sessions\|speakers\|cfp`, `slug`, `config` JSON (tracks, statuses, colors; `cfp` ignores this entirely — its deadline, formats, and form link are read live from the event's primary form and `formats`, never stored). `speakers` additionally carries `layout ∈ cards\|list`, chosen in the embed dialog and carried in the snippet URL (AC-274). Served from `/embed/:slug`, cached in KV with a **30-second** TTL so AC-89's 60 s budget has headroom; every write to a published agenda item purges the key (`agenda`/`sessions`/`speakers`), and for `cfp` the same 30 s TTL alone is what makes AC-218's closed-state flip automatic — no purge call fires on a form's `closes_at` passing, the next cache read past the TTL just recomputes it.

**`webhook_endpoints`** (AC-241, Amendment 15) — `event_id`, `url` (https only), `secret_hash`, `events_json` (subset of the six-event allowlist), `enabled` bool, `created_at`, `last_delivery_at` NULL. Writer: **Settings → Webhooks** (`/settings/webhooks`). Reader: the delivery producer.
**`webhook_deliveries`** (AC-241) — `endpoint_id`, `event_type`, `payload`, `status` ∈ `queued\|delivered\|failed`, `attempts`, `response_code` NULL, `error` NULL, `created_at`, `delivered_at` NULL. Writer: `WEBHOOK_QUEUE`'s consumer. Reader: the deliveries log on the same screen — an integration that fails silently is worse than no integration, so a failed delivery is visible here before its owner notices. **`id` is the replay-idempotency key**: a redelivered `id` produces no second effect.

**`audit_log`** — `event_id`, `actor_person_id` NULL, `actor_kind` ∈ `user\|api_token\|system\|airtable`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `created_at`. Writer: every status transition and destructive action. Reader: record history, un-accept dialog, AC-178.

**`event_settings`** — key/value JSON per event: `schedulable_statuses`, `demo_safe_allowlist`, `ai_assist_enabled` (**default false**, AC-167), `anonymized_default`, `airtable`, `search_weights`. Writer: settings screens (`demo_safe_allowlist` from Communications) + seed. Reader: the code paths named above.

> **`demo_safe_allowlist` starts empty, and there is one way to fill it.** The key is
> read by `src/lib/demo-mail-allowlist.ts` — the single reader and writer, used by the
> mail consumer, the reviewer-invite honesty check, and the API — and written through
> `PUT /api/v1/events/{eventId}/demo-mail-allowlist` (`program:write`; read at
> `program:read`). The organizer's way in is **Communications → Real email**, beside
> the outbox that would otherwise hold the message. Nothing seeds it, so an untouched
> deployment holds an empty list and in demo mode every `demo_safe` message is written
> `suppressed` rather than sent; an address on the list is delivered for real and its
> row reads `sent`. `always_live` messages (the public CFP confirmation) never consult
> the list and dispatch either way, which is how we know the credential and payload
> are sound independently of this gate.
> One query settles what a deployment has actually sent:
> `SELECT count(*) FROM outbox WHERE provider_message_id IS NOT NULL` — zero means
> nothing has ever left. See `code/platform/resend.md` for the general pattern.

---

## 4. API surface

### 4.1 Auth model

Three credentials, one authorization layer:

1. **Session cookie** — `mq_session`, HttpOnly, Secure, SameSite=Lax, **`Domain` omitted so it binds to `marquee.stage11.dev` exactly** (trap 15, guardrail G6). Issued by magic-link exchange or demo login.
2. **Bearer API token** — `Authorization: Bearer mq_…`. Works with **no cookie present** (AC-107); revocation is immediate.
3. **Anonymous** — public routes only; writes require a Turnstile token.

Scopes resolve from `memberships`: `public` < `speaker` (own records only) < `reviewer` (assigned round work only, no admin routes — AC-159) < `ops` < `program_lead` < `owner`. **A reviewer token calling an admin route gets 403, and calling the anonymity toggle gets 403 (AC-63).** Reviewer scope is per event, never inherited across events (AC-214).

**Judge-facing auth affordances** (R25, and the demo is the rubric):
- `POST /api/v1/auth/demo` `{role: "organizer"|"speaker"}` → session in one click, no form, no email round trip (AC-1, AC-2). **Gated on `events.demo_mode = 1` for the target event: with `demo_mode = 0` the route returns 403 and sets no cookie.** This is a demo affordance, not an auth mode — the repo is public and AC-160 proves a stranger can stand up their own instance from the README, so an ungated route would ship every self-hosted instance a one-click `owner` session. The README (M-45) states that demo login exists only in demo mode and how to turn it off.
- `POST /api/v1/auth/magic-link` in demo mode returns the link **on screen** as well as to the outbox, so the real speaker-auth flow is exercisable in ten seconds. **It enqueues an `outbox` row under the `magic_link_login` key and never calls Resend directly** — the queue consumer is the only sender, in every mode (G3).
- `POST /api/v1/admin/reset-demo` → restores the seeded state, idempotent, safe mid-judging, and never observable in a partially-reset state by a concurrent visitor (**AC-230**, US-73; `EVALUATION.md` gate 13). Also a button in the product and an `npm run reset:demo` command. **The route enqueues the reseed to a Queue and returns a job id the button polls** — a full reseed of ~5–10 k rows cannot be asserted to fit one Worker invocation's CPU and subrequest limits, or D1's 100-bound-parameter cap, and AC-230's ≤20 s budget is about the **observable restore**, not a single invocation. The reseed **short-circuits the mirror change feed** (§3.9) and enqueues one reconcile job at the end.

### 4.2 Routes

`/api/v1` prefix throughout, with exactly three deliberate exceptions — the calendar and feed URLs `/i/:uid.ics`, `/agenda.json`, and the public server-rendered pages in §2.1 — which are consumed by calendar clients and feed readers that cannot be asked to follow a versioned API prefix. `check:api`'s route-manifest parity treats these three as a named allowlist, not as drift. Every route appears in the OpenAPI document (AC-106); the SPA uses only these (AC-105). List endpoints share a contract: `?page&per_page&q&sort&<filter>=` and return `{data[], page, per_page, total}` whose filter semantics match the UI's exactly (AC-108).

**Public (no auth)**

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/public/events/:slug` | event, tracks, formats, rooms |
| GET | `/api/v1/public/forms/:slug` | fields, order, conditions, limits, welcome, closed state (AC-31) |
| POST | `/api/v1/public/forms/:slug/submissions` | Turnstile; server-side validation is authoritative (AC-25); 4xx + zero rows on violation |
| POST | `/api/v1/public/forms/:slug/drafts` · PATCH `…/drafts/:token` | autosave, resume link (AC-40, AC-41) |
| POST | `/api/v1/public/uploads/sign` · `/complete` | Turnstile-gated presign (AC-146) |
| GET | `/api/v1/public/agenda` · `/sessions/:slug` · `/speakers/:slug` | published only (AC-83, AC-84, AC-86) |
| GET | `/api/v1/public/embeds/:slug` | filtered by track/status (AC-88) |
| GET | `/i/:uid.ics` · `/api/v1/public/agenda.ics` · `/agenda.json` | stable invite URL; feeds (AC-197 modeled) |

**Authenticated — speaker scope:** `GET/PATCH /me`, `GET /me/submissions`, `PATCH /me/submissions/:id` for organizer-permitted title/description editing (AC-237), `GET /me/tasks`, `POST /me/tasks/:id/complete` with kind-specific acknowledge/form/file payload validation, `POST /me/participations/:id/confirm|decline` (AC-152, AC-153), `POST /me/uploads/sign|complete`.

**Authenticated — reviewer scope:** `GET /rounds/:id/queue` (next unreviewed, position, remaining — AC-59, AC-60), `GET /rounds/:id/submissions/:submissionId`, `GET …/files`, `POST /rounds/:id/evaluations` accepting required `recommendation: approve|maybe|deny` and optional numeric scorecard fields (AC-245), `POST /rounds/:id/comparisons`, `POST /rounds/:id/abstain`, **`GET /rounds/:id/export?format=csv`** — the reviewer-scoped export of their own queue, which AC-64 and AC-246 both name and which had no route to point at; A-8's byte-scan and A-9's helper scan would otherwise sign a scan that covered nothing. Every read/write uses the AC-246 track-intersection helper in addition to assignment checks. Anonymized responses strip name, company, email, bio, headshot **from the query payload, not the template** (AC-64).

**Authenticated — admin scope** (`/events/:eventId/…`):

| Resource | Routes |
|---|---|
| Event | `GET/PATCH /` , `GET/POST/PATCH/DELETE /tracks|/rooms|/formats|/waves` |
| Forms | `… /forms` CRUD, `/forms/:id/fields` CRUD + `PATCH /reorder`, `/forms/:id/admins` CRUD, `POST /forms/:id/duplicate` (AC-20), `POST /forms/:id/publish|close|reopen` |
| Submissions | `GET /submissions` (filters: status including `draft`, kind, track, format, wave, origin, missing field, q), `POST` (admin create — AC-118), `GET/PATCH/DELETE /submissions/:id`, `POST /submissions/:id/decision` `{recommendation, feedback_md?}` (AC-235), `POST /submissions/:id/messages` (AC-236), `POST /submissions/bulk` `{selector, action}` where `selector` is **either ids or a filter — select-all-matching is a server concept, not a page of checkboxes (AC-66)**; actions `accept`, `reject`, `waitlist`, `withdraw`, `promote`, `assign` |
| Views | `GET/POST /views`, `PATCH/DELETE /views/:id`; always event- and person-scoped; built-in views are returned with `built_in:true` and reject mutation (AC-247, AC-248) |
| Participation | `POST/PATCH/DELETE /submissions/:id/participants` |
| Evaluation | `/plans`, `/plans/:id/rounds`, `/rounds/:id/criteria`, `/committees`, `/committees/:id/reviewers/:personId/tracks` CRUD (AC-246), `/rounds/:id/assignments`, `POST /rounds/:id/promote` (AC-99) |
| Agenda | `GET /agenda`, `POST /agenda/items`, `PATCH /agenda/items/:id` (move/resize), `DELETE`, `GET /agenda/conflicts`, `POST /agenda/publish` |
| Tasks | `/task-templates` CRUD, `/speaker-tasks` list + `POST /assign`, `GET /chase` (the board's matrix in one query) |
| Comms | `/templates` CRUD, `POST /comms/preview`, **`POST /comms/send`** `{selector, template_key?, subject?, body?}` — **exactly one of `template_key` or `{subject, body}`, enforced server-side; merge fields render in both** (AC-129, AC-130, **AC-250**), `GET /outbox`, `GET /people/:id/messages`. *(One route, one name: `/messages/send` and `/comms/send` were two names for one operation, and `check:api`'s registry parity is built to catch exactly that — at gate time.)* |
| Calendar | `POST /submissions/:id/invites` (send/resend), `POST /agenda/items/:id/notify` |
| Import | `POST /imports` (upload), `POST /imports/:id/mapping` (preview first rows — AC-109), `POST /imports/:id/run`, `POST /imports/:id/undo` |
| Airtable | `GET /mirror/status`, `POST /mirror/sync`, `POST /mirror/webhook` (unauthenticated but signature-checked) |
| Search | `GET /search?q=` — submissions, speakers, sessions, forms in one labelled list (AC-102) |
| Tokens | `GET/POST /org/tokens`, `DELETE /org/tokens/:id` |
| Webhooks | `GET/POST /webhooks`, `PATCH/DELETE /webhooks/:id`, `POST /webhooks/:id/test` (one signed test delivery), `GET /webhooks/:id/deliveries` (AC-241, Amendment 15). Outbound only — not to be confused with `POST /mirror/webhook`, which is Airtable **inbound**. Six event types (**Amendment 16, ratified 2026-08-11** — see below): `submission.created`, `submission.status_changed`, `evaluation.completed`, `speaker_task.completed`, `agenda.published`, `speaker.confirmed`. Delivery is `HMAC-SHA256` over `id.timestamp.body`, retried with backoff on `WEBHOOK_QUEUE`, idempotent on delivery `id`. **These routes exist in this table so `check:api`'s registry/OpenAPI parity has something to match — a promised feature absent from §4.2 fails the gate on its own PR** |
| Ops | `POST /admin/reset-demo`, `GET /admin/health` |

**Meta:** `GET /api/openapi.json`, `GET /api/docs` (rendered, linked from the app's sidebar — AC-106).

### 4.3 The CLI (US-69) rides on this and nothing else

`marquee` is a thin Node binary in `cli/`. Commands: `event seed|show`, `submissions list|show`, `submissions accept|reject --filter`, `tasks list --overdue`, **`remind --filter (--template <key> | --subject <s> --body <b>)`** (AC-250 — exactly one form, mirroring `POST /comms/send`), `agenda export`. Every command takes `--json` (parseable stdout, **logs to stderr**, AC-139), `--url`, `--token` (AC-140). `--help` enumerates the registry exactly (AC-141).

---

## 5. Screen-by-screen specification

Keyed to the v1.4 Pipeline prototype at `prototypes/pipeline-v1.1/index.html` (legacy directory name only). Every screen lists its states; **empty, loading, and error are part of the spec, not an afterthought** — AC-161 tests them on a fresh install and AC-4 crawls for stubs. No design decision is left to the implementer: where this section is silent, the signed prototype's markup is the answer.

**Global chrome (admin).** Left sidebar: brand → event switcher → **Program home** → *Pipeline* group (the seven stages, numbered 1–7, `Onboarding` routing to the chase board and the rest to the filtered submissions list) → *Modules* group (CFP forms, Evaluation plan, Review queue, Agenda, Speaker portal, Event site, Event settings) → footer (`⌘ API & CLI`, `↻ Reset demo`). Topbar: breadcrumb `AIE NYC 2026 / <screen>`, global search with `⌘K`/`/` (AC-101), user chip. Every module is one click from home (`PHILOSOPHY.md` 1). Toasts confirm; nothing that changes state is silent.

**Craft rules that are testable and therefore not optional:** elements never jump (reserve space for swapped labels; the reminder button is fixed-width; `—` replaces removed values; numerals are tabular); one primary action per screen; state is carried by text, never colour alone (asserted in AC-23, AC-42, AC-49, AC-120).

### 5.1 Landing `/` — public, server-rendered
*Covers AC-1, AC-2, AC-4.* Hero: eyebrow "Open-source conference program operations", headline **"Fantastic conferences, effortlessly."**, one paragraph, three actions — **[Enter as organizer →] [Enter as speaker] [View public CFP]** — and the line "No signup. Both demos open populated AIE NYC 2026 workspaces." Right: live pipeline preview with real counts from the seed. Footer: `Apache-2.0 · Self-hosted · API-first`. `View on GitHub` links to the public repo.
**States:** one. There is no loading state — the counts are server-rendered. **Neither demo button may ever land on an empty screen (AC-2).**

### 5.2 Program pipeline `/dashboard`
*Covers AC-14, AC-15, AC-16.* Page head: "Program pipeline", subtitle carrying the live wave/review pressure sentence, actions `[Event settings] [Work the pipeline →]`.
1. **Pipeline card** — seven stage buttons, each `name · count · delta →`. Every one navigates to the filtered work behind it (AC-15). `Onboarding` → chase board; the rest → submissions list pre-filtered.
2. **Attention strip** — four buttons: next wave (scrolls to the planner), unreviewed-by-track, **speakers overdue** (→ chase board), and **decided · not notified** (→ the built-in view, **AC-268**). The fourth holds its row at zero and states that every decision has reached its speaker; it never disappears, because a row that vanishes when healthy cannot be trusted when it appears.
3. **Wave planner** — Wave 1/2/3 rows: name, date+state, progress bar against target, accepted count.
4. **Work in motion** — four clickable metric boxes (reviews done, tasks overdue, unscheduled, conflicts) + review-pressure chips by track.
5. **Speaker task dashboard** — the four most-behind speakers with their outstanding task and overdue distance; full board one click away.
**Live-ness (AC-14, AC-94):** counts refresh without a manual reload. Mechanism: SWR poll at 5 s on the dashboard and chase board only, plus immediate optimistic update after any local mutation. (Chosen over SSE/WebSocket deliberately: a Durable Object per event is a materially less-travelled path inside this window.)
**States:** loading = skeleton tiles at final size (never a spinner that resizes the page); empty install = every tile reads `0` with a next-action link (AC-161); error = an inline banner with retry, never a blank page.
**Budget:** p95 ≤ 1000 ms full render on the seed.

### 5.3 Event settings `/settings`
*Covers AC-5 – AC-13.* Four cards: **Event details** (name, starts, ends, venue, logo upload, timezone select with the note "Agenda and calendar invites inherit this timezone"), **Formats** (name, allowed range, default duration; add/edit), **Tracks** (colored chips; add/rename/reorder), **Rooms** (name + capacity; add/edit). Primary action `Save event settings` confirms **in place with no page reload** (AC-7).
The v1.4 prototype demonstrates real add/edit/reorder controls. Track reorder is drag; room capacity is an integer input.
**States:** dirty-state save button; per-field inline validation; save failure states the failure (`PHILOSOPHY.md` 1 — "a save that fails, says so").

### 5.4 CFP forms & builder `/forms`
*Covers AC-17 – AC-21, AC-24, AC-27 – AC-33, AC-132 – AC-134.* Three-column builder: **steps rail** (Type & basics · Welcome · Form fields · Participants · Rules & routing · Messages · Publish) with the `Collects: [Abstracts | Sessions]` segmented control (fixed width; the note beneath swaps between "Enters the evaluation pipeline." and "Bypasses evaluation; ready for agenda." **without moving anything**), close date, submissions-per-person; **field list** (drag handle, label, type · required, ↑/↓ controls, `＋ Add a field`); **live preview** in a browser-chrome frame that matches the public form exactly (AC-19 asserts deep-equality of label/type/order/required).
Participants step: min speakers (**default 1**), max speakers, max sponsors. Rules & routing: validation per field, conditional logic (`Show this field when …`, visible in the list without opening a field), routing rules. Messages: welcome copy, thank-you, pre-close reminder offset, form admins.
Forms catalog: every event can carry multiple independent forms; each card shows name, kind, status, public/private detail, response count, and `Duplicate`. `+ New form` starts an unpublished form with zero responses; duplicating copies fields/rules but never responses. Selecting a form changes only that form's builder and publish target.
The baseline CFP visibly includes title, abstract, attendee outcome, format, **one-or-more tracks**, primary speaker name/email/role/company, biography, headshot, optional co-speaker, optional supporting file, and a vendor-content question whose product field and routing appear only when answered Yes. These are ordinary schema-driven fields/participants/files, not a hardcoded alternate form.
**States:** unpublished changes badge; open, closed, at-limit, and resumed-draft public previews; a form that has opened locks `kind` with an explanation, not a disabled control with no reason.

### 5.5 Public CFP form `/f/:slug` — public, server-rendered
*Covers AC-25, AC-26, AC-29, AC-30 – AC-42, AC-155 – AC-157, **AC-231**.* Public shell (event wordmark, `Resume draft`). Header block: "Call for speakers · closes Sep 12", headline, welcome copy, progress dots. Fields in builder order, with character counters where a max exists, the speaker-limit sentence **before** the first add-person control (AC-29), Turnstile, and a footer row: left `Draft saved locally · just now` (AC-41), right `Submit abstract`.
**Validation (AC-25, AC-26):** fires client-side on blur *and* server-side on submit; a failed submit moves focus to the first invalid field and states the problem in a sentence a non-technical submitter understands — no field names, no type names, no error codes, no bare "invalid" (this is exactly what checkpoint C3 reads aloud). Example strings, which ship as written: *"Use at least 8 characters so reviewers can identify your session."* · *"Tell reviewers a little more — at least 40 characters."*
**States:** open · **closed** (200 with a closed message, never an error; POST rejected server-side — AC-31) · at-limit (explains the cap and lists existing submissions — AC-220) · draft-resumed (private-link banner naming when it was saved and restoring all completed values/files) · submitted (confirmation screen + confirmation email with a link back — AC-38; **in demo mode the confirmation screen also renders the portal magic link on screen — "Open your speaker portal →" — by the same mechanism as §4.1's demo magic link**) · **submit failure** · password-gated (post-competition). Re-opening preserves the URL, drafts, responses, and limits.

**Why the on-screen link** (F-10): `competition-requirements.md` §3 has the judge open the form in incognito, submit as a speaker, *then log in as that speaker*. A judge who types `test@test.com` — the overwhelmingly likely behaviour on a demo — submits successfully and has no route into that speaker's portal, because `[Enter as speaker]` lands a different, seeded speaker. That breaks the continuity between loop steps 5 and 6. **Note for sign-off: the v1.4 prototype does not yet render this affordance**; it is one line of spec and one e2e assertion under AC-38, and the prototype should be shown carrying it before the fidelity rule binds.

**Submit failure** (F-11): a 5xx, a Turnstile challenge failure, a rate-limit 429 (reachable per-IP by AC-232), or a dropped connection mid-submit renders an **inline banner above the submit row** — never a blank page, never a lost form. It **preserves every entered value**, offers retry, and states that the draft is saved. `PHILOSOPHY.md` 1: a save that fails, says so. This is the one screen where a public stranger meets a failure, and its copy is read aloud at **C3** alongside the validation failures.
**Mobile:** every field type including file upload operable at 375 px, no horizontal scroll, focused field never behind the keyboard (AC-155, AC-156).
**Turnstile is verified server-side before the write commits and before any upload presign is issued; a missing, replayed, or invalid token is rejected with no side effects (AC-231).** Precisely: it gates **draft creation, the submit, and every presign**. Autosave `PATCH …/drafts/:token` carries no challenge — the single-use-issued resume token is its authorization, and it is rate-limited per token in KV. This is the intended shape of "before any public write commits"; a literal per-keystroke challenge would make AC-41 unusable, and quietly dropping Turnstile from an endpoint would leave an unmarked hole in a Tier A guardrail. This criterion is inside Tier A's no-waiver set — R19 puts an open write endpoint on the public internet for four days with a public repo pointing at it.
**Budget:** cold load → interactive p95 ≤ 1000 ms.

### 5.6 Speaker portal `/portal`
*Covers AC-43 – AC-52, AC-146 – AC-148, AC-152 – AC-154, **AC-233**.* Public-ish shell with `Sign out`. Head: "Welcome back" + name + tasks-done progress. **Status hero is the most prominent element on the screen (AC-43):** `Accepted · Wave 2` eyebrow, session title, `Format · Day · Time · Room`, `[Add to calendar]`. Pre-decision it reads a concrete next-wave date, never blank and never the bare word "pending" (AC-44).
Below: **Your tasks** (title, `kind · due`, state chip, `Complete/Update`; ordered by due date; overdue rows carry a textual `Overdue` marker). **Cancelled tasks (AC-265)** are out of this list and out of the `N of M tasks done` progress figure, rendered instead below a dashed divider under `Cancelled · N` with the reason stated **once** — a speaker whose talk was withdrawn is told why their homework vanished, not left to notice. A cancelled row carries no action button. **Only open tasks are ever cancelled**, so work the speaker already finished stays in the active list, still reading as done: the progress figure falls to `2 of 2` rather than erasing what they did. Opening a task renders its real kind: agreement acknowledgment, required form fields, or direct file upload; only a valid kind-specific payload completes it. The right stack is **Speaker profile** (avatar, name, title·company, bio, `Edit` → bio/headshot/title/company/social links, with crop preview before save) and **Speaker handbook** — handbook pages authored as static markdown per event, rendering inside the portal (**AC-233**, US-39). **AC-233 sits below the Tier B cut line**: it may be cut, and if it is, the gate report names it with its AC ID and reason (gate 19). Silently missing is a failure.
The status hero exposes organizer-controlled title/description editing (AC-237). A confirmed program decision renders its optional feedback immediately below the hero, stamped with decision/time, from the same row used to render the decision email (AC-235).
**Confirm/decline** sits in the status hero once accepted, **once per role held (AC-153)**.
**States:** submitted · in review · accepted · waitlisted · rejected (the outcome is visible here as well as by email — AC-116) · withdrawn. Multiple submissions render as multiple status cards (AC-221 modeled).

### 5.7 Evaluation plan `/evaluation`
*Covers AC-53 – AC-58, AC-98 – AC-100, AC-163 – AC-166.* Cards: **plan** (name, progress, two-round funnel diagram — Round 1 *Initial screen* → Round 2 *Committee decision*, each with committee size, progress bar, remaining count — and the scorecard line `Impact 40% · Specificity 35% · Novelty 25% · Comment` with `Edit scorecard`), **Program committee** (member rows with per-evaluator progress `188 / 200`, `Manage`, `View all 15 reviewers`), **Evaluation summary** (metric boxes + score-distribution sparkline), **Round promotion** (`Preview 240 promotions` → bulk promote from a filtered list — AC-99).
Round settings include **mode** (`Scorecard` default | `Comparison`) and **anonymized review**, both admin-only (AC-63).
Plan creation, scorecard editing, committee management, assignment distribution, promotion preview, and reviewer track-scope editing are real controls in v1.4. Assignment offers *everyone reviews everything* and *N reviewers per submission* (AC-57). Each reviewer row names its carried track responsibilities; changing them recalculates queue membership without replacing completed reviews (AC-246).

### 5.8 Reviewer queue `/review`
*Covers AC-59 – AC-65, AC-158, AC-159, AC-244–246.* Head: `N of M in your authorized tracks · K remaining · identity hidden`, chips `[Anonymous review]`, `[Exit queue]`, followed by the reviewer's explicit track-scope chips and the intersection rule. Left: one submission — format/track/id chips, title, abstract, "What attendees will learn" — opens the full evaluator-visible field/file detail in a modal and returns to the same queue position (AC-244). Right: the primary **Approve · Maybe · Deny** recommendation path, committee note, `Save recommendation & next →`, optional score buttons 1–5, and `Abstain / conflict`. Numeric scores are never required to submit a recommendation (AC-245).
Advancing does **not** navigate (AC-59) and resumes at the correct index on return (AC-60). **No admin chrome is present and no admin route is reachable from this surface (AC-159)** — the reviewer shell is its own layout, not the admin shell with items hidden.
**Comparison mode** renders three cards side by side with a rank control that permits ties (AC-164).
**States:** queue complete ("You've cleared your queue" + coverage) · not assigned · no matching track scope · anonymized (identity fields absent from the payload) · out-of-scope guessed record (403, no metadata leakage). Queue/detail/file/export/write authorization all call the same intersection helper (AC-246).
**Budget:** median score→next-card-interactive ≤ 300 ms over ≥20 advances.

### 5.9 Abstracts & sessions `/submissions`
*Covers AC-23, AC-66 – AC-69, AC-114 – AC-120, AC-247–249.* Head: `N matching records · rendered 50 at a time…`, actions `[Export] [+ Add session]`. Toolbar: search, status filter, **type filter (Abstract | Session)**, track filter, sort, and `Columns`. Above it, built-in and personal saved-view chips apply search/filter/sort/column-order together; personal views can be created, renamed, updated, and deleted and persist per user/event (AC-247). The column chooser shows/hides/reorders the fixed AC-248 registry while Title stays mandatory.
The immutable built-in **Decided · not notified** view (**AC-268, AC-269**) lists every record carrying a decision whose notification has not been sent, with the `Notified` column stating **which** of the three reasons applies — `Changed in Airtable`, `Not delivered`, `No valid address`. Its head action is a single `Notify N speakers`, counted over only the records that *can* be sent: a record with no address is excluded from the action, and the sentence says how many need an address first. Notifying writes a new outbox row against the existing decision row and never rewrites the decision.
The immutable built-in **Drafts needing attention** view shows a live count and columns for title, submitter contact, Draft status, last saved, and missing currently-applicable required fields. Opening/editing a draft preserves Draft status; only form admins and program staff can access this view (AC-249).
**Selection bar** appears above the table when anything is selected: `N selected`, `Select all N matching` (a server-side selector, not a page of rows — AC-66), `Reject…`, `Accept N abstracts`.
**Bulk accept modal (AC-67):** "Accept N abstracts into Wave 2?" with the downstream effects enumerated *before* the action — portal status updates, acceptance emails queued, speaker task sets assigned, calendar invites offered after scheduling — and the honest line that records without valid speaker emails will remain unchanged and appear in the result summary. On confirm: per-record success/failure summary; **the form stays open and new submissions still succeed (AC-68)**.
**Bulk reject (AC-115):** the same shape with a rendered preview of one real recipient's merged message before sending.
**Pagination:** 50 rows per page, server-side. `Showing 1–50 of 1,040` and Previous/Next; the empty result states what to clear.
**Budget:** 1,000-row list first interactive p95 ≤ 1000 ms; filter/sort re-render p95 ≤ 200 ms.

### 5.10 Speaker onboarding — the chase board `/onboarding`
*The strongest screen in the product. Covers AC-91 – AC-94, AC-128 – AC-131.* Head: `N accepted speakers still owe something. The most behind are first…`, primary `[Send reminder (N)]` — **fixed width so the count changing never moves the layout**.
Four metric buttons (Accepted speakers · Overdue tasks · At risk · Ready to schedule) double as filters. Chase toolbar: chips `All / Overdue / Incomplete / At risk` each with a live count, task-type select, track select, and `N shown · M selected`.
Matrix table: checkbox · **Speaker** (name button + `company · wave · N Sessions`) · Track (colored dot) · **one column per task type** with a state glyph (`✓ done`, `! overdue`, `× at risk`, `· upcoming`, `– cancelled`) · Last contact · `Nudge`. Rows sort by severity, then name.
**Cancelled tasks are not owed work (AC-265).** "Still owes something" is one predicate — neither done nor cancelled — and every count on this screen goes through it: the four metric buttons, all four filter-chip counts, the task-type filter, severity ordering, and the overdue totals. A cancelled task contributes zero severity, so a speaker whose only outstanding tasks were cancelled leaves the board — unless they hold **another** accepted session, whose work they still owe and whose row therefore stays.
**Speaker drawer** (click a name): chase summary (tasks done, wave, last contact), task lines with due dates, sessions with `Open in agenda`, **message history timeline**, biography and email.
**Compose drawer** (`Send reminder` / `Nudge`): template select, subject, body with `{{speaker.first_name}}` / `{{task.title}}` / `{{task.due_date}}` merge fields, a **merge-field preview rendered for one real recipient**, and `Queue reminder (N)`. Header states `Demo-safe outbox · no email will be delivered` when demo mode is on. Each send writes one outbox row per recipient and is logged on the speaker's record (AC-93, AC-131).
**Live (AC-94):** a speaker completing a task in another context updates this board with no report to run and no configuration first.
**Budget:** ~150 speakers × task matrix, p95 ≤ 1000 ms.

### 5.11 Agenda builder `/agenda`
*Covers AC-70 – AC-82.* Head actions: `[⚠ N conflicts]` (danger) and `[View public agenda ↗]`. Toolbar: **fixed-width view segment `List · Day · Week · Track · Room`**, day select, track select, snap select, `+ Add break`.
Left rail: **Unscheduled pool** — `N accepted Sessions ready to place`, filter input, draggable cards showing title, `format · Nm · speaker`, track color spine. The pool contains exactly the accepted-and-unplaced set (AC-70).
Board, five views:
- **Day** — room columns × time rows; cells are drop targets; tiles carry title, speaker, and a `⚠ Live conflict` flag.
- **List** and **Week** — chronological rows: day, time, title, speaker, track chip.
- **Track** — a **true swimlane per track** (lane label with scheduled count and total minutes, a day band per event day, slot columns). Colour overlay alone fails AC-81.
- **Room** — one lane per room.
Drag from pool → slot sets date, start time, and room; duration defaults from format and is resizable; a tile can be dragged back to the pool; **there is no save button** (AC-73 – AC-75). **Scroll position and active filters survive every one of the 20 ordered view transitions (AC-80).**
**Conflicts drawer:** every current conflict listed (`Room overlap`, `<Name> is double-booked`) with a jump that opens the track view on the right day. Conflicts warn, never block (AC-79).
**Budget:** view switch p95 ≤ 200 ms.

### 5.12 Event site `/agenda` (public) and embeds
*Covers AC-83 – AC-90, AC-217 – AC-218, AC-273 – AC-274 (Amendment 18).* Public shell with `Get embed code` and `Organizer demo`. Header: dates · venue, `Agenda`, `Subscribe to calendar`. Controls: day segment, track select, search. Session rows: time + room gutter, title (→ permalink), speakers (→ permalink), track chip. Only published records appear; an unpublished record's URL 404s with no title leakage (AC-86).
**Session and speaker permalinks** (`/s/:slug`, `/p/:slug`) cross-link both ways (AC-84) and are interactive in v1.4.
**Embed routes are anonymous-only.** `/embed/:slug` renders inside a third-party site's iframe, and the `mq_session` cookie is `SameSite=Lax` with no `Domain` (§4.1, trap 15) — so an embed that pulled an authed fragment would work locally for the logged-in organizer previewing it and silently degrade on the customer's site. Embeds **never read `mq_session` and never vary by identity**; `Cache-Control: public`, and the KV key carries no user dimension. Asserted under **A-5**, which already owns cookie behaviour. This holds for all four kinds, including `cfp`.

**Embed dialog** (Amendment 18, binding prototype v1.10): a four-format segment — `Agenda | Sessions | Speakers | Call for speakers` — equal flex widths. A Track select and a Layout segment (`Cards | List`) sit below it and are **always rendered**; each disables, never disappears, when its kind doesn't apply (Track for `cfp`; Layout for anything but `speakers`) — elements never jump. The copyable `<iframe …>` snippet's query string mirrors what is disabled: `track` is omitted for `cfp`, `layout=list` appears only when `speakers` and list are both chosen. Live preview updates per format. `Agenda` and `Sessions` are both itinerary reads over the same published-session query (time-led card vs. flat title/track/time row); `Speakers` renders the gallery in the chosen layout; `Call for speakers` renders the event's primary open form's deadline, formats, and a link to `/f/:slug`, flipping to its closed state from `closes_at` alone — no republish, no admin action, just the next cache read past the 30 s TTL. All four are responsive and inherit configured colors where applicable; `agenda`/`sessions`/`speakers` reflect a source change **within 60 s** (measured, recorded) and `cfp` reflects its form's close date on the same cache cadence.
**Budget:** cold interactive p95 ≤ 1000 ms; operable at 375 px.

### 5.13 Complete supporting screens demonstrated in v1.4

Each is specified here and demonstrated as a real route, overlay, modal, or stateful control in the candidate binding prototype; no toast stands in for the operation.

| Screen | Route | ACs |
|---|---|---|
| Global search results overlay (⌘K / `/`) | overlay | AC-101 – AC-104 |
| Admin submission record (detail, participants, answers, scores per round, applied routing rule, history) | `/submissions/:id` | AC-100, AC-120, AC-136, AC-224 |
| Admin create submission (abstract or session, bypass-evaluation toggle) | `/submissions/new` | AC-118, AC-119 |
| Un-accept cascade dialog (enumerates portal tasks, scheduled emails, calendar invites; cancel/retain each) | modal | AC-121 – AC-124 |
| Comms: templates, triggers on/off, outbox log with rendered previews and delivery outcome | `/comms` | AC-125 – AC-131, AC-189 |
| Task templates | `/settings/tasks` | AC-46, AC-47 |
| Import from Sessionize (upload → column mapping with first-rows preview → run → per-row outcomes → undo), **entry point named on the empty-event screen and in the README** | `/import` | AC-109 – AC-113 |
| Settings → Airtable (base link, both row counts, last sync, outbox depth, Sync now, live log, webhook-expiry warning) | `/settings/airtable` | **AC-228, AC-229** |
| Settings → API tokens | `/settings/api` | AC-107 |
| Settings → Webhooks (endpoint list with events and signing secret, add endpoint with https + event validation, send test, deliveries log with response codes and attempts) | `/settings/webhooks` | **AC-241** |
| Submissions → Decided · not notified (built-in view + `Notify N speakers`) | `/submissions?view=not-notified` | **AC-268, AC-269** |
| API docs (rendered OpenAPI, linked from the sidebar) | `/api/docs` | AC-106 |
| AI assist panel (off by default, labelled an aid, absent from the demo path) | `/evaluation/ai` | AC-167 – AC-169 |
| Empty-install states for every route | — | AC-161 |

---

## 6. Seed specification

The seeded demo *is* the product a judge sees. Generator lives at `scripts/seed/`, sourced from `sequence/research/sources/aie-summit-2025-program.json`, idempotent, and re-runnable as `npm run seed` and `npm run reset:demo`.

**Event:** AI Engineer New York 2026 · "Where AI Engineering Meets Wall Street" · **Oct 12–14, 2026** · Sheraton New York Times Square · `America/New_York`. **Clock frozen ~Aug 20, 2026: CFP open, Wave 1 dispatched, Wave 2 pending** — the only state in which multi-wave acceptance, speaker status, the task dashboard, and multi-round evaluation are all simultaneously alive on screen.

**Formats** (verbatim from the 2026 CFP): Stage Talk 15–20 m (default 20) · Workshop 1–2 h (default 90) · Lightning 5–10 m (default 10) · Online 5–55 m (default 25).
**Tracks:** AI in Financial Services (mainstage) · Agents · Evals · Infra · Open Models · RAG/Retrieval · Security · Leadership.
**Buildings** (Amendment 11): Sheraton New York Times Square, 811 7th Ave (ballrooms + Expo Stage) · Workshop Annex — Lower Conference Level, 811 7th Ave (Workshop Rooms A–E) · Online (virtual sessions; address "Virtual"). Three buildings exercise grouping, the ICS "Room · Building" location, and the Buildings settings card without inventing a second real venue.
**Rooms:** Metropolitan Ballroom (2,500) · Central Park Ballroom · New York Ballroom (1,200) · Expo Stage · Workshop Rooms A–E. Only the three named ballrooms are verified; everything else is labelled generically on purpose.
**Waves:** Aug 15 (sent) · Sep 1 (pending) · Sep 15 (planned). CFP closes Sep 12.

**Scale — two options; the client decides at review (recommendation: A).**

| | **Option A — faithful (recommended)** | Option B — sized to 2026 |
|---|---|---|
| Submissions | **1,000** | 1,200 |
| Accepted sessions | **60** (the exact Feb 2025 core, every record real and checkable) | ~115 (Feb 2025 core + CODE 2025 roster + fabricated) |
| Accepted speakers | 75 | ~150 |
| Acceptance rate | **6.0%** — bottom of AIE's published 5–15% band | 9.6% — mid-band |

**Recommendation: A.** The accepted set is the part a judge actually reads, and under A every row of it is real and verifiable; the 940-row rejected/pending pool still stress-tests speed and volume at full scale. **Note the collision with AC-3, which requires ≥150 accepted speakers** — A yields 75. Resolve one of three ways at review, in order of preference: (i) take **A′** — Option A's 60 real sessions plus the CODE 2025 roster as a second real, non-overlapping accepted pool, reaching ~150 accepted speakers with zero fabricated accepted people; (ii) take B; (iii) amend AC-3. **Flag F-2.** The build assumes **A′** unless told otherwise.

**Status mix** (Option A′ proportions): accepted Wave 1 ~32 · accepted Wave 2 decided-not-sent ~28 (so the demo has a live batch-accept to perform) · under review, committee-assigned ~200 · under review, unassigned ~150 · rejected ~550 · draft/incomplete ~40 · waitlisted ~70 · sponsor **Sessions** ~25–40 (bypass the competitive path).

**Deliberate ugliness** (`PROTOTYPE-CONTRACT.md`, asserted by `check:seed`): long names with diacritics and hyphenation (`Casey O'Connell-Singh`, `Mei-Ling de la Fontaine`) · titles long enough to truncate, and one absurdly long title · **a speaker on 3 submissions** · **a 4-person panel** · **an overdue task set** · **at least two live double-bookings visible in the agenda on load** · five parallel workshop rooms and expo sessions inside mainstage breaks (real conflict material from the 2025 grid) · one or two deliberately malformed records (a named speaker with no format) so validation has something honest to flag.

**Seeded task templates** (Amendment 4 — swyx's must-show examples from the full brief's screenshots; generic form/upload task kinds, not the AC-179/180 structured intake, which stays post-competition): every accepted speaker carries **"Hotel and Travel Reservations"** (form task) and **"Presentation Upload"** (file-request task) — these two lead the chase board and the portal — plus the optional four seeded across a subset: *Finalize talk description* · *Finalize bio & photos* · *Announce your participation* · *Invite colleagues*. Judges should meet their own task names on first load.

**Hard prohibitions — this repo is public** (`seed-source-2025.md` §9):
- **No real email addresses.** Generate `firstname.lastname@example.com`. The source payload leaked 59 real addresses; they were stripped at capture and must never reach the repo, the seed, or a log.
- **No real headshots.** No download, no hotlink, no re-host. **Placeholder imagery only:** deterministic initials-on-colour SVG avatars rendered locally, no external request.
- **Real names appear only on the real accepted core.** Never attach a real person to a fabricated *rejected* submission. Fabricated rows use synthetic names and plausible-but-invented companies.
- No phone numbers, passport/visa data, or realistic travel logistics; travel fields carry obviously-synthetic values.
- Session abstracts from the public 2025 program may be used verbatim for the 60 real sessions; never attribute a fabricated abstract to a real person.
- Ship `SEED-DATA.md`: derived from the publicly published AI Engineer Summit 2025 program, for demonstration; contact details, images, and all non-accepted submissions synthetic; no affiliation with or endorsement by AI Engineer.

**The demo organizer is also a reviewer.** The landing offers only `[Enter as organizer] [Enter as speaker]`, and the admin sidebar links **Review queue** — so the organizer demo persona is seeded a `reviewer` membership on the demo event, `reviewer_track_scopes` covering **every** track, and round-1 `round_assignments` over ~40 unreviewed submissions. Without this, walkthrough step 8 (*evaluate*) lands the judge on §5.8's "no matching track scope" state, which is a dead end mid-loop and an AC-4 zero-child list container. `check:seed` asserts the organizer persona's queue returns **≥20 unreviewed candidates** — also the material AC-62's 20-advance speed run needs.

**Airtable demo base** is pre-populated with the full seed before judging, on **Team plan or above** (Free caps at 1,000 records/base and the seed is exactly 1,000 — trap 6).

---

## 7. Guardrails

Each carries an enforcement criterion and **a demanded audit ticket** — a ticket the orchestrator must schedule and an auditor must sign, not a hope.

| # | Guardrail | Enforcement criterion | Audit ticket |
|---|---|---|---|
| **G1** | **No secret material, no Stage 11 internals, no `Atin/` content, and no redistributed third-party material in the public repo** | The public repo is **created from an orphan/squashed initial commit** (ticket M-56), never curated at the tip of a history that already carries the material. `npm run check:repo` — `gitleaks` + a Marquee ruleset, `Atin/` and internal-path scan, and a **third-party-content denylist** (`sources/`, `*.pdf`, `competitor-*`, `AGENT-BRIEF-*`, `run-state`, `C11_`, `surface:`, `workspace:`, `/Users/`) — over **full history**, not the tip; Apache-2.0 present; research docs curated | **A-1 · repo hygiene** — run at every milestone, against the assembled orphan history before the push, and **mandatorily against the pushed remote's full history** after it (`EVALUATION.md` gate 16) |
| **G2** | **The PROTOTYPE badge never appears in product code** | `check:repo` greps `src/` and the built bundle for the badge markup and the string `PROTOTYPE`; the badge exists only under `prototypes/` | **A-2 · badge sweep** — grep + visual pass over every product route (gate 15) |
| **G3** | **Demo-safe email from the first commit: in demo mode the app is *incapable* of mailing a non-allowlisted address** | The allowlist check lives in the **queue consumer**, the single choke point through which every send passes — not in each call site. Its rule is one line: **suppress unless `outbox.send_policy = 'always_live'` or `to_email` is in the allowlist.** The consumer cannot make the AC-38 exception on template key alone — every seeded submission carries `submission_confirmation` too — so the *decision* is made at enqueue by the two call sites permitted to write `always_live` (§3.8), and the consumer only enforces it. A test injects sends from all seven triggers plus bulk paths with demo mode on and asserts **zero** provider calls to non-allowlisted addresses, and that each is recorded `suppressed (demo mode)` with its full rendered body. One deliberate exception, tested: a **live submitter's own address on the public form is never suppressed** (AC-38, `smoke:mail`) | **A-3 · mail containment** — including a code-level assertion that no module imports the Resend client except the consumer, and an **enumeration of every `send_policy='always_live'` write site asserting there are exactly two** |
| **G4** | **Airtable is never read on a request path** (US-72's non-negotiable) | Static check: the Airtable client is importable only from `src/jobs/mirror/*`; a lint rule fails any import elsewhere. Runtime: every mirror call is tagged and `check:speed` asserts zero mirror calls during page renders. This is what lets **AC-225**'s 60-second budget coexist with R7 rather than fight it | **A-4 · mirror isolation** |
| **G5** | **No third-party call is synchronous on a write path** | Writes enqueue only; the consumer calls out. Asserted by the same import-boundary lint (Resend + Airtable clients confined to `src/jobs/*`) | folded into A-3/A-4 |
| **G6** | **Cookies scoped to the exact subdomain, and no session is issued outside its stated conditions** | The session cookie is set with **no `Domain` attribute**; a test asserts the `Set-Cookie` header contains no `Domain=`. `https://` always (`.dev` is HSTS-preloaded). **`POST /api/v1/auth/demo` 403s unless the target event's `demo_mode = 1`, setting no cookie (AC-2)** | **A-5 · cookie scope and session issuance** — enumerate every route that mints an `auth_sessions` row and assert each one's precondition, including the demo route's `demo_mode` gate |
| **G7** | **Every list surface is budgeted and measured** | `check:speed` covers, at minimum: dashboard, submissions list (1,000 rows), filter/sort re-render, chase board, review-queue advance, agenda view switch, search, public form cold, public agenda cold, portal, embed propagation, bulk-accept main-thread task. p95 over budget = non-zero exit (`EVALUATION.md` §1.3) | **A-6 · speed report** — `speed-report.json` attached to the gate with actuals |
| **G8** | **Public writes are bot-defended and upload-safe** | **AC-231** — Turnstile verified server-side before any public write commits and before any presign is issued; missing, replayed, or invalid tokens rejected with no side effects. **AC-232** — extension **and** MIME allowlist at presign, **magic-byte sniff on completion with a mismatch rejected and the object deleted**, per-IP and per-submission caps in KV, served from an origin separate from the app with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` | **A-7 · public write surface** |
| **G9** | **Blind review leaks nothing, anywhere** | Identity is stripped **in the query layer for reviewer-scoped reads**, so API responses and exports are covered by construction; AC-64 byte-scans every reviewer-visible response and export for seeded identity strings | **A-8 · anonymity scan** |
| **G10** | **Reviewer scope never crosses events or assigned tracks** | Every `reviewer` membership carries a non-null `event_id`; AC-214 asserts event-A/event-B isolation. AC-246 mechanically scans that queue, detail, file, export, and evaluation-write routes all call the same track-intersection authorization helper, then probes an out-of-scope ID for 403 with no metadata leakage | **A-9 · reviewer-scope isolation** |
| **G11** | **Bulk operations never exceed D1's bound-parameter cap** | All bulk paths go through one chunking helper (≤90 params or `json_each`); a test drives 150- and 1,000-record selections | **A-10 · bulk-write audit** (trap 11) |
| **G12** | **Demo resettable between judges** | **AC-230** — `npm run reset:demo` (and the in-product button) ≤20 s, idempotent under repeat invocation, safe mid-judging, never observable in a partially-reset state by a concurrent visitor; second judge inherits nothing (gate 13) | **A-11 · reset drill** |

---

## 8. Non-goals

Copied so nothing creeps back in. **The auditor must not raise any of these as a defect.**

**Explicit SKIPs** (`USER_STORIES.md` traceability table, `PRODUCT-DEFINITION.md` §3): **R33 payment/ticketing · R39 multi-language · R8 CRM, marketing, CMS · SMS · AI agenda builder · attendee ticketing and attendee app · speaker availability constraints · optimal reviewer assignment.**

**Deliberately out of scope for this build** (`EVALUATION.md` §5, ratified 2026-08-08 and clarified 2026-08-09): OAuth calendar write (ICS `METHOD:REQUEST` is the shipped path; OAuth is a documented extension point) · Airtable as primary datastore · malware scanning of uploads · multi-round beyond two · multi-event UI (modeled, not built) · custom sending domain · D1 read replication and Smart Placement · **Month agenda view** (it appeared only as a label in a context reference image, never as a desired capability) · **a generalized CMS or arbitrary resource-page system** (R8 remains an explicit SKIP). The narrow Speaker Handbook and configured agenda/speaker embeds are product features, not a generalized CMS.

**Not a defect:** a Tier B story below the cut line, provided the gate report names it (`EVALUATION.md` gate 19).

---

## 9. Vocabulary

The words on screen are the words a program team already uses (`PHILOSOPHY.md` 6): **Abstract · Session · Speaker · Submitter · Evaluation plan · Round · Scorecard · Committee · Portal · Task · Handbook page · Agenda · Break · Event site.** The `waitlisted` status displays as **"Maybe"** on chips and filters (Amendment 4 — swyx's ruled review floor is approve/**maybe**/deny; the judge should meet their own word), with "waitlist" acceptable in explanatory copy. Banned synonyms, asserted absent from `SKILL.md` (AC-144) and to be avoided in product copy: *proposal, talk submission, CFP entry, panel review*. Buttons say what they do — `Accept 37 abstracts`, never `Submit`.

---

## 10. Modeled but not built

`AC-170 – AC-224` are post-competition. The schema carries them where carrying them is nearly free and retrofitting is not: the **complete status enum including `waitlisted`** (AC-176), the **`(person, submission, role)` triple** (AC-222, AC-224, and it gates AC-77/AC-153 in scope), **org-level people** (AC-212), **round-aware evaluation** (a third round is data), **per-event reviewer scope enforced from the first migration** (AC-214), and `agenda_items.kind='break'`. No UI ships for them and the auditor does not test them.

### Named known limitation — the submitter and the speaker are the same person *(Amendment 15)*

**What ships:** the public CFP collects one email address, under `Primary speaker`. Whoever fills the form becomes both the submitter and the speaker on the record. So when an assistant submits on behalf of their director, every downstream artifact — confirmation, portal magic link, task assignments, the decision email, and the calendar invite — goes to the assistant, and the person who actually has to do the work is never contacted.

**What is already modeled:** `submissions.submitter_person_id` is a real column, `participations.role` already includes `submitter` alongside `speaker`, `people` is org-level and keyed by email, `speaker_tasks.person_id` is per-person, and auth is a per-person magic link. **`AC-223` and `AC-224` already specify the correct behaviour** — confirmation and status mail to the submitter, task and profile requests to the speaker, both on the record with roles labelled — and sit in the post-competition band above. Two addresses would therefore mean two `people` rows and two independent portals, with no session or login ambiguity; the only genuinely new surface is a submitter who holds no speaker role opening the portal, which needs one honest empty state rather than a state-model change.

**Why it is named here rather than fixed:** ruled extra credit (2026-08-10). This paragraph and `EVALUATION.md` gate 19 exist so it is a *documented deferral with AC numbers* rather than something a judge discovers live. Drafted criteria are held unminted in `sequence/research/state-model-gaps.md` Part 2; mint from AC-270 if the if-capacity band opens.

---

## 11. Flags for the orchestrator

Deviations and gaps, raised rather than silently forked (living-artifacts norm). **All prototype-contract gaps are closed in v1.4, and F-2's seed-source choice was ruled A′ on 2026-08-09. No flag in this table is open.**

| # | Flag | Status | Resolution / recommendation |
|---|---|---|---|
| **F-1** | **The Airtable two-way mirror had no acceptance criterion** — `EVALUATION.md` gate 9 and the competition's *larger* stack bonus, uncovered. | ✅ **RESOLVED** | **`US-72` · Genuine two-way Airtable mirror, Tier B rank 8** (directly after US-68, the API story it rides on), carrying **AC-225** (local change reaches Airtable ≤60 s) · **AC-226** (allowlisted inbound applies within one webhook cycle; non-allowlisted ignored and logged, never partially applied) · **AC-227** (echo suppression; no sync loop under sustained two-way editing) · **AC-228** (Settings → Airtable shows base link, both row counts, last sync, outbox depth) · **AC-229** (keepalive cron survives 7 days; expiry visible before silent data loss). Built by M-25/M-26 and **not cuttable**. |
| **F-2** | **Seed scale collides with AC-3.** AC-3 requires ≥150 accepted speakers; the recommended faithful seed (Option A) yields 75. | ✅ **RESOLVED** — A′, Atin, 2026-08-09 | Ships **A′** — the 60 real Feb-2025 sessions plus the real, non-overlapping CODE-2025 roster, reaching ~150 accepted speakers with zero fabricated accepted people. Closed in `run-state.md`'s decision log; no open human action remains. |
| **F-3** | **Speaker Handbook page** (brief item 8, present in the v1.1 portal) had no story and no AC. | ✅ **RESOLVED** | **AC-233**, appended to `US-39`. Static markdown per event, rendering in the portal. Hosted on a Tier A story but **explicitly below the Tier B cut line** — cuttable, provided the cut is named in the gate report (gate 19). Tier A's no-waiver additions are AC-231, AC-234, AC-240, and AC-244–246. |
| **F-4** | The original v1.1 prototype rendered several loop-critical affordances as toasts (public session/speaker permalinks, admin manual entry, plan/scorecard/committee editing, add break, export). | ✅ **RESOLVED in v1.4** | §5.13's operations now have interactive routes/modals/controls in the candidate binding prototype. Static/runtime verification must still prove every control, but no build-time design choice remains. |
| **F-5** | `reset:demo` was `EVALUATION.md` gate 13 and a product button with no AC. | ✅ **RESOLVED** | **`US-73` · Reset the demo, Tier B rank 3**, carrying **AC-230** — command *and* button, idempotent under repeat invocation, safe mid-judging, never observable in a partially-reset state. Built in Wave 0 (M-03) even though it ranks in Tier B, because the demo logins need it from the first deploy. |
| **F-6** | **Turnstile, upload magic-byte sniffing, and per-IP caps** (guardrail G8) had no AC. | ✅ **RESOLVED** | **AC-231** appended to `US-14` — server-side Turnstile before any public write or presign; **inside Tier A's no-waiver set**, because R19 puts an open write endpoint on the public internet for four days with a public repo pointing at it. **AC-232** appended to `US-41` — extension + MIME allowlist, magic-byte sniff with deletion on mismatch, per-IP/per-submission caps, separate serving origin. |
| **F-7** | **AC-89 (embed reflects a change within 60 s) vs KV caching.** | Recorded decision | Spec'd at a **30 s TTL with explicit purge on publish**, so the number is a decision rather than an accident. |
| **F-8** | **Live-ness mechanism for AC-14 / AC-94** is a 5 s SWR poll, not a push channel. | Recorded decision | "Real-time" in the brief; polling is the honest, low-risk read of it inside the window. Revisit only if the Sunday video says otherwise. |

---

## Amendment 5 — program board + scheduled/published legibility (2026-08-09)

**New screen — Program board `/board`** (US-75, AC-238 and AC-243; **AC-239 struck**): read-only Kanban across the seven lifecycle stages, every submitted record a card (title, speakers, track chips, time-in-stage), filters for text/type/track/format/wave. Cards never drag and contain no lifecycle actions; click/Enter/Space opens the exact record. The three *derived* columns (Onboarding, Scheduled, Published) state their entry action. Virtualized columns; full-seed fast. Drafts stay in the dedicated AC-249 queue and do not appear as Submitted board cards.

**Scheduled/published legibility** (AC-240): scheduled rows everywhere show `day · time · room`; scheduled-but-unpublished carries "Not yet public" + a publish affordance; pipeline stage cards sub-labeled — Scheduled *"placed on the working agenda"*, Published *"live on the public site"*. The §5.2 attention strip and §5.9 list chips inherit this.

**Seed** (§6): ≥15% of submissions multi-track; ≥3 accepted-and-scheduled sessions carry two tracks; asserted by `check:seed`.

## Amendment 6 — board filtering + record-owned actions (2026-08-09; **AC IDs corrected by the orchestrator**)

> Authored by the v1.3 prototype builder, which is why its original text misallocated AC-241/242 (already minted for webhooks and token scopes in `USER_STORIES.md` Amendment 6). Corrected IDs below. **RATIFIED by the client 2026-08-09** — AC-239 struck; consequential actions belong on the detail screen, not behind a drag.

**Program board `/board`** (extends AC-238; **AC-243**, replacing struck AC-239): filters compose across free-text search (title, speaker, record ID, company), type, any carried track, format, and wave, with filtered count + one-click reset. The board is a read-only overview: no card is draggable and no lifecycle action appears on a card. Mouse click, Enter, or Space opens the exact submission record. The record owns stage-appropriate actions (review, wave, accept, onboarding, agenda placement, publish, public view), with the existing confirmation/cascade preview for consequential transitions. Agenda drag-and-drop is unaffected.

## Amendment 7 — API surface upgrades from the Sessionboard comparison (2026-08-09)

Source: `sequence/research/api-comparison.md`. Four gaps amended into the pre-kickoff surface; one deferred behind Tier A; six cross-cutting semantics pinned.

**New/changed routes:** `GET /api/v1/events` (token-visible events with id/slug/name/dates/timezone/role — tokens must be able to discover their event IDs) · `GET /events/:id/people` (+ `?q=&role=&task_status=`), `GET/PATCH /people/:personId`, `GET /people/:personId/submissions` (no duplicate Speaker/Contact models) · full file lifecycle: `GET .../submissions/:id/files`, `POST .../files/sign`, `POST .../files/complete`, `PATCH/DELETE .../files/:fileId` (replacement = new upload version) · `POST /org/tokens` accepts `{name, scopes[], event_ids[]}` (AC-242 semantics).

**Deferred behind Tier A green:** signed outbound webhooks (AC-241) — endpoint CRUD, test delivery, deliveries log, six event types, HMAC over `id.timestamp.body`.

**Pinned semantics (bind every route):** `page`/`per_page` (default 50, max 100), stable ULID secondary sort, `{data,page,per_page,total,total_pages}` · `ETag` from `updated_at`, `If-Match` on PATCH/DELETE/agenda-move/publish, 409 with current state — agents and humans are simultaneous first-class operators · one error envelope `{error:{code,message,field?,details?}, request_id}` with the pinned status map · rate-limit buckets (read/write/send/import; public by IP+submission) with `RateLimit-*` + `Retry-After` · bulk operations return a durable `operation_id` with selected/succeeded/failed counts · **OpenAPI is generated from the route registry and is the single source** for docs, CLI registry, and SKILL.md links.

## Amendment 8 — context-coverage closure (2026-08-09)

**Tier A review path (AC-244–246).** The reviewer can open full evaluator-visible fields/files without losing position; Approve/Maybe/Deny is the primary recommendation and does not require a score; explicit multi-track reviewer responsibility is enforced by one server authorization helper across queue/detail/file/export/write. The prototype shows all three as interactions, not copy.

**Decision and portal completion (AC-235–237).** Program-lead decisions own optional speaker feedback that renders from one decision row into both email and portal. Records can send a logged one-off templated email. Speaker title/description edits are organizer-controlled and history-stamped. Acknowledge/form/file portal tasks open and validate their actual response surface.

**Operator table (US-76, AC-247–249).** Personal event-scoped saved views capture query, filters, sort, and visible-column order; the fixed column registry is configurable with Title mandatory; the immutable Drafts needing attention queue exposes count, last-save, contact, and missing fields without implicitly submitting anything. Draft access is limited to form admins and program staff.

**Prototype coverage repairs.** v1.4 shows multiple independently publishable forms, the complete CFP field/participant/file/conditional path, open/closed/at-limit/resumed states, the real kind-specific speaker-task completion surfaces, decision feedback, and the existing integration seams. Real Resend, ICS delivery, Airtable mirroring, D1 persistence, auth, and R2 behavior remain product/runtime obligations settled by `EVALUATION.md`; a static prototype never substitutes for their probes.

**Explicit exclusion.** No Month view and no generalized CMS are added. Month was reference-image vocabulary, not a context requirement; generalized CMS support is explicitly optional/skipped. The narrow handbook and embeds remain.

---

## Amendment 9 — agent-composed sends (2026-08-09)

`POST /api/v1/events/:id/comms/send` (the single send route — §4.2) and `marquee remind` accept `{selector, template_key?, subject?, body?}` with **exactly one of** `template_key` or `{subject, body}` enforced server-side; merge fields render in both; ad-hoc sends log identically; demo-safe + `comms:send` scope unchanged (**AC-250**). No LLM features in Marquee — the API is the rail, the caller is the writer.

---

## Amendment 10 — per-item reviewer assignment (2026-08-09)

Submission record → evaluation panel: current reviewers per round + coverage; assign/remove a specific reviewer (AC-251, `round_assignments` write, track scopes enforced). **[beyond v1.5 prototype — acknowledged divergence, build per spec.]** Fold into the record-screen and assignments tickets, +1h.

---

## Amendment 11 — venue model (2026-08-09)

**`buildings`** (AC-252) — `event_id`, `name`, `address`, `position`. Writer: Event Settings → Buildings card; seed: the Sheraton-coherent trio in §6 (ruled 2026-08-09 under operator-delegated authority — a 2026 event at the Sheraton cannot coherently seed 2025's venue buildings, and §6's room list is already Sheraton-native). Reader: room grouping/labels, ICS `LOCATION` ("Room · Building"), public session pages.
**`rooms`** gains `building_id` (required), `av_capabilities` (JSON tag array), `notes` (AC-253). Writers: Event Settings → Rooms card (building select, AV tag editor, notes). Readers: agenda room headers + tooltip panel, room view, day-of surfaces. Lands in M-02's single migration; Event Settings, seed, and agenda tickets absorb +2h. **[Settings card and room-header rendering: beyond v1.5 prototype unless the v1.6 micro-round lands first.]**

---

## Amendment 12 — upload lifecycle schema (2026-08-09, orchestration)

Raised by MRQ-14's (M-13, uploads) plan review while MRQ-2 (M-02) was writing the single init migration, and folded into it rather than deferred to a second migration — M-02's contract is the whole schema at once. **No new AC; these serve AC-52, AC-146–148, AC-231, AC-232. Next mint remains AC-254.**

- **`attachments.sha256` becomes NULLABLE.** The checksum is not knowable at row-creation time: the row is written when the presigned PUT is issued, and the digest only exists after `/complete` performs its HEAD verify and magic-byte sniff. A NOT NULL column here would have forced either a fabricated placeholder digest or a two-phase insert.
- **`attachments.r2_etag` added.** R2 returns an etag on PUT; storing it is what lets `/complete` prove the object it is about to mark `ready` is the object the client actually uploaded, and it is the handle for the S3-vs-binding coherence check.
- **`draft_file` and `submission_file` relations added, indexed.** A file can be attached to a *draft* before a submission row exists (the CFP explicitly supports resumable drafts with restored files, §5), so file ownership cannot be a single foreign key onto `submissions`.

Writers: the upload routes in M-13. Readers: the CFP draft-resume path, submission detail, reviewer file reads (through the AC-246 authorization helper), and the nightly orphan sweep.

---

## Amendment 13 — the rename stops at the wire (2026-08-10, orchestration)

Raised by MRQ-8 at merge: commit `9e8b425` renamed the organizer's noun **event → conference** in UI copy and app routes, but `SPEC.md` §4.2 and §9 still specify `/api/v1/events/...`, so the rename does not reach the wire surface.

**Ruling: that is correct and deliberate. The wire API keeps `events`.**

- **UI copy and app routes say "conference"** — that is the organizer's language and the only surface a judge reads.
- **The HTTP API, OpenAPI document, and CLI keep `/api/v1/events/...`**, and the database keeps `event_id`.

Why the rename stops here:

1. MRQ-8 built the generated route manifest, the OpenAPI assembly, and `check:api`'s parity assertion against these paths. Renaming the wire now invalidates all three plus every downstream ticket's assumptions, mid-flight, days before the deadline.
2. The schema column is `event_id`. Renaming the wire without renaming the schema would produce a *three*-way mismatch (UI "conference" / API "conference" / DB "event") — strictly worse than the current two-way one, where the internal identifier and the wire agree.
3. No judge-visible benefit. The walkthrough is driven through the UI; the API earns its bonus by existing, being documented, and being honest — not by its noun.

**Known, accepted divergence:** a judge who opens `/api/docs` sees `events` while the interface says "conference". That is a small coherence blemish, recorded here rather than hidden, and it is the cheaper of the two available inconsistencies. Post-competition, the clean fix is to rename schema, wire, and UI together in one migration.

---

*v1.4 contract revision, 2026-08-09; folded against `USER_STORIES.md` Amendments 1–9. Amendments follow that file's rules: **the next criteria append from AC-254**; deletions are struck, never recycled. Next input — client review and sign-off of the v1.4 prototype; only then mint `DESIGN.md` and hand the complete contract to orchestration.*

---

## Amendment 14 — geography becomes a constraint (2026-08-10, client-directed)

*Extends Amendment 11. Binding prototype: `prototypes/pipeline-v1.1/index.html` at **v1.7**. Design reasoning: `sequence/venue-map-ux.md`.*

Amendment 11 gave a building a name, an address, and a position in a list. This amendment gives it a **place**, and makes that place a scheduling constraint rather than a label. Locations are rendered at five zooms of attention; most surfaces take the cheapest one that answers their question, and only two render a map at all.

**Model.** `buildings` gains `lat` REAL nullable, `lng` REAL nullable, `access_minutes` INTEGER (default 0) — all three shipped in `migrations/0002_venue_geography.sql` — and **`access_note` TEXT** (AC-255), which is *new here and not yet migrated*. Nullable coordinates are a first-class state, not an omission: a streamed venue never takes a pin and must never be given a fabricated one. **Entrance instructions belong to the building, not the room** — every room in a building inherits its `access_note`. Seed §6 currently carries the photo-ID/security sentence on a room note; it moves to the building.

**Transit conflicts (AC-258, AC-259).** `getConflicts` gains a third class beside room overlap and speaker double-booking. Two sessions sharing a speaker, in different pinned buildings, whose gap is smaller than `walk + access_minutes` at the destination, raise a **`transit`** conflict. Walking time is `haversine × 1.3 ÷ 80 m/min`, floored at 1 minute — the 1.3 factor is a street-grid detour allowance, and the model claims no more precision than that. The class **warns without blocking**, like every other conflict.

> **The class is named Transit, never Travel.** "Travel and accommodation" is already a speaker task meaning flights and hotels, and both land on the same person. The rename is binding across the conflict object's `kind`, the drawer, tile flags, dashboard labels, the API conflict type, and any copy.

**Venues is the screen that edits venues (AC-256).** Buildings *and* rooms are authored at `/settings/venues`, under the site map their coordinates drive. `/settings` keeps the conference record and points at Venues with a count; it holds no venue editors. Both screens write through one shared writer, so no save path silently owns fields it does not display.

**Rendering (AC-257).** The map is a **tile mosaic, not a map library**: OpenStreetMap rasters positioned as plain `<img>` on a centre-clipped fixed-width plane, with pins and walking lines drawn over them. No Leaflet, no CDN, no API key, no initialisation, and no reflow when tiles land — the box is fixed-aspect and reserved. **Tile failure is a designed state**, not an error: pins, walking lines, and the scale legend render over the graph-paper grid, so the map is never a blank rectangle. Attribution is required and always visible. OSM's tile policy is not intended for heavy application traffic; acceptable for the judging window, and a self-host or keyed provider is the production answer (§6 open dependency).

**The speaker's arrival instructions (AC-260 – AC-262).** The portal renders room, building, address, entrance note, and a **leave-by** derived from the speaker's own previous session that day, falling back to the primary building when they have none. Comms gains place merge fields — `{{session.room}}`, `{{session.building}}`, `{{session.address}}`, `{{session.accessNote}}`, `{{session.leaveBy}}` — because email is the surface speakers actually read. The ICS carries a real `LOCATION` (room, building, street address, ICS-escaped) and `GEO:lat;lng` when pinned, replacing a bare room name a phone cannot navigate to.

**Disclosure (AC-263).** Venue surfaces show for every conference and **fold** when there is one building. The rule: **zoom 2 is independent of building count; zoom 1 is not.** A single hotel still has a door and a security desk, so address, entrance note, and access minutes stay on at any count. What folds is the *comparison* — the "· Building" room-label suffix, walk times, transit conflicts, the agenda building band, and the embedded site map, which arrives collapsed.

**Seed consequence — this amendment supersedes §6's "without inventing a second real venue."** That clause was written when buildings were labels. Transit conflicts require two buildings genuinely apart in space: the seed as shipped places Sheraton and the Workshop Annex at *identical* coordinates with zero access minutes, which makes the conflict class unreachable and stacks two pins on one point. §6 must seed at least two buildings far enough apart to produce a real walking time, with a non-zero access time on one, and at least one live transit conflict visible on load. `check:seed` asserts it (AC-259).

**[Beyond v1.7 prototype — acknowledged divergence: none. Every surface in this amendment is built in the prototype and driven.]**

---

## Amendment 15 — the states a forward-only model forgot (2026-08-10, client-directed)

*Source: `sequence/research/state-model-gaps.md`. Two stories and six criteria minted in `USER_STORIES.md` Amendment 15 (**US-80, US-81; AC-264 – AC-269**). Binding prototype **v1.8**, driven in-browser across all 28 routes. Three schema additions land in one migration; two of the six issues are contract-hole repairs that mint nothing.*

**The shared defect.** The data model and `STATEMAP.md` both drew the edges that move a record *forward* and almost none of the edges that undo, stop, or fail to arrive. Three consequences, all verified against the shipped schema rather than inferred:

**1. Task cancellation had no state (AC-264 – AC-267).** `speaker_tasks.status` shipped as `CHECK (status IN ('open','done'))`, while **AC-123 already graded** the un-accept dialog's cancel/retain choice and the v1.7 prototype already drew the control. A builder would have had an acceptance criterion requiring the behaviour, a prototype promising it, and a constraint rejecting it — and the natural improvisation is `DELETE`, which destroys exactly what "retained for records" means. The sharper consequence: **`AC-125` puts `task overdue` in the minimum automated-trigger set**, so an open task on a cancelled talk keeps mailing a real speaker about a talk that no longer exists, on the product whose headline claim is that the system does the chasing. Resolved by a nullable `cancelled_at` (§3.7), one idempotent `reconcileTaskSet` on every acceptance path, and a single `owes = neither done nor cancelled` predicate that every count on the chase board goes through.

**Dialog relabelled (client ruling).** Once cancellation is a tombstone, *"Retain for records"* described what cancelling already did. The two branches are now **`Cancel open tasks`** / **`Keep tasks active`**, and they must produce observably different states — cancelled-and-silent versus open-and-still-chased. Keeping the second branch is deliberate: a speaker who still moderates another session is genuinely still owed work.

**2. Outbound webhooks were promised in three layers and absent from three others.** `US-68`, **AC-241**, `M-54`, the `WEBHOOK_QUEUE` binding, and a `post-merge-smoke` validation row all existed; the tables, the §4.2 routes, and the screen did not. Because `check:api` asserts registry/OpenAPI parity, M-54 would have had to invent routes absent from this document and **fail the drift gate on its own PR**. Resolved by `webhook_endpoints` + `webhook_deliveries` (§3), the `Webhooks` row in §4.2, and `/settings/webhooks` in the screen inventory. **No new criterion — AC-241 already covers the behaviour, and the build stays exactly where `BUILDPLAN.md` ranks it.**

**3. "Decided but not told" had no answer (AC-268, AC-269).** `PHILOSOPHY.md` 2 makes the status change *be* the notification, which is a genuine advantage over the incumbent — but the automatic notification has exactly **three designed-in ways not to arrive**: the Airtable mirror deliberately skips the cascade (AC-226), a send can sit `queued`/`suppressed`/`failed` in the outbox, and a record can carry no usable address. All three are correct; none had a screen. Fully derivable from `submission_decisions` joined to `outbox` — **zero schema** — and resolved by one built-in view, one attention-strip row that holds at zero, and a notify action that writes a new outbox row against the unchanged decision.

**Deliberately not in this amendment.** The **Speaker Handbook** (AC-233) has the same shape as the webhooks gap — it renders in the prototype and has no table, no route, and no authoring surface — and is ruled **if-capacity**, after the walkthrough-loop tickets are green. The **submitter/speaker split** is ruled **extra credit** and is named as a known limitation in §10 above rather than built.

**[Beyond v1.8 prototype — acknowledged divergence: none for the three items above. AC-233's authoring surface remains unbuilt in both prototype and product, which is the if-capacity ruling, not a divergence.]**

---

## Amendment 16 — the webhook event allowlist (ratified 2026-08-11)

`SPEC.md` §4.2 and `USER_STORIES.md` AC-241 shipped **two different six-event lists**, sharing only three entries. MRQ-30 flagged it rather than picking one, which was correct — a delegator choosing silently would have set the wire contract by accident.

**The ratified six:**

| Event | Emitter in merged code |
|---|---|
| `submission.created` | MRQ-15 public CFP form; MRQ-33 admin create |
| `submission.status_changed` | MRQ-19's single `insertDecisions` writer |
| `evaluation.completed` | MRQ-18 reviewer queue |
| `speaker_task.completed` | MRQ-16 speaker portal; MRQ-24 chase board |
| `agenda.published` | MRQ-20 agenda; MRQ-22 public site |
| `speaker.confirmed` | MRQ-38 role confirm/decline |

**Why this list.** Every entry has a real emitter already merged — a webhook that can never fire is the same defect class as a green test over a dead feature. It is SPEC's list with one rename adopted from the stories: `task.completed` → **`speaker_task.completed`**, because the table is `speaker_tasks` and the shorter name would be ambiguous once organiser-side tasks exist.

**Dropped, deliberately:** `submission.updated` (fires on every keystroke-level edit — noise that would swamp a consumer) and `person.updated` (profile edits are covered where they matter by `speaker.confirmed` and `speaker_task.completed`). Both remain available to a later amendment if a consumer asks; neither is worth a bonus event slot now.

Delivery is unchanged: `HMAC-SHA256` over `id.timestamp.body`, retried with backoff on `WEBHOOK_QUEUE`, idempotent on delivery `id`.

## Amendment 17 — the Airtable mirror is cut (operator ruling, 2026-08-11)

**Cut, named explicitly as EVALUATION gate 19 requires:** MRQ-26 (mirror outbound), MRQ-27 (mirror inbound), MRQ-46 (mirror isolation audit), and MRQ-54 (inbound webhook spike). S-1 (Airtable base spike) is likewise not run.

**Why.** The mirror was never built — no `src/jobs/mirror/` exists; only a route-table entry and schema stubs. Its dependent audit had nothing to audit, and the spike plus S-1 needed an operator-provided Airtable base that was never in hand. Five of the eleven remaining tickets were therefore blocked on a track that had not started, with the deploy still unshipped.

**Nothing already published becomes false.** SPEC Amendment 4 and the README both present Airtable as *a deliberate engineering trade and an extension point*, never as a claim to the source-of-truth bonus — the explicit **API bonus (R53)** and Cloudflare carry that story instead. The README's extension-points table already names the mirror as an extension point rather than a shipped feature, and states D1 remains the source of truth.

**What survives.** `mirror_state` schema, the `mirror:write` API token scope, and the documented extension point. A future implementer inherits a named seam rather than a half-built one.

**What we forgo.** The two-way sync demo. A half-built mirror shown on camera would read worse than a clean, documented extension point — which is the trade this ruling makes deliberately.

## Amendment 18 — public widgets widened and protected (client-directed, 2026-08-11)

*Folds `USER_STORIES.md` Amendment 18. Binding prototype **v1.10** (`prototypes/pipeline-v1.1/index.html`, `showEmbedModal()`), public agenda → `Get embed code`.*

**Why.** A collaborator flagged that the competition rubric weights **Public Widgets** as a joint-heaviest area, while embeds (AC-87–90) sat in `EVALUATION.md`'s cuttable Tier B band pending §6 dependency 2's Discord Q2 ruling. Client ruling: protect and widen rather than leave the shipped feature exposed to a cut line it had already outgrown.

**Widened.** The embed dialog grows from two kinds to four — `agenda | sessions | speakers | cfp` (§3.10, §5.12). `sessions` is a new flat published-session read (title, track, time) sharing `agenda`'s query and KV path. `speakers` gains a `layout ∈ cards|list` choice carried in the snippet URL. `cfp` is wholly new: it renders the event's primary open form's deadline and formats with a link to `/f/:slug`, and flips to closed from `closes_at` alone, on the existing 30 s cache cadence — no republish action exists for it to need. US-16 (AC-217–AC-218) is promoted from unbuilt to live in-scope; US-58 gains AC-273–AC-274.

**Protected.** AC-87–90 are no-cut as of this amendment — MRQ-22 is merged, so cutting them would remove working, judged code, not defer unbuilt scope. `EVALUATION.md` §6 dependency 2 (Discord Q2 — embeddable gallery) closes as **resolved, built**. AC-217, AC-218, AC-273, and AC-274 join Tier A alongside AC-87–90: leaving the widened half of the family in the still-cuttable Tier B band would protect only the two kinds that existed before this ruling, not the family the ruling is about. `EVALUATION.md`'s Amendment log carries the exact count deltas and the one-line tier rationale.

**Reserved, untouched.** AC-270–AC-272 (the drafted submitter/speaker split) are not minted here. This amendment mints from AC-273 precisely so a later if-capacity opening does not collide with it; next mint after this ticket is AC-275.

**Build:** MRQ-75, on top of merged MRQ-22 (`src/routes/embed.route.tsx`, `src/ui/embeds/EmbedPage.tsx`, `src/lib/public-site.ts`). No new remote/mirror/queue surface — `cfp` reads `forms`/`formats`, already-modeled tables.

## Amendment 19 — the cold start, from the true step zero (client-directed, 2026-08-12)

*Folds `USER_STORIES.md` Amendment 19 (US-83 – US-86, AC-275 – AC-287). Binding surfaces: prototype **v1.11** (`prototypes/pipeline-v1.1/index.html`, cold-start flow), `docs/GETTING-STARTED.md` (human-side contract), `prototypes/cold-start/SKILL-SETUP-CHAPTER.md` (agent-side contract, folds into `renderSkill()`). Rulings D1–D8 in `prototypes/cold-start/DECISIONS.md`. **Post-deadline scope** — `EVALUATION.md` §2.4; nothing here joins the Wednesday gate.*

**Why.** Every event route is `/events/:eventId/…` and no route creates an event; the magic-link handler answers unknown addresses with a polite no-op; the only path from empty DB to usable app is a seed that hardcodes someone else's demo conference. A fresh installer cannot become a user. The design ruling that resolves it: initial setup is run by the operator's own agent, identity bootstraps through a one-time claim link printed by the deploy (mail cannot be a dependency of the flow that configures mail), and ownership lands on a person.

**§3.2 deltas.**
- `magic_links.purpose` widens to `login|draft_resume|cospeaker_profile|task_link|claim|org_invite`; `person_id` becomes NULLABLE, non-null exactly when purpose is a person-bound one — `claim` and `org_invite` tokens pre-date their person, who is created at exchange. Same hashing, same single-statement consumption, same 15-minute/therein expiries (claim: 24 h; invite: 7 d).
- `organizations` gains writer "claim exchange (created if absent)". `people` and `memberships` gain writers "claim exchange" and "invite exchange"; `memberships` gains remover "organizer removal (revokes the person's `auth_sessions` in the same transaction)". The last remaining `owner` membership is undeletable, enforced server-side.
- No new token table, no new token kind: the post-claim agent token is an ordinary `api_tokens` row.

**§4.2 route additions** (all appear in the OpenAPI document; `check:api` registry parity applies):

| Method | Path | Notes |
|---|---|---|
| GET | `/claim/:token` · `/join/:token` | server-rendered exchange pages; inert page on used/expired/unknown (AC-276, AC-282) |
| POST | `/api/v1/claim` | token + name + email → org-if-absent, owner person, membership, session (AC-276) |
| POST | `/api/v1/events` | owner/program_lead; name, dates, timezone, venue → event with generated slug (AC-279) |
| GET | `/api/v1/instance/status` | admin; mail/uploads/spam/domain derived from real binding+secret presence, never a stored flag (AC-284) |
| GET/POST | `/api/v1/org/invites` · DELETE `/org/invites/:id` | mint/list/revoke one-time org invites (AC-282) |
| GET | `/api/v1/org/members` · DELETE `/org/members/:personId` | organizer list/removal (AC-283) |
| POST | `/api/v1/admin/remove-demo` | deletes `is_demo` scope only, idempotent, flips `demo_mode` 0 (AC-286) |

**§4.3 delta.** The CLI gains `setup claim-link` (works unauthenticated against the local config/deploy context, since it exists precisely when no credential does) and the setup verbs — event create, taxonomy set, form draft, evaluation plan — each a thin wrapper over the routes above and §4.2's existing admin routes. `SKILL.md` gains the setup chapter through `cli/generate-skill.mjs`; the byte-equality test is unchanged and binding.

**§5 deltas.** §5.1: an instance with no owner membership renders the **unclaimed landing** in place of the demo landing — agent-run setup stated, claim-link story stated, nothing else revealed. New screens per prototype v1.11: claim (`/claim/:token`), handoff (token offer + three doors), Instance panel on the setup dashboard, Organizers card in settings, invite modal. §5.4: publish on a mail-less instance interposes the AC-285 acknowledgment. All markup questions resolve to prototype v1.11, per the standing rule.

**Guardrails.** Claim and invite links ride G6's cookie discipline; the unclaimed landing and inert pages leak no instance state (AC-277); demo removal is scoped by `is_demo` exactly as `reset:demo` is, in reverse.

## Amendment 21 — the organization is a record, and an invite carries its seat (client-directed, 2026-08-14)

*Folds `USER_STORIES.md` Amendment 21 (US-88 – US-89, AC-294 – AC-301). Binding surfaces: prototype **v1.15** (`prototypes/pipeline-v1.1/index.html`, the four `#org` tabs) and `sequence/org-settings-design.md` (rulings O1–O8). **Post-deadline scope** — `EVALUATION.md` §2.6, on §2.4's terms. Amendment numbers in this round are shared across `SPEC.md`, `USER_STORIES.md` and `EVALUATION.md` so two concurrent folds cannot collide; **Amendment 22 belongs to MRQ-204** and the gap in this file's own sequence is deliberate.*

**Why.** Conference settings contains nothing about who can log in. The machinery exists — Amendment 19's org members, one-time invites, `memberships` with roles and a nullable `event_id` — but it only ever surfaced during the cold-start setup walk, so access management had no steady-state home. Two things follow from giving it one. First, the organization stops being a name and becomes a record: it outlives every conference on it, so the values a new conference should start from belong to it. Second, an invite stops meaning one thing. Amendment 19's invite had exactly one shape — organization-wide owner — because there was only one reason to send one; a day-of volunteer needs `ops` scoped to this conference, and a link that cannot say so can only over-grant.

**§3.2 deltas.**
- `organizations` gains `default_timezone`, `default_theme`, `comms_from_name`, `comms_reply_to`, `logo_key`, `accent`. All nullable, and **null means the organization has not said** — an unset default follows the product when the product changes its mind, a set one does not, and the two must stay distinguishable. Inheritance happens once, at conference creation; changing a default never rewrites a conference that already inherited it.
- `magic_links` gains `invite_role`, `invite_event_id`, `invite_org_id` and `short_code_hash`. The first three are the seat an `org_invite` mints, decided at mint by the inviter and **never by the recipient**; a row that predates this amendment carries nulls, which mean organization-wide `owner`, which is what such a row already minted. `short_code_hash` is a second credential on the same single-use row (ruling O4) — a token has no speakable form, so the code is minted separately and hashed exactly as the token is, resolved at the same `/join/:token` door and spent by the same statement. Neither raw value is ever stored or logged.
- Which roles a *link* may offer is narrower than the column: `program_lead`, `ops`, `reviewer` only. `owner` moves by transfer, not by a link someone could forward, and `speaker` is a participation rather than a seat. A `reviewer` invite must name a conference, because `memberships` has always refused an organization-wide reviewer (`CHECK (role <> 'reviewer' OR event_id IS NOT NULL)`, AC-214). **A request that names no role mints `program_lead`, organization-wide** — the least authority that still means "organizer". This supersedes Amendment 19's behaviour, under which a bodyless invite minted a second `owner`: a request that says nothing must not be handed the most powerful seat on the instance by omission. The CLI's `organizers invite` and the cold-start card both mint bodylessly and therefore both move with it.
- `memberships` gains remover "conference removal (ends the person's participations at that event in the same transaction)". Organizer removal's existing in-transaction revocation widens: **sessions, the unexpired login links already in their inbox, and the `created_by` API tokens named in the request**, all in one batch. Token revocation is show-and-choose, never a sweep — a fired volunteer's tokens may power integrations the organization keeps.

**§4.2 route additions** (all appear in the OpenAPI document; `check:api` registry parity applies):

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/api/v1/org/settings` | org profile and defaults; organization-wide organizers only (AC-294) |
| POST | `/api/v1/org/invites` | **gains** `role` and `event_id`; returns the short code once beside the URL (AC-296, AC-297) |
| DELETE | `/api/v1/org/members/{personId}` | **gains** `revoke_token_ids`; four-arm transaction (AC-298) |
| GET | `/api/v1/events/{eventId}/people/{personId}/removal-preview` | everything removal would touch, published sessions and sole-speaker cases named (AC-299) |
| POST | `/api/v1/events/{eventId}/people/{personId}/remove` | remove from this conference (AC-299) |
| POST | `/api/v1/org/people/{personId}/revoke-access` | credentials only; participation and history untouched (AC-300) |

`GET /api/v1/org/members` widens to list conference-scoped organizer seats beside organization-wide ones: a seat the removal flow ends must be a seat the list shows.

**§5 deltas.** §5.1 gains **Organization settings** at `/org` — four tabs (Organization · Organizers · Server · API tokens), the Organization group's ⚙ row closing it exactly as the conference group ends in its own Settings row (ruling O1). API tokens moves off Conference settings because `api_tokens` is an org-scoped row with a nullable event scope (ruling O2); `/settings/api` still resolves. The Organizers card leaves Conference settings — its home now exists. `readTheme()` gains a third layer: the URL override, then this person's own choice, then the organization's default, then Day. The default is mirrored into storage so the pre-paint script reads it without a fetch, because a fetch there is the flash that script exists to prevent.

**Deliberately not in this amendment.** Invite-only stands — there is no join-request queue and none is to be added. Person delete and merge are CRM-scope. Governance policy on top of this mechanism (the role legend, owner transfer, the stale-seat banner) and the invite's QR rendering and second entry point are separate work; this amendment lands the mechanism they build on.

**Guardrails.** The short-code door carries the write rate limiter and the same inert answer as every other spent credential. A conference-scoped invite is validated against the inviter's own organization at mint *and* at exchange. Removing a person from a conference never unpublishes a session or frees its agenda slot (ruling O5a), and never touches the `people` row, their submissions, their annotations, or their participations at any other conference.
## Amendment 22 — delete conference: contract-first cascade *(2026-08-14, merge-captain allocation)*

Conference deletion is an organizer-only, irreversible operation. The wire route is `DELETE /api/v1/events/:id`; its policy is the existing organizer `program:write` grant (`owner` or `program_lead`). The handler resolves the event inside the caller's organization, writes the deletion audit row with the authenticated actor, and performs the cascade in one D1 batch. There is no soft-delete, restore, or second event-removal implementation.

### Cascade contract

The operation deletes children before the event row. **DIES:** submissions of both kinds and every submission child; forms, fields, admins, and their public links; agenda slots and the published schedule/conference-site material; portal magic links; event outbox mail (including queued mail) and calendar invites; event embeds; evaluation plans, rounds, criteria, committees, assignments, evaluations, comparisons, and reviewer scopes; speaker tasks and event uploads; imports and import rows; venues, taxonomy, routing rules, webhooks, event settings, and mirror-outbox rows. Event-owned magic links carry `magic_links.event_id`; migration 0018 backfills the unambiguous legacy links and leaves instance claim/organizer links organization-scoped. The demo conference is only a seeded case of this same event-owned list.

**SURVIVES:** organization-level `people`, `person_events` notes/tags/stage history, and the append-only `audit_log`. Organization-level person headshots also survive. The legacy `attachments.event_id` requirement is repaired narrowly in migration `0018_event_deletion.sql`: surviving `person_headshot` rows are detached (`event_id = NULL`) during deletion, while event-owned attachments are deleted. No new attachment ownership model is introduced. The deletion audit row keeps the deleted event ID without an event foreign key and records the actor, action `event.deleted`, before snapshot, after marker, timestamp, and request ID.

The UI reproduces the binding prototype at the foot of Conference settings: a Danger zone card opens a modal that first discloses the exact dies/stays consequences, then requires the organizer to type the conference name. Only an exact trimmed match enables **Delete conference**. The modal says, **“This removes the conference and everything scoped to it. It cannot be undone.”** After success, the UI selects another conference if one remains; otherwise it returns to the fresh-install landing. `marquee event delete <event-id>` and the generated `SKILL.md` command use the same route, and `POST /api/v1/admin/remove-demo` delegates to the same cascade with its explicitly broader seeded-people cleanup.

## Amendment 23 — the sponsorship, and the contact who completes its work *(2026-08-14, client-directed)*

Sponsorship is per-conference commerce over an organization-level company relationship — structurally parallel to Outreach over People. The company and its history survive every conference; the deal is one conference's record. Design round and rulings: `sequence/sponsors-design.md` §2 and §5, with `prototypes/sponsor-portal/index.html` as the binding visual contract.

### §3.7 deltas — two columns on `speaker_tasks`

**`completed_by_person_id` NULL** — *who* completed the work, beside `completed_at`'s *when*. Nullable, and null means **not recorded**, never "the assignee": back-filling `person_id` would assert that the assignee finished every task ever completed, which is the exact claim this column exists to stop making. Writer: every completion, from either portal seat. Reader: the portal task row, the organizer task view. It exists because a sponsorship's deliverables are visible to every contact and completable by any of them — a green checkmark that implies the wrong person did the work is worse than no attribution at all.

**`sponsorship_id` NULL** — the grouping join. Sponsor deliverables are person-assigned tasks on the existing machinery (ruling 2 — there is no company-owned task type); this column is only how they are grouped by the deal they belong to. `owes` is unchanged, and every count and trigger still filters on `cancelled_at IS NULL` alone.

### §3.11 Sponsors *(new)*

**`companies`** (org-scoped) — `name`, `website`, `domain`, `blurb`, `notes`, `is_demo`. The CRM's second noun. `people.company_id` links to it and coexists with the legacy `people.company` string; the reconcile is a later band.
**`sponsor_tiers`** (event-scoped) — `name`, `position`. Gold/Silver/Bronze seeded, renameable, extendable.
**`sponsorships`** (event-scoped join) — `company_id`, `tier_id`, `status` ∈ `courting|committed|fulfilled`, `passes`, and the booth columns (`booth_number`, `booth_size`, `booth_hall`, `booth_building_id` → `buildings(id, event_id)`, `booth_load_in`, `booth_access_note`, `booth_leave_note`). **Booth is columns on the deal, not a second record type** (ruling 5): a boothless sponsorship is those columns being null, which is why the portal composes down rather than branching. One deal per company per conference (`uq_sponsorships_event_company`).
**`sponsorship_contacts`** — `person_id` per sponsorship, `is_primary`. **Contacts are `people` rows** reached through this join, never a parallel contact table (`speaker-crm-scope.md` §2), and exactly one primary per sponsorship is a database fact (a partial unique index), not a read-then-write check.
**Linked Sessions** — `submissions.sponsorship_id` NULL. A sponsor Session is `kind = session` with `bypass_evaluation` (R9); this is the honest link back to the deal that bought it. A sponsor Session carries **no wave and no decision row** — it never entered the competitive path — so SPEC §6's 1,000 submissions and 60 accepted records both mean the **competitive pool**, and sponsor Sessions are counted and asserted apart from it.

**Not modelled here, deliberately:** per-tier deliverable **template sets** (the `reconcileTaskSet`-on-commit weave) belong to the tier-settings surface that authors them — half a reconciliation is worse than none — and company logo uploads land with the organizer surface that needs them. Tier-scoped portal *content* variation stays a later band: the portal renders the deliverables it is given.

### §4.2 route deltas

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/me/sponsor-portal` | the whole sponsorship for a signed-in contact: deal, derived deal line, every deliverable with assignee and completer, read-only Sessions, contact roster, handbook |
| PATCH | `/api/v1/me/sponsorships/:id/company` | org-level company facts; authorized only for a contact of that sponsorship. The contact roster is **not** writable — access to a sponsorship is the organizer's to grant |

`POST /api/v1/me/tasks/:taskId/complete` and `POST /api/v1/me/uploads/sign` are **widened, not duplicated**: each resolves through the speaker predicate or the sponsorship-contact predicate, from one shared function. Two near-identical predicates would give a contact a file deliverable that opens, validates, and then fails at the PUT.

### §5.14 Sponsor portal `/sponsor-portal` *(new)*

The speaker portal's sibling: same magic-link door, same session surface, same task machinery, same Flight Deck day treatment. The centre of gravity is the **sponsorship**. Page order, reproducing the binding prototype: head ("Welcome back" + `N of M deliverables done`) → **sponsorship hero** (tier · status eyebrow, company, conference line, and a **derived deal line** — Sessions counted from linked submissions, booth number, passes — never a per-tier blurb; organizer contact resolved from the event's own staff memberships on the right) → **Your booth**, the speaker location card's machinery reused (loc-lines, the leave-by accent box repurposed for load-in, the venue map as the receipt), rendered only when booth data exists → **Deliverables** (the shared task row, each carrying its assignee; cancelled work below a dashed divider with the reason stated once and out of the progress figure) → **Your Sessions** (read-only cards) → **Company profile** (org-level facts, contact roster with Primary/You chips) → **Sponsor handbook** (chapters; the load-in chapter only for a sponsorship with a booth).

**Three rulings bind the surface** (`sponsors-design.md` §5.2):

1. **Whole sponsorship, anyone completes.** Every deliverable is visible to every contact with its assignee named; any contact may complete any open one; the completer is recorded and displayed. The person holding the file is never blocked.
2. **The hero is the sponsorship** — booth-and-session deals read as ordinary composition, and so does their absence.
3. **Sessions are read-only; the task machinery is the single write path.** There is no edit control on a Session card. Three deliverables reach the thing they are about on completion, dispatched by template identity: *Name your speaker* creates the person, the `speaker` participation, and — through the same `reconcileTaskSet` the acceptance boundary runs — their membership and onboarding task set, so the promise on the task is literally true; *Session title & description* fills the submission under the same `speaker_talk_updated` audit action the speaker portal writes; *Confirm your company details* writes the org-level company facts, which is what replaces a public intake form (ruling 6).

**Entry.** A sponsorship contact holds no `memberships` row by doctrine, so `roleHome` takes the seat beside the roles: `/sponsor-portal` is returned only when the person holds no staff, reviewer, or speaker role. Somebody who is both a speaker and a contact still lands on `/portal`.

**Acknowledged divergences from the prototype.** The prototype opens tasks and handbook pages in modals; both portals expand in place, because the shipped task-row machinery is what the build reproduces and a second completion UI in one product is worse than a matched animation. The prototype's dashed switcher is prototype chrome; a real sponsorship switcher renders in its place, and only for a contact who genuinely holds more than one deal. A file deliverable states **vector PDF** rather than the prototype's "SVG or EPS": `task_upload` narrows `DOCUMENT_RULES`, which sniffs pdf/pptx/key and nothing else, so an accept list naming `.svg` presigns nothing — widening the sniffer is a security-surface change and is not done here.
