import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { ApiEnv } from "../api/runtime";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { ApiError } from "../api/errors";
import type { FormFieldView } from "./forms.queries";
import type { PersonRow } from "../db/schema";
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { enqueuePublicFormConfirmation, enqueueOutbox } from "../jobs/mail/outbox";
import { escapeHtml } from "../jobs/mail/render";
import { findTemplate } from "../jobs/mail/templates";
import { enqueueAuthMail } from "../lib/auth/auth-mail";
import { mintMagicLink } from "../lib/auth/magic-links";
import { mintToken, sha256Hex } from "../lib/auth/random-token";
import { verifyTurnstile } from "../lib/r2/turnstile";
import {
  answerAttachmentId,
  answerText,
  countFormForPerson,
  emailFromAnswers,
  findEventContext,
  findPersonByEmail,
  loadPublicForm,
  normalisePublicEmail,
  projectPublicAnswers,
  publicFormIsClosed,
  publicIssues,
  rawAnswersFromBody,
  replaceProjectedAnswers,
  toPublicFormState,
  upsertPublicPerson,
  vendorAffiliation,
} from "./public-form.shared";
import type { PublicFormState } from "./public-form.types";

const publicParams = z.object({ slug: z.string().min(1).max(160) });
const draftParams = publicParams.extend({ token: z.string().min(20).max(256) });
const answersSchema = z.record(z.string(), z.unknown()).default({});
const draftBodySchema = z.object({
  answers: answersSchema.optional(),
  email: z.string().trim().max(320).optional(),
  turnstileToken: z.string().optional(),
  turnstile_token: z.string().optional(),
});
const submitBodySchema = draftBodySchema.extend({
  resumeToken: z.string().min(20).max(256).optional(),
  resume_token: z.string().min(20).max(256).optional(),
});

const publicFieldSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  help_text: z.string().nullable(),
  type: z.enum(["short_text", "long_text", "single_select", "multi_select", "url", "email", "file", "number"]),
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
  conference: z.object({ name: z.string(), slug: z.string() }),
  form: z.object({
    id: z.string(), name: z.string(), slug: z.string(), kind: z.enum(["abstract", "session"]),
    welcome_md: z.string(), closes_at: z.number().int().nullable(), per_submitter_limit: z.number().int(),
    min_speakers: z.number().int(), max_speakers: z.number().int(), max_sponsors: z.number().int(),
  }),
  state: publicStateSchema,
  fields: z.array(publicFieldSchema),
  answers: z.record(z.string(), z.unknown()),
  files: z.array(publicFileSchema),
  draft_id: z.string().nullable(),
  resume_token: z.string().nullable(),
  resume_url: z.string().nullable(),
  last_saved_at: z.number().int().nullable(),
  submitted_at: z.number().int().nullable(),
  turnstile_site_key: z.string().nullable(),
  confirmation: z.object({
    title: z.string(), message: z.string(), email: z.string(), resume_url: z.string().nullable(), portal_url: z.string().nullable(),
  }).nullable(),
  message: z.string().nullable(),
}).openapi("PublicForm");

const issueSchema = z.object({ fieldKey: z.string(), message: z.string() });
const writeResponseSchema = publicFormSchema;

function workerSecrets(context: { env: ApiEnv["Bindings"] }): { TURNSTILE_SECRET_KEY: string; TURNSTILE_SITE_KEY: string } {
  return context.env as unknown as { TURNSTILE_SECRET_KEY: string; TURNSTILE_SITE_KEY: string };
}

