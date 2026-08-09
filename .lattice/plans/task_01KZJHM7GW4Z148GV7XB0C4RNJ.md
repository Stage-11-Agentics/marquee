# MRQ-2: Database schema — the whole init migration

BUILDPLAN: M-02 — Wave 0 (§3) ⛔ SERIALIZED · never merged with another item

## Planning-only gate

- This plan was authored before MRQ-1 merged, from the scratch cwd `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-2-plan-sandbox`. No source file, branch, worktree, or migration may be created during this phase.
- MRQ-2 depends on MRQ-1. On `RESUME IMPLEMENTATION`, use only the absolute post-merge worktree named by the Orchestrator, verify it is the git top-level, fetch `forgejo`, rebase on the then-current `forgejo/master`, and record the exact base SHA before editing.
- M-02 owns `migrations/0001_init.sql` and `src/db/schema.ts`. `0001_init.sql` is written once; later tickets add numbered migrations and module type mirrors rather than editing these files. Plan review adds one non-shared, standard-library verifier, `scripts/schema-verify.mjs`, because the MRQ-6 harness is not yet guaranteed to exist; it must not edit MRQ-6-owned `package.json`, `vitest.config.ts`, or `scripts/checks/*`.
- Implementation workflow is `sub-agent-full` (schema). The implementation agent receives this plan, the ticket, SPEC §2.4/§3 and Amendments 10–11, and the actual merged MRQ-1 tree with no inherited conversational context. This planning pass does not spawn it.

## Authority and scope

Authority order for implementation is the MRQ-2 boot prompt, ticket description, `SPEC.md` §3 plus Amendments 10–11, `EVALUATION.md`, then `BUILDPLAN.md`. Do not edit those contract documents and do not mint AC IDs.

The migration contains all **46 tables** named by SPEC §3 plus Amendment 11. The count includes the paired tables `committees`/`committee_members` and `imports`/`import_rows`, and includes `submissions`, whose heading is prose rather than a backtick-only table heading. Amendment 11 adds `buildings` and three required room fields. No ORM or generated migration layer is introduced: the ratified stack is raw D1 SQL and a thin TypeScript type mirror.

Evaluation coverage read for this ticket:

- AC-234/235/246–249 and Amendment 11 AC-252/253 have explicit §2 verification rows.
- AC-176/212/214/222 are in EVALUATION §7's post-competition modeled range rather than §2. Of these, AC-176 and AC-214 still carry explicit first-migration enforcement obligations; AC-212 and AC-222 are modeled structurally. Do not invent missing §2 rows.

## Migration-wide rules (check each before implementation is complete)

- [ ] Use D1/SQLite-compatible SQL only. Apply cleanly to an empty local D1 database with foreign-key checking enabled, then apply the full migration set a second time only through Wrangler's migration ledger to prove it is not replayed.
- [ ] Every table has `id TEXT PRIMARY KEY` (Worker-generated ULID) and `created_at INTEGER NOT NULL`; every mutable table has `updated_at INTEGER NOT NULL`, unless the SPEC explicitly supplies an immutable lifecycle timestamp instead. Any exception is documented beside the table in SQL and mirrored in TypeScript.
- [ ] Instants are UTC epoch-millisecond `INTEGER`; event calendar dates are `TEXT` (`YYYY-MM-DD`). Boolean integers are `INTEGER NOT NULL CHECK (... IN (0,1))`. JSON fields are `TEXT` with `json_valid(...)` checks when non-null.
- [ ] Every `event_id` and `org_id` named by SPEC is `TEXT NOT NULL REFERENCES ...`; all other named `*_id` relationships are foreign keys unless the relationship is intentionally polymorphic (`attachments.owner_id`, `mirror_outbox.row_id`, audit entity IDs).
- [ ] Use restrictive FK behavior by default. Do not add broad cascades that could bypass audit, mirror, or outbox writers; pure join-row cascade behavior may be added only when explicitly justified in the SQL comments and schema mirror.
- [ ] Encode all closed enums below with `CHECK` constraints. Do not narrow an open-ended `status`/`role` whose values are not enumerated by SPEC.
- [ ] Add `CHECK(json_valid(column))` for every JSON/config column, permitting NULL only where SPEC permits NULL. Add shape/cardinality checks where D1 can enforce them safely (notably comparison triplets); deeper business shape remains application validation.
- [ ] Quote and verify the exact column declaration `outbox.send_policy TEXT NOT NULL DEFAULT 'demo_safe' CHECK (send_policy IN ('demo_safe','always_live'))`.
- [ ] Use stable, descriptive index names. Do not create redundant indexes whose leftmost prefix is already supplied by a UNIQUE constraint or primary key.
- [ ] Triggers are in scope only where SPEC §3 names a trigger writer: `submissions.search_blob` receives `AFTER INSERT` and `AFTER UPDATE OF title,abstract` maintenance triggers in 0001. No generic mirror/audit trigger framework is invented here.
- [ ] Mirror every SQL column, nullability, enum literal, and default in `src/db/schema.ts`; no ORM metadata or runtime migration framework is added.

