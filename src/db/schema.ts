/**
 * Type mirror for migrations/0001_init.sql.
 *
 * Marquee uses raw SQL rather than an ORM. These types describe physical D1
 * rows (snake_case included) and keep the write-once core schema visible to
 * every later query module.
 */

export type Id = string;
export type EpochMilliseconds = number;
export type CalendarDate = string;
export type PersonKind = "human" | "agent";
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonText<T extends JsonValue = JsonValue> = string & {
  readonly __jsonType?: T;
};

export interface ApiTokenScopes {
  event_ids: Id[];
  permissions: string[];
}

export const EVENT_STATUSES = ["draft", "live"] as const;
export const MEMBERSHIP_ROLES = [
  "owner",
  "program_lead",
  "ops",
  "reviewer",
  "speaker",
] as const;
export const MAGIC_LINK_PURPOSES = [
  "login",
  "draft_resume",
  "cospeaker_profile",
  "task_link",
  "claim",
  "org_invite",
] as const;
/**
 * The two purposes that pre-date their person: a claim token is minted against
 * a database with no people in it, and an organization invite is minted before
 * the invited organizer exists. Both create their person at exchange, so both
 * carry a null `person_id` — enforced in the schema by 0009's CHECK.
 */
export const PERSONLESS_MAGIC_LINK_PURPOSES = ["claim", "org_invite"] as const;
export const FORM_KINDS = ["abstract", "session"] as const;
export const FORM_STATUSES = ["draft", "open", "closed"] as const;
export const FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "url",
  "email",
  "file",
  "number",
  "date",
] as const;
export const SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
] as const;
export const SUBMISSION_ORIGINS = ["public", "admin", "import"] as const;
export const VENDOR_AFFILIATIONS = [
  "none",
  "vendor_to_fi",
  "vendor_with_champion",
] as const;
export const LAST_WRITE_SOURCES = ["marquee", "airtable"] as const;
export const DECISIONS = ["approve", "maybe", "deny"] as const;
export const DECISION_STATUSES = ["accepted", "waitlisted", "rejected"] as const;
export const PARTICIPATION_ROLES = [
  "speaker",
  "co_speaker",
  "moderator",
  "chairperson",
  "submitter",
  "sponsor_contact",
] as const;
export const CONFIRMATION_STATUSES = ["pending", "confirmed", "declined"] as const;
export const EVALUATION_ROUND_MODES = ["scorecard", "comparison"] as const;
export const AGENDA_ITEM_KINDS = ["session", "break"] as const;
export const TASK_KINDS = ["acknowledge", "file", "form"] as const;
export const TASK_STATUSES = ["open", "done"] as const;
export const ATTACHMENT_OWNER_TYPES = [
  "person_headshot",
  "task_upload",
  "event_logo",
  "import_file",
  "draft_file",
  "submission_file",
] as const;
export const ATTACHMENT_STATUSES = ["pending", "ready"] as const;
export const OUTBOX_STATUSES = ["queued", "sent", "suppressed", "failed"] as const;
export const OUTBOX_SEND_POLICIES = ["demo_safe", "always_live"] as const;
export const CALENDAR_METHODS = ["REQUEST", "CANCEL"] as const;
export const WEBHOOK_EVENT_TYPES = [
  "submission.created",
  "submission.status_changed",
  "evaluation.completed",
  "speaker_task.completed",
  "agenda.published",
  "speaker.confirmed",
] as const;
export const WEBHOOK_DELIVERY_STATUSES = ["queued", "delivered", "failed"] as const;
export const MIRROR_OPERATIONS = ["upsert", "delete"] as const;
export const IMPORT_OUTCOMES = ["created", "updated", "skipped", "failed"] as const;
export const EMBED_KINDS = ["agenda", "sessions", "speakers", "cfp"] as const;
export const EMBED_LAYOUTS = ["cards", "list"] as const;
export const EMBED_OUTPUT_FORMATS = ["html", "json", "ical"] as const;
export const AUDIT_ACTOR_KINDS = ["user", "api_token", "system", "airtable"] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export type MagicLinkPurpose = (typeof MAGIC_LINK_PURPOSES)[number];
export type FormKind = (typeof FORM_KINDS)[number];
export type FormStatus = (typeof FORM_STATUSES)[number];
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export type SubmissionOrigin = (typeof SUBMISSION_ORIGINS)[number];
export type VendorAffiliation = (typeof VENDOR_AFFILIATIONS)[number];
export type LastWriteSource = (typeof LAST_WRITE_SOURCES)[number];
export type Decision = (typeof DECISIONS)[number];
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export type ParticipationRole = (typeof PARTICIPATION_ROLES)[number];
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];
export type EvaluationRoundMode = (typeof EVALUATION_ROUND_MODES)[number];
export type AgendaItemKind = (typeof AGENDA_ITEM_KINDS)[number];
export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
export type OutboxSendPolicy = (typeof OUTBOX_SEND_POLICIES)[number];
export type CalendarMethod = (typeof CALENDAR_METHODS)[number];
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];
export type MirrorOperation = (typeof MIRROR_OPERATIONS)[number];
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];
export type EmbedKind = (typeof EMBED_KINDS)[number];
export type EmbedLayout = (typeof EMBED_LAYOUTS)[number];
export type EmbedOutputFormat = (typeof EMBED_OUTPUT_FORMATS)[number];
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

