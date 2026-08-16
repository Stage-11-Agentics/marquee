import type { D1Database, Queue } from "@cloudflare/workers-types";

import { runBulkByIds } from "../../api/bulk";
import { newUlid } from "../../api/ids";
import { auditStatement, writeAudit as writeAuditRow, type AuditEntry } from "../../lib/audit";
import type { Decision, Id } from "../../db/schema";
import { sha256Hex } from "../../lib/auth/random-token";
import { acceptedSpeakerMembershipStatements } from "../../lib/speaker-membership";
import { cancelCalendarInvites } from "../calendar/invites";
import { enqueueMailMessage } from "../mail/consumer";
import { enqueueTrigger } from "../mail/triggers";

export type DecisionAction = "accept" | "reject" | "waitlist";
export type BulkAction = DecisionAction | "withdraw";

export interface DecisionActor {
  kind: "user" | "api_token";
  personId: Id;
  /**
   * The request this actor is acting within, carried alongside the identity
   * rather than threaded separately: every decision path already passes the
   * actor, and "who did it" and "in which request" are one fact about one
   * moment. Null where there is no inbound request (a cron sweep).
   */
  requestId: string | null;
}

export interface SubmissionDecisionInput {
  db: D1Database;
  queue: Queue<unknown>;
  eventId: Id;
  submissionId: Id;
  actor: DecisionActor;
  recommendation: Decision;
  feedbackMd?: string | null;
  waveId?: Id | null;
  operationId?: Id;
  now?: number;
}

export interface SubmissionDecisionResult {
  id: Id;
  outcome: "succeeded" | "failed";
  resultingStatus: "accepted" | "waitlisted" | "rejected" | "withdrawn" | null;
  decisionId?: Id;
  outboxId?: Id | null;
  outboxInserted: boolean;
  tasksAssigned: number;
  error?: string;
}

export interface BulkDecisionInput {
  db: D1Database;
  queue: Queue<unknown>;
  eventId: Id;
  ids: readonly Id[];
  actor: DecisionActor;
  action: BulkAction;
  feedbackMd?: string | null;
  waveId?: Id | null;
  operationId: Id;
  now?: number;
}

export interface BulkDecisionResult {
  operationId: Id;
  selected: number;
  results: SubmissionDecisionResult[];
  outboxEnqueued: number;
}

export type AcceptanceReversalChoice = "cancel" | "retain";

export interface AcceptanceReversalInput {
  calendar: AcceptanceReversalChoice;
  db: D1Database;
  emails: AcceptanceReversalChoice;
  eventId: Id;
  actor: DecisionActor;
  outcome: "withdrawn" | "rejected";
  queue: Queue<unknown>;
  submissionId: Id;
  tasks: AcceptanceReversalChoice;
  now?: number;
  origin?: string;
  /** Only the authenticated smoke harness may use the live G3 calendar path. */
  smokeHarness?: boolean;
}

export interface AcceptanceReversalResult {
  calendarCancelled: number;
  emailsCancelled: number;
  id: Id;
  outcome: "succeeded" | "failed";
  resultingStatus: "withdrawn" | "rejected" | null;
  tasksCancelled: number;
  error?: string;
}

interface SubmissionContext {
  id: Id;
  event_id: Id;
  status: string;
  wave_id: Id | null;
  title: string;
  person_id: Id;
  person_name: string;
  person_email: string;
}

interface TaskCandidate {
  existing_cancelled_at: number | null;
  existing_status: "open" | "done" | null;
  task_id: Id | null;
  template_id: Id;
  submission_id: Id;
  person_id: Id;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number;
}

function taskCancellationReason(outcome: "withdrawn" | "rejected"): string {
  return outcome === "withdrawn"
    ? "This talk was withdrawn from the conference."
    : "This talk was rejected by the conference.";
}

const DECISION_TARGETS = {
  accept: { decision: "approve", status: "accepted" },
  waitlist: { decision: "maybe", status: "waitlisted" },
  reject: { decision: "deny", status: "rejected" },
} as const;

/**
 * Every status an organizer can still decide from. `withdrawn` and `rejected`
 * are both outcomes the ORGANISER selects in the reversal dialog, not states a
 * speaker puts themselves into, so neither is terminal: reversing a decision by
 * mistake, or reconsidering later, has to have a way back. Re-acceptance is
 * safe to re-run because it reconciles the task set idempotently rather than
 * reassigning it.
 */
const ACTIONABLE_STATUSES = new Set([
  "submitted",
  "in_review",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
]);

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizeDecisionFeedback(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\r\n?/g, "\n").trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function decisionTarget(action: DecisionAction): {
  decision: Decision;
  status: "accepted" | "waitlisted" | "rejected";
} {
  return DECISION_TARGETS[action];
}

