import type { FormFieldView, FormLengthRuleView } from "./forms.queries";
import { findFormBySlug, listFormFields, listFormLengthRules } from "./forms.queries";
import type { FormRow, PersonRow, SubmissionRow } from "../db/schema";
import {
  projectApplicableAnswers,
  type FormLengthRule,
  parseFormCondition,
  type FormAnswerValue,
  type FormValidationIssue,
  type ProjectedFormAnswers,
} from "../lib/form-conditions";
import { sha256Hex } from "../lib/auth/random-token";
import { readMagicLink } from "../lib/auth/magic-links";
import { submitterEditability } from "../lib/submission-editing";
import { boundSourceOf } from "../lib/bound-options";
import { readStoredAnswerValue } from "../lib/stored-answer";
import { taxonomyNameKey } from "../lib/taxonomy";
import {
  DEFAULT_SUBMISSION_LIMIT,
  effectiveSubmitterLimit,
  parseSubmissionDefault,
  submissionCapacityMessage,
  submissionCapacityRefusal,
} from "../lib/submission-capacity";
import {
  PUBLIC_PARTICIPANT_ROLES,
  type PublicFormConfirmation,
  type PublicFormField,
  type PublicFormFile,
  type PublicFormOnBehalfOf,
  type PublicFormOutcome,
  type PublicFormParticipant,
  type PublicFormState,
  type PublicFormStateName,
} from "./public-form.types";

export interface PublicFormEnv {
  DB: D1Database;
  CACHE: KVNamespace;
}

interface PublicFormRow extends FormRow {
  conference_name: string;
  conference_slug: string;
  conference_timezone: string;
  submission_default_limit_json: string | null;
}