export interface MutableRecord {
  created_at: EpochMilliseconds;
  id: Id;
  updated_at: EpochMilliseconds;
}

export interface ImmutableRecord {
  created_at: EpochMilliseconds;
  id: Id;
}

export interface OrganizationRow extends MutableRecord {
  name: string;
  slug: string;
}

export interface EventRow extends MutableRecord {
  accent: string | null;
  demo_mode: 0 | 1;
  ends_on: CalendarDate;
  logo_key: string | null;
  name: string;
  org_id: Id;
  slug: string;
  starts_on: CalendarDate;
  status: EventStatus;
  tagline: string | null;
  timezone: string;
  venue: string | null;
}

export interface FormatRow extends MutableRecord {
  default_duration_min: number;
  event_id: Id;
  max_duration_min: number;
  min_duration_min: number;
  name: string;
  position: number;
}

export interface TrackRow extends MutableRecord {
  color: string;
  event_id: Id;
  name: string;
  position: number;
}

export interface BuildingRow extends MutableRecord {
  access_minutes: number;
  access_note: string | null;
  address: string;
  event_id: Id;
  lat: number | null;
  lng: number | null;
  name: string;
  position: number;
}

export interface RoomRow extends MutableRecord {
  av_capabilities: JsonText<string[]>;
  building_id: Id;
  capacity: number;
  event_id: Id;
  name: string;
  notes: string | null;
  position: number;
}

export interface WaveRow extends MutableRecord {
  decision_on: CalendarDate;
  event_id: Id;
  name: string;
  position: number;
  sent_at: EpochMilliseconds | null;
  target_count: number;
}

export interface AttachmentRow extends MutableRecord {
  content_type: string;
  event_id: Id;
  filename: string;
  owner_id: Id;
  owner_type: AttachmentOwnerType;
  r2_key: string;
  r2_etag: string | null;
  sha256: string | null;
  size_bytes: number;
  status: AttachmentStatus;
}

export interface FileCommentRow extends ImmutableRecord {
  attachment_id: Id | null;
  author_person_id: Id;
  body: string;
  event_id: Id;
  owner_id: Id;
  owner_type: "task_upload";
}

export interface PersonRow extends MutableRecord {
  bio: string | null;
  company: string | null;
  custom_fields: JsonText;
  email: string;
  headshot_attachment_id: Id | null;
  is_demo: 0 | 1;
  kind: PersonKind;
  last_write_source: LastWriteSource;
  name: string;
  org_id: Id;
  social_links: JsonText;
  title: string | null;
}