async function loadSubmission(
  db: D1Database,
  eventId: Id,
  submissionId: Id,
): Promise<SubmissionContext | null> {
  return db
    .prepare(
      `SELECT s.id, s.event_id, s.status, s.wave_id, s.title,
              COALESCE((
                SELECT speaker.id
                FROM participations speaker_part
                JOIN people speaker ON speaker.id = speaker_part.person_id
                WHERE speaker_part.submission_id = s.id
                  AND speaker_part.role IN ('speaker', 'submitter')
                ORDER BY CASE speaker_part.role WHEN 'speaker' THEN 0 ELSE 1 END,
                         speaker_part.position ASC, speaker_part.id ASC
                LIMIT 1
              ), submitter.id) AS person_id,
              COALESCE((
                SELECT speaker.name
                FROM participations speaker_part
                JOIN people speaker ON speaker.id = speaker_part.person_id
                WHERE speaker_part.submission_id = s.id
                  AND speaker_part.role IN ('speaker', 'submitter')
                ORDER BY CASE speaker_part.role WHEN 'speaker' THEN 0 ELSE 1 END,
                         speaker_part.position ASC, speaker_part.id ASC
                LIMIT 1
              ), submitter.name) AS person_name,
              COALESCE((
                SELECT speaker.email
                FROM participations speaker_part
                JOIN people speaker ON speaker.id = speaker_part.person_id
                WHERE speaker_part.submission_id = s.id
                  AND speaker_part.role IN ('speaker', 'submitter')
                ORDER BY CASE speaker_part.role WHEN 'speaker' THEN 0 ELSE 1 END,
                         speaker_part.position ASC, speaker_part.id ASC
                LIMIT 1
              ), submitter.email) AS person_email
       FROM submissions s
       JOIN people submitter ON submitter.id = s.submitter_person_id
       WHERE s.event_id = ? AND s.id = ?`,
    )
    .bind(eventId, submissionId)
    .first<SubmissionContext>();
}

async function loadSubmissions(
  db: D1Database,
  eventId: Id,
  ids: readonly Id[],
): Promise<SubmissionContext[]> {
  if (ids.length === 0) return [];
  const idsJson = JSON.stringify([...new Set(ids)]);
  const result = await db
    .prepare(
      `SELECT s.id, s.event_id, s.status, s.wave_id, s.title,
              COALESCE((
                SELECT speaker.id
                FROM participations speaker_part
                JOIN people speaker ON speaker.id = speaker_part.person_id
                WHERE speaker_part.submission_id = s.id
                  AND speaker_part.role IN ('speaker', 'submitter')
                ORDER BY CASE speaker_part.role WHEN 'speaker' THEN 0 ELSE 1 END,
                         speaker_part.position ASC, speaker_part.id ASC
                LIMIT 1
              ), submitter.id) AS person_id,
              COALESCE((
                SELECT speaker.name
                FROM participations speaker_part
                JOIN people speaker ON speaker.id = speaker_part.person_id
                WHERE speaker_part.submission_id = s.id
                  AND speaker_part.role IN ('speaker', 'submitter')
                ORDER BY CASE speaker_part.role WHEN 'speaker' THEN 0 ELSE 1 END,
                         speaker_part.position ASC, speaker_part.id ASC
                LIMIT 1
              ), submitter.name) AS person_name,
              COALESCE((
                SELECT speaker.email
                FROM participations speaker_part
                JOIN people speaker ON speaker.id = speaker_part.person_id
                WHERE speaker_part.submission_id = s.id
                  AND speaker_part.role IN ('speaker', 'submitter')
                ORDER BY CASE speaker_part.role WHEN 'speaker' THEN 0 ELSE 1 END,
                         speaker_part.position ASC, speaker_part.id ASC
                LIMIT 1
              ), submitter.email) AS person_email
       FROM submissions s
       JOIN people submitter ON submitter.id = s.submitter_person_id
       WHERE s.event_id = ?
         AND s.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       ORDER BY s.id ASC`,
    )
    .bind(eventId, idsJson)
    .all<SubmissionContext>();
  return result.results;
}

/** Local shape adapter over the shared audit writer; the actor carries the request. */
function auditEntryFor(input: {
  eventId: Id;
  actor: DecisionActor;
  action: string;
  entityType: string;
  entityId: Id;
  before?: unknown;
  after?: unknown;
  now: number;
}): AuditEntry {
  return {
    eventId: input.eventId,
    actorKind: input.actor.kind,
    actorPersonId: input.actor.personId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before,
    after: input.after,
    now: input.now,
    requestId: input.actor.requestId,
  };
}

async function writeAudit(
  db: D1Database,
  input: {
    eventId: Id;
    actor: DecisionActor;
    action: string;
    entityType: string;
    entityId: Id;
    before?: unknown;
    after?: unknown;
    now: number;
  },
): Promise<void> {
  await writeAuditRow(db, auditEntryFor(input));
}