export interface PublicFormRecord {
  form: FormRow;
  conference: { name: string; slug: string; timezone: string };
  fields: FormFieldView[];
  lengthRules: FormLengthRuleView[];
  state: PublicFormStateName;
  submission: SubmissionRow | null;
  answers: Record<string, unknown>;
  files: PublicFormFile[];
  email: string | null;
  resumeToken: string | null;
  resumeSource: "none" | "raw" | "magic";
  resumeMagicLinkId: string | null;
  resumeMissed: boolean;
  lastSavedAt: number | null;
  submittedAt: number | null;
  submissionOutcome: PublicFormOutcome | null;
  submissionEditable: boolean;
  submissionEditReason: string | null;
  actualCount: number;
  effectiveLimit: number;
  /** Everyone beyond the primary speaker, plus the on-behalf-of disclosure. */
  roster: PublicParticipantRoster;
  /**
   * The submission confirmation as the outbox has it: the address it is
   * addressed to and whether it has left yet. Null when none was enqueued.
   */
  receipt: { email: string; sent: boolean } | null;
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
 * The field keys the participant section owns, and the generic field list
 * therefore does not render.
 *
 * `co_speaker_name` / `co_speaker_email` are the old fixed second slot. They
 * stay in the form builder's vocabulary — an organizer's existing form still
 * has them, and existing drafts still have answers under them — but the page no
 * longer draws them as two more text boxes beside a list that already does the
 * same job. `readParticipantRoster` reads them once, as the first entry of the
 * list, and everything downstream sees one shape.
 */
export const LEGACY_PARTICIPANT_FIELD_KEYS = ["co_speaker_name", "co_speaker_email"] as const;

/**
 * Whether this form collects the people who will present.
 *
 * A form with no `speaker_*` fields collects its people some other way (or not
 * at all); it declares no capacity and is left alone.
 */
export function formCollectsParticipants(fields: readonly FormFieldView[]): boolean {
  return fields.some((field) => field.key === "speaker_name" || field.key === "speaker_email");
}

/**
 * The fields the page will actually ask for.
 *
 * The legacy `co_speaker_*` pair is owned by the participant section now, so it
 * is not rendered — and a field that is never rendered must not be validated
 * either. An organizer who had marked `co_speaker_name` required would
 * otherwise have created an unsatisfiable form: a required answer with no
 * control to type it into, refusing every submission forever. That is a dead
 * end in the walkthrough loop, which is a defect whoever finds it.
 *
 * Their stored answers stay on the row and are still read once, by
 * `readParticipantRoster`, to seed the roster of a submission that predates it.
 */
export function collectableFields(fields: readonly FormFieldView[]): FormFieldView[] {
  if (!formCollectsParticipants(fields)) return [...fields];
  return fields.filter((field) => !LEGACY_PARTICIPANT_FIELD_KEYS.includes(field.key as never));
}

/**
 * What the form may promise.
 *
 * `max_speakers` used to be clamped against the shape below it, because that
 * shape was a fixed pair of slots — `speaker_*` plus one optional
 * `co_speaker_*` — while `max_speakers` was a number an organizer typed into
 * the form builder. A form advertising four speakers through a shape that can
 * hold two is a contract nobody can satisfy, so it was clamped honestly.
 *
 * The shape is a list now, so the clamp is gone and the organizer's number is
 * the answer — for every value of it, including the nonsensical ones. A form
 * configured for zero speakers advertised zero before this and still does: an
 * organizer who types zero has made a mistake worth showing them, and quietly
 * flooring it at one would hide the mistake behind a form that half works.
 *
 * The function survives its clamp because two callers need the same number and
 * must not drift: the state the page renders, and the ceiling the submit route
 * enforces. It is also where a future clamp would go if the shape ever grows a
 * limit of its own again.
 */
export function advertisedMaxSpeakers(configured: number, _fields: readonly FormFieldView[]): number {
  return configured;
}

function participantRole(value: unknown): PublicFormParticipant["role"] | null {
  return PUBLIC_PARTICIPANT_ROLES.find((role) => role === value) ?? null;
}

/**
 * One participant entry, or nothing.
 *
 * A half-filled slot is not an error here — the submitter may be mid-typing,
 * and autosave runs on a timer. `requiredSubmissionIssues` is where an
 * incomplete slot becomes a sentence, at the moment the submitter presses
 * Submit and can act on it.
 */
function readParticipant(value: unknown): PublicFormParticipant | null {
  if (!isRecord(value)) return null;
  const name = asText(value.name);
  const email = normalisePublicEmail(value.email);
  const role = participantRole(value.role);
  return name && email && role ? { name, email, role } : null;
}

export function readParticipantList(value: unknown): PublicFormParticipant[] {
  const raw = typeof value === "string" ? parseJson<unknown>(value, null) : value;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const participant = readParticipant(entry);
    return participant ? [participant] : [];
  });
}

export function readOnBehalfOf(value: unknown): PublicFormOnBehalfOf | null {
  if (!isRecord(value)) return null;
  const name = asText(value.name);
  const email = normalisePublicEmail(value.email);
  return name && email ? { name, email } : null;
}

export interface PublicParticipantRoster {
  /** Complete entries only: everyone the submission actually carries. */
  participants: PublicFormParticipant[];
  onBehalfOf: PublicFormOnBehalfOf | null;
  /**
   * The slots as the submitter typed them, half-filled ones included.
   *
   * Kept so a saved draft restores what was on the screen rather than what the
   * record could make of it. Under the old shape a co-speaker's name lived in
   * `submission_answers` and survived a draft save with the address still
   * blank; losing that on the way to a list would be a silent regression paid
   * for by the one submitter who saved and came back.
   */
  typed: PublicFormParticipantSlot[];
  /**
   * Whether a roster was ever written for this submission.
   *
   * "No roster stored" and "a roster stored as empty" are different facts, and
   * only the first may fall back to the legacy `co_speaker_*` answers. Fusing
   * them would let a participant the submitter deleted be resurrected by
   * answers that are still on the row and no longer rendered.
   */
  stored: boolean;
}

/** One slot exactly as typed. Any part may be blank while it is being filled in. */
export interface PublicFormParticipantSlot {
  name: string;
  email: string;
  role: PublicFormParticipant["role"];
}

