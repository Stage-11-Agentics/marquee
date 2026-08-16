import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { D1PreparedStatement } from "@cloudflare/workers-types";

import type { ApiEnv } from "../api/runtime";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { ApiError } from "../api/errors";
import type { FormFieldView } from "./forms.queries";
import type { PersonRow } from "../db/schema";
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { IDEMPOTENCY_REGISTRY } from "../jobs/mail/idempotency";
import { enqueuePublicFormConfirmation, enqueueOutbox } from "../jobs/mail/outbox";
import { escapeHtml } from "../jobs/mail/render";
import { findTemplate } from "../jobs/mail/templates";
import { enqueueAuthMail } from "../lib/auth/auth-mail";
import { auditStatement } from "../lib/audit";
import { PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT } from "../lib/auth/draft-resume-copy";
import { mintMagicLink, mintMagicLink as issueParticipantMagicLink, promoteMagicLinkToResumeCapability } from "../lib/auth/magic-links";
import { mintToken, sha256Hex } from "../lib/auth/random-token";
import { noPersonReferencesPredicate } from "../lib/person-references";
import { verifyTurnstile } from "../lib/r2/turnstile";
import { submitterEditability } from "../lib/submission-editing";
import { withSubmissionReferenceAllocation } from "../lib/submission-reference";
import { submissionCapacityMessage, submissionCapacityRefusal } from "../lib/submission-capacity";
import { boundSourceOf } from "../lib/bound-options";
import { taxonomyNameKey } from "../lib/taxonomy";
import {
  answerAttachmentId,
  advertisedMaxSpeakers,
  answerText,
  formCollectsParticipants,
  legacyParticipantsFromAnswers,
  readOnBehalfOf,
  readParticipantSlots,
  readParticipantList,
  readParticipantRoster,
  writeParticipantRoster,
  type PublicParticipantRoster,
  countFormForPerson,
  emailFromAnswers,
  findEventContext,
  publicTurnstileExempt,
  findPersonByEmail,
  loadPublicForm,
  normalisePublicEmail,
  projectPublicAnswers,
  projectedAnswerRemovals,
  publicFormIsClosed,
  publicIssues,
  rawAnswersFromBody,
  replaceProjectedAnswers,
  projectedAnswerStatements,
  toPublicFormState,
  upsertPublicPerson,
  vendorAffiliation,
} from "./public-form.shared";
import { PUBLIC_PARTICIPANT_ROLES, type PublicFormState } from "./public-form.types";
import {
  assertRoutingPoolAllowedForTracks,
  routingPoolAssignmentStatements,
  selectSubmissionRouting,
} from "./public-form-routing";

const publicParams = z.object({ slug: z.string().min(1).max(160) });
const draftParams = publicParams.extend({ token: z.string().min(20).max(256) });
const answersSchema = z.record(z.string(), z.unknown()).default({});
/**
 * The people this submission says will present, beyond the primary speaker.
 *
 * Roles are an enum rather than free text: an applicant naming themselves
 * "chairperson" would be claiming a program decision the conference has not
 * made. The cap is generous and exists only so one request cannot mint an
 * unbounded number of `people` rows; the form's own `max_speakers` is the limit
 * a submitter is actually shown, and is enforced at Submit.
 */
const participantEntrySchema = z.object({
  // Deliberately not `.min(1)`. A blank half of a slot is an ordinary state
  // mid-typing, and rejecting it at the schema layer would answer a submitter
  // who typed a name and no address with a generic 400 instead of the sentence
  // `requiredSubmissionIssues` writes — which names the slot and says what to
  // do about it. Autosave tolerates the gap; Submit refuses it.
  name: z.string().trim().max(200),
  email: z.string().trim().max(320),
  role: z.enum(PUBLIC_PARTICIPANT_ROLES),
});
const participantListSchema = z.array(participantEntrySchema).max(50);
const onBehalfOfSchema = z.object({
  name: z.string().trim().max(200),
  email: z.string().trim().max(320),
}).nullable();

const draftBodySchema = z.object({
  answers: answersSchema.optional(),
  email: z.string().trim().max(320).optional(),
  turnstileToken: z.string().optional(),
  turnstile_token: z.string().optional(),
  participants: participantListSchema.optional(),
  on_behalf_of: onBehalfOfSchema.optional(),
});
const submitBodySchema = draftBodySchema.extend({
  resumeToken: z.string().min(20).max(256).optional(),
  resume_token: z.string().min(20).max(256).optional(),
});
/**
 * Editing an already-submitted abstract deliberately does not take a roster.
 *
 * The submitter edit window (MRQ-170) exists so a typo in the title or abstract
 * does not need an organizer. Changing who is presenting after the committee
 * has the record is a different act with different consequences — invitations
 * already sent, tasks already minted, a person already told they are speaking —
 * and it belongs to the organizer's participants panel, which records who made
 * the change. Accepting the field here and quietly not persisting it would be
 * worse than refusing it.
 */
const submittedEditBodySchema = z.object({ answers: answersSchema.optional() });

const publicFieldSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  help_text: z.string().nullable(),
  type: z.enum(["short_text", "long_text", "single_select", "multi_select", "url", "email", "file", "number", "date"]),
  required: z.boolean(),
  position: z.number().int().nonnegative(),
  config: z.record(z.string(), z.unknown()),
  condition: z.unknown(),
});
const publicFileSchema = z.object({
  attachment_id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  status: z.enum(["pending", "ready"]),
});
const publicStateSchema = z.enum(["open", "closed", "at_limit", "resumed", "submitted"]);
const publicFormSchema = z.object({
  conference: z.object({ name: z.string(), slug: z.string(), timezone: z.string() }),
  form: z.object({
    id: z.string(), name: z.string(), slug: z.string(), kind: z.enum(["abstract", "session"]),
    status: z.enum(["open", "closed"]), welcome_md: z.string(), closes_at: z.number().int().nullable(), per_submitter_limit: z.number().int(),
    min_speakers: z.number().int(), max_speakers: z.number().int(), max_sponsors: z.number().int(),
    length_rules: z.array(z.object({
      id: z.string(), label: z.string(), field_keys: z.array(z.string()), max_chars: z.number().int().positive(),
      sort_order: z.number().int().nonnegative(), disabled: z.boolean(), missing_field_keys: z.array(z.string()),
    })),
  }),
  state: publicStateSchema,
  outcome: z.enum(["accepted", "waitlisted", "rejected"]).nullable(),
  fields: z.array(publicFieldSchema),
  answers: z.record(z.string(), z.unknown()),
  files: z.array(publicFileSchema),
  draft_id: z.string().nullable(),
  resume_token: z.string().nullable(),
  resume_url: z.string().nullable(),
  last_saved_at: z.number().int().nullable(),
  submitted_at: z.number().int().nullable(),
  submission_editable: z.boolean(),
  submission_edit_reason: z.string().nullable(),
  turnstile_site_key: z.string().nullable(),
  confirmation: z.object({
    title: z.string(), message: z.string(), reference_code: z.string(), email: z.string(),
    receipt_email: z.string().nullable(), receipt_sent: z.boolean(),
    resume_url: z.string().nullable(), portal_url: z.string().nullable(),
  }).nullable(),
  message: z.string().nullable(),
  participants: z.array(z.object({
    name: z.string(),
    email: z.string(),
    role: z.enum(PUBLIC_PARTICIPANT_ROLES),
  })),
  on_behalf_of: z.object({ name: z.string(), email: z.string() }).nullable(),
}).openapi("PublicForm");

const issueSchema = z.object({ fieldKey: z.string(), message: z.string() });
const writeResponseSchema = publicFormSchema;

function workerSecrets(context: { env: ApiEnv["Bindings"] }): { TURNSTILE_SECRET_KEY: string; TURNSTILE_SITE_KEY: string } {
  return context.env as unknown as { TURNSTILE_SECRET_KEY: string; TURNSTILE_SITE_KEY: string };
}

function publicOrigin(url: string): string {
  return new URL(url).origin;
}

async function mintParticipantMagicLink(
  db: D1Database,
  input: { eventId: string; personId: string; purpose: "login" | "cospeaker_profile"; redirectTo: string; now?: number },
) {
  // Keep participant links on the same magic-link authority path as the
  // existing speaker portal link. The exchange route turns the purpose into
  // the narrow session hint; no second authentication writer is introduced.
  return issueParticipantMagicLink(db, input);
}

function tokenFromBody(body: { turnstileToken?: string; turnstile_token?: string }): string | undefined {
  return body.turnstileToken ?? body.turnstile_token;
}

function resumeTokenFromBody(body: { resumeToken?: string; resume_token?: string }): string | undefined {
  return body.resumeToken ?? body.resume_token;
}

