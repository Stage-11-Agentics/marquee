-- Marquee's complete first D1 schema.
-- MRQ-2 / BUILDPLAN M-02 owns this file. Later changes use new numbered
-- migrations; 0001 is never edited after merge.

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  tagline TEXT,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  timezone TEXT NOT NULL,
  venue TEXT,
  logo_key TEXT,
  accent TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live')),
  demo_mode INTEGER NOT NULL DEFAULT 0 CHECK (demo_mode IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (starts_on <= ends_on)
);

CREATE TABLE formats (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  default_duration_min INTEGER NOT NULL,
  min_duration_min INTEGER NOT NULL,
  max_duration_min INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (min_duration_min >= 0),
  CHECK (position >= 0),
  CHECK (min_duration_min <= default_duration_min),
  CHECK (default_duration_min <= max_duration_min)
);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, event_id),
  CHECK (position >= 0)
);

-- Amendment 11 venue model.
CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, event_id),
  CHECK (position >= 0)
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  building_id TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  position INTEGER NOT NULL,
  av_capabilities TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(av_capabilities) AND json_type(av_capabilities) = 'array'),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (building_id, event_id) REFERENCES buildings(id, event_id),
  CHECK (capacity >= 0),
  CHECK (position >= 0)
);

CREATE TABLE waves (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  decision_on TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  sent_at INTEGER,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (target_count >= 0),
  CHECK (position >= 0)
);

-- Attachments precede people to make the headshot foreign key concrete. The
-- polymorphic owner_id intentionally has no database foreign key.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  owner_type TEXT NOT NULL CHECK (
    owner_type IN (
      'person_headshot', 'task_upload', 'event_logo', 'import_file',
      'draft_file', 'submission_file'
    )
  ),
  owner_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  -- Pending direct-to-R2 uploads have neither value yet. Completion records
  -- the provider-observed ETag; sha256 stays NULL unless R2 supplies a
  -- provider-verified SHA-256 checksum.
  sha256 TEXT,
  r2_etag TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (size_bytes >= 0),
  CHECK (status <> 'ready' OR r2_etag IS NOT NULL)
);

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  company TEXT,
  bio TEXT,
  headshot_attachment_id TEXT REFERENCES attachments(id),
  social_links TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(social_links)),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  last_write_source TEXT NOT NULL DEFAULT 'marquee'
    CHECK (last_write_source IN ('marquee', 'airtable')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  event_id TEXT REFERENCES events(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK (
    role IN ('owner', 'program_lead', 'ops', 'reviewer', 'speaker')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (role <> 'reviewer' OR event_id IS NOT NULL)
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  role_hint TEXT,
  expires_at INTEGER NOT NULL,
  user_agent_hash TEXT NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  purpose TEXT NOT NULL CHECK (
    purpose IN ('login', 'draft_resume', 'cospeaker_profile', 'task_link')
  ),
  redirect_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  event_id TEXT REFERENCES events(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  -- Amendment 7's plural event grants live in the existing JSON field:
  -- {"permissions": string[], "event_ids": string[]}.
  scopes TEXT NOT NULL CHECK (
    json_valid(scopes)
    AND json_type(scopes) = 'object'
    AND json_type(scopes, '$.permissions') = 'array'
    AND json_type(scopes, '$.event_ids') = 'array'
  ),
  created_by TEXT NOT NULL REFERENCES people(id),
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    event_id IS NULL
    OR (
      json_array_length(scopes, '$.event_ids') = 1
      AND json_extract(scopes, '$.event_ids[0]') = event_id
    )
  )
);

CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('abstract', 'session')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  opens_at INTEGER,
  closes_at INTEGER,
  welcome_md TEXT NOT NULL DEFAULT '',
  per_submitter_limit INTEGER NOT NULL DEFAULT 3,
  min_speakers INTEGER NOT NULL DEFAULT 1,
  max_speakers INTEGER NOT NULL DEFAULT 4,
  max_sponsors INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  reminder_offset_hours INTEGER,
  thankyou_template_key TEXT,
  admin_notify_person_ids TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(admin_notify_person_ids) AND json_type(admin_notify_person_ids) = 'array'),
  turnstile_required INTEGER NOT NULL DEFAULT 1 CHECK (turnstile_required IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at <= closes_at),
  CHECK (per_submitter_limit >= 0),
  CHECK (min_speakers >= 0),
  CHECK (max_speakers >= min_speakers),
  CHECK (max_sponsors >= 0),
  CHECK (reminder_offset_hours IS NULL OR reminder_offset_hours >= 0)
);