export async function reconcileTaskSet(
  db: D1Database,
  eventId: Id,
  submissionIds: readonly Id[],
  now: number,
  actor?: DecisionActor,
): Promise<Map<Id, number>> {
  const counts = new Map<Id, number>();
  const created = new Map<Id, number>();
  const restoredCounts = new Map<Id, number>();
  if (submissionIds.length === 0) return counts;
  // Acceptance is where the conference commits to a person, so it is where the
  // person becomes a speaker *of this event* — the membership row the roster,
  // the portal sign-in, headshot ownership, and the comms audience all read.
  // Before this, the only writer of `memberships` was the demo reseeder, and
  // every speaker the product created at runtime was invisible to all four.
  const memberships = await acceptedSpeakerMembershipStatements(db, eventId, submissionIds, now);
  if (memberships.length > 0) await db.batch(memberships);
  const idsJson = JSON.stringify([...new Set(submissionIds)]);
  const candidates = await db
    .prepare(
      `SELECT DISTINCT tt.id AS template_id, s.id AS submission_id, p.id AS person_id,
              tt.name AS title, tt.kind, tt.description,
              existing.id AS task_id, existing.status AS existing_status,
              existing.cancelled_at AS existing_cancelled_at,
              COALESCE(tt.due_at, ? + (tt.due_offset_days * 86400000)) AS due_at
       FROM task_templates tt
       JOIN submissions s ON s.event_id = tt.event_id
       JOIN participations part
         ON part.submission_id = s.id
        AND part.role IN ('speaker', 'submitter')
       JOIN people p ON p.id = part.person_id
       LEFT JOIN speaker_tasks existing
         ON existing.template_id = tt.id
        AND existing.submission_id = s.id
        AND existing.person_id = p.id
       WHERE tt.event_id = ?
         AND tt.auto_assign = 1
         AND s.status = 'accepted'
         AND s.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       ORDER BY s.id ASC, tt.position ASC, p.id ASC`,
    )
    .bind(now, eventId, idsJson)
    .all<TaskCandidate>();

  for (const candidate of candidates.results) {
    if (candidate.task_id) {
      if (candidate.existing_status === "open" && candidate.existing_cancelled_at !== null) {
        const restoredResult = await db
          .prepare(
            `UPDATE speaker_tasks
             SET cancelled_at = NULL, updated_at = ?, last_write_source = 'marquee'
             WHERE id = ? AND status = 'open' AND cancelled_at IS NOT NULL`,
          )
          .bind(now, candidate.task_id)
          .run();
        if (Number(restoredResult?.meta?.changes ?? 0) > 0) {
          counts.set(candidate.submission_id, (counts.get(candidate.submission_id) ?? 0) + 1);
          restoredCounts.set(candidate.submission_id, (restoredCounts.get(candidate.submission_id) ?? 0) + 1);
        }
      }
      continue;
    }
    await db
      .prepare(
        `INSERT INTO speaker_tasks
          (id, event_id, person_id, submission_id, template_id, title, kind,
           description, due_at, status, completed_at, response_json, attachment_id,
           last_write_source, cancelled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)`,
      )
      .bind(
        newUlid(now),
        eventId,
        candidate.person_id,
        candidate.submission_id,
        candidate.template_id,
        candidate.title,
        candidate.kind,
        candidate.description,
        candidate.due_at,
        now,
        now,
      )
      .run();
    counts.set(candidate.submission_id, (counts.get(candidate.submission_id) ?? 0) + 1);
    created.set(candidate.submission_id, (created.get(candidate.submission_id) ?? 0) + 1);
  }
  if (actor) {
    for (const submissionId of new Set([...created.keys(), ...restoredCounts.keys()])) {
      await writeAudit(db, {
        eventId,
        actor,
        action: "submission.tasks_reconciled",
        entityType: "submission",
        entityId: submissionId,
        after: {
          created: created.get(submissionId) ?? 0,
          restored: restoredCounts.get(submissionId) ?? 0,
          rows: counts.get(submissionId) ?? 0,
        },
        now,
      });
    }
  }
  return counts;
}

async function enqueueDecisionMail(
  input: {
    db: D1Database;
    queue: Queue<unknown>;
    eventId: Id;
    submission: SubmissionContext;
    status: "accepted" | "rejected";
    decision: Decision;
    feedbackMd?: string | null;
    now: number;
    entityId?: Id;
    idempotencyKey?: string;
  },
): Promise<{ id: Id | null; inserted: boolean }> {
  if (!isValidEmail(input.submission.person_email)) return { id: null, inserted: false };
  const templateKey = input.status === "accepted" ? "acceptance" : "rejection";
  const result = await enqueueTrigger({
    db: input.db,
    eventId: input.eventId,
    templateKey,
    entityId: input.entityId ?? input.submission.id,
    personId: input.submission.person_id,
    toEmail: input.submission.person_email.trim(),
    data: {
      "speaker.first_name": input.submission.person_name.trim().split(/\s+/)[0] ?? input.submission.person_name,
      "speaker.name": input.submission.person_name,
      "speaker.email": input.submission.person_email,
      "submission.title": input.submission.title,
      "decision.feedback": input.feedbackMd ?? "",
      "decision.resulting_status": input.status,
      "decision.recommendation": input.decision,
    },
    now: input.now,
    idempotencyKey: input.idempotencyKey,
  });
  if (result?.inserted) await enqueueMailMessage(input.queue, result.id);
  return { id: result?.id ?? null, inserted: result?.inserted ?? false };
}

/**
 * A deliberate retry is a new send attempt for the same recorded decision.
 * Its business entity stays the decision id, while the fresh key keeps this
 * attempt distinct from both the original decision mail and earlier retries.
 */
async function enqueueDecisionRetry(input: {
  db: D1Database;
  queue: Queue<unknown>;
  eventId: Id;
  submission: SubmissionContext;
  decisionId: Id;
  decision: Decision;
  resultingStatus: "accepted" | "rejected";
  feedbackMd: string | null;
  now: number;
}): Promise<{ id: Id | null; inserted: boolean }> {
  const templateKey = input.resultingStatus === "accepted" ? "acceptance" : "rejection";
  const retryKey = await sha256Hex(`${templateKey}:${input.decisionId}:${newUlid(input.now)}`);
  return enqueueDecisionMail({
    db: input.db,
    queue: input.queue,
    eventId: input.eventId,
    submission: input.submission,
    status: input.resultingStatus,
    decision: input.decision,
    feedbackMd: input.feedbackMd,
    entityId: input.decisionId,
    idempotencyKey: retryKey,
    now: input.now,
  });
}