## Complete table, constraint, and index checklist

Each checkbox is implementation work. Common `id`/timestamp columns from the migration-wide rules are implicit in the field lists below.

### SPEC §3.1 — organization, event, taxonomy; Amendment 11 venue fold

- [ ] **`organizations`** — `name`, `slug`. Required text; `UNIQUE(slug)` for tenant lookup.
- [ ] **`events`** — `org_id`, `name`, `slug`, `tagline`, `starts_on`, `ends_on`, `timezone`, `venue`, `logo_key`, `accent`, `status`, `demo_mode`. FK `org_id → organizations`; `status CHECK ('draft','live')`; boolean `demo_mode`; `UNIQUE(org_id,slug)`; indexes `idx_events_org_id` and the unique slug index.
- [ ] **`formats`** — `event_id`, `name`, `default_duration_min`, `min_duration_min`, `max_duration_min`, `position`. FK to events; non-negative duration/position checks and `min <= default <= max`; index `idx_formats_event_position`.
- [ ] **`tracks`** — `event_id`, `name`, `color`, `position`. FK to events; hex-color format is application-validated unless a simple non-lossy SQL check is used; index `idx_tracks_event_position`.
- [ ] **`buildings`** (Amendment 11, AC-252) — `event_id`, `name`, `address`, `position`. FK to events; required name/address and non-negative position; indexes `idx_buildings_event_position` and `idx_buildings_event_name` as the room-grouping/read path requires.
- [ ] **`rooms`** (AC-252/253 fold) — `event_id`, `building_id` **NOT NULL**, `name`, `capacity`, `position`, `av_capabilities` (JSON tag array), `notes`. FKs to events/buildings; required building, non-negative capacity/position, valid JSON array; indexes `idx_rooms_event_position`, `idx_rooms_building_position`. Same-event building/room ownership is asserted by schema verification and downstream writes, not left to an unscoped lookup.
- [ ] **`waves`** — `event_id`, `name`, `decision_on`, `target_count`, `sent_at`, `position`. FK to events; non-negative target/position; `sent_at` nullable; indexes `idx_waves_event_position`, `idx_waves_event_decision_on`.

### SPEC §3.2 — people and access

- [ ] **`people`** (AC-212 model) — `org_id`, `email`, `name`, `title`, `company`, `bio`, `headshot_attachment_id`, `social_links`, `is_demo`, `last_write_source`. FK to organizations and nullable attachment; `social_links` valid JSON; boolean `is_demo`; mirror-source check `('marquee','airtable')`; `UNIQUE(org_id,email)` (never globally unique); indexes `idx_people_org_name`, `idx_people_headshot_attachment`.
- [ ] **`memberships`** (AC-214) — `org_id`, nullable `event_id`, `person_id`, `role`. FKs to organizations/events/people; role check `owner|program_lead|ops|reviewer|speaker`; enforce `role='reviewer' ⇒ event_id IS NOT NULL`; exact uniqueness is `uq_memberships_event ON (org_id,event_id,person_id,role) WHERE event_id IS NOT NULL` and `uq_memberships_org ON (org_id,person_id,role) WHERE event_id IS NULL`; authorization indexes `idx_memberships_person_event_role` and `idx_memberships_org_event_role`. `role` is deliberately part of both unique keys because SPEC §6 seeds one person as event organizer and reviewer.
- [ ] **`auth_sessions`** — `person_id`, `role_hint`, `expires_at`, `user_agent_hash`, `revoked_at` (plus the common `created_at`). FK to people; expiry/revocation index `idx_auth_sessions_person_expires`, plus `idx_auth_sessions_expires_revoked` for cleanup. Session IDs remain D1-backed and instantly revocable.
- [ ] **`magic_links`** — `token_hash`, `person_id`, `purpose`, `redirect_to`, `expires_at`, `used_at`. FK to people; `purpose CHECK ('login','draft_resume','cospeaker_profile','task_link')`; `UNIQUE(token_hash)`; indexes `idx_magic_links_token_unused` and `idx_magic_links_expires` for atomic consume and cleanup.
- [ ] **`api_tokens`** — `org_id`, nullable `event_id`, `name`, `token_hash`, `prefix`, `scopes`, `created_by`, `last_used_at`, `revoked_at`. FKs to organization/event/person; valid JSON scopes; `UNIQUE(token_hash)`; indexes `idx_api_tokens_prefix`, `idx_api_tokens_org_event_revoked`. Resolve Amendment 7's plural `event_ids[]` without a 47th table: persist `scopes` as `{permissions: string[], event_ids: string[]}`; the singular nullable `event_id` remains the SPEC-declared optional legacy/single-event fast path and, when set, must agree with the sole JSON event ID. Effective authority is token grant ∩ current membership.

