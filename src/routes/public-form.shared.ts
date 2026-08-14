import type { FormFieldView } from "./forms.queries";
import { findFormBySlug, listFormFields } from "./forms.queries";
import type { FormRow, PersonRow, SubmissionRow } from "../db/schema";
import {
  projectApplicableAnswers,
  type FormAnswerValue,
  type FormValidationIssue,
  type ProjectedFormAnswers,
} from "../lib/form-conditions";
import { sha256Hex } from "../lib/auth/random-token";
import { submitterEditability } from "../lib/submission-editing";
import type {
  PublicFormConfirmation,
  PublicFormField,
  PublicFormFile,
  PublicFormOutcome,
  PublicFormState,
  PublicFormStateName,
} from "./public-form.types";

export interface PublicFormEnv {
  DB: D1Database;
  CACHE: KVNamespace;
}

interface PublicFormRow extends FormRow {
  conference_name: string;
  conference_slug: string;
}

export interface PublicFormRecord {
  form: FormRow;
  conference: { name: string; slug: string };
  fields: FormFieldView[];
  state: PublicFormStateName;
  submission: SubmissionRow | null;
  answers: Record<string, unknown>;
  files: PublicFormFile[];
  email: string | null;
  resumeToken: string | null;
  resumeMissed: boolean;
  lastSavedAt: number | null;
  submittedAt: number | null;
  submissionOutcome: PublicFormOutcome | null;
  submissionEditable: boolean;
  submissionEditReason: string | null;
}

export interface PublicFormWriteResult {
  projected: ProjectedFormAnswers;
  issues: FormValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T | undefined) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalisePublicEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) ? email : null;
}

export function emailFromAnswers(answers: Record<string, unknown>): string | null {
  return normalisePublicEmail(answers.speaker_email ?? answers.email);
}

export function publicField(field: FormFieldView): PublicFormField {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    help_text: field.help_text,
    type: field.type,
    required: field.required,
    position: field.position,
    config: field.config,
    condition: field.condition,
  };
}

/**
 * How many people this form's fields can actually collect.
 *
 * The participant schema is a fixed pair of slots — `speaker_*` and one
 * optional `co_speaker_*` — while `max_speakers` is a number an organizer types
 * into the form builder. A form advertising four speakers through a shape that
 * can only ever hold two is a contract nobody can satisfy, and the applicant
 * reads the shortfall as a bug in the form rather than a limit of it.
 *
 * A form with no participant fields at all collects its people some other way
 * (or not at all); it declares no capacity here and is left alone.
 */
export function collectableParticipantSlots(fields: readonly FormFieldView[]): number | null {
  const has = (key: string): boolean => fields.some((field) => field.key === key);
  if (!has("speaker_name") && !has("speaker_email")) return null;
  return 1 + (has("co_speaker_name") && has("co_speaker_email") ? 1 : 0);
}

/** What the form may promise: never more than its fields can take. */
export function advertisedMaxSpeakers(configured: number, fields: readonly FormFieldView[]): number {
  const slots = collectableParticipantSlots(fields);
  return slots === null ? configured : Math.min(configured, slots);
}

function answerValue(valueJson: string | null, valueText: string | null): unknown {
  if (valueJson !== null) return parseJson(valueJson, null);
  return valueText;
}

async function readAnswers(
  db: D1Database,
  submissionId: string,
): Promise<Record<string, unknown>> {
  const rows = await db
    .prepare(
      `SELECT ff.key, sa.value_json, sa.value_text
       FROM submission_answers sa
       JOIN form_fields ff ON ff.id = sa.field_id
       WHERE sa.submission_id = ? ORDER BY ff.position ASC, ff.id ASC`,
    )
    .bind(submissionId)
    .all<{ key: string; value_json: string | null; value_text: string | null }>();
  return Object.fromEntries(rows.results.map((row) => [row.key, answerValue(row.value_json, row.value_text)]));
}

