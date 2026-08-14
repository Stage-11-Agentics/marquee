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
 * answers and the recommendation tally.
 *
 * A criterion column carries whatever KIND of answer the criterion asks for.
 * Numeric criteria average, which is the number a chair sorts on. Select and
 * text criteria cannot average, and averaging was the whole of what this route
 * did — the column was emitted for every criterion in the plan, and filled only
 * where a mean existed. So a select or text criterion was STRUCTURALLY empty:
 * not missing a value, incapable of carrying one, on every row forever.
 *
 * The source is still the scorecard. Pointing those columns at
 * `evaluations.recommendation` / `.comment` would appear to work wherever a
 * reviewer happened to fill the review row too, while answering a different
 * question than the rubric asked.
 */
import { z } from "@hono/zod-openapi";
import type { D1Database } from "@cloudflare/workers-types";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses } from "../api/route";
import type { SubmissionListItem } from "../api/submissions";
import { disambiguatedNames } from "../lib/duplicate-names";
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
  round_id: string;
  name: string;
  header: string;
  kind: "numeric" | "select" | "text";
}

/** One reviewer's answer to one criterion, as recorded. */


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
    SELECT criterion.id AS id, criterion.round_id AS round_id, criterion.name AS name, criterion.kind AS kind, round.name AS round_name
    FROM rubric_criteria criterion
    JOIN evaluation_rounds round ON round.id = criterion.round_id
    WHERE round.plan_id = ?
    ORDER BY round.position, criterion.position, criterion.id
  `).bind(planId).all<{ id: string; round_id: string; name: string; kind: string; round_name: string }>();
  return results.map((row) => ({
    id: row.id,
    round_id: row.round_id,
    name: row.name,
    header: `${row.name} (${row.round_name})`,
    kind: row.kind === "select" || row.kind === "text" ? row.kind : "numeric",
  }));
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
 * Every recorded answer to a non-numeric criterion, attributed to its reviewer.
 *
 * Attributed rather than tallied because these are the answers a chair reads
 * rather than sorts: a select criterion where one reviewer said Accept and
 * another said Maybe is exactly the disagreement the export must not flatten,
 * and a text criterion is one reviewer's reasoning and belongs to them.
 *
 * Human reviewers only, matching `criterionMeans` and `recommendationTallies`
 * either side of it. Whether this export should carry agent scorecards at all
 * is a live product question and not this fix's to answer: the separation is
 * deliberate everywhere else in the file, and quietly breaking it in one column
 * would be a change of meaning wearing a bug fix's clothes.
 *
 * The key resolution is done HERE rather than in the join, because it is a
 * precedence rule and SQL made it one that could not be stated. `criteria_scores`
 * is keyed by criterion id, and a revision preserves an older key by NAME beside
 * it; criterion ids are caller-supplied and names are not unique, so one key can
 * be criterion A's name and criterion B's id at the same time. Read as a join
 * that matches either, that key answers two columns at once and disagrees with
 * the organizer screen, which reads the id alone. Read as a rule — the id wins;
 * a name is a fallback only when the criterion has no id key at all, the name
 * belongs to exactly one criterion in the round, and the key is nobody else's id
 * — it is one answer per reviewer per criterion, and legible.
 *
 * Emptiness is judged AFTER that, not before: dropping an empty id-keyed answer
 * first would let a stale name-keyed one take its place.
 */
const ANSWER_SEPARATOR = " · ";

/**
 * Nothing inside one answer may imitate the boundary between two.
 *
 * Whitespace is collapsed FIRST. `csvCell` flattens newlines to spaces when the
 * file is written, so an answer containing a line break either side of a middot
 * carries no separator here and grows one later — a false reviewer boundary
 * built after the check that was supposed to prevent it.
 */
function answerText(value: string): string {
  return value.replace(/\s+/g, " ").split(ANSWER_SEPARATOR).join(" - ").trim();
}

interface ScorecardRow {
  submission_id: string;
  evaluation_id: string;
  round_id: string;
  reviewer_id: string;
  reviewer_name: string;
  criteria_scores: string | null;
}

interface AnswerCriterion {
  id: string;
  round_id: string;
  name: string;
}

/**
 * The answer a scorecard records for one criterion, or undefined for none.
 *
 * The name fallback excludes other criteria's ids BEFORE choosing among what is
 * left, and then insists on exactly one candidate. Choosing first and checking
 * afterwards makes the result depend on JSON property order: with `notes` also
 * being another criterion's id, `{"notes":…,"NOTES":…}` and
 * `{"NOTES":…,"notes":…}` are the same scorecard and would answer differently.
 */
function answerFor(
  scores: Record<string, unknown>,
  criterion: AnswerCriterion,
  roundCriteria: readonly AnswerCriterion[],
): unknown {
  if (Object.hasOwn(scores, criterion.id)) return scores[criterion.id];
  const name = criterion.name.toLowerCase();
  if (roundCriteria.filter((other) => other.name.toLowerCase() === name).length !== 1) return undefined;
  const candidates = Object.keys(scores).filter((key) => key.toLowerCase() === name
    // A key that is some other criterion's id is that criterion's answer,
    // whatever it also happens to spell.
    && !roundCriteria.some((other) => other.id === key));
  return candidates.length === 1 ? scores[candidates[0] as string] : undefined;
}

async function criterionAnswers(
  db: D1Database,
  eventId: string,
  columns: readonly CriterionColumn[],
): Promise<Map<string, Map<string, string[]>>> {
  const nonNumeric = columns.filter((column) => column.kind !== "numeric");
  if (nonNumeric.length === 0) return new Map();

  const { results } = await db.prepare(`
    SELECT evaluation.submission_id AS submission_id,
      evaluation.id AS evaluation_id,
      evaluation.round_id AS round_id,
      reviewer.id AS reviewer_id,
      reviewer.name AS reviewer_name,
      evaluation.criteria_scores AS criteria_scores
    FROM evaluations evaluation
    JOIN submissions submission ON submission.id = evaluation.submission_id
    JOIN people reviewer ON reviewer.id = evaluation.reviewer_person_id AND reviewer.kind = 'human'
    WHERE submission.event_id = ?
      AND evaluation.abstained = 0
      AND evaluation.criteria_scores IS NOT NULL
    ORDER BY evaluation.submission_id, reviewer.name, evaluation.id
  `).bind(eventId).all<ScorecardRow>();

  // Collected first, labelled second: the marker means "this cell shows more
  // than one person by this name", so the population is the reviewers whose
  // answers are actually printed — not every reviewer who filed a scorecard,
  // several of whom contribute nothing to any column.
  const entries: Array<{ submissionId: string; criterionId: string; reviewerId: string; reviewerName: string; text: string }> = [];
  for (const row of results) {
    let scores: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(row.criteria_scores ?? "null");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      scores = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const roundCriteria = columns.filter((column) => column.round_id === row.round_id);
    for (const column of nonNumeric) {
      if (column.round_id !== row.round_id) continue;
      const value = answerFor(scores, column, roundCriteria);
      if (value === undefined || value === null || typeof value === "object") continue;
      const text = answerText(String(value));
      if (text === "") continue;
      entries.push({
        submissionId: row.submission_id,
        criterionId: column.id,
        reviewerId: row.reviewer_id,
        // Normalised BEFORE the labels are derived. Two reviewers named
        // "Sam · Lee" and "Sam - Lee" are distinct to the helper and identical
        // once the separator is neutralised, so disambiguating first hands both
        // the same unsuffixed label.
        reviewerName: answerText(row.reviewer_name),
        text,
      });
    }
  }

  const reviewerNames = disambiguatedNames(
    [...new Map(entries.map((entry) => [entry.reviewerId, { id: entry.reviewerId, name: entry.reviewerName }])).values()],
  );
  const bySubmission = new Map<string, Map<string, string[]>>();
  for (const entry of entries) {
    const forSubmission = bySubmission.get(entry.submissionId) ?? new Map<string, string[]>();
    const answers = forSubmission.get(entry.criterionId) ?? [];
    const name = reviewerNames.get(entry.reviewerId) ?? entry.reviewerName;
    answers.push(`${name}: ${entry.text}`);
    forSubmission.set(entry.criterionId, answers);
    bySubmission.set(entry.submissionId, forSubmission);
  }
  return bySubmission;
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
      "One row per submission: identity, status, weighted aggregate, reviewer count, recommendation tally, and a column per scorecard criterion — numeric criteria averaged over human reviewers, select and text criteria carrying each human reviewer's recorded answer attributed to them.",
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

    const columns = await criterionColumns(context.env.DB, planId);
    const [means, answers, tallies, rows] = await Promise.all([
      criterionMeans(context.env.DB, eventId),
      criterionAnswers(context.env.DB, eventId, columns),
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
      const perCriterionAnswers = answers.get(item.id);
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
        ...columns.map((column) => (column.kind === "numeric"
          ? perCriterion?.get(column.id) ?? null
          : perCriterionAnswers?.get(column.id)?.join(ANSWER_SEPARATOR) ?? null)),
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