export interface PersonEventRow extends ImmutableRecord {
  actor_person_id: Id | null;
  kind: "note" | "tag" | "stage";
  org_id: Id;
  person_id: Id;
  value_json: JsonText;
}

export interface PersonListRow extends MutableRecord {
  config_json: JsonText;
  created_by: Id | null;
  kind: "live" | "fixed";
  name: string;
  org_id: Id;
}

export interface PersonListMemberRow {
  created_at: EpochMilliseconds;
  list_id: Id;
  person_id: Id;
}

export interface MembershipRow extends MutableRecord {
  confirmation_status: ConfirmationStatus;
  confirmed_at: EpochMilliseconds | null;
  event_id: Id | null;
  invited_at: EpochMilliseconds | null;
  org_id: Id;
  person_id: Id;
  role: MembershipRole;
}

export interface AuthSessionRow extends MutableRecord {
  expires_at: EpochMilliseconds;
  person_id: Id;
  revoked_at: EpochMilliseconds | null;
  role_hint: string | null;
  user_agent_hash: string;
}

export interface MagicLinkRow extends MutableRecord {
  expires_at: EpochMilliseconds;
  /** Null exactly for `claim` and `org_invite`, whose person is created at exchange. */
  person_id: Id | null;
  purpose: MagicLinkPurpose;
  redirect_to: string;
  token_hash: string;
  used_at: EpochMilliseconds | null;
}

export interface ApiTokenRow extends MutableRecord {
  acts_as_person_id: Id | null;
  created_by: Id;
  event_id: Id | null;
  last_used_at: EpochMilliseconds | null;
  name: string;
  org_id: Id;
  prefix: string;
  revoked_at: EpochMilliseconds | null;
  scopes: JsonText<ApiTokenScopes & { [key: string]: JsonValue }>;
  token_hash: string;
}

export interface FormRow extends MutableRecord {
  admin_notify_person_ids: JsonText<Id[]>;
  closes_at: EpochMilliseconds | null;
  event_id: Id;
  kind: FormKind;
  max_speakers: number;
  max_sponsors: number;
  min_speakers: number;
  name: string;
  opens_at: EpochMilliseconds | null;
  password_hash: string | null;
  per_submitter_limit: number;
  reminder_offset_hours: number | null;
  slug: string;
  status: FormStatus;
  thankyou_template_key: string | null;
  turnstile_required: 0 | 1;
  welcome_md: string;
}

export interface FormFieldRow extends MutableRecord {
  condition: JsonText | null;
  config: JsonText;
  form_id: Id;
  help_text: string | null;
  key: string;
  label: string;
  position: number;
  required: 0 | 1;
  type: FormFieldType;
}

export interface FormAdminRow extends MutableRecord {
  form_id: Id;
  person_id: Id;
}

export interface EmailTemplateRow extends MutableRecord {
  body_md: string;
  enabled: 0 | 1;
  event_id: Id;
  key: string;
  name: string;
  subject: string;
}

export interface OutboxRow extends MutableRecord {
  entity_id: Id | null;
  error: string | null;
  event_id: Id;
  html: string;
  ics_body: string | null;
  ics_uid: string | null;
  idempotency_key: string;
  person_id: Id | null;
  provider_message_id: string | null;
  scheduled_for: EpochMilliseconds | null;
  send_policy: OutboxSendPolicy;
  sent_at: EpochMilliseconds | null;
  status: OutboxStatus;
  subject: string;
  suppressed_reason: string | null;
  template_key: string;
  text: string;
  to_email: string;
}

export interface RoutingRuleRow extends MutableRecord {
  enabled: 0 | 1;
  event_id: Id;
  name: string;
  position: number;
  then_json: JsonText;
  when_json: JsonText;
}