### SPEC §3.3 — forms

- [ ] **`forms`** — `event_id`, `name`, `slug`, `kind`, `status`, `opens_at`, `closes_at`, `welcome_md`, `per_submitter_limit DEFAULT 3`, `min_speakers DEFAULT 1`, `max_speakers DEFAULT 4`, `max_sponsors`, `password_hash`, `reminder_offset_hours`, `thankyou_template_key`, `admin_notify_person_ids`, `turnstile_required DEFAULT 1`. FK to events; kind check `abstract|session`; status check `draft|open|closed`; non-negative limits and `min_speakers <= max_speakers`; boolean/JSON checks; `UNIQUE(event_id,slug)`; indexes `idx_forms_event_status_kind`, `idx_forms_closes_at_status`.
- [ ] **`form_fields`** — `form_id`, `key`, `label`, `help_text`, `type`, `required`, `position`, `config`, `condition`. FK to forms; type check for all eight values `short_text|long_text|single_select|multi_select|url|email|file|number`; boolean required; valid JSON config/condition; `UNIQUE(form_id,key)`; index `idx_form_fields_form_position`.
- [ ] **`form_admins`** — `form_id`, `person_id`. FKs to forms/people; `UNIQUE(form_id,person_id)`; reverse authorization index `idx_form_admins_person_form`.

### SPEC §3.4 and §3.10 — submissions, tracks, decisions, saved views, participation

- [ ] **`submissions`** — `event_id`, nullable `form_id`, `kind`, `bypass_evaluation`, `title`, `abstract`, `status`, nullable `format_id`, nullable `primary_track_id`, `origin`, `vendor_affiliation`, nullable `wave_id`, `submitter_person_id`, nullable `decided_at`, nullable `decided_by_person_id`, nullable `submitted_at`, nullable `last_saved_at`, nullable `resume_token_hash`, `is_published`, nullable `external_ref`, `search_blob`, nullable `applied_rule_id`, `last_write_source`. FKs to event/form/format/track/wave/people/routing rule; kind check `abstract|session`; **complete status check `draft|submitted|in_review|accepted|waitlisted|rejected|withdrawn`** (AC-176); origin check `public|admin|import`; vendor check `none|vendor_to_fi|vendor_with_champion`; booleans and mirror-source checks. Insert logic, types, and probes preserve “session defaults to bypass evaluation = 1” while still allowing the later admin toggle. Add `idx_submissions_event_status`, `idx_submissions_event_kind_status`, `idx_submissions_event_primary_track_status`, `idx_submissions_form_status`, `idx_submissions_submitter_form_status`, `idx_submissions_event_wave_status`, `idx_submissions_event_search_blob`, and partial unique `uq_submissions_event_external_ref` when `external_ref IS NOT NULL`. Add the SPEC-named trigger writer: `AFTER INSERT` and `AFTER UPDATE OF title,abstract` triggers normalize those fields into `search_blob`; MRQ-29 may extend the search projection in its own numbered migration, never by editing 0001.
- [ ] **`submission_answers`** — `submission_id`, `field_id`, nullable `value_text`, nullable `value_json`. FKs to submissions/form_fields; valid JSON when present; at least one value representation present; `UNIQUE(submission_id,field_id)`; reverse field index `idx_submission_answers_field_submission`.
- [ ] **`submission_tracks`** (AC-234) — `submission_id`, `track_id`, `is_primary`. FKs to submissions/tracks; boolean `is_primary`; `UNIQUE(submission_id,track_id)`; partial unique `uq_submission_tracks_one_primary` on `submission_id WHERE is_primary=1`; intersection indexes `idx_submission_tracks_track_submission` and `idx_submission_tracks_submission_primary`. “At least one track and exactly one primary” for persisted submitted records is completed transactionally by writers because an immediate table check cannot safely span multi-row inserts; verify the invariant explicitly.
- [ ] **`submission_decisions`** (AC-235) — `event_id`, `submission_id`, `decision`, `resulting_status`, nullable `feedback_md`, `decided_by_person_id`, `decided_at`, nullable `outbox_id`. FKs to event/submission/people/outbox; decision check `approve|maybe|deny`; resulting-status check `accepted|waitlisted|rejected`; indexes `idx_submission_decisions_submission_decided` and `idx_submission_decisions_event_decided`. The schema permits one row per transition, including bulk transitions; do not add a uniqueness constraint that collapses history.
- [ ] **`saved_views`** (AC-247/248) — `event_id`, `person_id`, `name`, `config_json`. FKs to events/people; valid JSON; `UNIQUE(event_id,person_id,name)`; ownership index `idx_saved_views_person_event`. Built-ins remain code-defined, not seeded rows.
- [ ] **`participations`** (AC-222 model) — `submission_id`, `person_id`, `role`, `position`, `confirmation_status`, nullable `confirmed_at`, nullable `invited_at`. FKs to submissions/people; role check `speaker|co_speaker|moderator|chairperson|submitter|sponsor_contact`; confirmation check `pending|confirmed|declined`; **`UNIQUE(person_id,submission_id,role)`** for the required triple; indexes `idx_participations_submission_role_position`, `idx_participations_person_submission_role`, and `idx_participations_person_confirmation` for conflict/portal reads.