async function requireTurnstile(context: { env: ApiEnv["Bindings"]; req: { header(name: string): string | undefined } }, token: string | undefined): Promise<void> {
  const result = await verifyTurnstile({
    secretKey: workerSecrets(context).TURNSTILE_SECRET_KEY,
    token,
    remoteIp: context.req.header("cf-connecting-ip"),
  });
  if (!result.ok) {
    throw new ApiError("forbidden", "Complete the security check, then choose Submit again.", { details: { retryable: true } });
  }
  const tokenKey = `public-form:turnstile:${await sha256Hex(token ?? "")}`;
  if (await context.env.CACHE.get(tokenKey)) {
    throw new ApiError("forbidden", "That security check has already been used. Complete it again, then choose Submit.", { details: { retryable: true } });
  }
  await context.env.CACHE.put(tokenKey, "1", { expirationTtl: 300 });
}

/**
 * Autosave rate limit: a fixed window keyed on the wall-clock minute.
 *
 * The limit and the key builder are exported so a test can seed the counter
 * instead of trying to spend it. Spending it means issuing DRAFT_AUTOSAVE_LIMIT
 * + 1 requests inside one window, which is a race against the window boundary:
 * a boundary landing mid-run resets the count and neither side reaches the
 * limit, and on a loaded machine — where the requests take longer than the
 * window is wide — no window can ever fill, so the limiter becomes untestable
 * rather than merely flaky.
 */
export const DRAFT_AUTOSAVE_LIMIT = 30;
export const DRAFT_AUTOSAVE_WINDOW_SECONDS = 60;

export async function draftAutosaveRateKey(token: string, now = Date.now()): Promise<string> {
  const window = Math.floor(now / 1000 / DRAFT_AUTOSAVE_WINDOW_SECONDS);
  return `public-form:autosave:${await sha256Hex(token)}:${window}`;
}

async function draftTokenAllowed(cache: KVNamespace, token: string, now = Date.now()): Promise<void> {
  const key = await draftAutosaveRateKey(token, now);
  const current = Number((await cache.get(key)) ?? "0");
  if (current >= DRAFT_AUTOSAVE_LIMIT) {
    throw ApiError.rateLimited(
      DRAFT_AUTOSAVE_WINDOW_SECONDS - Math.floor((now / 1000) % DRAFT_AUTOSAVE_WINDOW_SECONDS),
    );
  }
  await cache.put(key, String(current + 1), { expirationTtl: DRAFT_AUTOSAVE_WINDOW_SECONDS + 10 });
}

function answerMap(body: { answers?: Record<string, unknown> }): Record<string, unknown> {
  return body.answers ?? {};
}

/**
 * The roster this request is asserting.
 *
 * A body that names neither key is not asserting an empty roster — an older
 * client, or an autosave that only carried answers, would otherwise silently
 * delete every participant the submitter had already added. Absent means
 * "unchanged", so the roster already on the submission is carried forward.
 */
function rosterFromBody(
  body: { participants?: unknown; on_behalf_of?: unknown },
  current: PublicParticipantRoster,
  answers: Record<string, unknown>,
): PublicParticipantRoster {
  // A client that names nobody has not necessarily named nobody: a form still
  // carrying the old `co_speaker_*` pair sends that person as two answers, and
  // reading them here is what keeps those forms working unchanged.
  //
  // The fallback is gated on `stored`, not on the list being empty. Those are
  // different facts: a submission that has never had a roster written may read
  // the legacy answers, but one whose stored roster is empty has had its
  // participants deliberately removed, and falling back there would resurrect
  // them from answers that are still on the row and no longer rendered.
  // `current.typed` first even when nothing is stored: for a legacy form it was
  // already computed from the submission's OWN answers, while `answers` is the
  // request's — and the same request wipes the stored ones. Falling back to the
  // request only when the submission has nothing of its own cannot lose anyone.
  const carried = current.typed.length > 0
    ? current.typed
    : readParticipantSlots(legacyParticipantsFromAnswers(answers));
  const typed = body.participants === undefined
    ? (current.stored ? current.typed : carried)
    : readParticipantSlots(body.participants);
  return {
    participants: readParticipantList(typed),
    onBehalfOf: body.on_behalf_of === undefined ? current.onBehalfOf : readOnBehalfOf(body.on_behalf_of),
    typed,
    stored: true,
  };
}

/**
 * Every entry a submitter typed, complete or not.
 *
 * `readParticipantList` drops half-filled slots so autosave is never blocked
 * mid-typing; Submit is where the difference has to become a sentence, or a
 * name typed without an address would vanish with no explanation at all.
 */
/** Something was typed into this object, but not enough of it to be a person. */
function isHalfTyped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const fields = Object.values(value as Record<string, unknown>);
  return fields.some((field) => typeof field === "string" && field.trim() !== "")
    && fields.some((field) => typeof field !== "string" || field.trim() === "");
}

/**
 * Slots the submitter started and did not finish.
 *
 * Read from the resolved roster rather than the request body, so a resumed
 * draft carrying a half-typed slot is refused at Submit even when the client
 * omits the key. Autosave is never blocked — the submitter is mid-sentence, and
 * the slot is stored as typed so it survives a save.
 */
function incompleteParticipantSlots(slots: readonly { name: string; email: string }[]): number {
  return slots.filter((slot) => !slot.name.trim() || !normalisePublicEmail(slot.email)).length;
}

function requiredSubmissionIssues(
  fields: readonly FormFieldView[],
  answers: Record<string, unknown>,
  form: { min_speakers: number; max_speakers: number },
  roster: PublicParticipantRoster,
  raw: { participants?: unknown; on_behalf_of?: unknown },
): Array<{ fieldKey: string; message: string }> {
  if (!formCollectsParticipants(fields)) return [];
  const primaryPresent = Boolean(answerText(answers, "speaker_name") || normalisePublicEmail(answers.speaker_email));
  // Deduped by address, because that is what `insertParticipationRows` will do.
  // Counting raw entries refused a submitter for a roster that was about to
  // collapse under the ceiling anyway.
  const distinctParticipants = new Set(roster.participants.map((entry) => entry.email.toLowerCase()));
  const participantCount = (primaryPresent ? 1 : 0) + distinctParticipants.size;
  if (participantCount < Number(form.min_speakers)) {
    return [{ fieldKey: "speaker_name", message: "Add at least one participant before sending this abstract, then try again." }];
  }
  // The same ceiling the form advertises. Enforcing the raw configured number
  // here would let the two disagree the moment either one moves.
  if (participantCount > advertisedMaxSpeakers(Number(form.max_speakers), fields)) {
    return [{ fieldKey: "speaker_name", message: "Remove an extra participant so the conference limit is respected, then try again." }];
  }
  if (isHalfTyped(raw.on_behalf_of) || (raw.on_behalf_of !== undefined && raw.on_behalf_of !== null && roster.onBehalfOf === null)) {
    return [{ fieldKey: "on_behalf_of", message: "Add your own name and a contact address the conference team can reply to, then try again." }];
  }
  if (incompleteParticipantSlots(roster.typed) > 0) {
    return [{ fieldKey: "participants", message: "Give every added participant a name and a contact address, then try again." }];
  }
  return [];
}

async function referenceId(
  db: D1Database,
  table: "formats" | "tracks" | "levels",
  eventId: string,
  value: string,
): Promise<string | null> {
  const rows = table === "formats"
    ? await db.prepare("SELECT id, name FROM formats WHERE event_id = ?").bind(eventId).all<{ id: string; name: string; name_key?: string }>()
    : await db.prepare(`SELECT id, name, name_key FROM ${table} WHERE event_id = ? AND deleted_at IS NULL`).bind(eventId).all<{ id: string; name: string; name_key?: string }>();
  const key = taxonomyNameKey(value);
  return rows.results.find((row) => row.id === value || taxonomyNameKey(row.name_key ?? row.name) === key)?.id ?? null;
}

async function resolveDomainReferences(
  db: D1Database,
  eventId: string,
  fields: readonly FormFieldView[],
  answers: Record<string, unknown>,
): Promise<{ formatId: string | null; levelId: string | null; trackIds: string[]; issues: Array<{ fieldKey: string; message: string }> }> {
  const issues: Array<{ fieldKey: string; message: string }> = [];
  let formatId: string | null = null;
  let levelId: string | null = null;
  // Bound fields are the source of truth even when an organizer gives the
  // field a human key such as `session_format`. The canonical keys remain the
  // compatibility fallback for older/custom forms that predate `source`.
  const formatField = fields.find((field) => boundSourceOf(field) === "formats")
    ?? fields.find((field) => field.key === "format");
  const formatKey = formatField?.key ?? "format";
  const format = answerText(answers, formatKey);
  if (format) {
    formatId = await referenceId(db, "formats", eventId, format);
    if (!formatId) issues.push({ fieldKey: formatKey, message: "Choose a format from the list, then try again." });
  }
  const tracksField = fields.find((field) => boundSourceOf(field) === "tracks")
    ?? fields.find((field) => field.key === "tracks");
  const tracksKey = tracksField?.key ?? "tracks";
  const tracks = Array.isArray(answers[tracksKey]) ? answers[tracksKey].filter((value): value is string => typeof value === "string") : [];
  const trackIds: string[] = [];
  for (const track of tracks) {
    const id = await referenceId(db, "tracks", eventId, track);
    if (!id) issues.push({ fieldKey: tracksKey, message: "Choose conference tracks from the list, then try again." });
    else if (!trackIds.includes(id)) trackIds.push(id);
  }
  const levelField = fields.find((field) => boundSourceOf(field) === "levels")
    ?? fields.find((field) => field.key === "audience_level" && boundSourceOf(field) === "levels");
  const levelKey = levelField?.key ?? "audience_level";
  const level = answerText(answers, levelKey);
  if (levelField && level) {
    levelId = await referenceId(db, "levels", eventId, level);
    if (!levelId) issues.push({ fieldKey: levelKey, message: "Choose an audience level from the list, then try again." });
  }
  return { formatId, levelId, trackIds, issues };
}