export interface SubmissionRow extends MutableRecord {
  abstract: string | null;
  applied_rule_id: Id | null;
  bypass_evaluation: 0 | 1;
  decided_at: EpochMilliseconds | null;
  decided_by_person_id: Id | null;
  event_id: Id;
  external_ref: string | null;
  form_id: Id | null;
  format_id: Id | null;
  is_published: 0 | 1;
  kind: FormKind;
  last_saved_at: EpochMilliseconds | null;
  last_write_source: LastWriteSource;
  origin: SubmissionOrigin;
  primary_track_id: Id | null;
  resume_token_hash: string | null;
  search_blob: string;
  status: SubmissionStatus;
  submitted_at: EpochMilliseconds | null;
  submitter_person_id: Id;
  title: string;
  vendor_affiliation: VendorAffiliation;
  wave_id: Id | null;
}

export interface SubmissionAnswerRow extends MutableRecord {
  field_id: Id;
  submission_id: Id;
  value_json: JsonText | null;
  value_text: string | null;
}

export interface SubmissionTrackRow extends MutableRecord {
  is_primary: 0 | 1;
  submission_id: Id;
  track_id: Id;
}

export interface SubmissionDecisionRow extends MutableRecord {
  decided_at: EpochMilliseconds;
  decided_by_person_id: Id;
  decision: Decision;
  event_id: Id;
  feedback_md: string | null;
  outbox_id: Id | null;
  resulting_status: DecisionStatus;
  submission_id: Id;
}

export interface SavedViewRow extends MutableRecord {
  config_json: JsonText;
  event_id: Id;
  name: string;
  person_id: Id;
}

export interface ParticipationRow extends MutableRecord {
  confirmation_status: ConfirmationStatus;
  confirmed_at: EpochMilliseconds | null;
  invited_at: EpochMilliseconds | null;
  person_id: Id;
  position: number;
  role: ParticipationRole;
  submission_id: Id;
}

export interface EvaluationPlanRow extends MutableRecord {
  event_id: Id;
  instructions: string;
  name: string;
  scale_max: number | null;
  scale_min: number | null;
  status: string;
}

export interface EvaluationRoundRow extends MutableRecord {
  anonymized: 0 | 1;
  committee_id: Id | null;
  closes_at: EpochMilliseconds | null;
  mode: EvaluationRoundMode;
  name: string;
  opens_at: EpochMilliseconds | null;
  plan_id: Id;
  position: number;
  target_reviews_per_submission: number;
}

export interface RubricCriterionRow extends MutableRecord {
  /** Weights are a numeric-only concept: select and text criteria carry weight 0. */
  kind: "numeric" | "select" | "text";
  name: string;
  /** JSON array of choice labels; set only when kind is 'select'. */
  options: JsonText | null;
  position: number;
  round_id: Id;
  scale_max: number | null;
  scale_min: number | null;
  weight_pct: number;
}

export interface CommitteeRow extends MutableRecord {
  event_id: Id;
  name: string;
}

export interface CommitteeMemberRow extends MutableRecord {
  committee_id: Id;
  person_id: Id;
  role: string;
}

export interface ReviewerTrackScopeRow extends MutableRecord {
  event_id: Id;
  person_id: Id;
  track_id: Id;
}

export interface RoundAssignmentRow extends MutableRecord {
  committee_id: Id | null;
  reviewer_person_id: Id | null;
  round_id: Id;
  status: string;
  submission_id: Id;
}

export interface EvaluationRow extends MutableRecord {
  abstained: 0 | 1;
  comment: string;
  criteria_scores: JsonText | null;
  recommendation: Decision | null;
  reviewer_person_id: Id;
  round_id: Id;
  score: number | null;
  submission_id: Id;
}

export interface ComparisonRow extends MutableRecord {
  ranking: JsonText<JsonValue[]>;
  reviewer_person_id: Id;
  round_id: Id;
  submission_ids: JsonText<[Id, Id, Id]>;
}

export interface RoundPromotionRow extends MutableRecord {
  from_round_id: Id;
  promoted_at: EpochMilliseconds;
  promoted_by: Id;
  submission_id: Id;
  to_round_id: Id;
}