### SPEC §3.5 — round-aware evaluation and reviewer authority

- [ ] **`evaluation_plans`** — `event_id`, `name`, `instructions`, `scale_min`, `scale_max`, `status`. FK to events; `scale_min <= scale_max`; index `idx_evaluation_plans_event_status`.
- [ ] **`evaluation_rounds`** — `plan_id`, `position`, `name`, `mode`, `anonymized`, `target_reviews_per_submission`, `opens_at`, `closes_at`. FK to plans; mode check `scorecard|comparison`; boolean anonymized; positive target; `UNIQUE(plan_id,position)`; index `idx_evaluation_rounds_plan_position`. No hard-coded two-round ceiling: a third round is data.
- [ ] **`rubric_criteria`** — `round_id`, `name`, `weight_pct`, `position`. FK to rounds; weight range 0–100 and non-negative position; `UNIQUE(round_id,position)`; index `idx_rubric_criteria_round_position`. Sum-to-100 remains a transaction/application invariant because SQLite row checks cannot aggregate siblings.
- [ ] **`committees`** — `event_id`, `name`. FK to events; index `idx_committees_event_name`.
- [ ] **`committee_members`** — `committee_id`, `person_id`, `role`. FKs to committees/people; `UNIQUE(committee_id,person_id)` unless multiple committee roles are explicitly required later; reverse index `idx_committee_members_person_committee`.
- [ ] **`reviewer_track_scopes`** (AC-246) — `event_id`, `person_id`, `track_id`. FKs to events/people/tracks; `UNIQUE(event_id,person_id,track_id)`; explicit-scope indexes `idx_reviewer_track_scopes_person_event_track` and `idx_reviewer_track_scopes_track_event_person`. This table is additive authority to the required per-event reviewer membership; no org-wide reviewer fallback exists.
- [ ] **`round_assignments`** — `round_id`, `submission_id`, nullable `reviewer_person_id`, nullable `committee_id`, `status`. FKs to rounds/submissions/people/committees; enforce exactly one assignment target (reviewer XOR committee), because SPEC's two modes represent either an explicit reviewer assignment or a committee-wide assignment and never an ambiguous row targeting both/neither; unique reviewer and committee assignment indexes scoped by round/submission; queue indexes `idx_round_assignments_reviewer_status_round` and `idx_round_assignments_committee_status_round`. Amendment 10/AC-251 requires no extra table or field beyond the existing `reviewer_person_id` target.
- [ ] **`evaluations`** — `round_id`, `submission_id`, `reviewer_person_id`, nullable `recommendation`, nullable `score`, nullable `criteria_scores`, `comment`, `abstained`. FKs to rounds/submissions/people; nullable recommendation check `approve|maybe|deny`; valid JSON criteria scores; boolean abstained; **`UNIQUE(round_id,submission_id,reviewer_person_id)`** (round-aware uniqueness); indexes `idx_evaluations_round_submission` and `idx_evaluations_reviewer_round`.
- [ ] **`comparisons`** — `round_id`, `reviewer_person_id`, `submission_ids`, `ranking`. FKs to rounds/people; valid JSON; enforce `json_array_length(submission_ids)=3`; index `idx_comparisons_round_reviewer`. Set equality, uniqueness of the three IDs, ranking coverage, and ties are application-validated.
- [ ] **`round_promotions`** — `from_round_id`, `to_round_id`, `submission_id`, `promoted_at`, `promoted_by`. FKs to both rounds/submission/person; check rounds differ; `UNIQUE(from_round_id,to_round_id,submission_id)`; indexes `idx_round_promotions_to_submission`, `idx_round_promotions_from_submission`.