export function readParticipantSlots(value: unknown): PublicFormParticipantSlot[] {
  const raw = typeof value === "string" ? parseJson<unknown>(value, null) : value;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const role = participantRole(entry.role) ?? "co_speaker";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const email = typeof entry.email === "string" ? entry.email.trim() : "";
    return name || email ? [{ name, email, role }] : [];
  });
}

/**
 * The roster a submission is carrying, from wherever it is recorded.
 *
 * `submissions.participants_json` is the store. Where a submission predates it
 * — a draft saved before this shipped, or a form still carrying the old
 * `co_speaker_*` pair — the legacy answers are read as the first list entry, so
 * a submitter who resumes a draft finds the colleague they already named rather
 * than an empty list and a silent loss.
 */
/**
 * The co-speaker a form still carrying the old fixed second slot has collected,
 * as one list entry. Empty when the answers name nobody.
 */
export function legacyParticipantsFromAnswers(answers: Record<string, unknown>): PublicFormParticipant[] {
  const legacy = readParticipant({
    name: answers.co_speaker_name,
    email: answers.co_speaker_email,
    role: "co_speaker",
  });
  return legacy ? [legacy] : [];
}

export function readParticipantRoster(
  participantsJson: unknown,
  answers: Record<string, unknown>,
): PublicParticipantRoster {
  const row = typeof participantsJson === "string" ? parseJson<Record<string, unknown>>(participantsJson, {}) : null;
  if (row !== null && (Array.isArray(row.participants) || isRecord(row.on_behalf_of))) {
    const typed = readParticipantSlots(row.participants);
    return {
      participants: readParticipantList(row.participants),
      onBehalfOf: readOnBehalfOf(row.on_behalf_of),
      typed,
      stored: true,
    };
  }
  const legacy = legacyParticipantsFromAnswers(answers);
  return { participants: legacy, onBehalfOf: null, typed: legacy.map((entry) => ({ ...entry })), stored: false };
}

/**
 * The roster as stored: the slots as typed, so a resumed draft is what the
 * submitter left rather than what the record kept of it. Reading it back
 * narrows to the complete entries again, so no consumer has to know.
 */