export interface AgendaItemRow extends MutableRecord {
  duration_min: number;
  event_id: Id;
  is_published: 0 | 1;
  kind: AgendaItemKind;
  room_id: Id;
  starts_at: EpochMilliseconds;
  submission_id: Id | null;
  title: string | null;
  track_id: Id | null;
}

export interface TaskTemplateRow extends MutableRecord {
  auto_assign: 0 | 1;
  description: string;
  due_at: EpochMilliseconds | null;
  due_offset_days: number | null;
  event_id: Id;
  file_config: JsonText | null;
  form_id: Id | null;
  kind: TaskKind;
  name: string;
  position: number;
}

export interface SpeakerTaskRow extends MutableRecord {
  attachment_id: Id | null;
  cancelled_at: EpochMilliseconds | null;
  completed_at: EpochMilliseconds | null;
  description: string;
  due_at: EpochMilliseconds;
  event_id: Id;
  kind: TaskKind;
  last_write_source: LastWriteSource;
  person_id: Id;
  response_json: JsonText | null;
  status: TaskStatus;
  submission_id: Id | null;
  template_id: Id;
  title: string;
}

export interface CalendarInviteRow extends MutableRecord {
  last_method: CalendarMethod;
  last_sent_at: EpochMilliseconds | null;
  person_id: Id;
  sequence: number;
  status: string;
  submission_id: Id;
  uid: string;
}

export interface MirrorOutboxRow extends MutableRecord {
  attempts: number;
  drained_at: EpochMilliseconds | null;
  last_error: string | null;
  op: MirrorOperation;
  payload: JsonText;
  row_id: Id;
  status: string;
  table_name: string;
}

export interface MirrorStateRow extends MutableRecord {
  airtable_table_id: string | null;
  cursor: string | null;
  last_error: string | null;
  last_sync_at: EpochMilliseconds | null;
  local_row_count: number;
  remote_row_count: number;
  table_name: string;
  webhook_expires_at: EpochMilliseconds | null;
  webhook_id: string | null;
}

export interface WebhookEndpointRow extends ImmutableRecord {
  enabled: 0 | 1;
  event_id: Id;
  events_json: JsonText;
  last_delivery_at: EpochMilliseconds | null;
  secret_hash: string;
  url: string;
}

export interface WebhookDeliveryRow extends ImmutableRecord {
  attempts: number;
  delivered_at: EpochMilliseconds | null;
  endpoint_id: Id;
  error: string | null;
  event_type: WebhookEventType;
  payload: string;
  response_code: number | null;
  status: WebhookDeliveryStatus;
}

export interface ImportRow extends MutableRecord {
  event_id: Id;
  file_key: string;
  mapping: JsonText;
  source: string;
  status: string;
  undone_at: EpochMilliseconds | null;
}

export interface ImportRowRow extends MutableRecord {
  before_json: JsonText | null;
  entity: string;
  import_id: Id;
  outcome: ImportOutcome;
  reason: string | null;
  row_index: number;
  target_id: Id | null;
}

export interface EmbedRow extends MutableRecord {
  config: JsonText;
  enabled: 0 | 1;
  event_id: Id;
  kind: EmbedKind;
  name: string;
  slug: string;
}

export interface AuditLogRow extends ImmutableRecord {
  action: string;
  actor_kind: AuditActorKind;
  actor_person_id: Id | null;
  after_json: JsonText | null;
  before_json: JsonText | null;
  entity_id: Id;
  entity_type: string;
  event_id: Id;
  /**
   * The request this change came from, joining the domain audit trail to the
   * operational log. Null means there was no originating request — a cron
   * sweep, or a row written before the column existed.
   */
  request_id: string | null;
}

export interface EventSettingRow extends MutableRecord {
  event_id: Id;
  key: string;
  value_json: JsonText;
}

