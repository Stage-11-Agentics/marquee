/**
 * The annotations log, folded.
 *
 * `person_events` is append-only and carries three kinds — `note`, `tag`, and
 * `stage`. Nothing is ever updated or deleted, so current state is a fold over
 * the log and the log itself is the activity feed and the stage history. These
 * are the pure halves of that fold: the SQL in `people.queries.ts` does the same
 * thing set-at-a-time for a page of rows, and these serve one person's drawer.
 */

export const PERSON_EVENT_KINDS = ["note", "tag", "stage"] as const;
export type PersonEventKind = (typeof PERSON_EVENT_KINDS)[number];

/**
 * The six sourcing stages, in board order, including the two terminal ones.
 * `open` stages are the ones a prospect can be enrolled at.
 */
export const PIPELINE_STAGES = [
  { id: "researching", name: "Researching", kind: "open" },
  { id: "identified", name: "Identified", kind: "open" },
  { id: "contacted", name: "Contacted", kind: "open" },
  { id: "interested", name: "Interested", kind: "open" },
  { id: "confirmed", name: "Confirmed", kind: "won" },
  { id: "declined", name: "Declined", kind: "lost" },
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]["id"];

export const PIPELINE_STAGE_IDS = PIPELINE_STAGES.map((stage) => stage.id) as readonly PipelineStageId[];

export function pipelineStageName(id: string): string {
  return PIPELINE_STAGES.find((stage) => stage.id === id)?.name ?? id;
}

export interface PersonEventRow {
  id: string;
  person_id: string;
  kind: string;
  value_json: string;
  actor_person_id: string | null;
  actor_name?: string | null;
  created_at: number;
}

export interface PersonNote {
  id: string;
  body: string;
  actor_person_id: string | null;
  actor_name: string | null;
  created_at: number;
}

export interface PersonStageEntry {
  id: string;
  stage: string;
  stage_name: string;
  score: number | null;
  rationale: string | null;
  actor_person_id: string | null;
  actor_name: string | null;
  created_at: number;
}

function value(row: PersonEventRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.value_json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    // A row whose payload cannot be read is still a row that happened. It is
    // skipped by the readers below rather than throwing the whole drawer away.
    return {};
  }
}

function text(input: unknown): string | null {
  return typeof input === "string" && input.length > 0 ? input : null;
}

/** Notes, newest first. */
export function foldNotes(rows: readonly PersonEventRow[]): PersonNote[] {
  return rows
    .filter((row) => row.kind === "note")
    .map((row) => ({
      id: row.id,
      body: text(value(row).body) ?? "",
      actor_person_id: row.actor_person_id,
      actor_name: row.actor_name ?? null,
      created_at: row.created_at,
    }))
    .filter((note) => note.body.length > 0)
    .sort((left, right) => right.created_at - left.created_at || right.id.localeCompare(left.id));
}

/**
 * The tags a person currently carries: the newest row per tag decides, so
 * add → remove → add reads as carried without any row being rewritten.
 */
export function foldTags(rows: readonly PersonEventRow[]): string[] {
  const latest = new Map<string, { op: string; at: number; id: string }>();
  for (const row of rows) {
    if (row.kind !== "tag") continue;
    const payload = value(row);
    const tag = text(payload.tag);
    if (!tag) continue;
    const op = text(payload.op) ?? "add";
    const current = latest.get(tag);
    if (!current || row.created_at > current.at || (row.created_at === current.at && row.id > current.id)) {
      latest.set(tag, { op, at: row.created_at, id: row.id });
    }
  }
  return [...latest.entries()]
    .filter(([, entry]) => entry.op === "add")
    .map(([tag]) => tag)
    .sort((left, right) => left.localeCompare(right));
}

/** Every stage move, oldest first — the timestamped history the card shows. */
export function foldStageHistory(rows: readonly PersonEventRow[]): PersonStageEntry[] {
  return rows
    .filter((row) => row.kind === "stage")
    .map((row) => {
      const payload = value(row);
      const stage = text(payload.stage);
      const score = typeof payload.score === "number" ? payload.score : null;
      return stage === null ? null : {
        id: row.id,
        stage,
        stage_name: pipelineStageName(stage),
        score,
        rationale: text(payload.rationale),
        actor_person_id: row.actor_person_id,
        actor_name: row.actor_name ?? null,
        created_at: row.created_at,
      };
    })
    .filter((entry): entry is PersonStageEntry => entry !== null)
    .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id));
}

/** The current pipeline card for a person, or null if never enrolled. */
export function currentStage(rows: readonly PersonEventRow[]): PersonStageEntry | null {
  const history = foldStageHistory(rows);
  return history.length === 0 ? null : history[history.length - 1]!;
}

/**
 * The score and rationale a card carries: a stage move records "moved to
 * Contacted" without restating why the prospect was interesting, so both fall
 * back to the most recent row that stated one.
 */
export function currentCard(rows: readonly PersonEventRow[]): PersonStageEntry | null {
  const history = foldStageHistory(rows);
  const latest = history.at(-1);
  if (!latest) return null;
  const scored = [...history].reverse().find((entry) => entry.score !== null);
  const explained = [...history].reverse().find((entry) => entry.rationale !== null);
  return { ...latest, score: latest.score ?? scored?.score ?? null, rationale: latest.rationale ?? explained?.rationale ?? null };
}
