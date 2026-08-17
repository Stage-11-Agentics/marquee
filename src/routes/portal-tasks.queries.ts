/**
 * The portal's task projection — one derivation, two portals.
 *
 * The speaker portal reads the tasks assigned to one person; the sponsor portal
 * reads the tasks grouped under one sponsorship, whoever they are assigned to.
 * That is the only difference, and it is a scope predicate. Everything else — the
 * per-kind payload, the file-version batch read, the derived `overdue`, the
 * cancellation reason — is identical, and identical is the point: two copies of
 * this is how a payload fix lands on one portal and quietly misses the other.
 */

import { parseUploadOwnerConfig, policyFor } from "../lib/r2/policy";
import { listVersionsForOwners, type FileVersionList } from "../lib/files/versions";
import { readStoredAnswerValue } from "../lib/stored-answer";
import { readTaskFileConfig } from "../lib/task-template-config";
import { isTaskOverdue } from "../lib/task-due";
import { isFieldApplicable, projectApplicableAnswers, type FormLengthRule } from "../lib/form-conditions";
import { listFormFields, listFormLengthRules, type FormFieldView } from "./forms.queries";

export interface PortalTaskEvent {
  id: string;
  timezone: string;
}

/**
 * Whose work this is. `person` is the speaker seat's own list; `sponsorship` is
 * the whole deal's list, because every contact sees every deliverable with its
 * assignee named (sponsors-design §5.2 ruling 1).
 */
export type PortalTaskScope =
  | { kind: "person"; personId: string }
  | { kind: "sponsorship"; sponsorshipId: string };