type InsertedParticipant = {
  id: string;
  person: PersonRow;
  role: "speaker" | "co_speaker" | "moderator";
  position: number;
};

/**
 * The two identities a submission has, which are usually one person.
 *
 * `submitter` is who the conference writes back to — the address on the
 * confirmation, and later on the decision (AC-223). `speaker` is who holds the
 * work: the tasks, the profile request, the portal link, the calendar invite.
 * With the on-behalf-of disclosure off they are the same row, which is exactly
 * what shipped before this and remains the ordinary CFP submission.
 */
interface IntakeIdentities {
  submitter: PersonRow;
  speaker: PersonRow;
}

/**
 * Resolve both identities from the answers and the disclosure.
 *
 * Trust is the load-bearing argument. The submitter is the authority on their
 * own name and profile; the speaker they named is not theirs to rewrite, so an
 * existing record for that address is left untouched.
 */
async function resolveIntakeIdentities(input: {
  db: D1Database;
  orgId: string;
  submitter: PersonRow;
  answers: Record<string, unknown>;
  roster: PublicParticipantRoster;
  now: number;
}): Promise<IntakeIdentities> {
  if (input.roster.onBehalfOf === null) return { submitter: input.submitter, speaker: input.submitter };
  const speakerEmail = normalisePublicEmail(input.answers.speaker_email);
  const speakerName = answerText(input.answers, "speaker_name");
  if (!speakerEmail || !speakerName) return { submitter: input.submitter, speaker: input.submitter };
  const speaker = await upsertPublicPerson({
    db: input.db,
    // Supplied by the event context, never by the request.
    orgId: input.orgId,
    email: speakerEmail,
    name: speakerName,
    company: answerText(input.answers, "speaker_company"),
    title: answerText(input.answers, "speaker_role"),
    bio: answerText(input.answers, "biography"),
    trust: "named_by_other",
    now: input.now,
  });
  return { submitter: input.submitter, speaker };
}

/**
 * Rewrite the submission's participation rows from the roster it is carrying.
 *
 * One `submitter` row, one `speaker` row, and one row per person the submitter
 * added. Positions follow the order the submitter arranged them in, because
 * that order is what the program surfaces sort by and the applicant is the only
 * one who knows it.
 *
 * The returned list is everyone who needs their own scoped invitation: the
 * people named by somebody else, who have a profile to complete and no other
 * way in. A submitter who is also the speaker is not among them — they already
 * hold the resume link.
 */
async function insertParticipationRows(
  db: D1Database,
  submissionId: string,
  identities: IntakeIdentities,
  answers: Record<string, unknown>,
  roster: PublicParticipantRoster,
  eventOrgId: string,
  now: number,
): Promise<{ invitees: InsertedParticipant[] }> {
  const participants: Array<{ person: PersonRow; role: InsertedParticipant["role"]; position: number; invite: boolean }> = [];
  const primaryNamed = Boolean(answerText(answers, "speaker_name") || answers.speaker_email);
  if (primaryNamed) {
    participants.push({
      person: identities.speaker,
      role: "speaker",
      position: 0,
      invite: identities.speaker.id !== identities.submitter.id,
    });
  }
  // One row per person, whatever the roster says. Two entries can resolve to the
  // same record — the submitter listing themselves again, or one address typed
  // into two slots — and a second participation row for the same person on the
  // same submission is not a second person: it is a duplicate the record, the
  // agenda, and the chase board would each have to dedupe for themselves. The
  // first entry wins, so the role the submitter chose first is the one kept.
  const seen = new Set<string>([identities.submitter.id, identities.speaker.id]);
  for (const [index, entry] of roster.participants.entries()) {
    const person = await upsertPublicPerson({
      // This argument is intentionally supplied by the event context, not the request.
      db,
      orgId: eventOrgId,
      email: entry.email,
      name: entry.name,
      trust: "named_by_other",
      now,
    });
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    participants.push({ person, role: entry.role, position: index + 1, invite: true });
  }
  const statements = [db.prepare("DELETE FROM participations WHERE submission_id = ?").bind(submissionId)];
  statements.push(db.prepare(
    `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
     VALUES (?, ?, ?, 'submitter', 0, 'confirmed', ?, ?)`,
  ).bind(crypto.randomUUID(), submissionId, identities.submitter.id, now, now));
  const insertedParticipants = participants.map((participant) => ({ ...participant, id: crypto.randomUUID() }));
  for (const participant of insertedParticipants) {
    statements.push(db.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(participant.id, submissionId, participant.person.id, participant.role, participant.position, now, now));
  }
  await db.batch(statements);
  return { invitees: insertedParticipants.filter((participant) => participant.invite) };
}

/**
 * Write the roster and the participation rows it implies, in that order.
 *
 * `participants_json` is the material a resumed draft is rebuilt from, so it is
 * stored even where an intake decision later collapses two entries into one
 * person: the submitter should find what they typed, not what the record made
 * of it.
 */
async function persistParticipantRoster(
  db: D1Database,
  input: {
    submissionId: string;
    orgId: string;
    submitter: PersonRow;
    answers: Record<string, unknown>;
    roster: PublicParticipantRoster;
    now: number;
  },
): Promise<{ identities: IntakeIdentities; invitees: InsertedParticipant[] }> {
  const identities = await resolveIntakeIdentities({
    db,
    orgId: input.orgId,
    submitter: input.submitter,
    answers: input.answers,
    roster: input.roster,
    now: input.now,
  });
  const inserted = await insertParticipationRows(
    db,
    input.submissionId,
    identities,
    input.answers,
    input.roster,
    input.orgId,
    input.now,
  );
  await db
    .prepare("UPDATE submissions SET participants_json = ?, updated_at = ? WHERE id = ?")
    .bind(writeParticipantRoster(input.roster), input.now, input.submissionId)
    .run();
  return { identities, invitees: inserted.invitees };
}

interface PublicPersonPreparation {
  byEmail: Map<string, PersonRow>;
  statements: D1PreparedStatement[];
}

function publicPersonRow(input: {
  id: string;
  orgId: string;
  email: string;
  name: string;
  company?: string | null;
  title?: string | null;
  bio?: string | null;
  now: number;
}): PersonRow {
  return {
    id: input.id,
    org_id: input.orgId,
    email: input.email,
    name: input.name || input.email,
    title: input.title ?? null,
    company: input.company ?? null,
    bio: input.bio ?? null,
    headshot_attachment_id: null,
    social_links: "[]" as PersonRow["social_links"],
    is_demo: 0,
    last_write_source: "marquee",
    created_at: input.now,
    updated_at: input.now,
    company_id: null,
    custom_fields: "{}" as PersonRow["custom_fields"],
    do_not_contact: 0,
    kind: "human",
  };
}

/** Read-or-compose a public person without mutating D1 before the arrival batch. */
async function preparePublicPerson(
  db: D1Database,
  preparation: PublicPersonPreparation,
  input: {
    orgId: string;
    email: string;
    name: string;
    company?: string | null;
    title?: string | null;
    bio?: string | null;
    now: number;
  },
): Promise<PersonRow> {
  const email = input.email.trim().toLowerCase();
  const cached = preparation.byEmail.get(email);
  if (cached) return cached;
  const existing = await findPersonByEmail(db, input.orgId, email);
  if (existing) {
    preparation.byEmail.set(email, existing);
    return existing;
  }
  const person = publicPersonRow({ id: crypto.randomUUID(), ...input, email });
  preparation.byEmail.set(email, person);
  preparation.statements.push(db.prepare(
    `INSERT INTO people
      (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', 0, 'marquee', ?, ?)`,
  ).bind(person.id, person.org_id, person.email, person.name, person.title, person.company, person.bio, input.now, input.now));
  return person;
}