### SPEC §3.6 — agenda

- [ ] **`agenda_items`** — `event_id`, nullable unique `submission_id`, `kind`, nullable `title`, `starts_at`, `duration_min`, `room_id`, nullable `track_id`, `is_published`. FKs to events/submissions/rooms/tracks; kind check `session|break`; positive duration; boolean publication; check session rows have a submission and break rows have no submission plus a title. Add unique index on non-null `submission_id`, `idx_agenda_event_starts_room`, `idx_agenda_room_starts`, `idx_agenda_event_published_starts`, and `idx_agenda_track_starts` for the five views/conflict pass.

### SPEC §3.7 — speaker onboarding

- [ ] **`task_templates`** — `event_id`, `name`, `kind`, `description`, nullable `due_at`, nullable `due_offset_days`, nullable `form_id`, nullable `file_config`, `position`, `auto_assign`. FKs to event/form; kind check `acknowledge|file|form`; valid JSON file config; boolean auto-assign; due source is `due_at` XOR `due_offset_days`; indexes `idx_task_templates_event_position`, `idx_task_templates_event_auto_assign`.
- [ ] **`speaker_tasks`** — `event_id`, `person_id`, nullable `submission_id`, `template_id`, `title`, `kind`, `description`, `due_at`, `status`, nullable `completed_at`, nullable `response_json`, nullable `attachment_id`, `last_write_source`. FKs to event/person/submission/template/attachment; kind check `acknowledge|file|form`; status check `open|done`; valid response JSON; mirror-source check. Do not store `overdue`. Add task indexes `idx_speaker_tasks_event_status_due`, `idx_speaker_tasks_person_status_due`, `idx_speaker_tasks_submission_status`, and `idx_speaker_tasks_template`.
- [ ] **`attachments`** — `event_id`, `owner_type`, `owner_id`, `r2_key`, `filename`, `content_type`, `size_bytes`, `status`, `sha256`. FK to events; polymorphic owner intentionally has no FK; owner check `person_headshot|task_upload|event_logo|import_file`; status check `pending|ready`; non-negative size; `UNIQUE(r2_key)`; indexes `idx_attachments_owner`, `idx_attachments_event_status_created` for serving and orphan sweep.

### SPEC §3.8 — communications

- [ ] **`email_templates`** — `event_id`, `key`, `name`, `subject`, `body_md`, `enabled`. FK to events; boolean enabled; `UNIQUE(event_id,key)`; index `idx_email_templates_event_enabled`.
- [ ] **`outbox`** — `event_id`, `template_key`, nullable `person_id`, `to_email`, `subject`, `html`, `text`, nullable `ics_uid`, nullable `ics_body`, `status`, **`send_policy TEXT NOT NULL DEFAULT 'demo_safe'`**, nullable `suppressed_reason`, `idempotency_key`, nullable `provider_message_id`, nullable `error`, nullable `scheduled_for`, nullable `sent_at`. FKs to event/person; status check `queued|sent|suppressed|failed`; send-policy check `demo_safe|always_live`; `UNIQUE(idempotency_key)`. Add consumer index `idx_outbox_status_scheduled_created`, log indexes `idx_outbox_event_created` and `idx_outbox_person_created`, and `idx_outbox_ics_uid` for calendar retrieval. Rendered content is stored at enqueue; no template FK is imposed because ad-hoc/custom sends are valid.
- [ ] **`calendar_invites`** — `submission_id`, `person_id`, `uid`, `sequence`, `last_method`, `last_sent_at`, `status`. FKs to submissions/people; method check `REQUEST|CANCEL`; non-negative sequence; `UNIQUE(submission_id,person_id)` and `UNIQUE(uid)`; index `idx_calendar_invites_submission_status`.

### SPEC §3.9 — Airtable mirror

- [ ] **`mirror_outbox`** — `table_name`, `row_id`, `op`, `payload`, `status`, `attempts`, nullable `last_error`, nullable `drained_at`. Polymorphic row has no FK; op check `upsert|delete`; valid JSON payload; non-negative attempts; queue indexes `idx_mirror_outbox_status_created`, `idx_mirror_outbox_table_row_created`.
- [ ] **`mirror_state`** — `table_name`, `airtable_table_id`, `cursor`, `webhook_id`, `webhook_expires_at`, `last_sync_at`, `local_row_count`, `remote_row_count`, nullable `last_error`. Non-negative counts; `UNIQUE(table_name)` under the SPEC's one configured mirror state per table; indexes `idx_mirror_state_webhook_expires`, `idx_mirror_state_last_sync`.