export interface PortalTaskRow {
  id: string;
  event_id: string;
  person_id: string;
  submission_id: string | null;
  sponsorship_id: string | null;
  submission_title: string | null;
  submission_status: string | null;
  template_id: string;
  template_due_at: number | null;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number;
  status: "open" | "done";
  completed_at: number | null;
  completed_by_person_id: string | null;
  completed_by_name: string | null;
  assignee_name: string;
  cancelled_at: number | null;
  response_json: string | null;
  attachment_id: string | null;
  form_id: string | null;
  file_config: string | null;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseObject(value: string | null | undefined): Record<string, unknown> {
  const parsed = parseJson<unknown>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function readStoredAnswer(row: { value_json: string | null; value_text: string | null }): unknown {
  return readStoredAnswerValue(row) ?? "";
}

export async function readSubmissionAnswers(
  db: D1Database,
  submissionId: string | null,
): Promise<Record<string, unknown>> {
  if (!submissionId) return {};
  const rows = await db
    .prepare(
      `SELECT field.key, answer.value_json, answer.value_text
       FROM submission_answers answer
       JOIN form_fields field ON field.id = answer.field_id
       WHERE answer.submission_id = ?`,
    )
    .bind(submissionId)
    .all<{ key: string; value_json: string | null; value_text: string | null }>();
  return Object.fromEntries(rows.results.map((row) => [row.key, readStoredAnswer(row)]));
}

export function taskPayload(
  task: Pick<PortalTaskRow, "kind" | "response_json" | "file_config" | "attachment_id" | "form_id">,
  fields: FormFieldView[],
  answers: Record<string, unknown>,
  versions: FileVersionList | null,
  lengthRules: readonly FormLengthRule[] = [],
): Record<string, unknown> {
  if (task.kind === "acknowledge") {
    return { kind: task.kind, acknowledged: parseObject(task.response_json).acknowledged === true };
  }
  if (task.kind === "file") {
    const config = parseUploadOwnerConfig(task.file_config);
    const policy = policyFor("task_upload", config);
    const editedConfig = readTaskFileConfig(task.file_config);
    const accept = editedConfig?.accept ?? policy?.rules.map((rule) => rule.extension) ?? [];
    // The person needs to see WHAT they uploaded, not just that something
    // happened: a bare checkmark is indistinguishable from a lost file.
    return {
      kind: task.kind,
      attachment_id: task.attachment_id,
      accept,
      max_bytes: editedConfig?.maxBytes ?? policy?.maxBytes ?? null,
      versions: versions?.versions ?? [],
      latest: versions?.latest ?? null,
      version_count: versions?.version_count ?? 0,
      latest_source: versions?.latest_source ?? "pointer",
    };
  }
  const projection = projectApplicableAnswers(fields, answers, lengthRules);
  return {
    kind: task.kind,
    form_id: task.form_id,
    fields: fields
      .filter((field) => isFieldApplicable(field, answers))
      .map((field) => ({
        key: field.key,
        label: field.label,
        help_text: field.help_text,
        type: field.type,
        required: field.required,
        position: field.position,
        config: field.config,
        condition: field.condition,
        value: projection.answers[field.key] ?? null,
      })),
    answers: projection.answers,
  };
}

/**
 * Why a cancelled deliverable vanished, in one sentence, from the audit row the
 * cancelling act wrote. Two entity kinds because two things cancel work: a talk
 * leaving the program, and a placement leaving a sponsorship package.
 */
async function cancellationReasons(
  db: D1Database,
  eventId: string,
  entityType: "submission" | "sponsorship",
  action: string,
): Promise<Map<string, string>> {
  const rows = await db
    .prepare(
      `SELECT entity_id, after_json
       FROM audit_log
       WHERE event_id = ? AND entity_type = ? AND action = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .bind(eventId, entityType, action)
    .all<{ entity_id: string; after_json: string | null }>();
  const reasons = new Map<string, string>();
  for (const audit of rows.results) {
    if (reasons.has(audit.entity_id)) continue;
    const reason = parseObject(audit.after_json).reason;
    if (typeof reason === "string" && reason.length > 0) reasons.set(audit.entity_id, reason);
  }
  return reasons;
}

export async function listPortalTasks(
  db: D1Database,
  event: PortalTaskEvent,
  scope: PortalTaskScope,
  mediaPublicOrigin: string,
  mediaSigningSecret: string,
): Promise<Record<string, unknown>[]> {
  const predicate = scope.kind === "person" ? "task.person_id = ?" : "task.sponsorship_id = ?";
  const scopeBinding = scope.kind === "person" ? scope.personId : scope.sponsorshipId;
  const [rows, submissionReasons, sponsorshipReasons] = await Promise.all([
    db
      .prepare(
        `SELECT task.id, task.event_id, task.person_id, task.submission_id, task.sponsorship_id,
           submission.title AS submission_title, submission.status AS submission_status,
           task.template_id, template.due_at AS template_due_at,
           task.title, task.kind, task.description, task.due_at,
           task.status, task.completed_at, task.cancelled_at,
           task.completed_by_person_id, completer.name AS completed_by_name,
           assignee.name AS assignee_name,
           task.response_json, task.attachment_id, template.form_id, template.file_config
         FROM speaker_tasks task
         JOIN task_templates template ON template.id = task.template_id AND template.event_id = task.event_id
         JOIN people assignee ON assignee.id = task.person_id
         LEFT JOIN people completer ON completer.id = task.completed_by_person_id
         LEFT JOIN submissions submission ON submission.id = task.submission_id AND submission.event_id = task.event_id
         WHERE task.event_id = ? AND ${predicate}
         ORDER BY task.due_at ASC, task.id ASC`,
      )
      .bind(event.id, scopeBinding)
      .all<PortalTaskRow>(),
    cancellationReasons(db, event.id, "submission", "submission.tasks_cancelled"),
    // Only the sponsor seat can hold a sponsorship-cancelled deliverable, and
    // speed is a feature (R7) — the speaker path does not pay for this read.
    scope.kind === "sponsorship"
      ? cancellationReasons(db, event.id, "sponsorship", "sponsorship.tasks_cancelled")
      : Promise.resolve(new Map<string, string>()),
  ]);

  // One batched read for every file task on the page rather than one per row.
  const versionsByTask = await listVersionsForOwners(
    db,
    "task_upload",
    rows.results.filter((task) => task.kind === "file").map((task) => task.id),
    mediaPublicOrigin,
    mediaSigningSecret,
  );

  return Promise.all(rows.results.map(async (task) => {
    const fields = task.kind === "form" && task.form_id ? await listFormFields(db, task.form_id) : [];
    const lengthRules = task.kind === "form" && task.form_id ? await listFormLengthRules(db, task.form_id, fields) : [];
    const submissionAnswers = await readSubmissionAnswers(db, task.submission_id);
    const responseAnswers = task.kind === "form" ? parseObject(task.response_json) : {};
    const answers = { ...submissionAnswers, ...responseAnswers };
    const cancelled = task.cancelled_at !== null;
    return {
      id: task.id,
      submission_id: task.submission_id,
      submission_title: task.submission_title,
      sponsorship_id: task.sponsorship_id,
      template_id: task.template_id,
      title: task.title,
      kind: task.kind,
      description: task.description,
      due_at: task.due_at,
      status: task.status,
      completed_at: task.completed_at,
      // Carried for every seat, rendered by the one that needs it. The organizer
      // task view inherits it rather than growing its own query later.
      assignee: { person_id: task.person_id, name: task.assignee_name },
      completed_by: task.completed_by_person_id
        ? { person_id: task.completed_by_person_id, name: task.completed_by_name ?? "Someone at your company" }
        : null,
      cancelled_at: task.cancelled_at,
      cancelled_reason: cancelled ? cancelledReasonFor(task, submissionReasons, sponsorshipReasons) : null,
      overdue: !cancelled && task.status === "open" && isTaskOverdue({
        dueAt: task.due_at,
        templateDueAt: task.template_due_at,
        timezone: event.timezone,
      }, Date.now()),
      payload: taskPayload(task, fields, answers, versionsByTask.get(task.id) ?? null, lengthRules),
    };
  }));
}

function cancelledReasonFor(
  task: PortalTaskRow,
  submissionReasons: Map<string, string>,
  sponsorshipReasons: Map<string, string>,
): string {
  if (task.submission_id) {
    const reason = submissionReasons.get(task.submission_id);
    if (reason) return reason;
  }
  if (task.sponsorship_id) {
    const reason = sponsorshipReasons.get(task.sponsorship_id);
    if (reason) return reason;
  }
  if (task.submission_id) {
    return task.submission_status === "rejected"
      ? "This talk was rejected by the conference."
      : "This talk was withdrawn from the conference.";
  }
  return "This task is no longer needed by the conference.";
}
