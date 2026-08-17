import type { D1Database, Queue } from "@cloudflare/workers-types";

import { BULK_ID_LIMIT } from "../../api/bulk";
import { requireIfMatch, strongEtag, type ResourceVersion } from "../../api/concurrency";
import { ApiError } from "../../api/errors";
import type { DecisionPlanResponse } from "../../api/decision-plan";
import { sha256Hex } from "../../lib/auth/random-token";
import { demoMailAllowlistFor, normalizeAllowlistEmail } from "../../lib/demo-mail-allowlist";
import { isValidEmail } from "../../lib/email-validity";
import { PUBLISHED_SESSION_REFUSAL } from "../../lib/publication-guard";
import { canTransitionSubmissionStatus } from "../../lib/submission-transitions";
import { publicSpeakerPathForPerson } from "../../lib/public-site";
import { firstName, mergeDataForRecipient } from "../mail/merge-data";
import { renderAdHocMail, renderDecisionMail } from "../mail/render";
import { findTemplate } from "../mail/templates";
import { enqueueMailMessage } from "../mail/consumer";
import { IDEMPOTENCY_REGISTRY } from "../mail/idempotency";
import { enqueueBulkReminder } from "../mail/triggers";
import { announceEventFor, announceRowCanSend, readAnnounceAudience, type AnnounceAudienceRow } from "../../routes/announce.queries";
import type { Id } from "../../db/schema";
import {
  loadSubmissions,
  normalizeDecisionFeedback,
  type BulkAction,
  type SubmissionContext,
} from "./decisions";
import { planBulkDecision, type DecisionPlanRecordSnapshot } from "./decision-plan";

interface NotificationStateRow {
  submission_id: string;
  decision: string;
  resulting_status: string;
  feedback_md: string | null;
  outbox_status: string | null;
}

export const STALE_DECISION_PLAN_MESSAGE = "The selection or the email changed after you previewed it.";

export function requireCurrentDecisionPlan(input: {
  request: Request;
  plan: DecisionPlanResponse;
  planFingerprint: string;
}): ResourceVersion {
  const expected = requireIfMatch(input.request, input.planFingerprint);
  if (expected.updatedAt !== 0) {
    throw ApiError.badRequest("If-Match must be the decision plan's strong ETag", "if-match");
  }
  if (input.plan.plan_fingerprint !== input.planFingerprint) {
    throw new ApiError("conflict", STALE_DECISION_PLAN_MESSAGE, {
      details: {
        code: "stale_plan",
        plan_fingerprint: input.plan.plan_fingerprint,
      },
      headers: { ETag: input.plan.etag },
    });
  }
  return expected;
}

export function refuseZeroEffect(plan: DecisionPlanResponse): never {
  if (!plan.zero_effect) throw new Error("decision plan has an effect");
  throw ApiError.conflict(plan.zero_effect.reason, plan.zero_effect);
}

function templateKey(action: BulkAction): "acceptance" | "rejection" {
  return action === "reject" ? "rejection" : "acceptance";
}

function decisionTargetStatus(action: BulkAction): string {
  if (action === "accept") return "accepted";
  if (action === "reject") return "rejected";
  if (action === "waitlist") return "waitlisted";
  return "withdrawn";
}

function snapshotFor(
  id: string,
  submission: SubmissionContext | undefined,
  notification: NotificationStateRow | undefined,
  templateEnabled: boolean,
  demoMode: boolean,
  allowlist: ReadonlySet<string>,
  action: BulkAction,
  confirmPublished: boolean,
): DecisionPlanRecordSnapshot {
  if (!submission) {
    return { id, title: "Unknown submission", transitionError: "submission not found" };
  }
  const transitionError = canTransitionSubmissionStatus(
    submission.status,
    decisionTargetStatus(action),
    "organizer",
  );
  const publishedRefusal = submission.agenda_published === 1 && !confirmPublished
    ? PUBLISHED_SESSION_REFUSAL
    : null;
  const email = submission.person_email?.trim() ?? "";
  const demoSuppressed = action !== "waitlist"
    && action !== "withdraw"
    && templateEnabled
    && demoMode
    && isValidEmail(email)
    && !allowlist.has(normalizeAllowlistEmail(email));
  return {
    id: submission.id,
    title: submission.title,
    email,
    transitionError: transitionError ?? publishedRefusal,
    published: submission.agenda_published === 1,
    alreadyNotified: notification?.resulting_status === decisionTargetStatus(action)
      && notification?.outbox_status !== null
      && notification?.outbox_status !== undefined
      && ["queued", "sent", "suppressed"].includes(notification.outbox_status),
    demoSuppressed,
  };
}

