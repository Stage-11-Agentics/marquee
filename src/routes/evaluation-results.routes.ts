/**
 * The chair's results export.
 *
 * Deliberately NOT the reviewer queue export (`/rounds/{roundId}/export`) —
 * that one lists a reviewer's *unreviewed* items and carries no scores at all.
 * A download button wired to it looks right and is useless the moment someone
 * opens the file, which is exactly the failure this route exists to avoid.
 *
 * The rows come from `listSubmissions` itself rather than a parallel query, so
 * the file carries the same records, the same derived status, the same
 * weighted score and the same reviewer count the results table shows. The only
 * columns computed here are the ones the screen does not display: per-criterion
 * means and the recommendation tally.
 */
import { z } from "@hono/zod-openapi";
import type { D1Database } from "@cloudflare/workers-types";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses } from "../api/route";
import type { SubmissionListItem } from "../api/submissions";
import { scoreBasisCell } from "../lib/review-aggregate";
import { requireProgram } from "./evaluation.routes";
import { listSubmissions } from "./submissions.queries";

const planParams = z.object({
  eventId: z.string().min(1),
  planId: z.string().min(1),
});

const exportQuery = z.object({ format: z.literal("csv").default("csv") });

interface CriterionColumn {
  id: string;
  header: string;
}

interface CriterionRow {
  submission_id: string;
  criterion_id: string;
  mean: number | null;
}

interface RecommendationRow {
  submission_id: string;
  approve_count: number;
  maybe_count: number;
  deny_count: number;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""').replaceAll("\n", " ").replaceAll("\r", " ")}"`;
}

/** Plan criteria in reading order, headed with their round so two rounds never collide. */
async function criterionColumns(db: D1Database, planId: string): Promise<CriterionColumn[]> {
  const { results } = await db.prepare(`
    SELECT criterion.id AS id, criterion.name AS name, round.name AS round_name
    FROM rubric_criteria criterion
    JOIN evaluation_rounds round ON round.id = criterion.round_id
    WHERE round.plan_id = ?
    ORDER BY round.position, criterion.position, criterion.id
  `).bind(planId).all<{ id: string; name: string; round_name: string }>();
  return results.map((row) => ({ id: row.id, header: `${row.name} (${row.round_name})` }));
}

/**
 * Mean recorded value per criterion. Matched by criterion id or name for the
 * same reason the aggregate is: the reviewer surface owns the shape of the
 * `criteria_scores` map, and non-numeric answers are excluded by the element's
 * own JSON type rather than by a declared kind.
 */
async function criterionMeans(
  db: D1Database,
  eventId: string,
): Promise<Map<string, Map<string, number>>> {
  const { results } = await db.prepare(`
    SELECT evaluation.submission_id AS submission_id,
      criterion.id AS criterion_id,
      ROUND(AVG(element.value), 2) AS mean
    FROM evaluations evaluation
    JOIN submissions submission ON submission.id = evaluation.submission_id
    JOIN people reviewer ON reviewer.id = evaluation.reviewer_person_id AND reviewer.kind = 'human'
    JOIN json_each(evaluation.criteria_scores) element
    JOIN rubric_criteria criterion
      ON criterion.round_id = evaluation.round_id
     AND (criterion.id = element.key OR lower(criterion.name) = lower(element.key))
    WHERE submission.event_id = ?
      AND evaluation.abstained = 0
      AND evaluation.criteria_scores IS NOT NULL
      AND element.type IN ('integer', 'real')
    GROUP BY evaluation.submission_id, criterion.id
  `).bind(eventId).all<CriterionRow>();
  const bySubmission = new Map<string, Map<string, number>>();
  for (const row of results) {
    if (row.mean === null) continue;
    const forSubmission = bySubmission.get(row.submission_id) ?? new Map<string, number>();
    forSubmission.set(row.criterion_id, Number(row.mean));
    bySubmission.set(row.submission_id, forSubmission);
  }
  return bySubmission;
}

