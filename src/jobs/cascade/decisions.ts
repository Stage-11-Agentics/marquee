import type { D1Database, Queue } from "@cloudflare/workers-types";

import { runBulkByIds } from "../../api/bulk";
import { newUlid } from "../../api/ids";
import type { Decision, Id } from "../../db/schema";
import { enqueueMailMessage } from "../mail/consumer";
import { enqueueTrigger } from "../mail/triggers";

export type DecisionAction = "accept" | "reject" | "waitlist";
export type BulkAction = DecisionAction | "withdraw";

export interface DecisionActor {
  kind: "user" | "api_token";
  personId: Id;
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
  template_id: Id;
  submission_id: Id;
  person_id: Id;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number;
}

const DECISION_TARGETS = {
  accept: { decision: "approve", status: "accepted" },
  waitlist: { decision: "maybe", status: "waitlisted" },
  reject: { decision: "deny", status: "rejected" },
} as const;

const ACTIONABLE_STATUSES = new Set([
  "submitted",
  "in_review",
  "accepted",
  "waitlisted",
  "rejected",
]);

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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
  await db
    .prepare(
      `INSERT INTO audit_log
        (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id,
         before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newUlid(input.now),
      input.eventId,
      input.actor.personId,
      input.actor.kind,
      input.action,
      input.entityType,
      input.entityId,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.now,
    )
    .run();
}

async function assignAcceptanceTasks(
  db: D1Database,
  eventId: Id,
  submissionIds: readonly Id[],
  now: number,
): Promise<Map<Id, number>> {
  const counts = new Map<Id, number>();
  if (submissionIds.length === 0) return counts;
  const idsJson = JSON.stringify([...new Set(submissionIds)]);
  const candidates = await db
    .prepare(
      `SELECT DISTINCT tt.id AS template_id, s.id AS submission_id, p.id AS person_id,
              tt.name AS title, tt.kind, tt.description,
              COALESCE(tt.due_at, ? + (tt.due_offset_days * 86400000)) AS due_at
       FROM task_templates tt
       JOIN submissions s ON s.event_id = tt.event_id
       JOIN participations part
         ON part.submission_id = s.id
        AND part.role IN ('speaker', 'submitter')
       JOIN people p ON p.id = part.person_id
       WHERE tt.event_id = ?
         AND tt.auto_assign = 1
         AND s.status = 'accepted'
         AND s.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         AND NOT EXISTS (
           SELECT 1 FROM speaker_tasks existing
           WHERE existing.template_id = tt.id
             AND existing.submission_id = s.id
             AND existing.person_id = p.id
         )
       ORDER BY s.id ASC, tt.position ASC, p.id ASC`,
    )
    .bind(now, eventId, idsJson)
    .all<TaskCandidate>();

  if (candidates.results.length === 0) return counts;
  await db.batch(
    candidates.results.map((candidate) =>
      db
        .prepare(
          `INSERT INTO speaker_tasks
            (id, event_id, person_id, submission_id, template_id, title, kind,
             description, due_at, status, completed_at, response_json, attachment_id,
             last_write_source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, 'marquee', ?, ?)`,
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
        ),
    ),
  );
  for (const candidate of candidates.results) {
    counts.set(candidate.submission_id, (counts.get(candidate.submission_id) ?? 0) + 1);
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
  },
): Promise<{ id: Id | null; inserted: boolean }> {
  if (!isValidEmail(input.submission.person_email)) return { id: null, inserted: false };
  const templateKey = input.status === "accepted" ? "acceptance" : "rejection";
  const result = await enqueueTrigger({
    db: input.db,
    eventId: input.eventId,
    templateKey,
    entityId: input.submission.id,
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
  });
  if (result?.inserted) await enqueueMailMessage(input.queue, result.id);
  return { id: result?.id ?? null, inserted: result?.inserted ?? false };
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
  },
): Promise<number> {
  if (input.ids.length === 0) return 0;
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
  if (input.decision) {
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
             ${input.decision ? "decided_at = ?, decided_by_person_id = ?," : ""}
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
      feedbackMd: input.feedbackMd,
      now,
    });
  const taskCounts = target.status === "accepted"
    ? await assignAcceptanceTasks(input.db, input.eventId, [submission.id], now)
    : new Map<Id, number>();
  const decisionId = newUlid(now);
  await insertDecisions(input.db, input.eventId, [{
    id: decisionId,
    submissionId: submission.id,
    decision: target.decision,
    status: target.status,
    feedbackMd: input.feedbackMd ?? null,
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
        feedbackMd: null,
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
      feedbackMd: null,
      actor: input.actor,
      decidedAt: now,
      outboxId: mail.id,
    });
  }

  await insertDecisions(input.db, input.eventId, transitions);
  const taskCounts = await assignAcceptanceTasks(input.db, input.eventId, acceptedIds, now);
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
      input.db
        .prepare(
          `INSERT INTO audit_log
            (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id,
             before_json, after_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newUlid(now),
          input.eventId,
          input.actor.personId,
          input.actor.kind,
          `bulk.${input.action}`,
          "submission",
          submission.id,
          JSON.stringify({ status: submission.status }),
          JSON.stringify({ status: targetStatus, operation_id: input.operationId }),
          now,
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