async function notificationStates(
  db: D1Database,
  eventId: string,
  ids: readonly string[],
): Promise<Map<string, NotificationStateRow>> {
  if (ids.length === 0) return new Map();
  const result = await db.prepare(`
    SELECT latest.submission_id, latest.decision, latest.resulting_status, latest.feedback_md,
           settled.status AS outbox_status
    FROM submission_decisions latest
    LEFT JOIN outbox settled ON settled.id = (
      SELECT candidate.id
      FROM outbox candidate
      WHERE candidate.event_id = latest.event_id
        AND (candidate.id = latest.outbox_id OR candidate.entity_id = latest.id)
      ORDER BY CASE WHEN candidate.status = 'sent' THEN 0 ELSE 1 END,
               candidate.created_at DESC,
               candidate.id DESC
      LIMIT 1
    )
    WHERE latest.event_id = ?
      AND latest.submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      AND NOT EXISTS (
        SELECT 1
        FROM submission_decisions newer
        WHERE newer.event_id = latest.event_id
          AND newer.submission_id = latest.submission_id
          AND (newer.decided_at > latest.decided_at
            OR (newer.decided_at = latest.decided_at AND newer.id > latest.id))
      )
  `).bind(eventId, JSON.stringify([...new Set(ids)])).all<NotificationStateRow>();
  return new Map(result.results.map((row) => [row.submission_id, row]));
}

function previewData(submission: SubmissionContext, resultingStatus: "accepted" | "rejected", feedbackMd: string | null, publicLink?: string | null) {
  const recommendation = resultingStatus === "accepted" ? "approve" : "deny";
  return {
    "speaker.first_name": firstName(submission.person_name),
    "speaker.name": submission.person_name,
    "speaker.email": submission.person_email,
    "event.name": submission.event_name,
    "speaker.public_link": publicLink,
    "submission.title": submission.title,
    "decision.feedback": feedbackMd ?? "",
    "decision.resulting_status": resultingStatus,
    "decision.recommendation": recommendation,
  };
}