/** Compose the participant/person side of a public arrival transaction. */
async function prepareParticipantRoster(
  db: D1Database,
  input: {
    submissionId: string;
    orgId: string;
    submitter: PersonRow;
    answers: Record<string, unknown>;
    roster: PublicParticipantRoster;
    now: number;
    preparation: PublicPersonPreparation;
  },
): Promise<{ identities: IntakeIdentities; invitees: InsertedParticipant[]; statements: D1PreparedStatement[] }> {
  let speaker = input.submitter;
  if (input.roster.onBehalfOf !== null) {
    const speakerEmail = normalisePublicEmail(input.answers.speaker_email);
    const speakerName = answerText(input.answers, "speaker_name");
    if (speakerEmail && speakerName) {
      speaker = await preparePublicPerson(db, input.preparation, {
        orgId: input.orgId,
        email: speakerEmail,
        name: speakerName,
        company: answerText(input.answers, "speaker_company"),
        title: answerText(input.answers, "speaker_role"),
        bio: answerText(input.answers, "biography"),
        now: input.now,
      });
    }
  }

  const participants: Array<{ person: PersonRow; role: InsertedParticipant["role"]; position: number; invite: boolean }> = [];
  const primaryNamed = Boolean(answerText(input.answers, "speaker_name") || input.answers.speaker_email);
  if (primaryNamed) {
    participants.push({ person: speaker, role: "speaker", position: 0, invite: speaker.id !== input.submitter.id });
  }
  const seen = new Set<string>([input.submitter.id, speaker.id]);
  for (const [index, entry] of input.roster.participants.entries()) {
    const person = await preparePublicPerson(db, input.preparation, {
      orgId: input.orgId,
      email: entry.email,
      name: entry.name,
      now: input.now,
    });
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    participants.push({ person, role: entry.role, position: index + 1, invite: true });
  }

  const insertedParticipants = participants.map((participant) => ({ ...participant, id: crypto.randomUUID() }));
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM participations WHERE submission_id = ?").bind(input.submissionId),
    db.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
       VALUES (?, ?, ?, 'submitter', 0, 'confirmed', ?, ?)`,
    ).bind(crypto.randomUUID(), input.submissionId, input.submitter.id, input.now, input.now),
    db.prepare("UPDATE submissions SET participants_json = ?, updated_at = ? WHERE id = ?")
      .bind(writeParticipantRoster(input.roster), input.now, input.submissionId),
  ];
  for (const participant of insertedParticipants) {
    statements.push(db.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(participant.id, input.submissionId, participant.person.id, participant.role, participant.position, input.now, input.now));
  }
  return {
    identities: { submitter: input.submitter, speaker },
    invitees: insertedParticipants.filter((participant) => participant.invite),
    statements,
  };
}

/** What the invitation calls the seat, in the applicant's own vocabulary. */
function invitationRoleNoun(role: InsertedParticipant["role"]): string {
  return role === "moderator" ? "the moderator" : role === "speaker" ? "the speaker" : "a co-speaker";
}

async function enqueueCoSpeakerInvitation(
  context: Context<ApiEnv>,
  input: {
    eventId: string;
    conferenceName: string;
    submissionId: string;
    submissionTitle: string;
    addedBy: string;
    participant: InsertedParticipant;
    now: number;
  },
): Promise<void> {
  const redirectTo = `/co-speaker?participation=${encodeURIComponent(input.participant.id)}&submission=${encodeURIComponent(input.submissionId)}`;
  const link = await mintParticipantMagicLink(context.env.DB, {
    eventId: input.eventId,
    personId: input.participant.person.id,
    purpose: "cospeaker_profile",
    redirectTo,
    now: input.now,
  });
  const exchangeUrl = `${publicOrigin(context.req.url)}/api/v1/auth/exchange?token=${encodeURIComponent(link.token)}`;
  const addedBy = input.addedBy.trim() || "The conference submitter";
  const seat = invitationRoleNoun(input.participant.role);
  const subject = "Complete your conference speaker profile";
  const text = `${addedBy} added you as ${seat} on “${input.submissionTitle}” for ${input.conferenceName}.\n\nAdd your bio and headshot here: ${exchangeUrl}`;
  const html = `<p>${escapeHtml(addedBy)} added you as ${escapeHtml(seat)} on <strong>${escapeHtml(input.submissionTitle)}</strong> for ${escapeHtml(input.conferenceName)}.</p><p><a href="${escapeHtml(exchangeUrl)}">Add your bio and headshot</a></p>`;
  const invitation = await enqueueOutbox({
    db: context.env.DB,
    eventId: input.eventId,
    entityId: IDEMPOTENCY_REGISTRY.coSpeakerInvitation(input.participant.id),
    personId: input.participant.person.id,
    toEmail: input.participant.person.email,
    templateKey: "added_to_submission",
    subject,
    text,
    html,
    data: {
      "submission.title": input.submissionTitle,
      "speaker.name": input.participant.person.name,
      "message.body": text,
    },
    now: input.now,
  });
  if (invitation.inserted) await enqueueMailMessage(context.env.MAIL_QUEUE, invitation.id);
  // Keyed on the participation row, not on its role: the same scoped invite now
  // reaches a moderator and an on-behalf-of speaker, and a role predicate here
  // would silently skip stamping theirs.
  await context.env.DB.prepare(
    `UPDATE participations SET invited_at = ?, updated_at = ?
     WHERE id = ? AND submission_id = ? AND person_id = ?`,
  ).bind(input.now, input.now, input.participant.id, input.submissionId, input.participant.person.id).run();
}

function trackStatements(db: D1Database, submissionId: string, trackIds: readonly string[], now: number): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM submission_tracks WHERE submission_id = ?").bind(submissionId),
    db.prepare("UPDATE submissions SET primary_track_id = ?, updated_at = ? WHERE id = ?").bind(trackIds[0] ?? null, now, submissionId),
  ];
  for (const [position, trackId] of trackIds.entries()) {
    statements.push(db.prepare(
      `INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), submissionId, trackId, position === 0 ? 1 : 0, now, now));
  }
  return statements;
}

function tagStatements(db: D1Database, submissionId: string, tagIds: readonly string[], now: number): D1PreparedStatement[] {
  return [...new Set(tagIds)].map((tagId) => db.prepare(
    `INSERT OR IGNORE INTO submission_tags (id, submission_id, tag_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), submissionId, tagId, now, now));
}

interface RoutingStage {
  createdSubmission: boolean;
  previousTracks: TrackSnapshot[];
  personId: string;
  personCreated: boolean;
  submissionId: string;
}

async function stageRoutingSubmission(input: {
  db: D1Database;
  eventId: string;
  existing: { id: string } | null;
  formId: string;
  kind: "abstract" | "session";
  personId: string;
  personCreated: boolean;
  submissionId: string;
  title: string;
  abstract: string | null;
  formatId: string | null;
  trackIds: string[];
  vendorAffiliation: "none" | "vendor_to_fi" | "vendor_with_champion";
  resumeHash: string;
  now: number;
  searchBlob: string;
}): Promise<RoutingStage> {
  const previousTracks = input.existing
    ? (await input.db.prepare(
      "SELECT id, track_id, is_primary, created_at, updated_at FROM submission_tracks WHERE submission_id = ? ORDER BY is_primary DESC, id",
    ).bind(input.submissionId).all<TrackSnapshot>()).results
    : [];
  if (!input.existing) {
    await withSubmissionReferenceAllocation(input.db, input.eventId, input.now, (referenceCode) => [
      input.db.prepare(
        `INSERT INTO submissions
          (id, event_id, reference_code, form_id, kind, title, abstract, status, format_id, primary_track_id,
           origin, vendor_affiliation, submitter_person_id, resume_token_hash, last_saved_at,
           search_blob, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.submissionId, input.eventId, referenceCode, input.formId, input.kind, input.title, input.abstract,
        input.formatId, input.trackIds[0] ?? null, input.vendorAffiliation, input.personId,
        input.resumeHash, input.now, input.searchBlob, input.now, input.now,
      ),
    ]);
  }
  await persistTracks(input.db, input.submissionId, input.trackIds, input.now);
  return {
    createdSubmission: input.existing === null,
    previousTracks,
    personId: input.personId,
    personCreated: input.personCreated,
    submissionId: input.submissionId,
  };
}