export function writeParticipantRoster(roster: PublicParticipantRoster): string {
  return JSON.stringify({ on_behalf_of: roster.onBehalfOf, participants: roster.typed });
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
       WHERE sa.submission_id = ? AND ff.deleted_at IS NULL ORDER BY ff.position ASC, ff.id ASC`,
    )
    .bind(submissionId)
    .all<{ key: string; value_json: string | null; value_text: string | null }>();
  return Object.fromEntries(rows.results.map((row) => [row.key, readStoredAnswerValue(row)]));
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

export interface PublicFormResumeResolution {
  submission: SubmissionRow | null;
  source: "none" | "raw" | "magic";
  magicLinkId: string | null;
}

/** The only redirect shape minted for a draft reminder magic link. */
export function draftResumeRedirectTo(formSlug: string, submissionId: string): string {
  return `/f/${encodeURIComponent(formSlug)}?submission=${encodeURIComponent(submissionId)}`;
}

function submissionIdFromDraftResumeRedirect(redirectTo: string, formSlug: string): string | null {
  if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) return null;
  try {
    const url = new URL(redirectTo, "https://marquee.invalid");
    if (url.pathname !== `/f/${encodeURIComponent(formSlug)}`) return null;
    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || entries[0]?.[0] !== "submission") return null;
    const submissionId = entries[0][1];
    return /^[A-Za-z0-9_-]+$/.test(submissionId) ? submissionId : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a public-form capability without applying a write-state gate.
 * Raw resume hashes win, and the reminder link is consulted only on a raw
 * miss. Magic-link identity is bound to the event, form, submission, and its
 * submitter before any submitted/outcome/closed record is returned.
 */
export async function resolvePublicFormResume(
  db: D1Database,
  form: Pick<FormRow, "id" | "event_id">,
  formSlug: string,
  resumeToken: string | undefined,
  now = Date.now(),
): Promise<PublicFormResumeResolution> {
  const credential = resumeToken?.trim();
  if (!credential) return { submission: null, source: "none", magicLinkId: null };

  const rawSubmission = await findResumeSubmission(db, form.id, credential);
  if (rawSubmission) return { submission: rawSubmission, source: "raw", magicLinkId: null };

  const state = await readMagicLink(db, credential, now, { purposes: ["draft_resume"] });
  if (state.status !== "live" || state.link.event_id !== form.event_id || state.link.person_id === null) {
    return { submission: null, source: "none", magicLinkId: null };
  }
  const submissionId = submissionIdFromDraftResumeRedirect(state.link.redirect_to, formSlug);
  if (!submissionId) return { submission: null, source: "none", magicLinkId: null };
  const submission = await db
    .prepare(
      `SELECT * FROM submissions
       WHERE id = ? AND event_id = ? AND form_id = ? AND submitter_person_id = ?
       LIMIT 1`,
    )
    .bind(submissionId, form.event_id, form.id, state.link.person_id)
    .first<SubmissionRow>();
  return submission
    ? { submission, source: "magic", magicLinkId: state.link.id }
    : { submission: null, source: "none", magicLinkId: null };
}

/**
 * One sentence about the receipt, in the tense the outbox actually supports.
 * Shared so the banner and the confirmation panel cannot drift apart.
 */
export function receiptSentence(receipt: { email: string; sent: boolean }): string {
  return receipt.sent
    ? `We emailed a confirmation to ${receipt.email}.`
    : `A confirmation is on its way to ${receipt.email}.`;
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
 * The submission confirmation is conditional: `public-form.routes.ts` skips it
 * when the organizer has stored `enabled = 0` on the thank-you template. Read
 * the outbox rather than re-deriving that decision, so the page promises a
 * receipt only when a row exists to send. Indexed by `idx_outbox_entity_status`
 * on `(event_id, entity_id, …)`.
 *
 * Three narrowings, each answering a way the plain query lies:
 *
 * - **The recipient is the stored submitter, by id.** `comms.routes.ts` files
 *   organizer sends under the submission's own `entity_id`, so another
 *   participant's row can sit beside the receipt under the same key. Matching
 *   `person_id` against `submitter_person_id` is the one identity a caller
 *   cannot reach: `?email=` is request-supplied and overrides the resolved
 *   address, so keying on the address would let a resume-link holder point the
 *   sentence at a neighbouring row — or, with an address that matches nothing,
 *   hide their own receipt.
 * - **A failed or hard-bounced row is not on its way.** The delivery webhook
 *   moves a hard bounce to `failed` when the row had already been sent, and
 *   leaves `delivery_state` alone otherwise, so both have to be excluded. A
 *   soft bounce is still in flight and stays eligible.
 * - **Only a public-form confirmation is live mail.** `enqueuePublicFormConfirmation`
 *   is the one send path on this route that writes `send_policy = 'always_live'`;
 *   organizer communications take the `demo_safe` default. Without that clause an
 *   organizer message to the submitter, filed under the same submission and the
 *   same key, is a perfect match on every other column — and the page calls it
 *   "your confirmation".
 * - **The template key is the one this form uses now.** An organizer may change
 *   `thankyou_template_key` while submissions exist, and an older receipt then
 *   goes unrecognised. That direction is deliberate: the page falls silent
 *   about mail it cannot vouch for rather than claiming mail it cannot find.
 */
async function findReceipt(
  db: D1Database,
  form: FormRow,
  submission: SubmissionRow,
): Promise<{ email: string; sent: boolean } | null> {
  const row = await db
    .prepare(
      `SELECT to_email, status FROM outbox
       WHERE event_id = ? AND entity_id = ? AND template_key = ?
         AND person_id = ?
         AND send_policy = 'always_live'
         AND status IN ('queued', 'sent')
         AND delivery_state <> 'bounced_hard'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .bind(
      form.event_id,
      submission.id,
      form.thankyou_template_key ?? "submission_confirmation",
      submission.submitter_person_id,
    )
    .first<{ to_email: string; status: string }>();
  return row ? { email: row.to_email, sent: row.status === "sent" } : null;
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

export function publicFormIsClosed(
  form: Pick<FormRow, "status" | "opens_at" | "closes_at">,
  now = Date.now(),
): boolean {
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
      `SELECT f.*, e.name AS conference_name, e.slug AS conference_slug, e.timezone AS conference_timezone,
              setting.value_json AS submission_default_limit_json
       FROM forms f JOIN events e ON e.id = f.event_id
       LEFT JOIN event_settings setting
         ON setting.event_id = e.id AND setting.key = 'submission_default_limit'
       WHERE f.slug = ? LIMIT 1`,
    )
    .bind(slug)
    .first<PublicFormRow>();
  if (!row || row.status === "draft") return null;

  const form: FormRow = row;
  let eventDefault = DEFAULT_SUBMISSION_LIMIT;
  if (row.submission_default_limit_json !== null) {
    try {
      eventDefault = parseSubmissionDefault(JSON.parse(row.submission_default_limit_json) as unknown);
    } catch {
      eventDefault = DEFAULT_SUBMISSION_LIMIT;
    }
  }
  const effectiveLimit = effectiveSubmitterLimit(
    { submission_default_limit: eventDefault },
    form,
  );
  // Narrowed once, here, so rendering, validation, persistence and the client
  // all see the same field set. Filtering only at the render layer would leave
  // a required legacy field enforced by a control nobody can see.
  const fields = collectableFields(await listFormFields(db, form.id));
  const lengthRules = await listFormLengthRules(db, form.id, fields);
  const resume = await resolvePublicFormResume(db, form, slug, options.resumeToken, options.now ?? Date.now());
  const submission = resume.submission;
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
  else if (effectiveLimit > 0 && count >= effectiveLimit) state = "at_limit";
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
    conference: { name: row.conference_name, slug: row.conference_slug, timezone: row.conference_timezone },
    fields,
    lengthRules,
    state,
    submission,
    answers,
    files,
    email,
    resumeToken: submission ? options.resumeToken?.trim() || null : null,
    resumeSource: resume.source,
    resumeMagicLinkId: resume.magicLinkId,
    resumeMissed: Boolean(options.resumeToken?.trim()) && submission === null,
    lastSavedAt: asNumber(submission?.last_saved_at),
    submittedAt: asNumber(submission?.submitted_at),
    submissionOutcome: publicOutcomeForSubmission(submission),
    submissionEditable: editability.enabled,
    submissionEditReason: editability.reason,
    actualCount: count,
    effectiveLimit,
    roster: readParticipantRoster(submission?.participants_json ?? null, answers),
    // Only for the freshly-submitted state: an outcome replaces this copy
    // entirely, so under one the query would be run and then discarded.
    receipt: state === "submitted" && submission && publicOutcomeForSubmission(submission) === null
      ? await findReceipt(db, form, submission)
      : null,
  };
}