/** Build one deterministic, bounded, read-only plan for bulk or record callers. */
export async function buildDecisionPlan(input: {
  db: D1Database;
  eventId: string;
  ids: readonly string[];
  action: BulkAction;
  origin: string;
  feedbackMd?: string | null;
  confirmPublished?: boolean;
  waveId?: string | null;
  kindFeedbackEnabled?: boolean;
}): Promise<DecisionPlanResponse> {
  const ids = [...new Set(input.ids)];
  if (ids.length > BULK_ID_LIMIT) {
    throw new Error(`decision plan is capped at ${BULK_ID_LIMIT} submissions`);
  }
  const origin = (input.origin.trim() || "https://marquee.stage11.dev").replace(/\/+$/, "");
  const [event, submissions, notifications, template] = await Promise.all([
    input.db.prepare("SELECT demo_mode, updated_at FROM events WHERE id = ?").bind(input.eventId).first<{ demo_mode: number; updated_at: number }>(),
    loadSubmissions(input.db, input.eventId, ids),
    notificationStates(input.db, input.eventId, ids),
    findTemplate(input.db, input.eventId, templateKey(input.action)),
  ]);
  if (!event) throw new Error("event not found");
  const allowlist = Number(event.demo_mode) === 1
    ? new Set((await demoMailAllowlistFor(input.db, input.eventId)).map(normalizeAllowlistEmail))
    : new Set<string>();
  const byId = new Map(submissions.map((submission) => [submission.id, submission]));
  const snapshots = ids.map((id) => snapshotFor(
    id,
    byId.get(id),
    notifications.get(id),
    template.enabled === 1,
    Number(event.demo_mode) === 1,
    allowlist,
    input.action,
    input.confirmPublished === true,
  ));
  const plan = planBulkDecision({
    action: input.action,
    selected: snapshots,
    feedbackMd: normalizeDecisionFeedback(input.feedbackMd),
    template: {
      key: template.key,
      subject: template.subject,
      body_md: template.body_md,
      enabled: template.enabled === 1,
    },
    confirmPublished: input.confirmPublished === true,
  });
  const sendable = new Set(plan.rows[0]?.records.map((record) => record.id) ?? []);
  const firstPreviewId = [...sendable][0];
  const previewSubmission = firstPreviewId ? byId.get(firstPreviewId) : undefined;
  const previewPublicLinkPath = previewSubmission
    ? await publicSpeakerPathForPerson(input.db, input.eventId, previewSubmission.person_name, previewSubmission.person_id)
    : null;
  const previewPublicLink = previewPublicLinkPath ? `${origin}${previewPublicLinkPath}` : null;
  const recipientPreview = input.action === "waitlist" || input.action === "withdraw" || !previewSubmission
    ? null
    : { ...renderDecisionMail(template, previewData(previewSubmission, input.action === "accept" ? "accepted" : "rejected", plan.feedback_md, previewPublicLink)), to_email: previewSubmission.person_email.trim() };
  const fingerprintPayload = {
    action: input.action,
    wave_id: input.waveId ?? null,
    feedback_md: plan.feedback_md,
    template: {
      key: template.key,
      subject: template.subject,
      body_md: template.body_md,
      enabled: template.enabled === 1,
    },
    records: snapshots.map((snapshot, index) => ({
      id: snapshot.id,
      email: snapshot.email?.trim() ?? "",
      disposition: plan.rows.find((row) => row.records.some((record) => record.id === snapshot.id))?.disposition ?? "cannot_move",
      reason: plan.rows.flatMap((row) => row.records).find((record) => record.id === snapshot.id)?.reason ?? "submission not found",
      position: index,
    })),
  };
  const fingerprint = await sha256Hex(JSON.stringify(fingerprintPayload));
  return {
    action: plan.action,
    feedback_md: plan.feedback_md,
    mail_mode: plan.mail_mode,
    template: plan.template,
    demo_suppressed: plan.demo_suppressed,
    rows: plan.rows,
    recipient_preview: recipientPreview,
    plan_fingerprint: fingerprint,
    etag: strongEtag(fingerprint, 0),
    queue_revision: Number(event.updated_at),
    selected: ids.length,
    kind_feedback_enabled: input.kindFeedbackEnabled === true,
    zero_effect: plan.zero_effect,
  };
}

function notifyTemplateKey(resultingStatus: string): "acceptance" | "rejection" {
  return resultingStatus === "accepted" ? "acceptance" : "rejection";
}

