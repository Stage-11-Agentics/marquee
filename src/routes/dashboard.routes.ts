import { z } from "@hono/zod-openapi";

import {
  DASHBOARD_STAGE_IDS,
  type DashboardCount,
  type DashboardSnapshot,
  type DashboardWave,
} from "../api/dashboard";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import {
  hasSpeakerTaskCancellationColumn,
  hasSpeakerTaskTemplateProvenance,
  summarizeNotNotifiedSubmissions,
  submissionStatusPredicate,
  submissionTaskPredicate,
} from "./submissions.queries";
import { visibleVenueConflicts } from "../lib/venue-disclosure";
import { localParts } from "../lib/event-time";
import { isTaskOverdue } from "../lib/task-due";
import { readAgendaBuildingComparison, readAgendaConflicts } from "./agenda.queries";
import { projectCalendarDebt } from "../jobs/calendar/projection";
import { classifyPublicationFact, readPublicationFacts } from "../lib/publication-truth";

const dashboardCountSchema = z.object({
  id: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  href: z.string(),
  note: z.string(),
});

const dashboardWaveSchema = z.object({
  id: z.string(),
  name: z.string(),
  decision_on: z.string(),
  target_count: z.number().int().nonnegative(),
  sent_at: z.number().int().nullable(),
  accepted_count: z.number().int().nonnegative(),
  href: z.string(),
});

const dashboardSnapshotSchema = z.object({
  generated_at: z.number().int(),
  pipeline: z.array(dashboardCountSchema),
  format_mix: z.array(dashboardCountSchema),
  track_pressure: z.array(dashboardCountSchema),
  waves: z.array(dashboardWaveSchema),
  attention: z.object({
    next_wave: dashboardWaveSchema.nullable(),
    unreviewed_track: dashboardCountSchema.nullable(),
    overdue_submissions: dashboardCountSchema,
    decided_not_notified: dashboardCountSchema,
    calendar_updates: dashboardCountSchema,
  }),
  metrics: z.array(dashboardCountSchema),
  task_preview: z.array(z.object({
    person_name: z.string(),
    submission_id: z.string(),
    submission_title: z.string(),
    task_title: z.string(),
    due_at: z.number().int(),
    overdue: z.boolean(),
    href: z.string(),
  })),
});

const PIPELINE_META: Readonly<Record<(typeof DASHBOARD_STAGE_IDS)[number], { label: string; note: string }>> = {
  submitted: { label: "Submitted", note: "Ready for review" },
  in_review: { label: "In review", note: "Committee work underway" },
  waved: { label: "Waved", note: "Decision wave prepared" },
  accepted: { label: "Ready to place", note: "Accepted and ready for scheduling" },
  onboarding: { label: "Onboarding", note: "Speaker work underway" },
  scheduled: { label: "Scheduled", note: "placed on the working agenda" },
  published: { label: "Published", note: "live on the public site" },
};

function submissionsHref(params: Record<string, string>): string {
  return `/submissions?${new URLSearchParams(params).toString()}`;
}

function count(value: unknown): number {
  return Number(value ?? 0);
}

function dashboardStageSql(includeCancelledAt: boolean): string {
  return DASHBOARD_STAGE_IDS.map(
    (stage) => `COUNT(DISTINCT CASE WHEN ${submissionStatusPredicate(stage, { includeCancelledAt })} THEN s.id END) AS ${stage}`,
  ).join(",\n");
}

async function readDashboardConflicts(database: D1Database, eventId: string) {
  try {
    return await readAgendaConflicts(database, eventId);
  } catch (error: unknown) {
    // Keep the dashboard's older minimal contract fixture usable; deployed
    // databases always carry the agenda and venue geography schema.
    const message = error instanceof Error ? error.message : String(error);
    if (/no such (?:table|column)/i.test(message)) return [];
    throw error;
  }
}

async function readDashboardBuildingComparison(database: D1Database, eventId: string): Promise<boolean> {
  try {
    return await readAgendaBuildingComparison(database, eventId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such (?:table|column)/i.test(message)) return false;
    throw error;
  }
}

async function hasTrackDeletedAtColumn(database: D1Database): Promise<boolean> {
  const row = await database
    .prepare("SELECT 1 AS present FROM pragma_table_info('tracks') WHERE name = 'deleted_at'")
    .first<{ present: number }>();
  return row?.present === 1;
}