export const CORE_TABLE_NAMES = [
  "organizations",
  "events",
  "formats",
  "tracks",
  "buildings",
  "rooms",
  "waves",
  "attachments",
  "people",
  "memberships",
  "auth_sessions",
  "magic_links",
  "api_tokens",
  "forms",
  "form_fields",
  "form_admins",
  "email_templates",
  "outbox",
  "routing_rules",
  "submissions",
  "submission_answers",
  "submission_tracks",
  "submission_decisions",
  "saved_views",
  "participations",
  "evaluation_plans",
  "evaluation_rounds",
  "rubric_criteria",
  "committees",
  "committee_members",
  "reviewer_track_scopes",
  "round_assignments",
  "evaluations",
  "comparisons",
  "round_promotions",
  "agenda_items",
  "task_templates",
  "speaker_tasks",
  "calendar_invites",
  "mirror_outbox",
  "mirror_state",
  "imports",
  "import_rows",
  "embeds",
  "audit_log",
  "event_settings",
  "file_comments",
  "person_events",
  "person_lists",
  "person_list_members",
  "webhook_endpoints",
  "webhook_deliveries",
] as const;

export type CoreTableName = (typeof CORE_TABLE_NAMES)[number];
export const CORE_TABLE_COUNT = 52 as const;

type IsUnique<
  Values extends readonly unknown[],
  Seen extends readonly unknown[] = [],
> = Values extends readonly [infer Head, ...infer Tail]
  ? Head extends Seen[number]
    ? false
    : IsUnique<Tail, readonly [...Seen, Head]>
  : true;
type Assert<Condition extends true> = Condition;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type _CoreTableNamesAreUnique = Assert<IsUnique<typeof CORE_TABLE_NAMES>>;
type _CoreTableCountIsExact = Assert<Equal<(typeof CORE_TABLE_NAMES)["length"], 52>>;

export const CORE_TABLES = {
  agenda_items: "agenda_items",
  api_tokens: "api_tokens",
  attachments: "attachments",
  audit_log: "audit_log",
  auth_sessions: "auth_sessions",
  buildings: "buildings",
  calendar_invites: "calendar_invites",
  committee_members: "committee_members",
  committees: "committees",
  comparisons: "comparisons",
  email_templates: "email_templates",
  embeds: "embeds",
  evaluation_plans: "evaluation_plans",
  evaluation_rounds: "evaluation_rounds",
  evaluations: "evaluations",
  event_settings: "event_settings",
  file_comments: "file_comments",
  events: "events",
  form_admins: "form_admins",
  form_fields: "form_fields",
  formats: "formats",
  forms: "forms",
  import_rows: "import_rows",
  imports: "imports",
  magic_links: "magic_links",
  memberships: "memberships",
  mirror_outbox: "mirror_outbox",
  mirror_state: "mirror_state",
  organizations: "organizations",
  outbox: "outbox",
  participations: "participations",
  people: "people",
  person_events: "person_events",
  person_list_members: "person_list_members",
  person_lists: "person_lists",
  reviewer_track_scopes: "reviewer_track_scopes",
  rooms: "rooms",
  round_assignments: "round_assignments",
  round_promotions: "round_promotions",
  routing_rules: "routing_rules",
  rubric_criteria: "rubric_criteria",
  saved_views: "saved_views",
  speaker_tasks: "speaker_tasks",
  submission_answers: "submission_answers",
  submission_decisions: "submission_decisions",
  submission_tracks: "submission_tracks",
  submissions: "submissions",
  task_templates: "task_templates",
  tracks: "tracks",
  waves: "waves",
  webhook_deliveries: "webhook_deliveries",
  webhook_endpoints: "webhook_endpoints",
} as const satisfies { [Table in CoreTableName]: Table };