export interface NotifyNotifiedResult {
  selected: number;
  queued: number;
  skippedNoAddress: number;
  remaining: number;
  nextCursor: string | null;
  outboxIds: Id[];
}

interface ExistingDecisionCandidate {
  decision_id: Id;
  submission_id: Id;
  decision: Decision;
  resulting_status: "accepted" | "rejected";
  feedback_md: string | null;
  candidate_count: number;
}

/**
 * One decision mail performs two template reads, an outbox write, and a queue
 * send. Keep the request comfortably below Workers' 1,000-subrequest ceiling;
 * callers use the cursor in the response to drain the rest.
 */
export const NOTIFY_DECISIONS_BATCH_SIZE = 200;

export interface ResendDecisionInput {
  db: D1Database;
  queue: Queue<unknown>;
  eventId: Id;
  submissionId: Id;
  actor: DecisionActor;
  now?: number;
}

export interface ResendDecisionResult {
  id: Id;
  outcome: "succeeded" | "failed";
  decisionId?: Id;
  resultingStatus?: "accepted" | "rejected";
  outboxId?: Id | null;
  outboxInserted: boolean;
  error?: string;
}

interface ResendDecisionCandidate {
  id: Id;
  decision: Decision;
  resulting_status: "accepted" | "rejected";
  feedback_md: string | null;
}

/**
 * Queue one named decision resend. This deliberately does not consult the
 * bulk-notify eligibility query: a person asked for this record by name, so a
 * prior provider acceptance must not prevent the new attempt.
 */