CREATE TABLE form_fields (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  help_text TEXT,
  type TEXT NOT NULL CHECK (
    type IN (
      'short_text', 'long_text', 'single_select', 'multi_select',
      'url', 'email', 'file', 'number'
    )
  ),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  position INTEGER NOT NULL,
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  condition TEXT CHECK (condition IS NULL OR json_valid(condition)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (position >= 0)
);

CREATE TABLE form_admins (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE email_templates (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_md TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  template_key TEXT NOT NULL,
  person_id TEXT REFERENCES people(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  ics_uid TEXT,
  ics_body TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'suppressed', 'failed')),
  send_policy TEXT NOT NULL DEFAULT 'demo_safe'
    CHECK (send_policy IN ('demo_safe', 'always_live')),
  suppressed_reason TEXT,
  idempotency_key TEXT NOT NULL,
  provider_message_id TEXT,
  error TEXT,
  scheduled_for INTEGER,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE routing_rules (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  when_json TEXT NOT NULL CHECK (json_valid(when_json)),
  then_json TEXT NOT NULL CHECK (json_valid(then_json)),
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (position >= 0)
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  form_id TEXT REFERENCES forms(id),
  kind TEXT NOT NULL CHECK (kind IN ('abstract', 'session')),
  -- The insert trigger derives session=1; the later admin toggle may change it.
  bypass_evaluation INTEGER NOT NULL DEFAULT 0 CHECK (bypass_evaluation IN (0, 1)),
  title TEXT NOT NULL,
  abstract TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft', 'submitted', 'in_review', 'accepted',
      'waitlisted', 'rejected', 'withdrawn'
    )
  ),
  format_id TEXT REFERENCES formats(id),
  primary_track_id TEXT REFERENCES tracks(id),
  origin TEXT NOT NULL CHECK (origin IN ('public', 'admin', 'import')),
  vendor_affiliation TEXT NOT NULL DEFAULT 'none' CHECK (
    vendor_affiliation IN ('none', 'vendor_to_fi', 'vendor_with_champion')
  ),
  wave_id TEXT REFERENCES waves(id),
  submitter_person_id TEXT NOT NULL REFERENCES people(id),
  decided_at INTEGER,
  decided_by_person_id TEXT REFERENCES people(id),
  submitted_at INTEGER,
  last_saved_at INTEGER,
  resume_token_hash TEXT,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  external_ref TEXT,
  search_blob TEXT NOT NULL DEFAULT '',
  applied_rule_id TEXT REFERENCES routing_rules(id),
  last_write_source TEXT NOT NULL DEFAULT 'marquee'
    CHECK (last_write_source IN ('marquee', 'airtable')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE submission_answers (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  field_id TEXT NOT NULL REFERENCES form_fields(id),
  value_text TEXT,
  value_json TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (value_text IS NOT NULL OR value_json IS NOT NULL)
);

CREATE TABLE submission_tracks (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  track_id TEXT NOT NULL REFERENCES tracks(id),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE submission_decisions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'maybe', 'deny')),
  resulting_status TEXT NOT NULL CHECK (
    resulting_status IN ('accepted', 'waitlisted', 'rejected')
  ),
  feedback_md TEXT,
  decided_by_person_id TEXT NOT NULL REFERENCES people(id),
  decided_at INTEGER NOT NULL,
  outbox_id TEXT REFERENCES outbox(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  name TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE participations (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK (
    role IN (
      'speaker', 'co_speaker', 'moderator', 'chairperson',
      'submitter', 'sponsor_contact'
    )
  ),
  position INTEGER NOT NULL,
  confirmation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (confirmation_status IN ('pending', 'confirmed', 'declined')),
  confirmed_at INTEGER,
  invited_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (position >= 0)
);

CREATE TABLE evaluation_plans (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  scale_min REAL,
  scale_max REAL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (scale_min IS NULL AND scale_max IS NULL)
    OR (scale_min IS NOT NULL AND scale_max IS NOT NULL AND scale_min <= scale_max)
  )
);

CREATE TABLE evaluation_rounds (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES evaluation_plans(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'scorecard' CHECK (mode IN ('scorecard', 'comparison')),
  anonymized INTEGER NOT NULL DEFAULT 0 CHECK (anonymized IN (0, 1)),
  target_reviews_per_submission INTEGER NOT NULL,
  opens_at INTEGER,
  closes_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (position >= 0),
  CHECK (target_reviews_per_submission > 0),
  CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at <= closes_at)
);

CREATE TABLE rubric_criteria (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES evaluation_rounds(id),
  name TEXT NOT NULL,
  weight_pct REAL NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (weight_pct >= 0 AND weight_pct <= 100),
  CHECK (position >= 0)
);

CREATE TABLE committees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE committee_members (
  id TEXT PRIMARY KEY,
  committee_id TEXT NOT NULL REFERENCES committees(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE reviewer_track_scopes (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  track_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (track_id, event_id) REFERENCES tracks(id, event_id)
);

CREATE TABLE round_assignments (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES evaluation_rounds(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  reviewer_person_id TEXT REFERENCES people(id),
  committee_id TEXT REFERENCES committees(id),
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (reviewer_person_id IS NOT NULL AND committee_id IS NULL)
    OR (reviewer_person_id IS NULL AND committee_id IS NOT NULL)
  )
);

CREATE TABLE evaluations (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES evaluation_rounds(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  reviewer_person_id TEXT NOT NULL REFERENCES people(id),
  recommendation TEXT CHECK (
    recommendation IS NULL OR recommendation IN ('approve', 'maybe', 'deny')
  ),
  score REAL,
  criteria_scores TEXT CHECK (criteria_scores IS NULL OR json_valid(criteria_scores)),
  comment TEXT NOT NULL DEFAULT '',
  abstained INTEGER NOT NULL DEFAULT 0 CHECK (abstained IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES evaluation_rounds(id),
  reviewer_person_id TEXT NOT NULL REFERENCES people(id),
  submission_ids TEXT NOT NULL CHECK (
    json_valid(submission_ids)
    AND json_type(submission_ids) = 'array'
    AND json_array_length(submission_ids) = 3
  ),
  ranking TEXT NOT NULL CHECK (json_valid(ranking) AND json_type(ranking) = 'array'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE round_promotions (
  id TEXT PRIMARY KEY,
  from_round_id TEXT NOT NULL REFERENCES evaluation_rounds(id),
  to_round_id TEXT NOT NULL REFERENCES evaluation_rounds(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  promoted_at INTEGER NOT NULL,
  promoted_by TEXT NOT NULL REFERENCES people(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (from_round_id <> to_round_id)
);

CREATE TABLE agenda_items (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  submission_id TEXT REFERENCES submissions(id),
  kind TEXT NOT NULL CHECK (kind IN ('session', 'break')),
  title TEXT,
  starts_at INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  track_id TEXT REFERENCES tracks(id),
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (duration_min > 0),
  CHECK (
    (kind = 'session' AND submission_id IS NOT NULL AND title IS NULL)
    OR (kind = 'break' AND submission_id IS NULL AND title IS NOT NULL)
  )
);

CREATE TABLE task_templates (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('acknowledge', 'file', 'form')),
  description TEXT NOT NULL DEFAULT '',
  due_at INTEGER,
  due_offset_days INTEGER,
  form_id TEXT REFERENCES forms(id),
  file_config TEXT CHECK (file_config IS NULL OR json_valid(file_config)),
  position INTEGER NOT NULL,
  auto_assign INTEGER NOT NULL DEFAULT 0 CHECK (auto_assign IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((due_at IS NULL) <> (due_offset_days IS NULL)),
  CHECK (due_offset_days IS NULL OR due_offset_days >= 0),
  CHECK (position >= 0),
  CHECK (kind <> 'form' OR form_id IS NOT NULL)
);

CREATE TABLE speaker_tasks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  submission_id TEXT REFERENCES submissions(id),
  template_id TEXT NOT NULL REFERENCES task_templates(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('acknowledge', 'file', 'form')),
  description TEXT NOT NULL DEFAULT '',
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  completed_at INTEGER,
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  attachment_id TEXT REFERENCES attachments(id),
  last_write_source TEXT NOT NULL DEFAULT 'marquee'
    CHECK (last_write_source IN ('marquee', 'airtable')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE calendar_invites (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  uid TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  last_method TEXT NOT NULL CHECK (last_method IN ('REQUEST', 'CANCEL')),
  last_sent_at INTEGER,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (sequence >= 0)
);

CREATE TABLE mirror_outbox (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  drained_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (attempts >= 0)
);

CREATE TABLE mirror_state (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  airtable_table_id TEXT,
  cursor TEXT,
  webhook_id TEXT,
  webhook_expires_at INTEGER,
  last_sync_at INTEGER,
  local_row_count INTEGER NOT NULL DEFAULT 0,
  remote_row_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (local_row_count >= 0),
  CHECK (remote_row_count >= 0)
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  source TEXT NOT NULL,
  file_key TEXT NOT NULL,
  mapping TEXT NOT NULL CHECK (json_valid(mapping)),
  status TEXT NOT NULL,
  undone_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES imports(id),
  row_index INTEGER NOT NULL,
  entity TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('created', 'updated', 'skipped', 'failed')),
  reason TEXT,
  target_id TEXT,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (row_index >= 0)
);

CREATE TABLE embeds (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  kind TEXT NOT NULL CHECK (kind IN ('agenda', 'speakers')),
  slug TEXT NOT NULL,
  config TEXT NOT NULL CHECK (json_valid(config)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Append-only audit history intentionally has no updated_at column.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  actor_person_id TEXT REFERENCES people(id),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'api_token', 'system', 'airtable')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  created_at INTEGER NOT NULL
);

CREATE TABLE event_settings (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Uniqueness constraints and access-path indexes. Names are durable query-plan
-- vocabulary for the thin SQL layer and the schema verifier.
CREATE UNIQUE INDEX uq_organizations_slug ON organizations(slug);

CREATE UNIQUE INDEX uq_events_org_slug ON events(org_id, slug);

CREATE INDEX idx_formats_event_position ON formats(event_id, position);
CREATE INDEX idx_tracks_event_position ON tracks(event_id, position);
CREATE INDEX idx_buildings_event_position ON buildings(event_id, position);
CREATE INDEX idx_buildings_event_name ON buildings(event_id, name);
CREATE INDEX idx_rooms_event_position ON rooms(event_id, position);
CREATE INDEX idx_rooms_building_position ON rooms(building_id, position);
CREATE INDEX idx_waves_event_position ON waves(event_id, position);
CREATE INDEX idx_waves_event_decision_on ON waves(event_id, decision_on);

CREATE UNIQUE INDEX uq_attachments_r2_key ON attachments(r2_key);
CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id);
CREATE INDEX idx_attachments_draft_files
  ON attachments(owner_id, created_at)
  WHERE owner_type = 'draft_file';
CREATE INDEX idx_attachments_submission_files
  ON attachments(owner_id, created_at)
  WHERE owner_type = 'submission_file';
CREATE INDEX idx_attachments_event_status_created
  ON attachments(event_id, status, created_at);

CREATE UNIQUE INDEX uq_people_org_email ON people(org_id, email);
CREATE INDEX idx_people_org_name ON people(org_id, name);
CREATE INDEX idx_people_headshot_attachment ON people(headshot_attachment_id);

-- Role is part of both keys: one person may be an organizer and reviewer for
-- the same event, while an exact duplicate membership is forbidden.
CREATE UNIQUE INDEX uq_memberships_event
  ON memberships(org_id, event_id, person_id, role)
  WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX uq_memberships_org
  ON memberships(org_id, person_id, role)
  WHERE event_id IS NULL;
CREATE INDEX idx_memberships_person_event_role
  ON memberships(person_id, event_id, role);
CREATE INDEX idx_memberships_org_event_role
  ON memberships(org_id, event_id, role);

CREATE INDEX idx_auth_sessions_person_expires
  ON auth_sessions(person_id, expires_at);
CREATE INDEX idx_auth_sessions_expires_revoked
  ON auth_sessions(expires_at, revoked_at);

CREATE UNIQUE INDEX uq_magic_links_token_hash ON magic_links(token_hash);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);

CREATE UNIQUE INDEX uq_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX idx_api_tokens_prefix ON api_tokens(prefix);
CREATE INDEX idx_api_tokens_org_event_revoked
  ON api_tokens(org_id, event_id, revoked_at);

CREATE UNIQUE INDEX uq_forms_event_slug ON forms(event_id, slug);
CREATE INDEX idx_forms_event_status_kind ON forms(event_id, status, kind);
CREATE INDEX idx_forms_closes_at_status ON forms(closes_at, status);

CREATE UNIQUE INDEX uq_form_fields_form_key ON form_fields(form_id, key);
CREATE INDEX idx_form_fields_form_position ON form_fields(form_id, position);
CREATE UNIQUE INDEX uq_form_admins_form_person ON form_admins(form_id, person_id);
CREATE INDEX idx_form_admins_person_form ON form_admins(person_id, form_id);

CREATE UNIQUE INDEX uq_email_templates_event_key ON email_templates(event_id, key);
CREATE INDEX idx_email_templates_event_enabled ON email_templates(event_id, enabled);

CREATE UNIQUE INDEX uq_outbox_idempotency_key ON outbox(idempotency_key);
CREATE INDEX idx_outbox_status_scheduled_created
  ON outbox(status, scheduled_for, created_at);
CREATE INDEX idx_outbox_event_created ON outbox(event_id, created_at);
CREATE INDEX idx_outbox_person_created ON outbox(person_id, created_at);
CREATE INDEX idx_outbox_ics_uid ON outbox(ics_uid) WHERE ics_uid IS NOT NULL;

CREATE INDEX idx_routing_rules_event_enabled_position
  ON routing_rules(event_id, enabled, position);
CREATE INDEX idx_routing_rules_event_name ON routing_rules(event_id, name);

CREATE INDEX idx_submissions_event_status ON submissions(event_id, status);
CREATE INDEX idx_submissions_event_kind_status
  ON submissions(event_id, kind, status);
CREATE INDEX idx_submissions_event_primary_track_status
  ON submissions(event_id, primary_track_id, status);
CREATE INDEX idx_submissions_form_status ON submissions(form_id, status);
CREATE INDEX idx_submissions_submitter_form_status
  ON submissions(submitter_person_id, form_id, status);
CREATE INDEX idx_submissions_event_wave_status
  ON submissions(event_id, wave_id, status);
CREATE INDEX idx_submissions_event_search_blob
  ON submissions(event_id, search_blob);
CREATE UNIQUE INDEX uq_submissions_event_external_ref
  ON submissions(event_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE UNIQUE INDEX uq_submission_answers_submission_field
  ON submission_answers(submission_id, field_id);
CREATE INDEX idx_submission_answers_field_submission
  ON submission_answers(field_id, submission_id);

CREATE UNIQUE INDEX uq_submission_tracks_submission_track
  ON submission_tracks(submission_id, track_id);
CREATE UNIQUE INDEX uq_submission_tracks_one_primary
  ON submission_tracks(submission_id)
  WHERE is_primary = 1;
CREATE INDEX idx_submission_tracks_track_submission
  ON submission_tracks(track_id, submission_id);
CREATE INDEX idx_submission_tracks_submission_primary
  ON submission_tracks(submission_id, is_primary);

CREATE INDEX idx_submission_decisions_submission_decided
  ON submission_decisions(submission_id, decided_at);
CREATE INDEX idx_submission_decisions_event_decided
  ON submission_decisions(event_id, decided_at);

CREATE UNIQUE INDEX uq_saved_views_event_person_name
  ON saved_views(event_id, person_id, name);
CREATE INDEX idx_saved_views_person_event ON saved_views(person_id, event_id);

CREATE UNIQUE INDEX uq_participations_person_submission_role
  ON participations(person_id, submission_id, role);
CREATE INDEX idx_participations_submission_role_position
  ON participations(submission_id, role, position);
CREATE INDEX idx_participations_person_confirmation
  ON participations(person_id, confirmation_status);

CREATE INDEX idx_evaluation_plans_event_status
  ON evaluation_plans(event_id, status);
CREATE UNIQUE INDEX uq_evaluation_rounds_plan_position
  ON evaluation_rounds(plan_id, position);
CREATE UNIQUE INDEX uq_rubric_criteria_round_position
  ON rubric_criteria(round_id, position);
CREATE INDEX idx_committees_event_name ON committees(event_id, name);
CREATE UNIQUE INDEX uq_committee_members_committee_person
  ON committee_members(committee_id, person_id);
CREATE INDEX idx_committee_members_person_committee
  ON committee_members(person_id, committee_id);

CREATE UNIQUE INDEX uq_reviewer_track_scopes_event_person_track
  ON reviewer_track_scopes(event_id, person_id, track_id);
CREATE INDEX idx_reviewer_track_scopes_person_event_track
  ON reviewer_track_scopes(person_id, event_id, track_id);
CREATE INDEX idx_reviewer_track_scopes_track_event_person
  ON reviewer_track_scopes(track_id, event_id, person_id);

CREATE UNIQUE INDEX uq_round_assignments_reviewer
  ON round_assignments(round_id, submission_id, reviewer_person_id)
  WHERE reviewer_person_id IS NOT NULL;
CREATE UNIQUE INDEX uq_round_assignments_committee
  ON round_assignments(round_id, submission_id, committee_id)
  WHERE committee_id IS NOT NULL;
CREATE INDEX idx_round_assignments_reviewer_status_round
  ON round_assignments(reviewer_person_id, status, round_id);
CREATE INDEX idx_round_assignments_committee_status_round
  ON round_assignments(committee_id, status, round_id);

CREATE UNIQUE INDEX uq_evaluations_round_submission_reviewer
  ON evaluations(round_id, submission_id, reviewer_person_id);
CREATE INDEX idx_evaluations_round_submission
  ON evaluations(round_id, submission_id);
CREATE INDEX idx_evaluations_reviewer_round
  ON evaluations(reviewer_person_id, round_id);
CREATE INDEX idx_comparisons_round_reviewer
  ON comparisons(round_id, reviewer_person_id);
CREATE UNIQUE INDEX uq_round_promotions_rounds_submission
  ON round_promotions(from_round_id, to_round_id, submission_id);
CREATE INDEX idx_round_promotions_to_submission
  ON round_promotions(to_round_id, submission_id);
CREATE INDEX idx_round_promotions_from_submission
  ON round_promotions(from_round_id, submission_id);

CREATE UNIQUE INDEX uq_agenda_items_submission
  ON agenda_items(submission_id)
  WHERE submission_id IS NOT NULL;
CREATE INDEX idx_agenda_event_starts_room
  ON agenda_items(event_id, starts_at, room_id);
CREATE INDEX idx_agenda_room_starts ON agenda_items(room_id, starts_at);
CREATE INDEX idx_agenda_event_published_starts
  ON agenda_items(event_id, is_published, starts_at);
CREATE INDEX idx_agenda_track_starts ON agenda_items(track_id, starts_at);

CREATE INDEX idx_task_templates_event_position
  ON task_templates(event_id, position);
CREATE INDEX idx_task_templates_event_auto_assign
  ON task_templates(event_id, auto_assign);
CREATE INDEX idx_speaker_tasks_event_status_due
  ON speaker_tasks(event_id, status, due_at);
CREATE INDEX idx_speaker_tasks_person_status_due
  ON speaker_tasks(person_id, status, due_at);
CREATE INDEX idx_speaker_tasks_submission_status
  ON speaker_tasks(submission_id, status);
CREATE INDEX idx_speaker_tasks_template ON speaker_tasks(template_id);

CREATE UNIQUE INDEX uq_calendar_invites_submission_person
  ON calendar_invites(submission_id, person_id);
CREATE UNIQUE INDEX uq_calendar_invites_uid ON calendar_invites(uid);
CREATE INDEX idx_calendar_invites_submission_status
  ON calendar_invites(submission_id, status);

CREATE INDEX idx_mirror_outbox_status_created
  ON mirror_outbox(status, created_at);
CREATE INDEX idx_mirror_outbox_table_row_created
  ON mirror_outbox(table_name, row_id, created_at);
CREATE UNIQUE INDEX uq_mirror_state_table_name ON mirror_state(table_name);
CREATE INDEX idx_mirror_state_webhook_expires ON mirror_state(webhook_expires_at);
CREATE INDEX idx_mirror_state_last_sync ON mirror_state(last_sync_at);

CREATE INDEX idx_imports_event_status_created ON imports(event_id, status, created_at);
CREATE INDEX idx_imports_event_source_created ON imports(event_id, source, created_at);
CREATE UNIQUE INDEX uq_import_rows_import_row ON import_rows(import_id, row_index);
CREATE INDEX idx_import_rows_import_outcome ON import_rows(import_id, outcome);
CREATE INDEX idx_import_rows_target ON import_rows(target_id);

CREATE UNIQUE INDEX uq_embeds_slug ON embeds(slug);
CREATE INDEX idx_embeds_event_kind ON embeds(event_id, kind);

CREATE INDEX idx_audit_event_created ON audit_log(event_id, created_at);
CREATE INDEX idx_audit_entity_created
  ON audit_log(entity_type, entity_id, created_at);
CREATE INDEX idx_audit_actor_created ON audit_log(actor_person_id, created_at);
CREATE UNIQUE INDEX uq_event_settings_event_key ON event_settings(event_id, key);

-- SPEC §3.4 names the writer for search_blob as a trigger. The Wave-2 quick
-- search ticket may extend this normalized projection in a later migration.
CREATE TRIGGER submissions_session_bypass_insert
AFTER INSERT ON submissions
WHEN new.kind = 'session' AND new.bypass_evaluation = 0
BEGIN
  UPDATE submissions SET bypass_evaluation = 1 WHERE id = new.id;
END;

CREATE TRIGGER submissions_search_blob_insert
AFTER INSERT ON submissions
BEGIN
  UPDATE submissions
  SET search_blob = lower(trim(new.title || ' ' || coalesce(new.abstract, '')))
  WHERE id = new.id;
END;

CREATE TRIGGER submissions_search_blob_update
AFTER UPDATE OF title, abstract ON submissions
BEGIN
  UPDATE submissions
  SET search_blob = lower(trim(new.title || ' ' || coalesce(new.abstract, '')))
  WHERE id = new.id;
END;