/** Recommendation tally over the same non-abstained rows the aggregate counts. */
async function recommendationTallies(
  db: D1Database,
  eventId: string,
): Promise<Map<string, RecommendationRow>> {
  const { results } = await db.prepare(`
    SELECT evaluation.submission_id AS submission_id,
      SUM(CASE WHEN evaluation.recommendation = 'approve' THEN 1 ELSE 0 END) AS approve_count,
      SUM(CASE WHEN evaluation.recommendation = 'maybe' THEN 1 ELSE 0 END) AS maybe_count,
      SUM(CASE WHEN evaluation.recommendation = 'deny' THEN 1 ELSE 0 END) AS deny_count
    FROM evaluations evaluation
    JOIN submissions submission ON submission.id = evaluation.submission_id
    JOIN people reviewer ON reviewer.id = evaluation.reviewer_person_id AND reviewer.kind = 'human'
    WHERE submission.event_id = ? AND evaluation.abstained = 0
    GROUP BY evaluation.submission_id
  `).bind(eventId).all<RecommendationRow>();
  return new Map(results.map((row) => [row.submission_id, {
    submission_id: row.submission_id,
    approve_count: Number(row.approve_count ?? 0),
    maybe_count: Number(row.maybe_count ?? 0),
    deny_count: Number(row.deny_count ?? 0),
  }]));
}

/**
 * Every matching record, in the results table's own order. Paged rather than
 * capped: a chair exporting a shortlist needs the whole shortlist, and a
 * silently truncated file is the worst artifact this route could produce.
 */
async function allResultRows(db: D1Database, eventId: string): Promise<SubmissionListItem[]> {
  const rows: SubmissionListItem[] = [];
  let page = 1;
  let pages = 1;
  do {
    const envelope = await listSubmissions(db, { eventId, page, per_page: 100, sort: "score" });
    rows.push(...envelope.data);
    pages = envelope.total_pages;
    page += 1;
  } while (page <= pages);
  return rows;
}

const exportPlanResults = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/plans/{planId}/results/export",
    operationId: "exportEvaluationResults",
    summary: "Export review results as CSV",
    description:
      "One row per submission: identity, status, weighted aggregate, reviewer count, recommendation tally, and a column per scorecard criterion.",
    tags: ["Evaluation"],
    request: { params: planParams, query: exportQuery },
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: {
        content: { "text/csv": { schema: z.string() } },
        description: "Review results CSV",
      },
      ...errorResponses([400, 401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, planId } = context.req.valid("param");
    context.req.valid("query");
    requireProgram(context, eventId, false);
    await planForEventOrThrow(context.env.DB, eventId, planId);

    const [columns, means, tallies, rows] = await Promise.all([
      criterionColumns(context.env.DB, planId),
      criterionMeans(context.env.DB, eventId),
      recommendationTallies(context.env.DB, eventId),
      allResultRows(context.env.DB, eventId),
    ]);

    const header = [
      "Submission ID", "Title", "Speakers", "Tracks", "Format", "Status",
      "Weighted score", "Score basis", "Reviews", "Accept", "Maybe", "Decline",
      ...columns.map((column) => column.header),
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const item of rows) {
      const tally = tallies.get(item.id);
      const perCriterion = means.get(item.id);
      lines.push([
        item.id,
        item.title,
        item.speakers.map((speaker) => speaker.name).join("; "),
        item.tracks.map((track) => track.name).join("; "),
        item.format,
        item.status,
        item.score,
        scoreBasisCell(item.score, item.score_is_weighted),
        item.review_count,
        tally?.approve_count ?? 0,
        tally?.maybe_count ?? 0,
        tally?.deny_count ?? 0,
        ...columns.map((column) => perCriterion?.get(column.id) ?? null),
      ].map(csvCell).join(","));
    }

    return new Response(`${lines.join("\n")}\n`, {
      headers: {
        "Content-Disposition": "attachment; filename=review-results.csv",
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  },
);

/** 404 on a plan that is not this event's, before any expensive read. */
async function planForEventOrThrow(db: D1Database, eventId: string, planId: string): Promise<void> {
  const plan = await db
    .prepare("SELECT id FROM evaluation_plans WHERE id = ? AND event_id = ?")
    .bind(planId, eventId)
    .first<{ id: string }>();
  if (!plan) throw ApiError.notFound("evaluation plan not found");
}

export const apiRoutes = [exportPlanResults];