export async function resendSubmissionDecision(input: ResendDecisionInput): Promise<ResendDecisionResult> {
  const now = input.now ?? Date.now();
  const failed = (error: string): ResendDecisionResult => ({
    id: input.submissionId,
    outcome: "failed",
    outboxInserted: false,
    error,
  });
  const submission = await loadSubmission(input.db, input.eventId, input.submissionId);
  if (!submission) return failed("submission not found");
  if (submission.status !== "accepted" && submission.status !== "rejected") {
    return failed("only accepted or rejected decisions can be resent");
  }

  const decision = await input.db
    .prepare(
      `SELECT id, decision, resulting_status, feedback_md
       FROM submission_decisions
       WHERE event_id = ? AND submission_id = ? AND resulting_status = ?
       ORDER BY decided_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(input.eventId, input.submissionId, submission.status)
    .first<ResendDecisionCandidate>();
  if (!decision) return failed("no accepted or rejected decision exists to resend");
  if (!isValidEmail(submission.person_email)) {
    return failed("speaker has no valid email address; correct the address before resending");
  }

  const outbox = await enqueueDecisionRetry({
    db: input.db,
    queue: input.queue,
    eventId: input.eventId,
    submission,
    decisionId: decision.id,
    decision: decision.decision,
    resultingStatus: decision.resulting_status,
    feedbackMd: decision.feedback_md,
    now,
  });
  if (!outbox.id) return failed("the decision email template is disabled");

  if (outbox.inserted) {
    await writeAudit(input.db, {
      eventId: input.eventId,
      actor: input.actor,
      action: "submission.decision_mail_queued",
      entityType: "submission",
      entityId: submission.id,
      after: {
        decision_id: decision.id,
        outbox_id: outbox.id,
        resulting_status: decision.resulting_status,
        to_email: submission.person_email,
      },
      now,
    });
  }

  return {
    id: submission.id,
    outcome: "succeeded",
    decisionId: decision.id,
    resultingStatus: decision.resulting_status,
    outboxId: outbox.id,
    outboxInserted: outbox.inserted,
  };
}

/**
 * Re-send a decision without touching the decision record. The decision id is
 * the retry's business entity, while a fresh key makes every deliberate retry
 * a new outbox row rather than a duplicate of the automatic send. A cursor
 * lets one bounded operation move past queued rows without making pending
 * messages ineligible for a later deliberate retry.
 */
export async function notifyExistingDecisions(input: {
  db: D1Database;
  queue: Queue<unknown>;
  eventId: Id;
  submissionIds: readonly Id[];
  cursor?: string | null;
  now?: number;
}): Promise<NotifyNotifiedResult> {
  const ids = [...new Set(input.submissionIds)];
  if (ids.length === 0) return { selected: 0, queued: 0, skippedNoAddress: 0, remaining: 0, nextCursor: null, outboxIds: [] };
  const now = input.now ?? Date.now();
  const cursor = input.cursor?.trim() || null;
  const submissions = await loadSubmissions(input.db, input.eventId, ids);
  const submissionsById = new Map(submissions.map((submission) => [submission.id, submission]));
  const idsJson = JSON.stringify(ids);
  const candidates = await input.db
    .prepare(
      `SELECT decision.id AS decision_id, decision.submission_id, decision.decision,
              decision.resulting_status, decision.feedback_md,
              COUNT(*) OVER () AS candidate_count
       FROM submission_decisions decision
       WHERE decision.event_id = ?
         AND decision.resulting_status IN ('accepted', 'rejected')
         AND decision.submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         AND (? IS NULL OR decision.id > ?)
         AND NOT EXISTS (
           SELECT 1
           FROM submission_decisions newer
           WHERE newer.event_id = decision.event_id
             AND newer.submission_id = decision.submission_id
             AND (newer.decided_at > decision.decided_at
               OR (newer.decided_at = decision.decided_at AND newer.id > decision.id))
         )
         AND NOT EXISTS (
           SELECT 1
           FROM outbox settled
           JOIN events settled_event ON settled_event.id = settled.event_id
           WHERE settled.event_id = decision.event_id
             AND (settled.id = decision.outbox_id OR settled.entity_id = decision.id)
             AND (
               settled.status = 'sent'
               OR (
                 settled.status = 'suppressed'
                 AND settled.suppressed_reason = 'demo_mode_not_allowlisted'
                 AND settled_event.demo_mode = 1
               )
             )
         )
       ORDER BY decision.id ASC
       LIMIT ?`,
    )
    .bind(input.eventId, idsJson, cursor, cursor, NOTIFY_DECISIONS_BATCH_SIZE)
    .all<ExistingDecisionCandidate>();

  const remaining = Math.max(Number(candidates.results[0]?.candidate_count ?? 0) - candidates.results.length, 0);
  const nextCursor = remaining > 0 ? candidates.results[candidates.results.length - 1]?.decision_id ?? null : null;
  let skippedNoAddress = 0;
  let selected = 0;
  let queued = 0;
  const outboxIds: Id[] = [];
  for (const candidate of candidates.results) {
    const submission = submissionsById.get(candidate.submission_id);
    if (!submission || !isValidEmail(submission.person_email)) {
      skippedNoAddress += 1;
      continue;
    }
    selected += 1;
    const templateKey = candidate.resulting_status === "accepted" ? "acceptance" : "rejection";
    const retryKey = await sha256Hex(`${templateKey}:${candidate.decision_id}:${newUlid(now)}`);
    const result = await enqueueDecisionMail({
      db: input.db,
      queue: input.queue,
      eventId: input.eventId,
      submission,
      status: candidate.resulting_status,
      decision: candidate.decision,
      feedbackMd: candidate.feedback_md,
      entityId: candidate.decision_id,
      idempotencyKey: retryKey,
      now,
    });
    if (result.id) outboxIds.push(result.id);
    if (result.inserted) queued += 1;
  }
  return { selected, queued, skippedNoAddress, remaining, nextCursor, outboxIds };
}

export interface OnboardingCascadeResult {
  id: Id;
  outcome: "succeeded" | "failed";
  tasksAssigned: number;
  notificationsQueued: number;
  skippedNoAddress: number;
  error?: string;
}

/**
 * Explicitly resume the organizer-owned acceptance cascade after an Airtable
 * edit. Inbound mirror writes deliberately stop at the record boundary; this
 * action is the recovery door that lets a program lead opt into the derived
 * task and notification work once they have reviewed the changed record.
 */
export async function runOnboardingCascade(input: {
  db: D1Database;
  queue: Queue<unknown>;
  eventId: Id;
  submissionId: Id;
  actor: DecisionActor;
  now?: number;
}): Promise<OnboardingCascadeResult> {
  const submission = await loadSubmission(input.db, input.eventId, input.submissionId);
  if (!submission) {
    return {
      id: input.submissionId,
      outcome: "failed",
      tasksAssigned: 0,
      notificationsQueued: 0,
      skippedNoAddress: 0,
      error: "submission was not found in this conference",
    };
  }
  if (submission.status !== "accepted") {
    return {
      id: submission.id,
      outcome: "failed",
      tasksAssigned: 0,
      notificationsQueued: 0,
      skippedNoAddress: 0,
      error: "the onboarding cascade is available only for accepted submissions",
    };
  }

  const now = input.now ?? Date.now();
  const taskCounts = await reconcileTaskSet(input.db, input.eventId, [submission.id], now, input.actor);
  const tasksAssigned = taskCounts.get(submission.id) ?? 0;
  const notification = await notifyExistingDecisions({
    db: input.db,
    queue: input.queue,
    eventId: input.eventId,
    submissionIds: [submission.id],
    now,
  });
  await writeAudit(input.db, {
    eventId: input.eventId,
    actor: input.actor,
    action: "submission.onboarding_cascade_run",
    entityType: "submission",
    entityId: submission.id,
    before: { status: submission.status, last_write_source: "airtable" },
    after: {
      tasks_assigned: tasksAssigned,
      notifications_queued: notification.queued,
      skipped_no_address: notification.skippedNoAddress,
    },
    now,
  });
  return {
    id: submission.id,
    outcome: "succeeded",
    tasksAssigned,
    notificationsQueued: notification.queued,
    skippedNoAddress: notification.skippedNoAddress,
  };
}

async function updateSubmissionStatus(
  db: D1Database,
  input: {
    eventId: Id;
    ids: readonly Id[];
    targetStatus: string;
    actor: DecisionActor;
    now: number;
    waveId?: Id | null;
    preserveWave: boolean;
    decision: boolean;
    stampAttribution?: boolean;
  },
): Promise<number> {
  if (input.ids.length === 0) return 0;
  const stampAttribution = input.decision || input.stampAttribution === true;
  const updateWave = input.preserveWave
    ? input.waveId === undefined
      ? "wave_id = wave_id"
      : "wave_id = ?"
    : "wave_id = NULL";
  const bindings: unknown[] = [
    input.targetStatus,
    input.now,
    "marquee",
  ];
  if (stampAttribution) {
    bindings.push(input.now, input.actor.personId);
  }
  if (input.preserveWave && input.waveId !== undefined) bindings.push(input.waveId);
  bindings.push(input.eventId);
  const result = await runBulkByIds(input.ids, (idsJson) =>
    db
      .prepare(
        `UPDATE submissions
         SET status = ?,
             updated_at = ?,
             last_write_source = ?,
             ${stampAttribution ? "decided_at = ?, decided_by_person_id = ?," : ""}
             ${updateWave}
         WHERE event_id = ?
           AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           AND status <> ?`,
      )
      .bind(...bindings, idsJson, input.targetStatus),
  );
  return Number(result?.meta?.changes ?? 0);
}

async function insertDecisions(
  db: D1Database,
  eventId: Id,
  transitions: Array<{
    id: Id;
    submissionId: Id;
    decision: Decision;
    status: "accepted" | "waitlisted" | "rejected";
    feedbackMd: string | null;
    actor: DecisionActor;
    decidedAt: number;
    outboxId: Id | null;
  }>,
): Promise<void> {
  if (transitions.length === 0) return;
  await db.batch(
    transitions.map((transition) =>
      db
        .prepare(
          `INSERT INTO submission_decisions
            (id, event_id, submission_id, decision, resulting_status, feedback_md,
             decided_by_person_id, decided_at, outbox_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          transition.id,
          eventId,
          transition.submissionId,
          transition.decision,
          transition.status,
          transition.feedbackMd,
          transition.actor.personId,
          transition.decidedAt,
          transition.outboxId,
          transition.decidedAt,
          transition.decidedAt,
        ),
    ),
  );
}