### SPEC §3.10 — operations and provenance

- [ ] **`routing_rules`** — `event_id`, `name`, `when_json`, `then_json`, `position`, `enabled`. FK to events; valid JSON; boolean enabled; indexes `idx_routing_rules_event_enabled_position` and `idx_routing_rules_event_name`. `submissions.applied_rule_id` points here.
- [ ] **`imports`** — `event_id`, `source`, `file_key`, `mapping`, `status`, nullable `undone_at`. FK to events; valid JSON mapping; indexes `idx_imports_event_status_created`, `idx_imports_event_source_created`.
- [ ] **`import_rows`** — required relational `import_id` plus `row_index`, `entity`, `outcome`, nullable `reason`, nullable `target_id`, nullable `before_json`. FK to imports; outcome check `created|updated|skipped|failed`; valid JSON before state; `UNIQUE(import_id,row_index)`; indexes `idx_import_rows_import_outcome`, `idx_import_rows_target`.
- [ ] **`embeds`** — `event_id`, `kind`, `slug`, `config`. FK to events; kind check `agenda|speakers`; valid JSON; `UNIQUE(slug)` for `/embed/:slug`; index `idx_embeds_event_kind`.
- [ ] **`audit_log`** — `event_id`, nullable `actor_person_id`, `actor_kind`, `action`, `entity_type`, `entity_id`, nullable `before_json`, nullable `after_json`. FKs to events/people; actor-kind check `user|api_token|system|airtable`; valid before/after JSON; immutable append-only row (no `updated_at`); indexes `idx_audit_event_created`, `idx_audit_entity_created`, `idx_audit_actor_created`.
- [ ] **`event_settings`** — `event_id`, `key`, `value_json`; keys hold `schedulable_statuses`, `demo_safe_allowlist`, `ai_assist_enabled` (default false at seed/write), `anonymized_default`, `airtable`, and `search_weights`. FK to events; valid JSON; `UNIQUE(event_id,key)`; index supplied by that ownership key. Do not create one column per setting.

## Type mirror (`src/db/schema.ts`)

- [ ] Export the shared `Id`/epoch/date/JSON aliases and closed enum arrays as `as const`, deriving literal unions so SQL checks and TypeScript values stay visibly aligned.
- [ ] Export a row type and insert type for every one of the 46 tables. Insert types omit generated ULID/timestamps and mark SQL-defaulted columns optional; nullable SQL columns remain explicitly nullable rather than optional on selected rows.
- [ ] Export `CORE_TABLES`/schema metadata for the immutable 0001 inventory, sufficient for schema verification without pretending to be an ORM. Keep physical SQL names exact (`snake_case`) and do not create a parallel camel-case persistence vocabulary. Later `schema.<module>.ts` files compose their own metadata with `CORE_TABLES`; no mutable global registry forces them to edit `schema.ts`.
- [ ] Include the critical constants directly in the mirror: complete submission statuses including `waitlisted`, participation roles, evaluation modes/recommendations, reviewer scope shape, outbox statuses/send policies/default, venue JSON tag shape, and all other closed enums listed above.
- [ ] Add compile-time exhaustiveness/satisfies assertions that `CORE_TABLES` contains exactly the 46 expected 0001 names and no duplicate/missing table interface.

## Implementation sequence after `RESUME IMPLEMENTATION`

1. Verify the named worktree and MRQ-1 merge/base SHA; bump MRQ-2 from `planned` to `in_progress` before edits. Inspect the landed Wrangler/D1 binding and TypeScript conventions without changing M-01-owned files.
2. Dispatch the context-clean schema implementer for the two owned files. It must tick this inventory in its completion comment and run the focused migration/type checks; it does not bump Lattice status.
3. Build `migrations/0001_init.sql` in FK-safe logical order, then add indexes after all tables. Forward references/cycles (`people ↔ attachments`, `submissions → routing_rules`, `submission_decisions → outbox`) must be tested on the actual D1 engine; do not silently drop their FKs to make ordering easier.
4. Build `src/db/schema.ts` from the finished SQL rather than designing a second schema in parallel. Diff an extracted SQL table/column registry against the TypeScript registry.
5. Delegator audits every checkbox above against SPEC §3 and Amendments 10–11, resolves any implementer deviation, and follows the full code-review/validation/PR lifecycle from COMMON. No later ticket may rewrite `0001_init.sql`.

## Verification and AC evidence