function publicOrigin(url: string): string {
  return new URL(url).origin;
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

async function draftTokenAllowed(cache: KVNamespace, token: string, now = Date.now()): Promise<void> {
  const limit = 30;
  const windowSeconds = 60;
  const window = Math.floor(now / 1000 / windowSeconds);
  const key = `public-form:autosave:${await sha256Hex(token)}:${window}`;
  const current = Number((await cache.get(key)) ?? "0");
  if (current >= limit) throw ApiError.rateLimited(windowSeconds - Math.floor((now / 1000) % windowSeconds));
  await cache.put(key, String(current + 1), { expirationTtl: windowSeconds + 10 });
}

function answerMap(body: { answers?: Record<string, unknown> }): Record<string, unknown> {
  return body.answers ?? {};
}

function requiredSubmissionIssues(
  fields: readonly FormFieldView[],
  answers: Record<string, unknown>,
  form: { min_speakers: number; max_speakers: number },
): Array<{ fieldKey: string; message: string }> {
  const hasParticipantSchema = fields.some((field) => field.key === "speaker_name" || field.key === "speaker_email");
  if (!hasParticipantSchema) return [];
  const primaryPresent = Boolean(answerText(answers, "speaker_name") || normalisePublicEmail(answers.speaker_email));
  const coName = answerText(answers, "co_speaker_name");
  const coEmail = normalisePublicEmail(answers.co_speaker_email);
  const participantCount = (primaryPresent ? 1 : 0) + (coName && coEmail ? 1 : 0);
  if (participantCount < Number(form.min_speakers)) {
    return [{ fieldKey: "speaker_name", message: "Add at least one participant before sending this abstract, then try again." }];
  }
  if (participantCount > Number(form.max_speakers)) {
    return [{ fieldKey: "speaker_name", message: "Remove an extra participant so the conference limit is respected, then try again." }];
  }
  if (answers.co_speaker_name && !answers.co_speaker_email) {
    return [{ fieldKey: "co_speaker_email", message: "Add a contact address for the additional participant, then try again." }];
  }
  if (answers.co_speaker_email && !answers.co_speaker_name) {
    return [{ fieldKey: "co_speaker_name", message: "Add a name for the additional participant, then try again." }];
  }
  return [];
}

async function referenceId(
  db: D1Database,
  table: "formats" | "tracks",
  eventId: string,
  value: string,
): Promise<string | null> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE event_id = ? AND (id = ? OR lower(name) = lower(?)) LIMIT 1`).bind(eventId, value, value).first<{ id: string }>();
  return row?.id ?? null;
}

async function resolveDomainReferences(
  db: D1Database,
  eventId: string,
  answers: Record<string, unknown>,
): Promise<{ formatId: string | null; trackIds: string[]; issues: Array<{ fieldKey: string; message: string }> }> {
  const issues: Array<{ fieldKey: string; message: string }> = [];
  let formatId: string | null = null;
  const format = answerText(answers, "format");
  if (format) {
    formatId = await referenceId(db, "formats", eventId, format);
    if (!formatId) issues.push({ fieldKey: "format", message: "Choose a format from the list, then try again." });
  }
  const tracks = Array.isArray(answers.tracks) ? answers.tracks.filter((value): value is string => typeof value === "string") : [];
  const trackIds: string[] = [];
  for (const track of tracks) {
    const id = await referenceId(db, "tracks", eventId, track);
    if (!id) issues.push({ fieldKey: "tracks", message: "Choose conference tracks from the list, then try again." });
    else trackIds.push(id);
  }
  return { formatId, trackIds, issues };
}

async function insertParticipationRows(
  db: D1Database,
  submissionId: string,
  primary: PersonRow,
  answers: Record<string, unknown>,
  eventOrgId: string,
  now: number,
): Promise<void> {
  const participants: Array<{ person: PersonRow; role: "speaker" | "co_speaker"; position: number }> = [];
  const primaryName = answerText(answers, "speaker_name");
  if (primaryName || answers.speaker_email) participants.push({ person: primary, role: "speaker", position: 0 });
  const coEmail = normalisePublicEmail(answers.co_speaker_email);
  const coName = answerText(answers, "co_speaker_name");
  if (coEmail && coName) {
    const coPerson = await upsertPublicPerson({
      // This argument is intentionally supplied by the event context, not the request.
      db,
      orgId: eventOrgId,
      email: coEmail,
      name: coName,
      now,
    });
    participants.push({ person: coPerson, role: "co_speaker", position: 1 });
  }
  const statements = [db.prepare("DELETE FROM participations WHERE submission_id = ?").bind(submissionId)];
  statements.push(db.prepare(
    `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
     VALUES (?, ?, ?, 'submitter', 0, 'confirmed', ?, ?)`,
  ).bind(crypto.randomUUID(), submissionId, primary.id, now, now));
  for (const participant of participants) {
    statements.push(db.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(crypto.randomUUID(), submissionId, participant.person.id, participant.role, participant.position, now, now));
  }
  await db.batch(statements);
}

async function persistTracks(db: D1Database, submissionId: string, trackIds: string[], now: number): Promise<void> {
  const statements = [db.prepare("DELETE FROM submission_tracks WHERE submission_id = ?").bind(submissionId)];
  for (const [position, trackId] of trackIds.entries()) {
    statements.push(db.prepare(
      `INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), submissionId, trackId, position === 0 ? 1 : 0, now, now));
  }
  await db.batch(statements);
}