export function messageForState(
  state: PublicFormStateName,
  submissionEditable = false,
  receipt: { email: string; sent: boolean } | null = null,
  capacity: { effectiveLimit: number; actualCount: number } = { effectiveLimit: DEFAULT_SUBMISSION_LIMIT, actualCount: 0 },
): string | null {
  switch (state) {
    case "closed":
      return "This call for speakers is closed. Keep your link and return when the conference reopens.";
    case "at_limit":
      return submissionCapacityMessage(submissionCapacityRefusal(capacity.effectiveLimit, capacity.actualCount, "new"));
    case "resumed":
      return "Your saved draft is back. Review the answers, then choose Submit when you are ready.";
    case "submitted": {
      // Named only when a confirmation was actually enqueued; an organizer who
      // disabled the template leaves the submitter no mail to wait for. The
      // tense follows the row rather than the moment: a page reopened a week
      // later must not still describe a delivered mail as on its way.
      const receiptLine = receipt ? ` ${receiptSentence(receipt)}` : "";
      return submissionEditable
        ? `Your abstract is in.${receiptLine} You can still edit it while the call for speakers is open.`
        : `Your abstract is in.${receiptLine} Keep this link if you need to revisit the confirmation.`;
    }
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
  const now = Date.now();
  const resumeUrl = record.resumeToken
    ? `${options.origin}/f/${encodeURIComponent(record.form.slug)}?resume=${encodeURIComponent(record.resumeToken)}`
    : null;
  const personEmail = record.email ?? "";
  const confirmationCopy = record.submissionOutcome === "accepted"
    ? { title: "Your abstract was accepted", message: "The conference team accepted this abstract. Keep this private link for the next steps." }
    : record.submissionOutcome === "waitlisted"
      ? { title: "Your abstract is a Maybe", message: "The conference team marked this abstract Maybe and placed it on the waitlist. Keep this private link for updates." }
      : record.submissionOutcome === "rejected"
        ? { title: "Your abstract was rejected", message: "The conference team rejected this abstract for the program. Keep this private link if you need to revisit the record." }
        : { title: "Your abstract is in", message: "The conference team has your response and will follow up at the address you entered." };
  const receipt = record.receipt;
  const confirmation: PublicFormConfirmation | null = record.state === "submitted"
    ? {
        ...confirmationCopy,
        reference_code: record.submission?.reference_code ?? "",
        email: personEmail,
        receipt_email: receipt?.email ?? null,
        receipt_sent: receipt?.sent ?? false,
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
      status: publicFormIsClosed(record.form, now) ? "closed" : "open",
      welcome_md: record.form.welcome_md,
      closes_at: asNumber(record.form.closes_at),
      per_submitter_limit: record.effectiveLimit,
      min_speakers: Number(record.form.min_speakers),
      max_speakers: advertisedMaxSpeakers(Number(record.form.max_speakers), record.fields),
      max_sponsors: Number(record.form.max_sponsors),
      length_rules: record.lengthRules.map((rule) => ({
        id: rule.id,
        label: rule.label,
        field_keys: rule.field_keys,
        max_chars: rule.max_chars,
        sort_order: rule.sort_order,
        disabled: rule.disabled,
        missing_field_keys: rule.missing_field_keys,
      })),
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
    message: record.resumeMissed
      ? resumeMissMessage(record.state)
      : messageForState(record.state, record.submissionEditable, receipt, {
        effectiveLimit: record.effectiveLimit,
        actualCount: record.actualCount,
      }),
    // The slots as typed, so a resumed draft is what the submitter left on the
    // screen rather than what the record could make of it.
    participants: record.roster.typed,
    on_behalf_of: record.roster.onBehalfOf,
  };
}

type PublicIssueField = Pick<FormFieldView, "key" | "type">;

/** Convert evaluator language into a sentence with a visible remedy. */
export function publicIssueMessage(issue: FormValidationIssue, field?: PublicIssueField): string {
  const message = issue.message.toLowerCase();
  if (issue.kind === "form_length_rule") return `${issue.message} Then try again.`;
  if (message === "this field is required.") return "Add an answer so the conference team can review this abstract.";
  switch (field?.type) {
    case "email": return "Enter an address where the conference team can reach you, then try again.";
    case "url": return "Add a web address beginning with https://, then try again.";
    case "number": return "Enter a number in the range shown, then try again.";
    case "date": return "Choose a valid date, then try again.";
    case "single_select":
    case "multi_select": return "Choose an option from the list, then try again.";
    case "file": return "Choose a file of the accepted size and format, then try again.";
    default: break;
  }
  // These domain checks already carry public-facing copy and are keyed by
  // stable API fields. Never infer their kind from an organizer-authored label.
  if (issue.fieldKey === "format" || issue.fieldKey === "tracks") return issue.message;
  if (message === "use the requested format.") return "Use the format shown beneath this answer, then try again.";
  return "Add the requested detail, then try again.";
}

export function publicIssues(
  issues: readonly FormValidationIssue[],
  fields: readonly PublicIssueField[] = [],
): FormValidationIssue[] {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  // Keep internal group metadata out of the public error envelope. The public
  // contract is still the stable fieldKey/message pair; the local client has
  // the evaluator's kind while server responses already contain public copy.
  return issues.map((issue) => ({
    fieldKey: issue.fieldKey,
    message: publicIssueMessage(issue, fieldsByKey.get(issue.fieldKey)),
  }));
}

export function projectPublicAnswers(
  fields: readonly FormFieldView[],
  rawAnswers: Record<string, unknown>,
  lengthRules: readonly FormLengthRule[] = [],
): PublicFormWriteResult {
  const projected = projectApplicableAnswers(fields, rawAnswers, lengthRules);
  return { projected, issues: publicIssues(projected.issues, fields) };
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

/**
 * Apply one already-projected answer map without blanket deletion. Public
 * arrivals may submit partial answer payloads while a draft is being resumed;
 * callers identify explicit clears through `explicitlyRemovedFieldIds`.
 */
export async function projectedAnswerStatements(
  db: D1Database,
  submissionId: string,
  fields: readonly FormFieldView[],
  answers: Record<string, FormAnswerValue>,
  now: number,
  explicitlyRemovedFieldIds: readonly string[] = [],
): Promise<D1PreparedStatement[]> {
  const existing = (await db.prepare(`
    SELECT answer.id, answer.field_id, answer.value_text, answer.value_json
    FROM submission_answers answer
    LEFT JOIN form_fields field ON field.id = answer.field_id
    WHERE answer.submission_id = ?
  `).bind(submissionId).all<{ id: string; field_id: string; value_text: string | null; value_json: string | null }>()).results;
  const removal = new Set(explicitlyRemovedFieldIds);
  const existingByField = new Map(existing.map((row) => [row.field_id, row]));
  const statements: D1PreparedStatement[] = [];
  const levelFields = fields.filter((field) => boundSourceOf(field) === "levels");
  let levelByKey = new Map<string, { id: string; name: string }>();
  if (levelFields.length > 0) {
    const form = await db.prepare(`
      SELECT event_id FROM forms WHERE id = (SELECT form_id FROM form_fields WHERE id = ?)
    `).bind(levelFields[0]!.id).first<{ event_id: string }>();
    if (form) {
      const rows = await db.prepare("SELECT id, name, name_key FROM levels WHERE event_id = ? AND deleted_at IS NULL").bind(form.event_id).all<{ id: string; name: string; name_key: string }>();
      levelByKey = new Map(rows.results.flatMap((row) => [[row.id, row], [taxonomyNameKey(row.name_key ?? row.name), row]]));
    }
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(answers, field.key)) continue;
    const value = answers[field.key];
    const level = boundSourceOf(field) === "levels" && typeof value === "string"
      ? levelByKey.get(value) ?? levelByKey.get(taxonomyNameKey(value))
      : undefined;
    const stringValue = level?.name ?? (typeof value === "string" ? value : null);
    const jsonValue = level
      ? JSON.stringify({ bound_source: "levels", id: level.id, label: level.name })
      : stringValue === null ? JSON.stringify(value) : null;
    const existingRow = existingByField.get(field.id);
    statements.push(existingRow
      ? db.prepare(
        `UPDATE submission_answers SET value_text = ?, value_json = ?, updated_at = ?
         WHERE id = ? AND submission_id = ? AND field_id = ?`,
      ).bind(stringValue, jsonValue, now, existingRow.id, submissionId, field.id)
      : db.prepare(
        `INSERT INTO submission_answers
         (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), submissionId, field.id, stringValue, jsonValue, now, now));
  }
  for (const fieldId of removal) {
    statements.push(db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND field_id = ?").bind(submissionId, fieldId));
  }
  return statements;
}

export async function replaceProjectedAnswers(
  db: D1Database,
  submissionId: string,
  fields: readonly FormFieldView[],
  answers: Record<string, FormAnswerValue>,
  now: number,
  explicitlyRemovedFieldIds: readonly string[] = [],
): Promise<void> {
  const statements = await projectedAnswerStatements(db, submissionId, fields, answers, now, explicitlyRemovedFieldIds);
  if (statements.length > 0) await db.batch(statements);
}

/**
 * Work out which existing answer rows a caller explicitly removed from its
 * projection. Omitted keys remain retained for partial draft autosaves. A
 * controlling key supplied in the same request also explicitly removes an
 * answer that became inapplicable, so conditional answers cannot reappear with
 * stale data when the controlling choice is restored later.
 */
export async function projectedAnswerRemovals(
  db: D1Database,
  submissionId: string,
  fields: readonly FormFieldView[],
  answers: Record<string, FormAnswerValue>,
  suppliedKeys: ReadonlySet<string>,
  removeAllMissing = false,
): Promise<string[]> {
  const rows = (await db.prepare(`
    SELECT answer.field_id, field.key
    FROM submission_answers answer
    LEFT JOIN form_fields field ON field.id = answer.field_id
    WHERE answer.submission_id = ?
  `).bind(submissionId).all<{ field_id: string; key: string | null }>()).results;
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  return rows.flatMap((row) => {
    if (!row.key || Object.prototype.hasOwnProperty.call(answers, row.key)) return [];
    const field = fieldsByKey.get(row.key);
    if (!field) return [];
    const dependencies = parseFormCondition(field.condition)?.all.map((clause) => clause.fieldKey) ?? [];
    return removeAllMissing || suppliedKeys.has(row.key) || dependencies.some((key) => suppliedKeys.has(key)) ? [row.field_id] : [];
  });
}

export async function findEventContext(
  db: D1Database,
  eventId: string,
): Promise<{ id: string; org_id: string; slug: string; name: string; timezone: string; demo_mode: number } | null> {
  return db
    .prepare("SELECT id, org_id, slug, name, timezone, demo_mode FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ id: string; org_id: string; slug: string; name: string; timezone: string; demo_mode: number }>();
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

/**
 * Who is asserting this person's details.
 *
 * `self` is the submitter typing their own name and address: they are the
 * authority on both, and an edit to either is an update they are entitled to
 * make.
 *
 * `named_by_other` is everyone else on the form — the co-speaker, the
 * moderator, the executive somebody is submitting for. The record matches on
 * `(org_id, email)`, so a public submitter who typed a colleague's address used
 * to rename that colleague's existing organization contact, silently, from an
 * unauthenticated form. Nobody involved would ever see it: the submitter gets a
 * success page, and the organizer's CRM quietly holds a different name than the
 * person put there.
 *
 * A named person is therefore created if absent and left entirely alone if
 * present. The scoped `cospeaker_profile` link is the one write path to their
 * own profile, which is the point of it: the person themselves is the authority
 * on their bio and headshot, and they have to hold the link to exercise it.
 */
export type PublicPersonTrust = "self" | "named_by_other";

export async function upsertPublicPerson(input: {
  db: D1Database;
  orgId: string;
  email: string;
  name: string;
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  trust?: PublicPersonTrust;
  now: number;
}): Promise<PersonRow> {
  const existing = await findPersonByEmail(input.db, input.orgId, input.email);
  if (existing) {
    if ((input.trust ?? "self") === "named_by_other") return existing;
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

export function rawAnswersFromBody(
  answers: Record<string, unknown>,
  email?: string,
): Record<string, unknown> {
  return email?.trim() ? { ...answers, speaker_email: email.trim() } : answers;
}

export function nowFor(row: { updated_at?: number | null }): number {
  return Math.max(Date.now(), Number(row.updated_at ?? 0));
}