Because M-06 owns `package.json` and the shared test harness and may not yet have merged, MRQ-2 must not edit its script table. Commit the same assertions in `scripts/schema-verify.mjs`, using only Node standard-library orchestration around Wrangler/local D1; if the MRQ-6 harness exists, it may invoke this script without relocating or duplicating it. Attach the transcript. A lack of harness is not permission to weaken the schema checks.

- [ ] Apply all migrations to a fresh local D1 database with `wrangler d1 migrations apply ... --local`. `PRAGMA foreign_key_check` is evidence that FK targets resolve, not enforcement proof; if D1 rejects it, introspect every `foreign_key_list` instead. The adversarial inserts below are the enforcement proof. Run TypeScript checking through MRQ-1's available command/tooling.
- [ ] Introspect `sqlite_master`, `PRAGMA table_info`, `foreign_key_list`, and `index_list/index_info` and compare against the exact 46-table inventory, required columns/defaults/nullability, FKs, enum checks, and every named index above.
- [ ] `[schema-foundation AC-176]`: insert every complete status including `waitlisted`; reject an unknown status.
- [ ] `[schema-foundation AC-212]`: prove identical email values may exist in different orgs but not twice in one org, and the people table has no `event_id`.
- [ ] `[schema-foundation AC-214]`: reject a reviewer membership with NULL `event_id`; prove one person may hold organizer and reviewer roles on the same event, while event-A reviewer membership and track scopes do not create event-B authority by construction.
- [ ] `[schema-foundation AC-222]`: allow one person to hold distinct participation roles on one submission, reject an exact duplicate `(person,submission,role)`, and retain per-role confirmation state.
- [ ] `[schema-foundation AC-234]`: reject duplicate track pairs and a second primary; transaction-level fixture rejects zero tracks for a submitted record and verifies the first selected track is both `submissions.primary_track_id` and the unique primary join row.
- [ ] `[schema-foundation AC-235]`: insert multiple decision-history rows for one submission, including waitlist and bulk-style NULL feedback, and link an optional rendered outbox row without collapsing history.
- [ ] `[schema-foundation AC-246]`: prove reviewer scope uniqueness and efficient any-track intersection query shape; verify the query plan uses the submission-track and reviewer-scope indexes. Route-level 403/helper scans remain MRQ-17/MRQ-18 responsibilities.
- [ ] `[schema-foundation AC-247/248]`: prove per-event/per-person/per-name uniqueness, JSON config persistence, and ownership indexes. UI CRUD, built-in immutability, and fixed-column behavior remain MRQ-34 responsibilities.
- [ ] `[schema-foundation AC-249]`: prove the draft query uses `submissions.status`, `last_saved_at`, submitter/form relations, and the intended indexes; applicable-missing-field computation and authorization remain MRQ-13/MRQ-34 responsibilities.
- [ ] `[schema-foundation AC-252/253]`: reject a room without a building; persist valid AV tag-array JSON and notes; reject invalid JSON. CRUD/render/seed/public-visibility assertions remain with MRQ-4/MRQ-10/MRQ-20/MRQ-22/MRQ-25 per ticket map.
- [ ] Add adversarial probes for FK failures, invalid enums/booleans/JSON, duplicate unique keys, round-specific duplicate evaluation behavior, outbox default vs explicit `always_live`, assignment XOR, comparison cardinality, and the agenda session/break shape.
- [ ] Record proof types separately in review/validation: static schema/type parity, local D1 execution evidence, and downstream/UI inferences. MRQ-2 validation is headless local D1 schema behavior; no browser or production deploy is needed for this migration-only ticket.

## Non-goals and downstream handoff