async function moveAttachments(
  db: D1Database,
  submissionId: string,
  previousOwnerId: string | null,
  answers: Record<string, unknown>,
): Promise<void> {
  if (!previousOwnerId) return;
  const attachmentIds = [...new Set(Object.values(answers).map(answerAttachmentId).filter((id): id is string => id !== null))];
  if (attachmentIds.length === 0) return;
  const placeholders = attachmentIds.map(() => "?").join(",");
  await db.prepare(
    `UPDATE attachments SET owner_type = 'submission_file', owner_id = ?, updated_at = ?
     WHERE owner_type = 'draft_file' AND owner_id = ? AND id IN (${placeholders})`,
  ).bind(submissionId, Date.now(), previousOwnerId, ...attachmentIds).run();
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
    turnstileSiteKey: workerSecrets(context).TURNSTILE_SITE_KEY,
  });
  if (portalUrl && state.confirmation) state.confirmation.portal_url = portalUrl;
  return state;
}

async function createDraft(
  context: Context<ApiEnv>,
  slug: string,
  body: z.infer<typeof draftBodySchema>,
): Promise<PublicFormState> {
  await requireTurnstile(context, tokenFromBody(body));
  const base = await loadPublicForm(context.env.DB, slug, { email: body.email });
  if (!base) throw ApiError.notFound("This conference form is not available.");
  if (publicFormIsClosed(base.form)) throw ApiError.conflict("This call for speakers is closed. Keep your answers and return when the conference reopens.");
  if (base.state === "at_limit") throw ApiError.conflict("Your abstract limit is full. Use a saved resume link to continue an existing draft.");

  const raw = rawAnswersFromBody(answerMap(body), body.email);
  const projected = projectPublicAnswers(base.fields, raw);
  const email = emailFromAnswers(projected.projected.answers) ?? normalisePublicEmail(body.email);
  if (!email) throw ApiError.unprocessable("Enter an address where the conference team can reach you, then choose Save draft.", "email");
  const event = await findEventContext(context.env.DB, base.form.event_id);
  if (!event) throw ApiError.notFound("This conference is no longer available.");
  const now = Date.now();
  const knownPerson = await findPersonByEmail(context.env.DB, event.org_id, email);
  if (base.form.per_submitter_limit > 0 && knownPerson && await countFormForPerson(context.env.DB, base.form.id, knownPerson.id) >= Number(base.form.per_submitter_limit)) {
    throw ApiError.conflict("Your abstract limit is full. Use a saved resume link to continue an existing draft.");
  }
  const person = await upsertPublicPerson({
    db: context.env.DB,
    orgId: event.org_id,
    email,
    name: answerText(projected.projected.answers, "speaker_name") ?? email,
    company: answerText(projected.projected.answers, "speaker_company"),
    title: answerText(projected.projected.answers, "speaker_role"),
    bio: answerText(projected.projected.answers, "biography"),
    now,
  });
  const submissionId = crypto.randomUUID();
  const resumeToken = mintToken();
  const title = answerText(projected.projected.answers, "title") ?? "Untitled abstract";
  await context.env.DB.prepare(
    `INSERT INTO submissions
      (id, event_id, form_id, kind, title, abstract, status, origin, vendor_affiliation,
       submitter_person_id, resume_token_hash, last_saved_at, search_blob, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', 'public', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    submissionId, base.form.event_id, base.form.id, base.form.kind, title,
    answerText(projected.projected.answers, "abstract"), vendorAffiliation(projected.projected.answers),
    person.id, await sha256Hex(resumeToken), now,
    JSON.stringify(projected.projected.answers), now, now,
  ).run();
  await replaceProjectedAnswers(context.env.DB, submissionId, base.fields, projected.projected.answers, now);
  await insertParticipationRows(context.env.DB, submissionId, person, projected.projected.answers, event.org_id, now);

  const resumeUrl = `${publicOrigin(context.req.url)}/f/${encodeURIComponent(slug)}?resume=${encodeURIComponent(resumeToken)}`;
  const mail = await enqueueAuthMail(context.env.DB, {
    eventId: base.form.event_id,
    personId: person.id,
    toEmail: email,
    templateKey: "draft_resume",
    entityId: submissionId,
    subject: "Continue your conference abstract",
    text: `Continue your conference abstract here: ${resumeUrl}`,
    html: `<p><a href="${resumeUrl}">Continue your conference abstract</a></p>`,
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
  const raw = rawAnswersFromBody(answerMap(body), body.email);
  const projected = projectPublicAnswers(base.fields, raw);
  const now = Date.now();
  const event = await findEventContext(context.env.DB, base.form.event_id);
  if (!event) throw ApiError.notFound("This conference is no longer available.");
  const person = await upsertPublicPerson({
    db: context.env.DB,
    orgId: event.org_id,
    email: (await findPersonByEmail(context.env.DB, event.org_id, base.email ?? ""))?.email ?? base.email ?? "draft@local.test",
    name: answerText(projected.projected.answers, "speaker_name") ?? base.email ?? "Conference participant",
    company: answerText(projected.projected.answers, "speaker_company"),
    title: answerText(projected.projected.answers, "speaker_role"),
    bio: answerText(projected.projected.answers, "biography"),
    now,
  });
  await replaceProjectedAnswers(context.env.DB, base.submission.id, base.fields, projected.projected.answers, now);
  await insertParticipationRows(context.env.DB, base.submission.id, person, projected.projected.answers, event.org_id, now);
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

async function handlePublicSubmission(
  context: Context<ApiEnv>,
  slug: string,
  body: z.infer<typeof submitBodySchema>,
): Promise<PublicFormState> {
  await requireTurnstile(context, tokenFromBody(body));
  const resumeToken = resumeTokenFromBody(body);
  const base = await loadPublicForm(context.env.DB, slug, { resumeToken, email: body.email });
  if (!base) throw ApiError.notFound("This conference form is not available.");
  if (resumeToken && !base.submission) throw ApiError.forbidden("Use the resume link that belongs to this abstract, then try again.");
  if (base.submission && base.submission.status !== "draft") throw ApiError.conflict("This abstract was already submitted. Use its confirmation link to view it.");
  if (publicFormIsClosed(base.form)) throw ApiError.conflict("This call for speakers is closed. Keep your answers and return when the conference reopens.");
  if (base.state === "at_limit") throw ApiError.conflict("Your abstract limit is full. Use a saved resume link to continue an existing draft.");

  const raw = rawAnswersFromBody(answerMap(body), body.email);
  const projected = projectPublicAnswers(base.fields, raw);
  const domainIssues = [
    ...projected.issues,
    ...requiredSubmissionIssues(base.fields, projected.projected.answers, base.form),
  ];
  const event = await findEventContext(context.env.DB, base.form.event_id);
  if (!event) throw ApiError.notFound("This conference is no longer available.");
  const references = await resolveDomainReferences(context.env.DB, base.form.event_id, projected.projected.answers);
  domainIssues.push(...publicIssues(references.issues));
  const email = emailFromAnswers(projected.projected.answers) ?? normalisePublicEmail(body.email);
  if (!email) domainIssues.push({ fieldKey: "speaker_email", message: "Enter an address where the conference team can reach you, then try again." });
  if (domainIssues.length > 0) {
    throw ApiError.unprocessable("Add the requested details, then choose Submit again.", undefined, { issues: domainIssues });
  }

  const now = Date.now();
  const existing = base.submission;
  const existingPerson = existing
    ? await context.env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(existing.submitter_person_id).first<PersonRow>()
    : await findPersonByEmail(context.env.DB, event.org_id, email!);
  if (!existing && base.form.per_submitter_limit > 0 && existingPerson && await countFormForPerson(context.env.DB, base.form.id, existingPerson.id) >= Number(base.form.per_submitter_limit)) {
    throw ApiError.conflict("Your abstract limit is full. Use a saved resume link to continue an existing draft.");
  }
  const person = existingPerson ?? await upsertPublicPerson({
    db: context.env.DB,
    orgId: event.org_id,
    email: email!,
    name: answerText(projected.projected.answers, "speaker_name") ?? email!,
    company: answerText(projected.projected.answers, "speaker_company"),
    title: answerText(projected.projected.answers, "speaker_role"),
    bio: answerText(projected.projected.answers, "biography"),
    now,
  });
  if (!person) throw new Error("submission owner disappeared");
  const existingCount = await countFormForPerson(context.env.DB, base.form.id, person.id, existing?.id);
  if (base.form.per_submitter_limit > 0 && existingCount >= Number(base.form.per_submitter_limit)) {
    throw ApiError.conflict("Your abstract limit is full. Use a saved resume link to continue an existing draft.");
  }
  const submissionId = existing?.id ?? crypto.randomUUID();
  const rawResumeToken = resumeToken ?? mintToken();
  const resumeHash = await sha256Hex(rawResumeToken);
  const title = answerText(projected.projected.answers, "title") ?? "Untitled abstract";
  const abstract = answerText(projected.projected.answers, "abstract");
  const confirmationUrl = `${publicOrigin(context.req.url)}/f/${encodeURIComponent(slug)}?resume=${encodeURIComponent(rawResumeToken)}`;
  if (existing) {
    await context.env.DB.prepare(
      `UPDATE submissions SET title = ?, abstract = ?, status = 'submitted', origin = 'public',
       format_id = ?, primary_track_id = ?, vendor_affiliation = ?, submitted_at = ?,
       last_saved_at = ?, search_blob = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
    ).bind(title, abstract, references.formatId, references.trackIds[0] ?? null, vendorAffiliation(projected.projected.answers), now, now, JSON.stringify(projected.projected.answers), now, existing.id).run();
  } else {
    await context.env.DB.prepare(
      `INSERT INTO submissions
       (id, event_id, form_id, kind, title, abstract, status, format_id, primary_track_id,
        origin, vendor_affiliation, submitter_person_id, resume_token_hash, submitted_at,
        last_saved_at, search_blob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(submissionId, base.form.event_id, base.form.id, base.form.kind, title, abstract, references.formatId, references.trackIds[0] ?? null, vendorAffiliation(projected.projected.answers), person.id, resumeHash, now, now, JSON.stringify(projected.projected.answers), now, now).run();
  }
  await replaceProjectedAnswers(context.env.DB, submissionId, base.fields, projected.projected.answers, now);
  await persistTracks(context.env.DB, submissionId, references.trackIds, now);
  await insertParticipationRows(context.env.DB, submissionId, person, projected.projected.answers, event.org_id, now);
  await moveAttachments(context.env.DB, submissionId, existing?.id ?? null, projected.projected.answers);

  const confirmationTemplateKey = base.form.thankyou_template_key ?? "submission_confirmation";
  const confirmationTemplate = await findTemplate(context.env.DB, base.form.event_id, confirmationTemplateKey);
  // This transactional reply is enabled unless an organizer explicitly stores
  // `enabled = 0`; an absent or unset state must not strand a submitter.
  if (confirmationTemplate.enabled !== 0) {
    const confirmation = await enqueuePublicFormConfirmation({
      db: context.env.DB,
      eventId: base.form.event_id,
      entityId: submissionId,
      personId: person.id,
      toEmail: email!,
      typedAddress: email!,
      templateKey: confirmationTemplateKey,
      data: { "submission.title": title, "speaker.first_name": (answerText(projected.projected.answers, "speaker_name") ?? "there").split(/\s+/)[0] ?? "there" },
      subject: `We received ${title}`,
      text: `We received ${title}.\n\nReview your conference abstract here: ${confirmationUrl}`,
      html: `<p>We received <strong>${escapeHtml(title)}</strong>.</p><p><a href="${confirmationUrl}">Review your conference abstract</a></p>`,
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
        entityId: `${submissionId}:admin:${admin.id}`,
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
    const portal = await mintMagicLink(context.env.DB, { personId: person.id, purpose: "login", redirectTo: "/portal", now });
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

export const apiRoutes = [getPublicForm, createPublicDraft, autosavePublicDraft, submitPublicFormRoute];