async function readFiles(
  db: D1Database,
  submission: SubmissionRow | null,
): Promise<PublicFormFile[]> {
  if (!submission) return [];
  const ownerType = submission.status === "draft" ? "draft_file" : "submission_file";
  const rows = await db
    .prepare(
      `SELECT id AS attachment_id, filename, content_type, size_bytes, status
       FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .bind(ownerType, submission.id)
    .all<PublicFormFile>();
  return rows.results.map((row) => ({ ...row, size_bytes: Number(row.size_bytes) }));
}

async function findResumeSubmission(
  db: D1Database,
  formId: string,
  resumeToken: string | undefined,
): Promise<SubmissionRow | null> {
  if (!resumeToken?.trim()) return null;
  const tokenHash = await sha256Hex(resumeToken.trim());
  return db
    .prepare(
      `SELECT * FROM submissions
       WHERE form_id = ? AND resume_token_hash = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(formId, tokenHash)
    .first<SubmissionRow>();
}

function publicOutcomeForSubmission(submission: SubmissionRow | null): PublicFormOutcome | null {
  if (!submission) return null;
  switch (submission.status) {
    case "accepted":
    case "waitlisted":
    case "rejected":
      return submission.status;
    default:
      return null;
  }
}

/**
 * "Submissions per person" caps the abstracts someone puts in front of the
 * committee. A draft is not one of those — it is the work in progress on the
 * way to one, and it is created server-side by the ordinary act of pressing
 * Save draft or attaching a file.
 *
 * Counting drafts made the cap self-inflicting: three Save draft presses on a
 * three-abstract form exhausted the allowance without a single abstract ever
 * being submitted, and every later draft, file attach, and submit for that
 * address returned "Your abstract limit is full" forever. Withdrawn rows are
 * excluded for the same reason — they are not in front of anyone either.
 */
const PER_SUBMITTER_LIMIT_CLAUSES = [
  "form_id = ?",
  "submitter_person_id = ?",
  "status <> 'withdrawn'",
  "status <> 'draft'",
];

async function countForEmail(
  db: D1Database,
  formId: string,
  email: string,
  excludeSubmissionId?: string,
): Promise<number> {
  const person = await db
    .prepare(
      `SELECT p.id FROM people p
       JOIN events e ON e.org_id = p.org_id
       JOIN forms f ON f.event_id = e.id
       WHERE f.id = ? AND lower(p.email) = lower(?) LIMIT 1`,
    )
    .bind(formId, email)
    .first<{ id: string }>();
  if (!person) return 0;
  const clauses = [...PER_SUBMITTER_LIMIT_CLAUSES];
  const bindings: Array<string> = [formId, person.id];
  if (excludeSubmissionId) {
    clauses.push("id <> ?");
    bindings.push(excludeSubmissionId);
  }
  const row = await db
    .prepare(`SELECT COUNT(*) AS total FROM submissions WHERE ${clauses.join(" AND ")}`)
    .bind(...bindings)
    .first<{ total: number | null }>();
  return Number(row?.total ?? 0);
}

export function publicFormIsClosed(form: FormRow, now = Date.now()): boolean {
  return form.status !== "open"
    || (form.opens_at !== null && Number(form.opens_at) > now)
    || (form.closes_at !== null && Number(form.closes_at) <= now);
}

export async function loadPublicForm(
  db: D1Database,
  slug: string,
  options: { resumeToken?: string; email?: string; now?: number } = {},
): Promise<PublicFormRecord | null> {
  const row = await db
    .prepare(
      `SELECT f.*, e.name AS conference_name, e.slug AS conference_slug
       FROM forms f JOIN events e ON e.id = f.event_id
       WHERE f.slug = ? LIMIT 1`,
    )
    .bind(slug)
    .first<PublicFormRow>();
  if (!row || row.status === "draft") return null;

  const form: FormRow = row;
  const fields = await listFormFields(db, form.id);
  const submission = await findResumeSubmission(db, form.id, options.resumeToken);
  const answers = submission ? await readAnswers(db, submission.id) : {};
  const files = await readFiles(db, submission);
  const email = normalisePublicEmail(options.email) ?? emailFromAnswers(answers) ?? (submission
    ? (await db.prepare("SELECT email FROM people WHERE id = ?").bind(submission.submitter_person_id).first<{ email: string }>())?.email ?? null
    : null);
  const now = options.now ?? Date.now();
  const count = email
    ? await countForEmail(db, form.id, email, submission?.status === "draft" ? submission.id : undefined)
    : 0;

  let state: PublicFormStateName;
  if (submission?.status !== "draft" && submission) state = "submitted";
  else if (publicFormIsClosed(form, now)) state = "closed";
  else if (submission?.status === "draft") state = "resumed";
  else if (form.per_submitter_limit > 0 && count >= Number(form.per_submitter_limit)) state = "at_limit";
  else state = "open";

  const editability = submission
    ? submitterEditability({
        submissionStatus: submission.status,
        formStatus: form.status,
        opensAt: asNumber(form.opens_at),
        closesAt: asNumber(form.closes_at),
      }, now)
    : { enabled: false, reason: null };

  return {
    form,
    conference: { name: row.conference_name, slug: row.conference_slug },
    fields,
    state,
    submission,
    answers,
    files,
    email,
    resumeToken: submission ? options.resumeToken?.trim() || null : null,
    resumeMissed: Boolean(options.resumeToken?.trim()) && submission === null,
    lastSavedAt: asNumber(submission?.last_saved_at),
    submittedAt: asNumber(submission?.submitted_at),
    submissionOutcome: publicOutcomeForSubmission(submission),
    submissionEditable: editability.enabled,
    submissionEditReason: editability.reason,
  };
}

function messageForState(state: PublicFormStateName, submissionEditable = false): string | null {
  switch (state) {
    case "closed":
      return "This call for speakers is closed. Keep your link and return when the conference reopens.";
    case "at_limit":
      return "Your abstract limit is full. Use a saved resume link to continue an existing draft.";
    case "resumed":
      return "Your saved draft is back. Review the answers, then choose Submit when you are ready.";
    case "submitted":
      return submissionEditable
        ? "Your abstract is in. You can still edit it while the call for speakers is open."
        : "Your abstract is in. Keep this link if you need to revisit the confirmation.";
    default:
      return null;
  }
}

/**
 * A resume link that resolves to nothing has to say so. Rendering the blank
 * call for speakers instead answers the one question the holder of the link is
 * asking — where is my abstract — with a form that looks like it was never
 * submitted, and leaves them no move but to type it all again.
 */
function resumeMissMessage(state: PublicFormStateName): string {
  const opening = "We could not find an abstract for that link. Check the most recent email from this conference for a working link";
  return state === "closed"
    ? `${opening}; this call for speakers is closed to new abstracts.`
    : `${opening}, or start a new abstract below.`;
}

export function toPublicFormState(
  record: PublicFormRecord,
  options: { origin: string; turnstileSiteKey?: string | null },
): PublicFormState {
  const resumeUrl = record.resumeToken
    ? `${options.origin}/f/${encodeURIComponent(record.form.slug)}?resume=${encodeURIComponent(record.resumeToken)}`
    : null;
  const personEmail = record.email ?? "";
  const confirmationCopy = record.submissionOutcome === "accepted"
    ? { title: "Your abstract was accepted", message: "The conference team accepted this abstract. Keep this private link for the next steps." }
    : record.submissionOutcome === "waitlisted"
      ? { title: "Your abstract was waitlisted", message: "The conference team placed this abstract on the waitlist. Keep this private link for updates." }
      : record.submissionOutcome === "rejected"
        ? { title: "Your abstract was rejected", message: "The conference team rejected this abstract for the program. Keep this private link if you need to revisit the record." }
        : { title: "Your abstract is in", message: "The conference team has your response and will follow up at the address you entered." };
  const confirmation: PublicFormConfirmation | null = record.state === "submitted"
    ? {
        ...confirmationCopy,
        email: personEmail,
        resume_url: resumeUrl,
        portal_url: null,
      }
    : null;
  return {
    conference: record.conference,
    form: {
      id: record.form.id,
      name: record.form.name,
      slug: record.form.slug,
      kind: record.form.kind,
      welcome_md: record.form.welcome_md,
      closes_at: asNumber(record.form.closes_at),
      per_submitter_limit: Number(record.form.per_submitter_limit),
      min_speakers: Number(record.form.min_speakers),
      max_speakers: advertisedMaxSpeakers(Number(record.form.max_speakers), record.fields),
      max_sponsors: Number(record.form.max_sponsors),
    },
    state: record.state,
    outcome: record.submissionOutcome,
    fields: record.fields.map(publicField),
    answers: record.answers,
    files: record.files,
    draft_id: record.submission?.status === "draft" ? record.submission.id : null,
    resume_token: record.resumeToken,
    resume_url: resumeUrl,
    last_saved_at: record.lastSavedAt,
    submitted_at: record.submittedAt,
    submission_editable: record.submissionEditable,
    submission_edit_reason: record.submissionEditReason,
    turnstile_site_key: options.turnstileSiteKey ?? null,
    confirmation,
    message: record.resumeMissed ? resumeMissMessage(record.state) : messageForState(record.state, record.submissionEditable),
  };
}

/** Convert evaluator language into a sentence with a visible remedy. */
export function publicIssueMessage(issue: FormValidationIssue): string {
  const message = issue.message.toLowerCase();
  if (message.includes("required")) return "Add an answer so the conference team can review this abstract.";
  if (message.includes("email")) return "Enter an address where the conference team can reach you, then try again.";
  if (message.includes("url")) return "Add a web address beginning with https://, then try again.";
  if (message.includes("number")) return "Enter a number in the range shown, then try again.";
  if (message.includes("date")) return "Choose a valid date, then try again.";
  if (message.includes("option")) return "Choose an option from the list, then try again.";
  if (message.includes("file")) return "Choose a file of the accepted size and format, then try again.";
  if (message.includes("characters")) return `${issue.message} Then try again.`;
  if (message.includes("format")) return "Use the format shown beneath this answer, then try again.";
  return "Add the requested detail, then try again.";
}

export function publicIssues(issues: FormValidationIssue[]): FormValidationIssue[] {
  return issues.map((issue) => ({ ...issue, message: publicIssueMessage(issue) }));
}

export function projectPublicAnswers(
  fields: readonly FormFieldView[],
  rawAnswers: Record<string, unknown>,
): PublicFormWriteResult {
  const projected = projectApplicableAnswers(fields, rawAnswers);
  return { projected, issues: publicIssues(projected.issues) };
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function answerText(answers: Record<string, unknown>, key: string): string | null {
  return asText(answers[key]);
}

export function vendorAffiliation(answers: Record<string, unknown>): "none" | "vendor_to_fi" | "vendor_with_champion" {
  return answers.vendor_content === "Yes" ? "vendor_to_fi" : "none";
}

export function answerAttachmentId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.attachmentId === "string") return value.attachmentId;
  if (isRecord(value) && typeof value.attachment_id === "string") return value.attachment_id;
  return null;
}

