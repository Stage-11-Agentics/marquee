import type { D1Database } from "@cloudflare/workers-types";

import { BULK_ID_LIMIT } from "../../api/bulk";
import { requireIfMatch, strongEtag, type ResourceVersion } from "../../api/concurrency";
import { ApiError } from "../../api/errors";
import type { DecisionPlanResponse } from "../../api/decision-plan";
import { sha256Hex } from "../../lib/auth/random-token";
import { demoMailAllowlistFor, normalizeAllowlistEmail } from "../../lib/demo-mail-allowlist";
import { isValidEmail } from "../../lib/email-validity";
import { PUBLISHED_SESSION_REFUSAL } from "../../lib/publication-guard";
import { canTransitionSubmissionStatus } from "../../lib/submission-transitions";
import { firstName } from "../mail/merge-data";
import { renderMail } from "../mail/render";
import { findTemplate } from "../mail/templates";
import {
  loadSubmissions,
  normalizeDecisionFeedback,
  type BulkAction,
  type SubmissionContext,
} from "./decisions";
import { planBulkDecision, type DecisionPlanRecordSnapshot } from "./decision-plan";

interface NotificationStateRow {
  submission_id: string;
  resulting_status: string;
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
    SELECT latest.submission_id, latest.resulting_status, settled.status AS outbox_status
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

function previewData(submission: SubmissionContext, action: BulkAction, feedbackMd: string | null) {
  const resultingStatus = action === "accept" ? "accepted" : "rejected";
  const recommendation = action === "accept" ? "approve" : "deny";
  return {
    "speaker.first_name": firstName(submission.person_name),
    "speaker.name": submission.person_name,
    "speaker.email": submission.person_email,
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
  feedbackMd?: string | null;
  confirmPublished?: boolean;
  waveId?: string | null;
}): Promise<DecisionPlanResponse> {
  const ids = [...new Set(input.ids)];
  if (ids.length > BULK_ID_LIMIT) {
    throw new Error(`decision plan is capped at ${BULK_ID_LIMIT} submissions`);
  }
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
  const recipientPreview = input.action === "waitlist" || input.action === "withdraw" || !previewSubmission
    ? null
    : { ...renderMail(template, previewData(previewSubmission, input.action, plan.feedback_md)), to_email: previewSubmission.person_email.trim() };
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
    zero_effect: plan.zero_effect,
  };
}