- No routes, query helper, seed data, auth, UI, queue consumer, mirror worker, event settings screen, condition evaluator, or schema migration runner are implemented here.
- Do not edit `wrangler.jsonc`, `package.json`, harness config, contract docs, or any later module mirror. Missing downstream capability is a handoff note, never a workaround in M-02.
- Schema consumers from the ticket map: MRQ-3 auth/reset, MRQ-4/5 seed, MRQ-8 API core, MRQ-9 submissions, MRQ-10 venue settings, MRQ-12 mail, MRQ-13/15 forms, MRQ-17/18 evaluation and reviewer authority, MRQ-20/22/25 agenda/public/ICS venue reads, MRQ-26/27 mirror, MRQ-28 round funnel, MRQ-33 decisions/record, MRQ-34 saved views/drafts, MRQ-35 routing, MRQ-38 participation/feedback, plus audits MRQ-45/47/50/51/52/53. Their code may rely on this schema but may not edit `0001_init.sql` after merge.
- Any field required by downstream code but absent from SPEC §3 must be raised as a contract gap and added in a later numbered migration by its owner; it is not silently invented during M-02 implementation.
- `suppress_mirror` is a runtime option to the later `afterWrite` hook, not persisted schema. MRQ-3 reset passes it and MRQ-26 honors it; neither looks for a column.
- MRQ-4 may use D1's `PRAGMA defer_foreign_keys` during FK-ordered bulk seed transactions; it may not disable or omit the constraints.
- MRQ-8's thin insert helper injects `id`, `created_at`, and mutable `updated_at`; insert types omit them because callers do not own them. That helper also makes `updated_at` available for Amendment 7 ETag/If-Match behavior.
- MRQ-25 owns the final ICS location composition conflict: preserve both `events.venue` and Amendment 11's room/building data in schema; the ICS implementation must apply the contract's public `Room · Building` form while deciding once whether/how the broader event venue prefixes it.
- For the serialized four-hour estimate, implementation priority is: (1) all 46 tables and write-once constraints/defaults/FKs, (2) required access-path and uniqueness indexes plus SQL/type parity, (3) the complete verifier probe breadth. Time pressure never permits omitting category 1; any category-3 remainder is reported rather than hidden.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Review artifact: `art_01KZJM08R35V9TYJTJ0Q3PHRVT` — **FAIL**, all findings resolved below before implementation.

1. **Membership uniqueness [CRITICAL] — ACCEPTED.** The plan now pins two partial unique indexes, both including `role`, and adds the SPEC §6 adversarial organizer-plus-reviewer probe. A role-less event membership key is forbidden.
2. **Plural API-token event grants [CRITICAL, ARCHITECTURAL] — RESOLVED WITH EXISTING SPEC COLUMN; DEVIATE-WITH-FLAG.** Amendment 7's `event_ids[]` persists inside the existing valid-JSON `scopes` column as `{permissions,event_ids}`; no 47th table is invented. The singular nullable `event_id` remains for SPEC compatibility and must agree when used. Effective authority remains grant ∩ membership. Flag this §3.2/Amendment 7 tension to the Orchestrator.
3. **Undeclared verification surface [MAJOR] — ACCEPTED WITH SCOPED ADDITION.** `scripts/schema-verify.mjs` is now the explicit third file, outside MRQ-6-owned paths and using no new package script/config. It carries the probes whether or not the shared harness has landed.
4. **False full-AC discharge [MAJOR] — ACCEPTED.** Schema probes are labeled `[schema-foundation AC-nnn]`, not exact `AC-nnn` test-name prefixes. MRQ-2's PR/completion/validation evidence must enumerate each partial discharge and downstream owner; only downstream end-to-end tests may satisfy the full `trace:ac` contract.
5. **`search_blob` writer missing [MAJOR] — ACCEPTED.** 0001 now owns explicit insert/update maintenance triggers and the event/search index. MRQ-29 may extend search composition only through a later numbered migration.
6. **`suppress_mirror` ambiguity [MAJOR] — RESOLVED AS RUNTIME-ONLY.** It is an `afterWrite` control passed by MRQ-3 and honored by MRQ-26, never a persisted column.
7. **Hard global 46-table registry [MINOR] — ACCEPTED.** The exact assertion is scoped to immutable `CORE_TABLES`; later module mirrors compose metadata without editing M-02's file.
8. **Near-vacuous/possibly unsupported FK pragma [MINOR] — ACCEPTED.** `foreign_key_check` is target-resolution evidence with a `foreign_key_list` fallback. Invalid-parent inserts prove enforcement. The MRQ-4 deferred-FK seed handoff is explicit.
9. **Amendment 10 ambiguity and assignment XOR [MINOR] — ACCEPTED.** AC-251 needs only `round_assignments.reviewer_person_id`. XOR is an intentional encoding of the two mutually exclusive target modes, not an accidental narrowing.
10. **Event venue vs room/building ICS source [MINOR] — ACCEPTED AS MRQ-25 HANDOFF.** Both schema fields remain. MRQ-25 resolves the final string once, preserving Amendment 11's public `Room · Building` contract.
11. **Insert timestamps omitted from insert types [MINOR] — ACCEPTED.** MRQ-8's thin helper injects ULID and timestamps; `updated_at` also underwrites Amendment 7 ETags.
12. **Four-hour estimate risk [MINOR] — ACKNOWLEDGED AND FLAGGED.** The plan now gives a strict correctness-first priority order. Report probe-breadth overrun; never cut write-once schema correctness. Notify the Orchestrator that the review considers the estimate optimistic on the corrected CP-1 critical chain.