/** Build the same four-row contract for the derived Decided · not notified surface. */
export async function buildNotifyPlan(input: {
  db: D1Database;
  eventId: string;
  ids: readonly string[];
  origin: string;
}): Promise<DecisionPlanResponse> {
  const ids = [...new Set(input.ids)];
  if (ids.length > BULK_ID_LIMIT) {
    throw new Error(`decision plan is capped at ${BULK_ID_LIMIT} submissions`);
  }
  const origin = (input.origin.trim() || "https://marquee.stage11.dev").replace(/\/+$/, "");
  const [event, submissions, notifications, acceptanceTemplate, rejectionTemplate] = await Promise.all([
    input.db.prepare("SELECT demo_mode, updated_at FROM events WHERE id = ?").bind(input.eventId).first<{ demo_mode: number; updated_at: number }>(),
    loadSubmissions(input.db, input.eventId, ids),
    notificationStates(input.db, input.eventId, ids),
    findTemplate(input.db, input.eventId, "acceptance"),
    findTemplate(input.db, input.eventId, "rejection"),
  ]);
  if (!event) throw new Error("event not found");
  const allowlist = Number(event.demo_mode) === 1
    ? new Set((await demoMailAllowlistFor(input.db, input.eventId)).map(normalizeAllowlistEmail))
    : new Set<string>();
  const byId = new Map(submissions.map((submission) => [submission.id, submission]));
  const templateByKey = { acceptance: acceptanceTemplate, rejection: rejectionTemplate };
  const snapshots: DecisionPlanRecordSnapshot[] = ids.map((id) => {
    const submission = byId.get(id);
    const notification = notifications.get(id);
    const status = notification?.resulting_status;
    const template = status === "accepted" || status === "rejected"
      ? templateByKey[notifyTemplateKey(status)]
      : acceptanceTemplate;
    const validDecision = status === "accepted" || status === "rejected";
    const email = submission?.person_email?.trim() ?? "";
    const alreadyQueuedOrSettled = ["queued", "sent", "suppressed"].includes(notification?.outbox_status ?? "");
    return {
      id,
      title: submission?.title ?? "Unknown submission",
      email,
      template: {
        key: template.key,
        subject: template.subject,
        body_md: template.body_md,
        enabled: template.enabled === 1,
      },
      transitionError: !validDecision ? "No accepted or rejected decision exists to notify." : null,
      alreadyNotified: alreadyQueuedOrSettled,
      demoSuppressed: validDecision
        && template.enabled === 1
        && Number(event.demo_mode) === 1
        && isValidEmail(email)
        && !allowlist.has(normalizeAllowlistEmail(email)),
    };
  });
  const firstTemplate = snapshots.find((snapshot) => snapshot.template?.key === "rejection")?.template
    ?? snapshots.find((snapshot) => snapshot.template)?.template
    ?? {
      key: acceptanceTemplate.key,
      subject: acceptanceTemplate.subject,
      body_md: acceptanceTemplate.body_md,
      enabled: acceptanceTemplate.enabled === 1,
    };
  const plan = planBulkDecision({
    action: "notify",
    selected: snapshots,
    template: firstTemplate,
    feedbackMd: null,
  });
  const sendableId = plan.rows[0]?.records[0]?.id;
  const sendableSubmission = sendableId ? byId.get(sendableId) : undefined;
  const sendableState = sendableId ? notifications.get(sendableId) : undefined;
  const sendableStatus = sendableState?.resulting_status === "accepted" || sendableState?.resulting_status === "rejected"
    ? sendableState.resulting_status
    : null;
  const previewTemplate = sendableStatus ? templateByKey[notifyTemplateKey(sendableStatus)] : null;
  const previewPublicLinkPath = sendableSubmission
    ? await publicSpeakerPathForPerson(input.db, input.eventId, sendableSubmission.person_name, sendableSubmission.person_id)
    : null;
  const previewPublicLink = previewPublicLinkPath ? `${origin}${previewPublicLinkPath}` : null;
  const recipientPreview = sendableSubmission && sendableState && sendableStatus && previewTemplate
    ? {
        ...renderDecisionMail(previewTemplate, previewData(sendableSubmission, sendableStatus, normalizeDecisionFeedback(sendableState.feedback_md), previewPublicLink)),
        to_email: sendableSubmission.person_email.trim(),
      }
    : null;
  const fingerprint = await sha256Hex(JSON.stringify({
    action: "notify",
    queue_revision: Number(event.updated_at),
    records: snapshots.map((snapshot, index) => ({
      id: snapshot.id,
      email: snapshot.email?.trim() ?? "",
      decision_id: notifications.get(snapshot.id)?.decision ?? null,
      resulting_status: notifications.get(snapshot.id)?.resulting_status ?? null,
      outbox_status: notifications.get(snapshot.id)?.outbox_status ?? null,
      disposition: plan.rows.find((row) => row.records.some((record) => record.id === snapshot.id))?.disposition ?? "cannot_move",
      reason: plan.rows.flatMap((row) => row.records).find((record) => record.id === snapshot.id)?.reason ?? "submission not found",
      position: index,
    })),
  }));
  return {
    action: plan.action,
    feedback_md: null,
    mail_mode: "rendered",
    template: plan.template,
    demo_suppressed: plan.demo_suppressed,
    rows: plan.rows,
    recipient_preview: recipientPreview,
    plan_fingerprint: fingerprint,
    etag: strongEtag(fingerprint, 0),
    queue_revision: Number(event.updated_at),
    selected: ids.length,
    kind_feedback_enabled: false,
    zero_effect: null,
  };
}

