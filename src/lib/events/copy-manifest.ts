/**
 * What travels when a conference is created from an existing one.
 *
 * Two rules hold this file together, and both exist because the schema accepts
 * a wrong copy silently.
 *
 * 1. **Columns are discovered, never listed.** The engine reads `SELECT *` and
 *    takes the column list from the row it got back, so a column added by the
 *    next migration is copied without anyone remembering to update a literal.
 *    Three migrations have already added columns to tables in this set
 *    (`0002`/`0003` to `buildings`, `0009_criterion_kinds` to `rubric_criteria`,
 *    `0010_evaluation_round_committees` to `evaluation_rounds`); a hand-written
 *    column list is a defect generator.
 *
 * 2. **Every column is nonetheless declared here**, and a test asserts this
 *    manifest against `PRAGMA table_info`. Discovery alone means a new column
 *    can never be silently *dropped*; the drift test means a new column can
 *    never be silently *leaked* into another conference. The migration that
 *    adds one fails the test and forces a ruling — which is the only moment
 *    anyone is in a position to make it.
 *
 * The nulls and constants below are not stylistic. Each one is a reference or a
 * date that would otherwise point at last year's conference:
 *   - `evaluation_rounds.committee_id` carries reviewer authority across years
 *     and dangles the moment the source event is deleted.
 *   - `forms.opens_at/closes_at` and `evaluation_rounds.opens_at/closes_at` are
 *     absolute epoch milliseconds — last year's submission window on next
 *     year's form.
 *   - `forms.status` is forced closed and `evaluation_plans.status` draft:
 *     opening intake is a decision, never a side effect of creating a record.
 */

/** The organizer-facing copy sets, in the order the checklist presents them. */
export const COPY_SET_KEYS = [
  "formats",
  "tracks",
  "forms",
  "task_templates",
  "email_templates",
  "evaluation_plan",
  "venues",
] as const;

export type CopySetKey = (typeof COPY_SET_KEYS)[number];

export type CopySelection = Partial<Record<CopySetKey, boolean>>;

/**
 * Venues are the one set that is off by default: a conference may return to the
 * same rooms or may not, and carrying a building nobody booked is worse than
 * one deliberate checkbox (design §2.3).
 */
export const DEFAULT_COPY_SELECTION: Record<CopySetKey, boolean> = {
  formats: true,
  tracks: true,
  forms: true,
  task_templates: true,
  email_templates: true,
  evaluation_plan: true,
  venues: false,
};

/** How a table's source rows are found, with exactly one bound parameter. */
export type CopyScope =
  | { kind: "event" }
  | { kind: "subquery"; column: string; sql: string };

export interface CopyTable {
  table: string;
  set: CopySetKey;
  /** Primary key; always regenerated. */
  key: string;
  scope: CopyScope;
  /** Deterministic read order, so positions and receipts are stable. */
  orderBy: string;
  /**
   * Column → the table whose id map rewrites it. `"__event__"` means the new
   * conference's own id.
   */
  remap: Readonly<Record<string, string>>;
  /** Columns forced to NULL on copy. */
  nulls: readonly string[];
  /** Columns forced to a fixed value on copy. */
  constants: Readonly<Record<string, string | number>>;
  /** Timestamp columns stamped with the copy's own clock. */
  stamps: readonly string[];
  /** Everything else, carried across unchanged. Declared for the drift test. */
  verbatim: readonly string[];
  /** Rows the engine declines to copy, with the reason surfaced in the receipt. */
  skip?: (row: Record<string, unknown>) => boolean;
}

const FORMS_OF_EVENT = "SELECT id FROM forms WHERE event_id = ?";
const PLANS_OF_EVENT = "SELECT id FROM evaluation_plans WHERE event_id = ?";
const ROUNDS_OF_EVENT =
  "SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?";

/**
 * Parents precede children: every remap target is already in the id map by the
 * time the child table is read.
 */