async function rollbackRoutingStage(db: D1Database, stage: RoutingStage): Promise<void> {
  if (stage.createdSubmission) {
    await db.batch([
      db.prepare("DELETE FROM submission_tracks WHERE submission_id = ?").bind(stage.submissionId),
      db.prepare("DELETE FROM submissions WHERE id = ? AND status = 'draft'").bind(stage.submissionId),
    ]);
  } else {
    const statements = [db.prepare("DELETE FROM submission_tracks WHERE submission_id = ?").bind(stage.submissionId)];
    for (const track of stage.previousTracks) {
      statements.push(db.prepare(
        `INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(track.id, stage.submissionId, track.track_id, track.is_primary, track.created_at, track.updated_at));
    }
    await db.batch(statements);
  }
  if (stage.personCreated) {
    await db.prepare(`
      DELETE FROM people
      WHERE id = ?
        AND ${noPersonReferencesPredicate()}
    `).bind(stage.personId).run();
  }
}

function attachmentStatements(
  db: D1Database,
  submissionId: string,
  previousOwnerId: string | null,
  answers: Record<string, unknown>,
  now: number,
): D1PreparedStatement[] {
  if (!previousOwnerId) return [];
  const attachmentIds = [...new Set(Object.values(answers).map(answerAttachmentId).filter((id): id is string => id !== null))];
  if (attachmentIds.length === 0) return [];
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < attachmentIds.length; offset += 80) {
    const chunk = attachmentIds.slice(offset, offset + 80);
    statements.push(db.prepare(
      `UPDATE attachments SET owner_type = 'submission_file', owner_id = ?, updated_at = ?
       WHERE owner_type = 'draft_file' AND owner_id = ? AND id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(submissionId, now, previousOwnerId, ...chunk));
  }
  return statements;
}

async function moveAttachments(
  db: D1Database,
  submissionId: string,
  previousOwnerId: string | null,
  answers: Record<string, unknown>,
): Promise<void> {
  const statements = attachmentStatements(db, submissionId, previousOwnerId, answers, Date.now());
  if (statements.length > 0) await db.batch(statements);
}

async function formResponse(
  context: { env: ApiEnv["Bindings"]; req: { url: string } },
  slug: string,
  resumeToken?: string,
  email?: string,
  portalUrl?: string | null,
): Promise<PublicFormState> {
  const record = await loadPublicForm(context.env.DB, slug, { resumeToken, email });
  if (!record) throw ApiError.notFound("This conference form is not available.");
  const state = toPublicFormState(record, {
    origin: publicOrigin(context.req.url),
    turnstileSiteKey: (await publicTurnstileExempt(context.env.DB, record.form.event_id))
      ? null
      : workerSecrets(context).TURNSTILE_SITE_KEY,
  });
  if (portalUrl && state.confirmation) state.confirmation.portal_url = portalUrl;
  return state;
}

async function createDraft(
  context: Context<ApiEnv>,
  slug: string,
  body: z.infer<typeof draftBodySchema>,
): Promise<PublicFormState> {
  const base = await loadPublicForm(context.env.DB, slug, { email: body.email });
  if (!base) throw ApiError.notFound("This conference form is not available.");
  if (!(await publicTurnstileExempt(context.env.DB, base.form.event_id))) {
    await requireTurnstile(context, tokenFromBody(body));
  }
  if (publicFormIsClosed(base.form)) throw ApiError.conflict("This call for speakers is closed. Keep your answers and return when the conference reopens.");
  if (base.state === "at_limit") {
    throw ApiError.conflict(submissionCapacityMessage(
      submissionCapacityRefusal(base.effectiveLimit, base.actualCount, "new"),
    ));
  }

  const raw = rawAnswersFromBody(answerMap(body), body.email);
  const projected = projectPublicAnswers(base.fields, raw, base.lengthRules);
  const roster = rosterFromBody(body, base.roster, raw);
  // The draft's owner is the person the resume link belongs to, and the
  // disclosure is what says who that is. Deriving it from `speaker_email`
  // instead — as this did — mailed the private resume link to a third party the
  // submitter had merely named, and set `submitter_person_id` to them, which
  // every AC-270/AC-271 guarantee downstream then inherited.
  const speakerEmail = emailFromAnswers(projected.projected.answers) ?? normalisePublicEmail(body.email);
  const email = roster.onBehalfOf?.email ?? speakerEmail;
  if (!email) throw ApiError.unprocessable("Enter an address where the conference team can reach you, then choose Save draft.", "email");
  const event = await findEventContext(context.env.DB, base.form.event_id);
  if (!event) throw ApiError.notFound("This conference is no longer available.");
  const now = Date.now();
  const knownPerson = await findPersonByEmail(context.env.DB, event.org_id, email);
  const knownPersonCount = knownPerson
    ? await countFormForPerson(context.env.DB, base.form.id, knownPerson.id)
    : 0;
  if (base.effectiveLimit > 0 && knownPerson && knownPersonCount >= base.effectiveLimit) {
    throw ApiError.conflict(submissionCapacityMessage(
      submissionCapacityRefusal(base.effectiveLimit, knownPersonCount, "new"),
    ));
  }
  // `knownPerson ??`, never an unconditional upsert. This route is the one
  // unauthenticated write door to `people`: a stranger POSTing a draft that
  // names an existing contact's address must not rewrite that contact's name
  // and profile. From here the resume token is the credential, and autosave —
  // which holds it — may update the owner's own record.
  const person = knownPerson ?? await upsertPublicPerson({
    db: context.env.DB,
    orgId: event.org_id,
    email,
    name: roster.onBehalfOf?.name ?? answerText(projected.projected.answers, "speaker_name") ?? email,
    company: roster.onBehalfOf ? null : answerText(projected.projected.answers, "speaker_company"),
    title: roster.onBehalfOf ? null : answerText(projected.projected.answers, "speaker_role"),
    bio: roster.onBehalfOf ? null : answerText(projected.projected.answers, "biography"),
    now,
  });
  const submissionId = crypto.randomUUID();
  const resumeToken = mintToken();
  const resumeHash = await sha256Hex(resumeToken);
  const title = answerText(projected.projected.answers, "title") ?? "Untitled abstract";
  await withSubmissionReferenceAllocation(context.env.DB, base.form.event_id, now, (referenceCode) => [
    context.env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, reference_code, form_id, kind, title, abstract, status, origin, vendor_affiliation,
         submitter_person_id, resume_token_hash, last_saved_at, search_blob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 'public', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      submissionId, base.form.event_id, referenceCode, base.form.id, base.form.kind, title,
      answerText(projected.projected.answers, "abstract"), vendorAffiliation(projected.projected.answers),
      person.id, resumeHash, now,
      JSON.stringify(projected.projected.answers), now, now,
    ),
  ]);
  await replaceProjectedAnswers(context.env.DB, submissionId, base.fields, projected.projected.answers, now);
  await persistParticipantRoster(context.env.DB, {
    submissionId,
    orgId: event.org_id,
    submitter: person,
    answers: projected.projected.answers,
    roster,
    now,
  });

  const resumeUrl = `${publicOrigin(context.req.url)}/f/${encodeURIComponent(slug)}?resume=${encodeURIComponent(resumeToken)}`;
  const closeCopy = base.form.closes_at === null
    ? "the call's closing date"
    : new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: event.timezone,
    }).format(Number(base.form.closes_at));
  const mail = await enqueueAuthMail(context.env.DB, {
    eventId: base.form.event_id,
    personId: person.id,
    toEmail: email,
    templateKey: "draft_resume",
    entityId: IDEMPOTENCY_REGISTRY.draftResume(submissionId),
    subject: PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT,
    text: `${PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT} here: ${resumeUrl}\n\nThis call closes on ${closeCopy} (${event.timezone}).`,
    html: `<p><a href="${resumeUrl}">${PUBLIC_DRAFT_RESUME_EMAIL_SUBJECT}</a></p><p>This call closes on ${escapeHtml(closeCopy)} (${escapeHtml(event.timezone)}).</p>`,
    now,
  });
  await enqueueMailMessage(context.env.MAIL_QUEUE, mail);
  return formResponse(context, slug, resumeToken, email);
}