interface AnnounceNotificationState {
  entity_id: string;
  status: string;
}

async function announceNotificationStates(
  db: D1Database,
  eventId: string,
  audience: readonly AnnounceAudienceRow[],
): Promise<Set<string>> {
  if (audience.length === 0) return new Set();
  const entityIds = audience.map((row) => String(IDEMPOTENCY_REGISTRY.announceRecipient(eventId as Id, row.id as Id)));
  const rows = await db
    .prepare(
      `SELECT entity_id, status
       FROM outbox
       WHERE event_id = ?
         AND entity_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         AND status IN ('queued', 'sent', 'suppressed')`,
    )
    .bind(eventId, JSON.stringify(entityIds))
    .all<AnnounceNotificationState>();
  return new Set(rows.results.map((row) => row.entity_id));
}

function announceSnapshotFor(
  id: string,
  audience: AnnounceAudienceRow | undefined,
  alreadyQueued: boolean,
  template: { key: string; subject: string; body_md: string; enabled: boolean },
  demoMode: boolean,
  allowlist: ReadonlySet<string>,
): DecisionPlanRecordSnapshot {
  if (!audience) return { id, title: "Unknown speaker", transitionError: "This speaker is no longer public." };
  const sendable = announceRowCanSend(audience);
  const transitionError = audience.do_not_contact
    ? "The speaker is marked do-not-contact."
    : sendable
      ? null
      : null;
  return {
    id,
    title: audience.name,
    email: audience.email,
    template,
    transitionError,
    alreadyNotified: alreadyQueued,
    demoSuppressed: sendable && demoMode && isValidEmail(audience.email)
      && !allowlist.has(normalizeAllowlistEmail(audience.email)),
  };
}

/** The Announce consumer of MRQ-234's bounded four-row plan contract. */
export async function buildAnnouncePlan(input: {
  db: D1Database;
  eventId: string;
  personIds: readonly string[];
  origin: string;
  subject: string;
  body: string;
}): Promise<DecisionPlanResponse> {
  const ids = [...new Set(input.personIds)];
  if (ids.length > BULK_ID_LIMIT) throw new Error(`announce plan is capped at ${BULK_ID_LIMIT} speakers`);
  const event = await announceEventFor(input.db, input.eventId);
  if (!event) throw new Error("event not found");
  const [audience, template] = await Promise.all([
    readAnnounceAudience(input.db, event, input.origin),
    findTemplate(input.db, input.eventId, "custom"),
  ]);
  const alreadyQueued = await announceNotificationStates(input.db, input.eventId, audience);
  const allowlist = Number(event.demo_mode) === 1
    ? new Set((await demoMailAllowlistFor(input.db, input.eventId)).map(normalizeAllowlistEmail))
    : new Set<string>();
  const byId = new Map(audience.map((row) => [row.id, row]));
  const planTemplate = {
    key: "custom",
    subject: input.subject,
    body_md: input.body,
    enabled: template.enabled === 1,
  };
  const snapshots = ids.map((id) => announceSnapshotFor(
    id,
    byId.get(id),
    byId.has(id) && alreadyQueued.has(String(IDEMPOTENCY_REGISTRY.announceRecipient(input.eventId as Id, id as Id))),
    planTemplate,
    Number(event.demo_mode) === 1,
    allowlist,
  ));
  const plan = planBulkDecision({ action: "announce", selected: snapshots, template: planTemplate });
  const firstSendableId = plan.rows[0]?.records[0]?.id;
  const previewRecipient = firstSendableId ? byId.get(firstSendableId) : undefined;
  const recipientPreview = previewRecipient
    ? {
        ...renderAdHocMail(input.subject, input.body, mergeDataForRecipient({
          name: previewRecipient.name,
          email: previewRecipient.email,
          submissionTitle: previewRecipient.talk_title,
          publicLink: previewRecipient.public_link,
        })),
        to_email: previewRecipient.email.trim(),
      }
    : null;
  const recordsById = new Map(plan.rows.flatMap((row) => row.records.map((record) => [record.id, record] as const)));
  const fingerprint = await sha256Hex(JSON.stringify({
    action: "announce",
    event_id: input.eventId,
    queue_revision: Number(event.updated_at),
    subject: input.subject,
    body: input.body,
    records: snapshots.map((snapshot, index) => ({
      id: snapshot.id,
      name: snapshot.title,
      email: snapshot.email?.trim() ?? "",
      public_link: byId.get(snapshot.id)?.public_link ?? null,
      disposition: plan.rows.find((row) => row.records.some((record) => record.id === snapshot.id))?.disposition ?? "cannot_move",
      reason: recordsById.get(snapshot.id)?.reason ?? "speaker not found",
      position: index,
    })),
  }));
  return {
    action: plan.action,
    feedback_md: null,
    mail_mode: "rendered",
    template: plan.template,
    demo_suppressed: plan.demo_suppressed,
    rows: plan.rows,
    recipient_preview: recipientPreview,
    plan_fingerprint: fingerprint,
    etag: strongEtag(fingerprint, 0),
    queue_revision: Number(event.updated_at),
    selected: ids.length,
    kind_feedback_enabled: false,
    zero_effect: plan.zero_effect,
  };
}