export interface CoreTableRows {
  agenda_items: AgendaItemRow;
  api_tokens: ApiTokenRow;
  attachments: AttachmentRow;
  audit_log: AuditLogRow;
  auth_sessions: AuthSessionRow;
  buildings: BuildingRow;
  calendar_invites: CalendarInviteRow;
  committee_members: CommitteeMemberRow;
  committees: CommitteeRow;
  comparisons: ComparisonRow;
  email_templates: EmailTemplateRow;
  embeds: EmbedRow;
  evaluation_plans: EvaluationPlanRow;
  evaluation_rounds: EvaluationRoundRow;
  evaluations: EvaluationRow;
  event_settings: EventSettingRow;
  file_comments: FileCommentRow;
  events: EventRow;
  form_admins: FormAdminRow;
  form_fields: FormFieldRow;
  formats: FormatRow;
  forms: FormRow;
  import_rows: ImportRowRow;
  imports: ImportRow;
  magic_links: MagicLinkRow;
  memberships: MembershipRow;
  mirror_outbox: MirrorOutboxRow;
  mirror_state: MirrorStateRow;
  organizations: OrganizationRow;
  outbox: OutboxRow;
  participations: ParticipationRow;
  people: PersonRow;
  person_events: PersonEventRow;
  person_list_members: PersonListMemberRow;
  person_lists: PersonListRow;
  reviewer_track_scopes: ReviewerTrackScopeRow;
  rooms: RoomRow;
  round_assignments: RoundAssignmentRow;
  round_promotions: RoundPromotionRow;
  routing_rules: RoutingRuleRow;
  rubric_criteria: RubricCriterionRow;
  saved_views: SavedViewRow;
  speaker_tasks: SpeakerTaskRow;
  submission_answers: SubmissionAnswerRow;
  submission_decisions: SubmissionDecisionRow;
  submission_tracks: SubmissionTrackRow;
  submissions: SubmissionRow;
  task_templates: TaskTemplateRow;
  tracks: TrackRow;
  waves: WaveRow;
  webhook_deliveries: WebhookDeliveryRow;
  webhook_endpoints: WebhookEndpointRow;
}

type _CoreRowsAreComplete = Assert<Equal<keyof CoreTableRows, CoreTableName>>;

interface CoreDefaultColumns {
  agenda_items: "is_published";
  api_tokens: never;
  attachments: "status";
  audit_log: never;
  auth_sessions: never;
  buildings: never;
  calendar_invites: "sequence";
  committee_members: never;
  committees: never;
  comparisons: never;
  email_templates: "enabled";
  embeds: never;
  evaluation_plans: "instructions";
  evaluation_rounds: "anonymized" | "mode";
  evaluations: "abstained" | "comment";
  event_settings: never;
  file_comments: never;
  events: "demo_mode" | "status";
  form_admins: never;
  form_fields: "config" | "required";
  formats: never;
  forms:
    | "admin_notify_person_ids"
    | "max_speakers"
    | "max_sponsors"
    | "min_speakers"
    | "per_submitter_limit"
    | "status"
    | "turnstile_required"
    | "welcome_md";
  import_rows: never;
  imports: never;
  magic_links: never;
  memberships: "confirmation_status";
  mirror_outbox: "attempts";
  mirror_state: "local_row_count" | "remote_row_count";
  organizations: never;
  outbox: "send_policy" | "status";
  participations: "confirmation_status";
  people: "custom_fields" | "is_demo" | "last_write_source" | "social_links";
  person_events: never;
  person_list_members: never;
  person_lists: "config_json";
  reviewer_track_scopes: never;
  rooms: "av_capabilities";
  round_assignments: never;
  round_promotions: never;
  routing_rules: "enabled";
  rubric_criteria: never;
  saved_views: never;
  speaker_tasks: "description" | "last_write_source" | "status";
  submission_answers: never;
  submission_decisions: never;
  submission_tracks: "is_primary";
  submissions:
    | "is_published"
    | "last_write_source"
    | "search_blob"
    | "status"
    | "vendor_affiliation";
  task_templates: "auto_assign" | "description";
  tracks: never;
  waves: never;
  webhook_deliveries: "attempts";
  webhook_endpoints: "enabled";
}

type GeneratedColumn<Row> = Extract<
  keyof Row,
  "created_at" | "id" | "updated_at"