async function autosaveDraft(
  context: Context<ApiEnv>,
  slug: string,
  token: string,
  body: z.infer<typeof draftBodySchema>,
): Promise<PublicFormState> {
  await draftTokenAllowed(context.env.CACHE, token);
  const base = await loadPublicForm(context.env.DB, slug, { resumeToken: token });
  if (!base || !base.submission || base.submission.status !== "draft") {
    throw ApiError.forbidden("Use the resume link that belongs to this abstract, then try again.");
  }
  if (publicFormIsClosed(base.form)) {
    throw ApiError.conflict("This call is closed. Answers and files can no longer be changed.");
  }
  const raw = rawAnswersFromBody(answerMap(body), body.email);
  const projected = projectPublicAnswers(base.fields, raw, base.lengthRules);
  const removals = await projectedAnswerRemovals(context.env.DB, base.submission.id, base.fields, projected.projected.answers, new Set(Object.keys(raw)));
  const now = Date.now();
  const event = await findEventContext(context.env.DB, base.form.event_id);
  if (!event) throw ApiError.notFound("This conference is no longer available.");
  // The draft's own owner, by id. Re-deriving them from an address in the
  // request let a changed `speaker_email` walk the write onto a different
  // person's record; the resume token names exactly one submission, and that
  // submission names exactly one submitter. Holding the token is what makes
  // this an authorized profile write rather than a stranger's.
  const person = await context.env.DB
    .prepare("SELECT * FROM people WHERE id = ?")
    .bind(base.submission.submitter_person_id)
    .first<PersonRow>();
  if (!person) throw ApiError.notFound("This draft is no longer available.");
  const roster = rosterFromBody(body, base.roster, raw);
  // The disclosure is recorded on the draft and applied at submit, where the
  // record's submitter is set. Moving it here would rewrite the owner of a
  // draft on a timer, mid-typing.
  //
  // But the profile fields branch on it exactly as `createDraft` and the submit
  // handler do. Under the disclosure the speaker card describes somebody else,
  // and writing it here filed an executive's name, bio, company and title
  // against their comms manager's own record — on every autosave, so within
  // seconds of the box being ticked. Submit could not heal it either: it finds
  // the submitter by address and short-circuits the upsert, so the wrong
  // identity was permanent.
  await upsertPublicPerson({
    db: context.env.DB,
    orgId: event.org_id,
    email: person.email,
    name: roster.onBehalfOf?.name ?? answerText(projected.projected.answers, "speaker_name") ?? person.name,
    company: roster.onBehalfOf ? null : answerText(projected.projected.answers, "speaker_company"),
    title: roster.onBehalfOf ? null : answerText(projected.projected.answers, "speaker_role"),
    bio: roster.onBehalfOf ? null : answerText(projected.projected.answers, "biography"),
    now,
  });
  await replaceProjectedAnswers(context.env.DB, base.submission.id, base.fields, projected.projected.answers, now, removals);
  await persistParticipantRoster(context.env.DB, {
    submissionId: base.submission.id,
    orgId: event.org_id,
    submitter: person,
    answers: projected.projected.answers,
    roster,
    now,
  });
  await context.env.DB.prepare(
    `UPDATE submissions SET title = ?, abstract = ?, vendor_affiliation = ?, last_saved_at = ?,
     search_blob = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
  ).bind(
    answerText(projected.projected.answers, "title") ?? "Untitled abstract",
    answerText(projected.projected.answers, "abstract"), vendorAffiliation(projected.projected.answers), now,
    JSON.stringify(projected.projected.answers), now, base.submission.id,
  ).run();
  return formResponse(context, slug, token, base.email ?? emailFromAnswers(projected.projected.answers) ?? undefined);
}

/**
 * A resume token is a capability for the one submission it hashes to. It is
 * deliberately separate from draft autosave: after submission the response
 * keeps its submitted status, but an undecided response may still be changed
 * while the public call remains open. The same before/after audit shape as the
 * authenticated speaker editor lets the organizer record show one timeline.
 */
async function editSubmittedSubmission(
  context: Context<ApiEnv>,
  slug: string,
  token: string,
  body: z.infer<typeof submittedEditBodySchema>,
): Promise<PublicFormState> {
  await draftTokenAllowed(context.env.CACHE, token);
  const base = await loadPublicForm(context.env.DB, slug, { resumeToken: token });
  if (!base || !base.submission) {
    throw ApiError.forbidden("Use the resume link that belongs to this abstract, then try again.");
  }
  const editability = submitterEditability({
    submissionStatus: base.submission.status,
    formStatus: base.form.status,
    opensAt: Number(base.form.opens_at ?? 0) || null,
    closesAt: Number(base.form.closes_at ?? 0) || null,
  });
  if (!editability.enabled) throw ApiError.conflict(editability.reason ?? "This abstract cannot be edited right now.");

  // Merge a partial request into the server's current projection. The browser
  // sends the whole form, but merging makes a copied resume request safe and
  // prevents an omitted field from being silently erased.
  const raw = rawAnswersFromBody({ ...base.answers, ...answerMap(body) });
  const projected = projectPublicAnswers(base.fields, raw, base.lengthRules);
  const domainIssues = [
    ...projected.issues,
    ...requiredSubmissionIssues(base.fields, projected.projected.answers, base.form, base.roster, {}),
  ];
  if (domainIssues.length > 0) {
    throw ApiError.unprocessable("Add the requested details, then choose Save changes again.", undefined, { issues: domainIssues });
  }

  const title = answerText(projected.projected.answers, "title") ?? base.submission.title ?? "Untitled abstract";
  const abstract = answerText(projected.projected.answers, "abstract");
  const now = Date.now();
  const removals = await projectedAnswerRemovals(context.env.DB, base.submission.id, base.fields, projected.projected.answers, new Set(Object.keys(raw)), true);
  const contentChanged = title !== base.submission.title || abstract !== base.answers.abstract;
  const answerRows = body.answers === undefined
    ? []
    : await projectedAnswerStatements(context.env.DB, base.submission.id, base.fields, projected.projected.answers, now, removals);
  if (!contentChanged && answerRows.length === 0) {
    return formResponse(context, slug, token, base.email ?? emailFromAnswers(projected.projected.answers) ?? undefined);
  }
  const statements = answerRows;
  if (contentChanged) {
    statements.unshift(
      context.env.DB.prepare(
        `UPDATE submissions SET title = ?, abstract = ?, search_blob = ?, last_saved_at = ?,
         last_write_source = 'marquee', updated_at = ?
         WHERE id = ? AND form_id = ? AND submitter_person_id = ?
           AND status IN ('submitted', 'in_review')`,
      ).bind(
        title,
        abstract,
        JSON.stringify(projected.projected.answers),
        now,
        now,
        base.submission.id,
        base.form.id,
        base.submission.submitter_person_id,
      ),
      auditStatement(context.env.DB, {
        eventId: base.form.event_id,
        actorKind: "user",
        actorPersonId: base.submission.submitter_person_id,
        action: "speaker_talk_updated",
        entityType: "submission",
        entityId: base.submission.id,
        before: { title: base.submission.title, description: base.answers.abstract ?? base.submission.abstract },
        after: { title, description: abstract },
        now,
        requestId: context.get("requestId") ?? null,
      }),
    );
  }
  await context.env.DB.batch(statements);
  // Write the roster through unchanged. The answer writer updates existing rows
  // in place and only removes fields the merged projection explicitly dropped,
  // so legacy participant answers remain available to the roster migration.
  await context.env.DB
    .prepare("UPDATE submissions SET participants_json = ?, updated_at = ? WHERE id = ?")
    .bind(writeParticipantRoster(base.roster), now, base.submission.id)
    .run();
  return formResponse(context, slug, token, base.email ?? emailFromAnswers(projected.projected.answers) ?? undefined);
}

async function handlePublicSubmission(
  context: Context<ApiEnv>,
  slug: string,
  body: z.infer<typeof submitBodySchema>,
): Promise<PublicFormState> {
  const resumeToken = resumeTokenFromBody(body);
  const base = await loadPublicForm(context.env.DB, slug, { resumeToken, email: body.email });
  if (!base) throw ApiError.notFound("This conference form is not available.");
  if (resumeToken && !base.submission) throw ApiError.forbidden("Use the resume link that belongs to this abstract, then try again.");
  /**
   * A submission carrying a resume token that resolves to this form's own
   * draft is the continuation of a session that already passed the security
   * check to create that draft — the same position autosave takes, and for
   * the same reason. A token is single-use, so demanding a second one here
   * forces the submitter to solve a fresh challenge between attaching a file
   * and pressing Submit, which is precisely the dead end this route's own
   * error message could not explain. Every other path — no resume token, or
   * one that does not resolve — still faces the full gate.
   */
  if (
    !(resumeToken && base.submission) &&
    !(await publicTurnstileExempt(context.env.DB, base.form.event_id))
  ) {
    await requireTurnstile(context, tokenFromBody(body));
  }
  if (base.submission && base.submission.status !== "draft") {
    const resumeHash = resumeToken ? await sha256Hex(resumeToken) : null;
    const arrival = resumeHash
      ? await context.env.DB.prepare(
        "SELECT submission_id FROM submission_arrivals WHERE submission_id = ? AND resume_token_hash = ?",
      ).bind(base.submission.id, resumeHash).first<{ submission_id: string }>()
      : null;
    if (arrival) return formResponse(context, slug, resumeToken, body.email ?? undefined);
    throw ApiError.conflict("This abstract was already submitted. Use its confirmation link to view it.");
  }
  if (publicFormIsClosed(base.form)) throw ApiError.conflict("This call for speakers is closed. Keep your answers and return when the conference reopens.");
  // A resumed draft gets the path-aware capacity response below, after its
  // owner and exclusion-aware count are known. New submissions can refuse now.
  if (base.state === "at_limit" && !base.submission) {
    throw ApiError.conflict(submissionCapacityMessage(
      submissionCapacityRefusal(base.effectiveLimit, base.actualCount, "new"),
    ));
  }

  const raw = rawAnswersFromBody(answerMap(body), body.email);
  const projected = projectPublicAnswers(base.fields, raw, base.lengthRules);
  // `raw`, not the projected answers: the legacy `co_speaker_*` pair is no
  // longer part of the served field set, so projection drops it. A form still
  // carrying those fields sends its co-speaker as two answers, and this is the
  // one read that turns them into a roster entry.
  const roster = rosterFromBody(body, base.roster, raw);
  const domainIssues = [
    ...projected.issues,
    ...requiredSubmissionIssues(base.fields, projected.projected.answers, base.form, roster, body),
  ];
  const event = await findEventContext(context.env.DB, base.form.event_id);
  if (!event) throw ApiError.notFound("This conference is no longer available.");
  const references = await resolveDomainReferences(context.env.DB, base.form.event_id, base.fields, projected.projected.answers);
  domainIssues.push(...publicIssues(references.issues));
  // Two addresses, usually one value. `speakerEmail` is who will present;
  // `email` is who the conference writes back to, which the on-behalf-of
  // disclosure separates (AC-270/AC-271). With the disclosure off they are the
  // same string and every path below behaves exactly as it did.
  const speakerEmail = emailFromAnswers(projected.projected.answers) ?? normalisePublicEmail(body.email);
  const email = roster.onBehalfOf?.email ?? speakerEmail;
  if (!speakerEmail) domainIssues.push({ fieldKey: "speaker_email", message: "Enter an address where the conference team can reach you, then try again." });
  if (domainIssues.length > 0) {
    throw ApiError.unprocessable("Add the requested details, then choose Submit again.", undefined, { issues: domainIssues });
  }

  const routing = await selectSubmissionRouting(context.env.DB, base.form.event_id, {
    answers: projected.projected.answers,
    eventFieldKeys: (await context.env.DB.prepare(`
      SELECT DISTINCT field.key
      FROM form_fields field
      JOIN forms form ON form.id = field.form_id
      WHERE form.event_id = ? AND field.deleted_at IS NULL
    `).bind(base.form.event_id).all<{ key: string }>()).results.map((field) => field.key),
    formatId: references.formatId,
    formFieldKeys: base.fields.map((field) => field.key),
    levelId: references.levelId,
    trackIds: references.trackIds,
    vendorAffiliation: vendorAffiliation(projected.projected.answers),
  });
  const now = Date.now();
  const existing = base.submission;
  const removals = existing
    ? await projectedAnswerRemovals(context.env.DB, existing.id, base.fields, projected.projected.answers, new Set(Object.keys(raw)), true)
    : [];
  // Who the record's submitter is: whoever `email` names, which the disclosure
  // decides. Resolving from the draft's owner instead — as this did — made the
  // record permanently disagree with the mail: a submitter who ticks "on behalf
  // of someone else" at Submit having saved a draft without it filed the
  // abstract under the speaker, and one who UNTICKS it kept the discloser as
  // submitter while the confirmation went to the speaker. Both directions have
  // to follow the box, so both read the same address.
  //
  // `email` is always present by here — a missing speaker address pushed a
  // domain issue above and the throw is unconditional — so there is no
  // draft-owner fallback arm. One existed and could never run.
  const existingPerson = await findPersonByEmail(context.env.DB, event.org_id, email!);
  const existingPersonCount = existingPerson
    ? await countFormForPerson(context.env.DB, base.form.id, existingPerson.id)
    : 0;
  if (!existing && base.effectiveLimit > 0 && existingPerson && existingPersonCount >= base.effectiveLimit) {
    throw ApiError.conflict(submissionCapacityMessage(
      submissionCapacityRefusal(base.effectiveLimit, existingPersonCount, "new"),
    ));
  }
  const submissionId = existing?.id ?? crypto.randomUUID();
  const rawResumeToken = resumeToken ?? mintToken();
  const resumeHash = await sha256Hex(rawResumeToken);
  const title = answerText(projected.projected.answers, "title") ?? "Untitled abstract";
  const abstract = answerText(projected.projected.answers, "abstract");
  const vendor = vendorAffiliation(projected.projected.answers);
  // Everything through the arrival claim is prepared first and committed in
  // one D1 batch. In particular, do not create a person, draft submission, or
  // track projection before the reviewer-scope preflight has passed: an
  // action-only rule has the same transaction boundary as a committee route.
  const preparation: PublicPersonPreparation = {
    byEmail: new Map(),
    statements: [],
  };
  if (existingPerson) preparation.byEmail.set(email!.trim().toLowerCase(), existingPerson);
  const person = existingPerson ?? await preparePublicPerson(context.env.DB, preparation, {
    orgId: event.org_id,
    email: email!,
    name: roster.onBehalfOf?.name ?? answerText(projected.projected.answers, "speaker_name") ?? email!,
    company: roster.onBehalfOf ? null : answerText(projected.projected.answers, "speaker_company"),
    title: roster.onBehalfOf ? null : answerText(projected.projected.answers, "speaker_role"),
    bio: roster.onBehalfOf ? null : answerText(projected.projected.answers, "biography"),
    now,
  });
  if (!person) throw new Error("submission owner disappeared");
  const existingCount = await countFormForPerson(context.env.DB, base.form.id, person.id, existing?.id);
  if (base.effectiveLimit > 0 && existingCount >= base.effectiveLimit) {
    throw ApiError.conflict(submissionCapacityMessage(
      submissionCapacityRefusal(base.effectiveLimit, existingCount, existing ? "resumed-draft" : "new"),
    ));
  }
  const intake = await prepareParticipantRoster(context.env.DB, {
    submissionId,
    orgId: event.org_id,
    submitter: person,
    answers: projected.projected.answers,
    roster,
    now,
    preparation,
  });
  await assertRoutingPoolAllowedForTracks(context.env.DB, base.form.event_id, routing.trackIds, routing);

  const confirmationUrl = `${publicOrigin(context.req.url)}/f/${encodeURIComponent(slug)}?resume=${encodeURIComponent(rawResumeToken)}`;
  let referenceCode = existing?.reference_code ?? null;
  // The first two moments of MRQ-211's submission timeline. Everything that
  // happens to a record afterwards — decided, reversed, mailed — already writes
  // an audit row; arrival and routing did not, so the one question the timeline
  // exists to answer ("why is this talk in this state") started mid-sentence.
  // Two rows rather than one: an organizer asking why a talk landed with this
  // committee is asking about the routing, not about the submission.
  const intakeRows = [
    auditStatement(context.env.DB, {
      eventId: base.form.event_id,
      actorKind: "user",
      actorPersonId: person.id,
      action: "submission.received",
      entityType: "submission",
      entityId: submissionId,
      after: {
        title,
        kind: base.form.kind,
        form_id: base.form.id,
        track_ids: routing.trackIds,
        tag_ids: routing.action?.addTagIds ?? [],
        level_id: routing.levelId,
      },
      now,
      requestId: context.get("requestId") ?? null,
    }),
  ];
  if (routing.ruleId !== null) {
    intakeRows.push(auditStatement(context.env.DB, {
      eventId: base.form.event_id,
      // Routing is the system applying a rule an organizer wrote, not the
      // submitter doing anything — crediting the submitter would be a lie about
      // authorship in the one place authorship is the product.
      actorKind: "system",
      actorPersonId: null,
      action: "submission.routed",
      entityType: "submission",
      entityId: submissionId,
      after: {
        rule_id: routing.ruleId,
        rule_name: routing.ruleName,
        track_ids: routing.trackIds,
        tag_ids: routing.action?.addTagIds ?? [],
        level_id: routing.levelId,
        committee_id: routing.committeeId,
      },
      now,
      requestId: context.get("requestId") ?? null,
    }));
  }
  const answerRows = await projectedAnswerStatements(
    context.env.DB,
    submissionId,
    base.fields,
    projected.projected.answers,
    now,
    removals,
  );
  const submissionRow = existing
    ? (referenceCode === null
      ? (allocatedCode: string) => context.env.DB.prepare(
        `UPDATE submissions SET reference_code = ?, title = ?, abstract = ?, status = 'submitted', origin = 'public',
         format_id = ?, primary_track_id = ?, level_id = ?, vendor_affiliation = ?, submitted_at = ?,
         last_saved_at = ?, search_blob = ?, applied_rule_id = ?, submitter_person_id = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      ).bind(
        allocatedCode, title, abstract, references.formatId, routing.trackIds[0] ?? null, routing.levelId, vendor, now,
        now, JSON.stringify(projected.projected.answers), routing.ruleId, person.id, now, submissionId,
      )
      : () => context.env.DB.prepare(
        `UPDATE submissions SET title = ?, abstract = ?, status = 'submitted', origin = 'public',
         format_id = ?, primary_track_id = ?, level_id = ?, vendor_affiliation = ?, submitted_at = ?,
         last_saved_at = ?, search_blob = ?, applied_rule_id = ?, submitter_person_id = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      ).bind(
        title, abstract, references.formatId, routing.trackIds[0] ?? null, routing.levelId, vendor, now,
        now, JSON.stringify(projected.projected.answers), routing.ruleId, person.id, now, submissionId,
      ))
    : (allocatedCode: string) => context.env.DB.prepare(
      `INSERT INTO submissions
       (id, event_id, reference_code, form_id, kind, title, abstract, status, format_id, primary_track_id, level_id,
        origin, vendor_affiliation, submitter_person_id, resume_token_hash, submitted_at,
        last_saved_at, search_blob, applied_rule_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      submissionId, base.form.event_id, allocatedCode, base.form.id, base.form.kind, title, abstract,
      references.formatId, routing.trackIds[0] ?? null, routing.levelId, vendor, person.id, resumeHash,
      now, now, JSON.stringify(projected.projected.answers), routing.ruleId, now, now,
    );

  const postSubmissionStatements: D1PreparedStatement[] = [
    ...answerRows,
    ...trackStatements(context.env.DB, submissionId, routing.trackIds, now),
    ...tagStatements(context.env.DB, submissionId, routing.action?.addTagIds ?? [], now),
    context.env.DB.prepare(
      "UPDATE submissions SET level_id = ?, applied_rule_id = ?, updated_at = ? WHERE id = ?",
    ).bind(routing.levelId, routing.ruleId, now, submissionId),
    ...intake.statements,
    ...attachmentStatements(context.env.DB, submissionId, existing?.id ?? null, projected.projected.answers, now),
    ...await routingPoolAssignmentStatements(context.env.DB, submissionId, routing, now),
    ...intakeRows,
    context.env.DB.prepare(
      `INSERT INTO submission_arrivals
         (submission_id, resume_token_hash, applied_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(submissionId, resumeHash, now, now, now),
  ];
  const commonStatements: D1PreparedStatement[] = [
    ...preparation.statements,
    ...(referenceCode === null ? [] : [submissionRow(referenceCode)]),
    ...postSubmissionStatements,
  ];
  if (referenceCode === null) {
    referenceCode = await withSubmissionReferenceAllocation(context.env.DB, base.form.event_id, now, (allocatedCode) => [
      ...preparation.statements,
      submissionRow(allocatedCode),
      ...postSubmissionStatements,
    ]);
  } else {
    await context.env.DB.batch(commonStatements);
  }

  if (base.resumeSource === "magic" && base.resumeMagicLinkId !== null) {
    await promoteMagicLinkToResumeCapability(context.env.DB, base.resumeMagicLinkId, now);
  }

  if (referenceCode === null) {
    referenceCode = (await context.env.DB.prepare(
      "SELECT reference_code FROM submissions WHERE id = ? AND event_id = ?",
    ).bind(submissionId, base.form.event_id).first<{ reference_code: string | null }>())?.reference_code ?? null;
  }
  if (!referenceCode) throw new Error("submission reference code was not assigned");

  // One scoped invitation per person somebody else named — the co-speakers, the
  // moderator, and under the disclosure the speaker too. Each is the authority
  // on their own bio and headshot, and this link is how they exercise it.
  for (const invitee of intake.invitees) {
    await enqueueCoSpeakerInvitation(context, {
      eventId: base.form.event_id,
      conferenceName: event.name,
      submissionId,
      submissionTitle: title,
      addedBy: roster.onBehalfOf?.name ?? answerText(projected.projected.answers, "speaker_name") ?? person.name,
      participant: invitee,
      now,
    });
  }

  const confirmationTemplateKey = base.form.thankyou_template_key ?? "submission_confirmation";
  const confirmationTemplate = await findTemplate(context.env.DB, base.form.event_id, confirmationTemplateKey);
  // This transactional reply is enabled unless an organizer explicitly stores
  // `enabled = 0`; an absent or unset state must not strand a submitter.
  if (confirmationTemplate.enabled !== 0) {
    const confirmation = await enqueuePublicFormConfirmation({
      db: context.env.DB,
      eventId: base.form.event_id,
      entityId: IDEMPOTENCY_REGISTRY.formConfirmation(submissionId),
      personId: person.id,
      toEmail: email!,
      typedAddress: email!,
      templateKey: confirmationTemplateKey,
      data: { "submission.title": title, "submission.reference_code": referenceCode, "speaker.first_name": (answerText(projected.projected.answers, "speaker_name") ?? "there").split(/\s+/)[0] ?? "there" },
      subject: `Abstract ${referenceCode} received — ${title}`,
      text: `Abstract ${referenceCode} received — ${title}.\n\nReview your conference abstract here: ${confirmationUrl}`,
      html: `<p>Abstract <strong>${escapeHtml(referenceCode)}</strong> received — <strong>${escapeHtml(title)}</strong>.</p><p><a href="${confirmationUrl}">Review your conference abstract</a></p>`,
      now,
    });
    await enqueueMailMessage(context.env.MAIL_QUEUE, confirmation.id);
  }

  const adminIds = (() => {
    try {
      const parsed = typeof base.form.admin_notify_person_ids === "string" ? JSON.parse(base.form.admin_notify_person_ids) : base.form.admin_notify_person_ids;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  })();
  if (adminIds.length > 0) {
    const admins = await context.env.DB.prepare(`SELECT id, email FROM people WHERE id IN (${adminIds.map(() => "?").join(",")})`).bind(...adminIds).all<{ id: string; email: string }>();
    for (const admin of admins.results) {
      const notice = await enqueueOutbox({
        db: context.env.DB,
        eventId: base.form.event_id,
        entityId: IDEMPOTENCY_REGISTRY.adminNotification(submissionId, admin.id),
        personId: admin.id,
        toEmail: admin.email,
        templateKey: "custom",
        data: { "message.body": `A new public abstract, ${title}, is ready for review.` },
        now,
      });
      await enqueueMailMessage(context.env.MAIL_QUEUE, notice.id);
    }
  }

  let portalUrl: string | null = null;
  if (event.demo_mode === 1) {
    // The submission already names the conference. Carry that identity through
    // the confirmation link so a multi-event submitter does not have to trust a
    // later fallback ordering to find the conference they just used.
    const portal = await mintMagicLink(context.env.DB, {
      personId: person.id,
      eventId: event.id,
      purpose: "login",
      redirectTo: `/portal?eventId=${encodeURIComponent(event.id)}`,
      now,
    });
    portalUrl = `${publicOrigin(context.req.url)}/api/v1/auth/exchange?token=${encodeURIComponent(portal.token)}`;
  }
  return formResponse(context, slug, rawResumeToken, email!, portalUrl);
}

const getPublicForm = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/public/forms/{slug}",
    operationId: "getPublicForm",
    summary: "Read a public conference form",
    description: "Returns the server-rendered form schema and its honest lifecycle state.",
    tags: ["Public forms"],
    request: { params: publicParams, query: z.object({ resume: z.string().optional(), email: z.string().optional() }) },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "read", keying: "ip_submission" }, concurrency: "none" },
    responses: { 200: jsonResponse(publicFormSchema, "Public form"), ...errorResponses([404, 429, 500]) },
  },
  async (context) => {
    const { slug } = context.req.valid("param");
    const query = context.req.valid("query");
    const state = await formResponse(context, slug, query.resume, query.email);
    context.header("Cache-Control", "no-store");
    return context.json(state, 200);
  },
);

const createPublicDraft = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/forms/{slug}/drafts",
    operationId: "createPublicFormDraft",
    summary: "Create a public conference form draft",
    tags: ["Public forms"],
    request: { params: publicParams, body: { content: { "application/json": { schema: draftBodySchema } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write", keying: "ip_submission" }, concurrency: "none" },
    responses: { 201: jsonResponse(writeResponseSchema, "Draft created"), ...errorResponses([403, 409, 422, 429, 500]) },
  },
  async (context) => {
    const state = await createDraft(context, context.req.valid("param").slug, context.req.valid("json"));
    return context.json(state, 201);
  },
);

const autosavePublicDraft = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/public/forms/{slug}/drafts/{token}",
    operationId: "autosavePublicFormDraft",
    summary: "Autosave a public conference form draft",
    description: "Resume-token authenticated autosave deliberately does not require Turnstile.",
    tags: ["Public forms"],
    request: { params: draftParams, body: { content: { "application/json": { schema: draftBodySchema } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write", keying: "ip_submission" }, concurrency: "none" },
    responses: { 200: jsonResponse(writeResponseSchema, "Draft saved"), ...errorResponses([403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const params = context.req.valid("param");
    const state = await autosaveDraft(context, params.slug, params.token, context.req.valid("json"));
    return context.json(state, 200);
  },
);

const editPublicSubmissionRoute = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/public/forms/{slug}/submissions/{token}",
    operationId: "editPublicSubmission",
    summary: "Edit an undecided public submission",
    description: "Resume-token authenticated submitter edits remain available while the call for speakers is open.",
    tags: ["Public forms"],
    request: { params: draftParams, body: { content: { "application/json": { schema: submittedEditBodySchema } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write", keying: "ip_submission" }, concurrency: "none" },
    responses: { 200: jsonResponse(writeResponseSchema, "Submission saved"), ...errorResponses([403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const params = context.req.valid("param");
    const state = await editSubmittedSubmission(context, params.slug, params.token, context.req.valid("json"));
    return context.json(state, 200);
  },
);

const submitPublicFormRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/forms/{slug}/submissions",
    operationId: "submitPublicForm",
    summary: "Submit a public conference form",
    description: "Validates the schema server-side and records only applicable answers.",
    tags: ["Public forms"],
    request: { params: publicParams, body: { content: { "application/json": { schema: submitBodySchema } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write", keying: "ip_submission" }, concurrency: "none" },
    responses: { 201: jsonResponse(writeResponseSchema, "Submission recorded"), ...errorResponses([403, 409, 422, 429, 500]) },
  },
  async (context) => {
    const state = await handlePublicSubmission(context, context.req.valid("param").slug, context.req.valid("json"));
    return context.json(state, 201);
  },
);

export const apiRoutes = [getPublicForm, createPublicDraft, autosavePublicDraft, editPublicSubmissionRoute, submitPublicFormRoute];