export interface AnnounceMailApplyResult {
  selected: number;
  succeeded: number;
  failed: number;
  state: "completed" | "completed_with_failures";
  outbox_enqueued: number;
  outbox_ids: string[];
  results: Array<{ id: string; outcome: "succeeded" | "failed"; error?: string }>;
}

export async function applyAnnounceMail(input: {
  db: D1Database;
  queue: Queue<unknown>;
  eventId: string;
  personIds: readonly string[];
  origin: string;
  subject: string;
  body: string;
  request: Request;
  planFingerprint: string;
}): Promise<AnnounceMailApplyResult> {
  const plan = await buildAnnouncePlan(input);
  requireCurrentDecisionPlan({ request: input.request, plan, planFingerprint: input.planFingerprint });
  if (plan.zero_effect) refuseZeroEffect(plan);
  const event = await announceEventFor(input.db, input.eventId);
  if (!event) throw ApiError.notFound("conference not found");
  const audience = await readAnnounceAudience(input.db, event, input.origin);
  const byId = new Map(audience.map((row) => [row.id, row]));
  const sendableIds = plan.rows[0]?.records.map((record) => record.id) ?? [];
  const queued = await enqueueBulkReminder({
    db: input.db,
    eventId: input.eventId as Id,
    templateKey: "custom",
    subject: input.subject,
    body: input.body,
    sendId: plan.plan_fingerprint as Id,
    recipients: sendableIds.flatMap((id) => {
      const recipient = byId.get(id);
      if (!recipient) return [];
      return [{
        entityId: IDEMPOTENCY_REGISTRY.announceRecipient(input.eventId as Id, recipient.id as Id),
        personId: recipient.id as Id,
        toEmail: recipient.email.trim(),
        data: mergeDataForRecipient({
          name: recipient.name,
          email: recipient.email,
          submissionTitle: recipient.talk_title,
          publicLink: recipient.public_link,
        }),
      }];
    }),
  });
  const outboxIds: string[] = [];
  const results: AnnounceMailApplyResult["results"] = [];
  for (let index = 0; index < queued.length; index += 1) {
    const item = queued[index]!;
    const id = sendableIds[index]!;
    if (item.inserted) {
      outboxIds.push(item.id);
      await enqueueMailMessage(input.queue, item.id);
      results.push({ id, outcome: "succeeded" });
    } else {
      results.push({ id, outcome: "failed", error: "This announce message was already queued." });
    }
  }
  return {
    selected: input.personIds.length,
    succeeded: results.filter((result) => result.outcome === "succeeded").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    state: results.some((result) => result.outcome === "failed") ? "completed_with_failures" : "completed",
    outbox_enqueued: outboxIds.length,
    outbox_ids: outboxIds,
    results,
  };
}