export const COPY_TABLES: readonly CopyTable[] = [
  {
    table: "formats",
    set: "formats",
    key: "id",
    scope: { kind: "event" },
    orderBy: "position, id",
    remap: { event_id: "__event__" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    verbatim: ["name", "default_duration_min", "min_duration_min", "max_duration_min", "position"],
  },
  {
    table: "tracks",
    set: "tracks",
    key: "id",
    scope: { kind: "event" },
    orderBy: "position, id",
    remap: { event_id: "__event__" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    verbatim: ["name", "color", "position"],
  },
  {
    table: "buildings",
    set: "venues",
    key: "id",
    scope: { kind: "event" },
    orderBy: "position, id",
    remap: { event_id: "__event__" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    // lat/lng/access_minutes arrived in 0002 and access_note in 0003 — exactly
    // the drift a literal column list would have stopped copying in silence.
    verbatim: ["name", "address", "position", "lat", "lng", "access_minutes", "access_note"],
  },
  {
    table: "rooms",
    set: "venues",
    key: "id",
    scope: { kind: "event" },
    orderBy: "position, id",
    // The composite FK (building_id, event_id) → buildings(id, event_id) is why
    // the venues set is all-or-nothing: a room cannot point at a building in
    // another conference even if someone wanted it to.
    remap: { event_id: "__event__", building_id: "buildings" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    verbatim: ["name", "capacity", "position", "av_capabilities", "notes"],
  },
  {
    table: "forms",
    set: "forms",
    key: "id",
    scope: { kind: "event" },
    orderBy: "id",
    remap: { event_id: "__event__" },
    // Last year's submission window has no business on next year's form, and a
    // copied form that opened on its own would be a conference collecting
    // abstracts nobody announced.
    nulls: ["opens_at", "closes_at"],
    constants: { status: "closed" },
    stamps: ["created_at", "updated_at"],
    // `password_hash` travels on purpose: a form that was gated must not
    // silently lose its gate when next year's organizer opens it. It arrives
    // closed, so nothing is exposed in the meantime.
    verbatim: [
      "name",
      "slug",
      "kind",
      "welcome_md",
      "per_submitter_limit",
      "submitter_limit_inherit",
      "min_speakers",
      "max_speakers",
      "max_sponsors",
      "password_hash",
      "reminder_offset_hours",
      "thankyou_template_key",
      "admin_notify_person_ids",
      "turnstile_required",
    ],
  },
  {
    table: "form_fields",
    set: "forms",
    key: "id",
    scope: { kind: "subquery", column: "form_id", sql: FORMS_OF_EVENT },
    orderBy: "position, id",
    remap: { form_id: "forms" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    // Neither JSON blob carries an id: `condition` keys on fieldKey
    // (src/lib/form-conditions.ts) and `config` carries source/minItems only.
    // Stated so nobody builds a remapper for them.
    verbatim: ["key", "label", "help_text", "type", "required", "position", "config", "condition"],
  },
  {
    table: "form_admins",
    set: "forms",
    key: "id",
    scope: { kind: "subquery", column: "form_id", sql: FORMS_OF_EVENT },
    orderBy: "id",
    remap: { form_id: "forms" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    // People are organization-scoped, so a form administrator is already the
    // same person row next year. They travel deliberately and the create screen
    // says so — they administer a form, which is not the same thing as the
    // reviewer authority a committee carries, and that is why committees don't.
    verbatim: ["person_id"],
  },
  {
    table: "email_templates",
    set: "email_templates",
    key: "id",
    scope: { kind: "event" },
    orderBy: "key, id",
    remap: { event_id: "__event__" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    verbatim: ["key", "name", "subject", "body_md", "enabled"],
  },
  {
    table: "evaluation_plans",
    set: "evaluation_plan",
    key: "id",
    scope: { kind: "event" },
    orderBy: "id",
    remap: { event_id: "__event__" },
    nulls: [],
    // The column carries no CHECK, so a copied plan would otherwise arrive in
    // whatever state the source was in — a live-looking review surface over
    // zero submissions and no committee. Draft is inert by construction:
    // assignment refuses any plan that is not open.
    constants: { status: "draft" },
    stamps: ["created_at", "updated_at"],
    verbatim: ["name", "instructions", "scale_min", "scale_max"],
  },
  {
    table: "evaluation_rounds",
    set: "evaluation_plan",
    key: "id",
    scope: { kind: "subquery", column: "plan_id", sql: PLANS_OF_EVENT },
    orderBy: "position, id",
    remap: { plan_id: "evaluation_plans" },
    // committee_id is the cross-event authority leak the copy contract exists
    // to prevent: a row-faithful copy points next year's round at last year's
    // committee, and dangles the moment that conference is deleted.
    nulls: ["committee_id", "opens_at", "closes_at"],
    constants: {},
    stamps: ["created_at", "updated_at"],
    verbatim: ["position", "name", "mode", "anonymized", "target_reviews_per_submission"],
  },
  {
    table: "rubric_criteria",
    set: "evaluation_plan",
    key: "id",
    scope: { kind: "subquery", column: "round_id", sql: ROUNDS_OF_EVENT },
    orderBy: "position, id",
    remap: { round_id: "evaluation_rounds" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    verbatim: ["name", "weight_pct", "position", "kind", "options", "scale_min", "scale_max"],
  },
  {
    table: "task_templates",
    set: "task_templates",
    key: "id",
    scope: { kind: "event" },
    orderBy: "position, id",
    // The remap the design's list forgot. `form_id` has a plain single-column
    // FK with no event_id in it, so pointing next year's speaker task at last
    // year's form is legal at the database level and wrong everywhere else.
    remap: { event_id: "__event__", form_id: "forms" },
    nulls: [],
    constants: {},
    stamps: ["created_at", "updated_at"],
    // `applies_to_roles` copies verbatim, and that is the whole point of it
    // being here: it is the organizer's targeting decision, and a clone that
    // dropped it would silently re-widen every narrowed template back to the
    // default inside an operation that reports success.
    verbatim: ["name", "kind", "description", "due_at", "due_offset_days", "file_config", "position", "auto_assign", "applies_to_roles"],
    // A fixed calendar deadline belongs to the conference it was set for, and
    // it cannot simply be nulled: CHECK ((due_at IS NULL) <> (due_offset_days
    // IS NULL)) requires exactly one of the pair, and `due_offset_days` counts
    // from the moment a task is assigned, not from the conference start — so a
    // derived offset would be a fabricated number wearing a real column's name.
    // These templates are declined, and the count is reported in the receipt.
    skip: (row) => row.due_at !== null && row.due_at !== undefined,
  },
];

/** Every column this manifest accounts for, for the schema-drift test. */
export function declaredColumns(table: CopyTable): string[] {
  return [
    table.key,
    ...Object.keys(table.remap),
    ...table.nulls,
    ...Object.keys(table.constants),
    ...table.stamps,
    ...table.verbatim,
  ];
}