async function readDashboardPublicationTruth(database: D1Database, eventId: string) {
  try {
    const truth = await readPublicationFacts(database, eventId);
    return truth.facts.map((fact) => classifyPublicationFact(fact, {
      eventId,
      publicBoundaryOpen: truth.publicBoundaryOpen,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such (?:table|column)/i.test(message)) return [];
    throw error;
  }
}

async function readDashboard(database: D1Database, eventId: string, now: number): Promise<DashboardSnapshot> {
  const includeCancelledAt = await hasSpeakerTaskCancellationColumn(database);
  const includeTemplateProvenance = await hasSpeakerTaskTemplateProvenance(database);
  const includeTrackDeletedAt = await hasTrackDeletedAtColumn(database);
  const event = await database.prepare("SELECT timezone FROM events WHERE id = ?").bind(eventId).first<{ timezone: string }>();
  const timezone = event?.timezone ?? "UTC";
  const overdueDay = localParts(now, timezone).day;
  const utcDayEnd = "(strftime('%s', date(task.due_at / 1000, 'unixepoch', '+1 day')) * 1000 - 1)";
  const taskPreviewTemplateJoin = includeTemplateProvenance
    ? "LEFT JOIN task_templates task_template ON task_template.id = task.template_id AND task_template.event_id = task.event_id"
    : "";
  const taskPreviewTemplateDue = includeTemplateProvenance ? "task_template.due_at" : "NULL";
  const taskPreviewOverdue = includeTemplateProvenance
    ? `
        (
          task_template.due_at IS NOT NULL
          AND task_template.due_at = task.due_at
          AND date(task.due_at / 1000, 'unixepoch') < ?
        )
        OR (
          (task_template.due_at IS NULL OR task_template.due_at <> task.due_at)
          AND task.due_at < ?
        )`
    : `
        (task.due_at = ${utcDayEnd} AND date(task.due_at / 1000, 'unixepoch') < ?)
        OR (task.due_at <> ${utcDayEnd} AND task.due_at < ?)`;
  const [stageResult, formatResult, trackResult, waveResult, overdueResult, unplacedResult, taskResult, agendaConflicts, showBuildingComparison, notifiedSummary, calendarDebt, publicationTruth] = await Promise.all([
    database.prepare(`
      SELECT ${dashboardStageSql(includeCancelledAt)}
      FROM submissions s
      JOIN events event ON event.id = s.event_id
      LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.event_id = s.event_id AND ai.kind = 'session'
      WHERE s.event_id = ?
    `).bind(eventId).first<Record<string, number | null>>(),
    database.prepare(`
      SELECT format.id, format.name, COUNT(DISTINCT s.id) AS count
      FROM formats format
      LEFT JOIN submissions s ON s.event_id = format.event_id AND s.format_id = format.id
      WHERE format.event_id = ?
      GROUP BY format.id, format.name, format.position
      ORDER BY format.position ASC, format.id ASC
    `).bind(eventId).all<{ id: string; name: string; count: number | null }>(),
    database.prepare(`
      SELECT track.id, track.name, COUNT(DISTINCT s.id) AS count
      FROM tracks track
      LEFT JOIN submission_tracks submission_track ON submission_track.track_id = track.id
      LEFT JOIN submissions s ON s.id = submission_track.submission_id
        AND s.event_id = track.event_id
        AND ${submissionStatusPredicate("unreviewed", { submission: "s" })}
      WHERE track.event_id = ?${includeTrackDeletedAt ? " AND track.deleted_at IS NULL" : ""}
      GROUP BY track.id, track.name, track.position
      ORDER BY count DESC, track.position ASC, track.id ASC
    `).bind(eventId).all<{ id: string; name: string; count: number | null }>(),
    database.prepare(`
      SELECT wave.id, wave.name, wave.decision_on, wave.target_count, wave.sent_at,
        COUNT(DISTINCT CASE WHEN ${submissionStatusPredicate("waved", {
          submission: "submission",
          agenda: "wave_agenda",
          includeCancelledAt,
        })} THEN submission.id END) AS accepted_count
      FROM waves wave
      LEFT JOIN submissions submission ON submission.event_id = wave.event_id AND submission.wave_id = wave.id
      LEFT JOIN agenda_items wave_agenda ON wave_agenda.submission_id = submission.id
        AND wave_agenda.event_id = submission.event_id
        AND wave_agenda.kind = 'session'
      WHERE wave.event_id = ?
      GROUP BY wave.id, wave.name, wave.decision_on, wave.target_count, wave.sent_at, wave.position
      ORDER BY wave.position ASC, wave.id ASC
    `).bind(eventId).all<{
      id: string;
      name: string;
      decision_on: string;
      target_count: number | null;
      sent_at: number | null;
      accepted_count: number | null;
    }>(),
    database.prepare(`
      SELECT COUNT(DISTINCT s.id) AS count
      FROM submissions s
      WHERE s.event_id = ? AND ${submissionTaskPredicate("overdue", "s", includeCancelledAt, includeTemplateProvenance)}
    `).bind(eventId, overdueDay, now).first<{ count: number | null }>(),
    database.prepare(`
      SELECT COUNT(DISTINCT s.id) AS count
      FROM submissions s
      LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.event_id = s.event_id AND ai.kind = 'session'
      WHERE s.event_id = ?
        AND ${submissionStatusPredicate("accepted_any", { includeCancelledAt })}
        AND ai.id IS NULL
    `).bind(eventId).first<{ count: number | null }>(),
    database.prepare(`
      SELECT person.name AS person_name, submission.id AS submission_id, submission.title AS submission_title,
        task.title AS task_title, task.due_at, ${taskPreviewTemplateDue} AS template_due_at
      FROM speaker_tasks task
      ${taskPreviewTemplateJoin}
      JOIN people person ON person.id = task.person_id
      JOIN submissions submission ON submission.id = task.submission_id
      WHERE task.event_id = ? AND task.status = 'open'${includeCancelledAt ? " AND task.cancelled_at IS NULL" : ""}
      ORDER BY CASE WHEN (
        ${taskPreviewOverdue}
      ) THEN 0 ELSE 1 END, task.due_at ASC, task.id ASC
      LIMIT 4
    `).bind(eventId, overdueDay, now).all<{
      person_name: string;
      submission_id: string;
      submission_title: string;
      task_title: string;
      due_at: number;
      template_due_at: number | null;
    }>(),
    readDashboardConflicts(database, eventId),
    readDashboardBuildingComparison(database, eventId),
    summarizeNotNotifiedSubmissions(database, eventId),
    projectCalendarDebt(database, eventId),
    readDashboardPublicationTruth(database, eventId),
  ]);

  const stages = stageResult ?? {};
  const pipeline = DASHBOARD_STAGE_IDS.map((id) => ({
    id,
    label: PIPELINE_META[id].label,
    count: count(stages[id]),
    href: submissionsHref({ status: id }),
    note: PIPELINE_META[id].note,
  }));
  const formatMix = formatResult.results.map((row) => ({
    id: row.id,
    label: row.name,
    count: count(row.count),
    href: submissionsHref({ format: row.id }),
    note: "submissions",
  }));
  const trackPressure = trackResult.results.map((row) => ({
    id: row.id,
    label: row.name,
    count: count(row.count),
    href: submissionsHref({ status: "unreviewed", track: row.id }),
    note: "unreviewed",
  }));
  const waves: DashboardWave[] = waveResult.results.map((row) => ({
    id: row.id,
    name: row.name,
    decision_on: row.decision_on,
    target_count: count(row.target_count),
    sent_at: row.sent_at,
    accepted_count: count(row.accepted_count),
    href: submissionsHref({ status: "waved", wave: row.id }),
  }));
  const overdueSubmissions: DashboardCount = {
    id: "overdue",
    label: "Tasks overdue",
    count: count(overdueResult?.count),
    href: submissionsHref({ task: "overdue" }),
    note: "submissions with speaker work overdue",
  };
  const decidedNotNotified: DashboardCount = {
    id: "decided-not-notified",
    label: "Decided · not notified",
    count: notifiedSummary.sendable,
    href: submissionsHref({ status: "not_notified" }),
    note: notifiedSummary.sendable === 0 && notifiedSummary.no_valid_address === 0
      ? "Every decision has reached its speaker"
      : `${notifiedSummary.sendable.toLocaleString()} can be notified now · ${notifiedSummary.no_valid_address.toLocaleString()} need an address first`,
  };
  const unplaced: DashboardCount = {
    id: "unplaced",
    label: "Unscheduled",
    count: count(unplacedResult?.count),
    href: submissionsHref({ status: "accepted_any", placement: "unplaced" }),
    note: "accepted records not yet on the agenda",
  };
  const unreviewedTrack = trackPressure.find((item) => item.count > 0) ?? null;
  const visibleAgendaConflicts = visibleVenueConflicts(agendaConflicts, showBuildingComparison);
  const conflictSessionCount = new Set(visibleAgendaConflicts.flatMap((conflict) => conflict.session_ids)).size;
  const conflicts: DashboardCount = {
    id: "conflicts",
    label: "Conflicts",
    count: visibleAgendaConflicts.length,
    href: "/agenda-builder",
    note: `${conflictSessionCount} affected Sessions · live`,
  };
  const calendarUpdates: DashboardCount = {
    id: "calendar-updates",
    label: "Unsent schedule updates",
    count: calendarDebt.first_invite_count + calendarDebt.unsent_update_count,
    href: "/agenda-builder",
    note: calendarDebt.blocked.length > 0
      ? `${calendarDebt.blocked.length} recipient${calendarDebt.blocked.length === 1 ? "" : "s"} need an address first`
      : "open the agenda builder to send one batch per speaker",
  const publicationRows = publicationTruth as ReturnType<typeof classifyPublicationFact>[];
  const notYetPublic = publicationRows.filter((row) => row.classification === "READY_TO_PUBLISH").length;
  const liveOnSite = publicationRows.filter((row) => row.classification === "PUBLIC_LIVE").length;
  const publicationAnomalies = publicationRows.filter((row) => row.classification === "BOARD_ANOMALY").length;
  const publicationReady: DashboardCount = {
    id: "not_yet_public",
    label: "Not yet public",
    count: notYetPublic,
    href: submissionsHref({ kind: "session", status: "not_yet_public" }),
    note: "scheduled and ready to publish",
  };
  const liveOnSiteMetric: DashboardCount = {
    id: "live_on_site",
    label: "Live on site",
    count: liveOnSite,
    href: submissionsHref({ kind: "session", status: "live_on_site" }),
    note: publicationAnomalies > 0
      ? `${publicationAnomalies} published Session${publicationAnomalies === 1 ? "" : "s"} reversed after publish`
      : "accepted Sessions visible on the public site",
  };

  return {
    generated_at: now,
    pipeline,
    format_mix: formatMix,
    track_pressure: trackPressure,
    waves,
    attention: {
      next_wave: waves.find((wave) => wave.sent_at === null) ?? null,
      unreviewed_track: unreviewedTrack,
      overdue_submissions: overdueSubmissions,
      decided_not_notified: decidedNotNotified,
      calendar_updates: calendarUpdates,
    },
    metrics: [
      pipeline.find((item) => item.id === "in_review")!,
      overdueSubmissions,
      unplaced,
      conflicts,
      publicationReady,
      liveOnSiteMetric,
    ],
    task_preview: taskResult.results.map((row) => {
      const task = includeTemplateProvenance
        ? { dueAt: row.due_at, templateDueAt: row.template_due_at, timezone }
        : { dueAt: row.due_at, timezone };
      const overdue = isTaskOverdue(task, now);
      return {
        person_name: row.person_name,
        submission_id: row.submission_id,
        submission_title: row.submission_title,
        task_title: row.task_title,
        due_at: row.due_at,
        overdue,
        href: overdue
        ? submissionsHref({ task: "overdue" })
        : submissionsHref({ status: "onboarding" }),
      };
    }),
  };
}

const getDashboard = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/dashboard",
    operationId: "getProgramDashboard",
    summary: "Read the program dashboard snapshot",
    description: "One D1-derived dashboard snapshot whose counts link to their exact submission-list filters.",
    tags: ["Dashboard"],
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    request: { params: z.object({ eventId: z.string().min(1) }) },
    responses: {
      200: jsonResponse(dashboardSnapshotSchema, "Program dashboard snapshot"),
      ...errorResponses([401, 403, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    return context.json(await readDashboard(context.env.DB, eventId, Date.now()), 200);
  },
);

export const apiRoutes = [getDashboard];