>;
type DefaultColumn<Table extends CoreTableName> = Extract<
  CoreDefaultColumns[Table],
  keyof CoreTableRows[Table]
>;

export type CoreInsert<Table extends CoreTableName> = Omit<
  CoreTableRows[Table],
  GeneratedColumn<CoreTableRows[Table]> | DefaultColumn<Table>
> &
  Partial<Pick<CoreTableRows[Table], DefaultColumn<Table>>>;

export type OrganizationInsert = CoreInsert<"organizations">;
export type EventInsert = CoreInsert<"events">;
export type FormatInsert = CoreInsert<"formats">;
export type TrackInsert = CoreInsert<"tracks">;
export type BuildingInsert = CoreInsert<"buildings">;
export type RoomInsert = CoreInsert<"rooms">;
export type WaveInsert = CoreInsert<"waves">;
export type AttachmentInsert = CoreInsert<"attachments">;
export type PersonInsert = CoreInsert<"people">;
export type PersonEventInsert = CoreInsert<"person_events">;
export type PersonListInsert = CoreInsert<"person_lists">;
export type PersonListMemberInsert = CoreInsert<"person_list_members">;
export type MembershipInsert = CoreInsert<"memberships">;
export type AuthSessionInsert = CoreInsert<"auth_sessions">;
export type MagicLinkInsert = CoreInsert<"magic_links">;
export type ApiTokenInsert = CoreInsert<"api_tokens">;
export type FormInsert = CoreInsert<"forms">;
export type FormFieldInsert = CoreInsert<"form_fields">;
export type FormAdminInsert = CoreInsert<"form_admins">;
export type EmailTemplateInsert = CoreInsert<"email_templates">;
export type OutboxInsert = CoreInsert<"outbox">;
export type RoutingRuleInsert = CoreInsert<"routing_rules">;
export type SubmissionInsert = CoreInsert<"submissions">;
export type SubmissionAnswerInsert = CoreInsert<"submission_answers">;
export type SubmissionTrackInsert = CoreInsert<"submission_tracks">;
export type SubmissionDecisionInsert = CoreInsert<"submission_decisions">;
export type SavedViewInsert = CoreInsert<"saved_views">;
export type ParticipationInsert = CoreInsert<"participations">;
export type EvaluationPlanInsert = CoreInsert<"evaluation_plans">;
export type EvaluationRoundInsert = CoreInsert<"evaluation_rounds">;
export type RubricCriterionInsert = CoreInsert<"rubric_criteria">;
export type CommitteeInsert = CoreInsert<"committees">;
export type CommitteeMemberInsert = CoreInsert<"committee_members">;
export type ReviewerTrackScopeInsert = CoreInsert<"reviewer_track_scopes">;
export type RoundAssignmentInsert = CoreInsert<"round_assignments">;
export type EvaluationInsert = CoreInsert<"evaluations">;
export type ComparisonInsert = CoreInsert<"comparisons">;
export type RoundPromotionInsert = CoreInsert<"round_promotions">;
export type AgendaItemInsert = CoreInsert<"agenda_items">;
export type TaskTemplateInsert = CoreInsert<"task_templates">;
export type SpeakerTaskInsert = CoreInsert<"speaker_tasks">;
export type CalendarInviteInsert = CoreInsert<"calendar_invites">;
export type MirrorOutboxInsert = CoreInsert<"mirror_outbox">;
export type MirrorStateInsert = CoreInsert<"mirror_state">;
export type ImportInsert = CoreInsert<"imports">;
export type ImportRowInsert = CoreInsert<"import_rows">;
export type EmbedInsert = CoreInsert<"embeds">;
export type AuditLogInsert = CoreInsert<"audit_log">;
export type EventSettingInsert = CoreInsert<"event_settings">;
export type FileCommentInsert = CoreInsert<"file_comments">;
export type WebhookEndpointInsert = CoreInsert<"webhook_endpoints">;
export type WebhookDeliveryInsert = CoreInsert<"webhook_deliveries">;