export async function cancelTaskSet(
  db: D1Database,
  eventId: Id,
  submissionId: Id,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE speaker_tasks
       SET cancelled_at = ?, updated_at = ?, last_write_source = 'marquee'
       WHERE event_id = ?
         AND submission_id = ?
         AND status = 'open'
         AND cancelled_at IS NULL`,
    )
    .bind(now, now, eventId, submissionId)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

export async function suppressQueuedSubmissionEmails(
  db: D1Database,
  eventId: Id,
  submissionId: Id,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE outbox
       SET status = 'suppressed', suppressed_reason = 'acceptance_reversed', updated_at = ?
       WHERE event_id = ?
         AND entity_id = ?
         AND ics_body IS NULL
         AND status = 'queued'`,
    )
    .bind(now, eventId, submissionId)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

function reversalFailure(id: Id, error: string): AcceptanceReversalResult {
  return {
    id,
    outcome: "failed",
    resultingStatus: null,
    tasksCancelled: 0,
    emailsCancelled: 0,
    calendarCancelled: 0,
    error,
  };
}

/**
 * Reverse an accepted submission through the same record-owned cascade. The
 * three choices are persisted as row-level effects; no branch merely toggles
 * a UI flag. Calendar cancellation runs before the agenda row is removed so
 * the shared UID/SEQUENCE invite lifecycle remains available to the builder.
 */
export async function writeAcceptanceReversal(
  input: AcceptanceReversalInput,
): Promise<AcceptanceReversalResult> {
  const now = input.now ?? Date.now();
  const submission = await loadSubmission(input.db, input.eventId, input.submissionId);
  if (!submission) return reversalFailure(input.submissionId, "submission not found");
  if (submission.status !== "accepted") {
    return reversalFailure(submission.id, `submission is ${submission.status}; only accepted submissions can be reversed`);
  }

  const changed = await updateSubmissionStatus(input.db, {
    eventId: input.eventId,
    ids: [submission.id],
    targetStatus: input.outcome,
    actor: input.actor,
    now,
    preserveWave: false,
    decision: false,
    stampAttribution: true,
  });
  if (changed !== 1) return reversalFailure(submission.id, "submission changed during reversal; retry the confirmed action");

  const cancellationReason = input.tasks === "cancel" ? taskCancellationReason(input.outcome) : null;
  const tasksCancelled = cancellationReason
    ? await cancelTaskSet(input.db, input.eventId, submission.id, now)
    : 0;
  const emailsCancelled = input.emails === "cancel"
    ? await suppressQueuedSubmissionEmails(input.db, input.eventId, submission.id, now)
    : 0;
  const calendarDeliveries = input.calendar === "cancel"
    ? await cancelCalendarInvites({
      db: input.db,
      eventId: input.eventId,
      origin: input.origin,
      queue: input.queue,
      submissionId: submission.id,
      now,
      smokeHarness: input.smokeHarness,
    })
    : [];

  await input.db
    .prepare("DELETE FROM agenda_items WHERE event_id = ? AND submission_id = ?")
    .bind(input.eventId, submission.id)
    .run();

  if (input.outcome === "rejected") {
    await insertDecisions(input.db, input.eventId, [{
      id: newUlid(now),
      submissionId: submission.id,
      decision: "deny",
      status: "rejected",
      feedbackMd: null,
      actor: input.actor,
      decidedAt: now,
      outboxId: null,
    }]);
  }

  const effects = {
    tasks: input.tasks,
    emails: input.emails,
    calendar: input.calendar,
    tasks_cancelled: tasksCancelled,
    emails_cancelled: emailsCancelled,
    calendar_cancelled: calendarDeliveries.length,
    task_cancellation_reason: cancellationReason,
  };
  await writeAudit(input.db, {
    eventId: input.eventId,
    actor: input.actor,
    action: "submission.acceptance_reversed",
    entityType: "submission",
    entityId: submission.id,
    before: { status: submission.status },
    after: { status: input.outcome, ...effects },
    now,
  });
  await writeAudit(input.db, {
    eventId: input.eventId,
    actor: input.actor,
    action: `submission.tasks_${input.tasks === "cancel" ? "cancelled" : "retained"}`,
    entityType: "submission",
    entityId: submission.id,
    after: {
      choice: input.tasks,
      reason: cancellationReason ?? "Open tasks were kept active after acceptance reversal.",
      rows: tasksCancelled,
    },
    now,
  });
  await writeAudit(input.db, {
    eventId: input.eventId,
    actor: input.actor,
    action: `submission.emails_${input.emails === "cancel" ? "cancelled" : "retained"}`,
    entityType: "submission",
    entityId: submission.id,
    after: { choice: input.emails, rows: emailsCancelled },
    now,
  });
  await writeAudit(input.db, {
    eventId: input.eventId,
    actor: input.actor,
    action: `submission.calendar_${input.calendar === "cancel" ? "cancelled" : "retained"}`,
    entityType: "submission",
    entityId: submission.id,
    after: { choice: input.calendar, rows: calendarDeliveries.length },
    now,
  });

  return {
    id: submission.id,
    outcome: "succeeded",
    resultingStatus: input.outcome,
    tasksCancelled,
    emailsCancelled,
    calendarCancelled: calendarDeliveries.length,
  };
}