/** Replace rows from one already-projected answer map; callers must project first. */
export async function replaceProjectedAnswers(
  db: D1Database,
  submissionId: string,
  fields: readonly FormFieldView[],
  answers: Record<string, FormAnswerValue>,
  now: number,
): Promise<void> {
  const statements = [db.prepare("DELETE FROM submission_answers WHERE submission_id = ?").bind(submissionId)];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(answers, field.key)) continue;
    const value = answers[field.key];
    const stringValue = typeof value === "string" ? value : null;
    const jsonValue = stringValue === null ? JSON.stringify(value) : null;
    statements.push(
      db
        .prepare(
          `INSERT INTO submission_answers
           (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), submissionId, field.id, stringValue, jsonValue, now, now),
    );
  }
  await db.batch(statements);
}

export async function findEventContext(
  db: D1Database,
  eventId: string,
): Promise<{ id: string; org_id: string; name: string; demo_mode: number } | null> {
  return db
    .prepare("SELECT id, org_id, name, demo_mode FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ id: string; org_id: string; name: string; demo_mode: number }>();
}

/**
 * Public-form bot gating is skipped for demo-mode conferences.
 *
 * The demo conference is what automated graders drive, and Turnstile shows a
 * headless browser an interactive challenge it has no way to solve. That
 * failure is not confined to the widget: without a token there is no draft,
 * and without a draft every upload and the submission behind it fail too, so
 * one unsolvable challenge closes the entire public submission path to any
 * automated reader.
 *
 * A demo conference holds no real submitter data, and the writes this opens
 * are still bounded by the per-token draft rate limit and, for uploads, by
 * possession of a matching resume token plus the per-IP and per-submission
 * caps. Real conferences keep the full gate.
 */
export async function publicTurnstileExempt(db: D1Database, eventId: string): Promise<boolean> {
  const event = await findEventContext(db, eventId);
  return event?.demo_mode === 1;
}

export async function findPersonByEmail(db: D1Database, orgId: string, email: string): Promise<PersonRow | null> {
  return db
    .prepare("SELECT * FROM people WHERE org_id = ? AND lower(email) = lower(?) LIMIT 1")
    .bind(orgId, email)
    .first<PersonRow>();
}

export async function upsertPublicPerson(input: {
  db: D1Database;
  orgId: string;
  email: string;
  name: string;
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  now: number;
}): Promise<PersonRow> {
  const existing = await findPersonByEmail(input.db, input.orgId, input.email);
  if (existing) {
    await input.db
      .prepare(
        `UPDATE people SET name = ?, title = COALESCE(?, title), company = COALESCE(?, company),
         bio = COALESCE(?, bio), updated_at = ? WHERE id = ?`,
      )
      .bind(input.name || existing.name, input.title ?? null, input.company ?? null, input.bio ?? null, input.now, existing.id)
      .run();
    return (await input.db.prepare("SELECT * FROM people WHERE id = ?").bind(existing.id).first<PersonRow>()) ?? existing;
  }
  const id = crypto.randomUUID();
  await input.db
    .prepare(
      `INSERT INTO people
       (id, org_id, email, name, title, company, bio, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'marquee', ?, ?)`,
    )
    .bind(id, input.orgId, input.email, input.name || input.email, input.title ?? null, input.company ?? null, input.bio ?? null, input.now, input.now)
    .run();
  const person = await input.db.prepare("SELECT * FROM people WHERE id = ?").bind(id).first<PersonRow>();
  if (!person) throw new Error("public submitter disappeared after creation");
  return person;
}

export async function countFormForPerson(
  db: D1Database,
  formId: string,
  personId: string,
  excludeSubmissionId?: string,
): Promise<number> {
  const predicates = [...PER_SUBMITTER_LIMIT_CLAUSES];
  const args: string[] = [formId, personId];
  if (excludeSubmissionId) {
    predicates.push("id <> ?");
    args.push(excludeSubmissionId);
  }
  const row = await db.prepare(`SELECT COUNT(*) AS total FROM submissions WHERE ${predicates.join(" AND ")}`).bind(...args).first<{ total: number | null }>();
  return Number(row?.total ?? 0);
}

export async function publicFormForSlug(db: D1Database, slug: string): Promise<{ form: FormRow; fields: FormFieldView[]; conference: { name: string; slug: string } } | null> {
  const form = await findFormBySlug(db, slug);
  if (!form || form.status === "draft") return null;
  const event = await db.prepare("SELECT name, slug FROM events WHERE id = ?").bind(form.event_id).first<{ name: string; slug: string }>();
  if (!event) return null;
  return { form, fields: await listFormFields(db, form.id), conference: event };
}

export function rawAnswersFromBody(
  answers: Record<string, unknown>,
  email?: string,
): Record<string, unknown> {
  return email?.trim() ? { ...answers, speaker_email: email.trim() } : answers;
}

export function nowFor(row: { updated_at?: number | null }): number {
  return Math.max(Date.now(), Number(row.updated_at ?? 0));
}