function failureResult(id: Id, error: string): SubmissionDecisionResult {
  return {
    id,
    outcome: "failed",
    resultingStatus: null,
    outboxInserted: false,
    tasksAssigned: 0,
    error,
  };
}

function canTransition(submission: SubmissionContext, targetStatus: string): string | null {
  if (!ACTIONABLE_STATUSES.has(submission.status)) {
    return `submission is ${submission.status} and cannot be decided`;
  }
  if (submission.status === targetStatus) return `submission is already ${targetStatus}`;
  return null;
}

/**
 * The one record-owned decision writer. Bulk uses the same transition rules,
 * decision row shape, outbox trigger, and acceptance-task cascade below.
 */
export async function writeSubmissionDecision(
  input: SubmissionDecisionInput,
): Promise<SubmissionDecisionResult> {
  const now = input.now ?? Date.now();
  const feedbackMd = normalizeDecisionFeedback(input.feedbackMd);
  const target = decisionTarget(input.recommendation === "approve" ? "accept" : input.recommendation === "maybe" ? "waitlist" : "reject");
  const submission = await loadSubmission(input.db, input.eventId, input.submissionId);
  if (!submission) return failureResult(input.submissionId, "submission not found");
  const invalidState = canTransition(submission, target.status);
  if (invalidState) return failureResult(submission.id, invalidState);
  if (target.status !== "waitlisted" && !isValidEmail(submission.person_email)) {
    return failureResult(submission.id, "speaker has no valid email address; record was left unchanged");
  }

  const changed = await updateSubmissionStatus(input.db, {
    eventId: input.eventId,
    ids: [submission.id],
    targetStatus: target.status,
    actor: input.actor,
    now,
    waveId: input.waveId,
    preserveWave: target.status === "accepted",
    decision: true,
  });
  if (changed !== 1) {
    return failureResult(submission.id, "submission changed during decision; retry the confirmed action");
  }

  const mail = target.status === "waitlisted"
    ? { id: null, inserted: false }
    : await enqueueDecisionMail({
      db: input.db,
      queue: input.queue,
      eventId: input.eventId,
      submission,
      status: target.status === "accepted" ? "accepted" : "rejected",
      decision: target.decision,
      feedbackMd,
      now,
    });
  const taskCounts = target.status === "accepted"
    ? await reconcileTaskSet(input.db, input.eventId, [submission.id], now, input.actor)
    : new Map<Id, number>();
  const decisionId = newUlid(now);
  await insertDecisions(input.db, input.eventId, [{
    id: decisionId,
    submissionId: submission.id,
    decision: target.decision,
    status: target.status,
    feedbackMd,
    actor: input.actor,
    decidedAt: now,
    outboxId: mail.id,
  }]);
  await writeAudit(input.db, {
    eventId: input.eventId,
    actor: input.actor,
    action: `submission.${target.decision}`,
    entityType: "submission",
    entityId: submission.id,
    before: { status: submission.status },
    after: { status: target.status, decision_id: decisionId, operation_id: input.operationId ?? null },
    now,
  });
  if (mail.inserted && mail.id !== null) {
    // "Mail sent" on the timeline (MRQ-211), worded as what actually happened:
    // the message is QUEUED here and the send is the consumer's own later fact.
    // A row claiming it was sent would be the timeline's first lie, on the one
    // moment a speaker will quote back at an organizer.
    await writeAudit(input.db, {
      eventId: input.eventId,
      actor: input.actor,
      action: "submission.decision_mail_queued",
      entityType: "submission",
      entityId: submission.id,
      after: { outbox_id: mail.id, status: target.status },
      now,
    });
  }
  return {
    id: submission.id,
    outcome: "succeeded",
    resultingStatus: target.status,
    decisionId,
    outboxId: mail.id,
    outboxInserted: mail.inserted,
    tasksAssigned: taskCounts.get(submission.id) ?? 0,
  };
}

/** Apply a server-selected ID set with one set-based status write and shared cascades. */
export async function writeBulkSubmissionDecisions(
  input: BulkDecisionInput,
): Promise<BulkDecisionResult> {
  const now = input.now ?? Date.now();
  const feedbackMd = normalizeDecisionFeedback(input.feedbackMd);
  const ids = [...new Set(input.ids)];
  const submissions = await loadSubmissions(input.db, input.eventId, ids);
  const byId = new Map(submissions.map((submission) => [submission.id, submission]));
  const results: SubmissionDecisionResult[] = [];
  const eligible: SubmissionContext[] = [];
  const target = input.action === "withdraw" ? null : decisionTarget(input.action);

  for (const id of ids) {
    const submission = byId.get(id);
    if (!submission) {
      results.push(failureResult(id, "submission not found"));
      continue;
    }
    const invalidState = canTransition(submission, target?.status ?? "withdrawn");
    if (invalidState) {
      results.push(failureResult(id, invalidState));
      continue;
    }
    if (target && target.status !== "waitlisted" && !isValidEmail(submission.person_email)) {
      results.push(failureResult(id, "speaker has no valid email address; record was left unchanged"));
      continue;
    }
    eligible.push(submission);
  }

  if (eligible.length === 0) {
    await writeAudit(input.db, {
      eventId: input.eventId,
      actor: input.actor,
      action: `bulk.${input.action}`,
      entityType: "bulk_submission_decision",
      entityId: input.operationId,
      after: { selected: ids.length, succeeded: 0, failed: results.length, results },
      now,
    });
    return { operationId: input.operationId, selected: ids.length, results, outboxEnqueued: 0 };
  }

  const targetStatus = target?.status ?? "withdrawn";
  await updateSubmissionStatus(input.db, {
    eventId: input.eventId,
    ids: eligible.map((submission) => submission.id),
    targetStatus,
    actor: input.actor,
    now,
    waveId: input.waveId,
    preserveWave: targetStatus === "accepted",
    decision: target !== null,
  });

  const transitions: Array<{
    id: Id;
    submissionId: Id;
    decision: Decision;
    status: "accepted" | "waitlisted" | "rejected";
    feedbackMd: string | null;
    actor: DecisionActor;
    decidedAt: number;
    outboxId: Id | null;
  }> = [];
  let outboxEnqueued = 0;
  const acceptedIds: Id[] = [];
  const mailById = new Map<Id, { id: Id | null; inserted: boolean }>();

  for (const submission of eligible) {
    if (!target) {
      results.push({
        id: submission.id,
        outcome: "succeeded",
        resultingStatus: "withdrawn",
        outboxInserted: false,
        tasksAssigned: 0,
      });
      continue;
    }
    const mail = target.status === "waitlisted"
      ? { id: null, inserted: false }
      : await enqueueDecisionMail({
        db: input.db,
        queue: input.queue,
        eventId: input.eventId,
        submission,
        status: target.status === "accepted" ? "accepted" : "rejected",
        decision: target.decision,
        feedbackMd,
        now,
      });
    mailById.set(submission.id, mail);
    if (mail.inserted) outboxEnqueued += 1;
    if (target.status === "accepted") acceptedIds.push(submission.id);
    transitions.push({
      id: newUlid(now),
      submissionId: submission.id,
      decision: target.decision,
      status: target.status,
      feedbackMd,
      actor: input.actor,
      decidedAt: now,
      outboxId: mail.id,
    });
  }

  await insertDecisions(input.db, input.eventId, transitions);
  const taskCounts = await reconcileTaskSet(input.db, input.eventId, acceptedIds, now, input.actor);
  for (const submission of eligible) {
    const transition = transitions.find((item) => item.submissionId === submission.id);
    if (!target) continue;
    const mail = mailById.get(submission.id) ?? { id: null, inserted: false };
    results.push({
      id: submission.id,
      outcome: "succeeded",
      resultingStatus: target.status,
      decisionId: transition?.id,
      outboxId: mail.id,
      outboxInserted: mail.inserted,
      tasksAssigned: taskCounts.get(submission.id) ?? 0,
    });
  }

  await input.db.batch(
    eligible.map((submission) =>
      auditStatement(
        input.db,
        auditEntryFor({
          eventId: input.eventId,
          actor: input.actor,
          action: `bulk.${input.action}`,
          entityType: "submission",
          entityId: submission.id,
          before: { status: submission.status },
          after: { status: targetStatus, operation_id: input.operationId },
          now,
        }),
      ),
    ),
  );
  await writeAudit(input.db, {
    eventId: input.eventId,
    actor: input.actor,
    action: `bulk.${input.action}.summary`,
    entityType: "bulk_submission_decision",
    entityId: input.operationId,
    after: {
      selected: ids.length,
      succeeded: results.filter((result) => result.outcome === "succeeded").length,
      failed: results.filter((result) => result.outcome === "failed").length,
    },
    now,
  });
  return { operationId: input.operationId, selected: ids.length, results, outboxEnqueued };
}
