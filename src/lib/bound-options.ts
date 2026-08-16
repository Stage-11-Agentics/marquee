import type { D1Database } from "@cloudflare/workers-types";
import type { FormFieldView } from "../routes/forms.queries";
import type { FormFieldType } from "../db/schema";

/**
 * A select field can either carry its own list of options or be *bound* to a
 * conference setting. Bound is the honest default for the two lists the server
 * already treats as domain references: an answer under `format` or `tracks` is
 * resolved back to a `formats` / `tracks` row by name at submit time
 * (`public-form.routes.ts` `resolveDomainReferences`). When the option list is
 * a hand-typed copy, renaming a format in Conference settings silently splits
 * the two: the dropdown still offers the old name, the resolver no longer finds
 * it, and the submitter is told to "choose a format from the list" by a list
 * that visibly contains their choice.
 *
 * Binding removes the copy. The options a bound field offers ARE the rows the
 * resolver reads, so the two cannot disagree.
 */
export const BOUND_SOURCES = ["formats", "tracks", "levels"] as const;

export type BoundSource = (typeof BOUND_SOURCES)[number];

export type BoundFieldType = "single_select" | "multi_select";

/** The settings area each source is edited in, for operator-facing copy. */
export const BOUND_SOURCE_LABELS: Record<BoundSource, string> = {
  formats: "Formats",
  tracks: "Tracks",
  levels: "Levels",
};

function isSelectType(type: FormFieldType): type is BoundFieldType {
  return type === "single_select" || type === "multi_select";
}

/**
 * The storage model has one format and one-or-more tracks. Keep a bound field
 * aligned with that model instead of letting a select render a live list that
 * the submit path cannot place on a submission.
 */
export function isBoundSourceCompatible(source: BoundSource, type: FormFieldType): type is BoundFieldType {
  return (source === "formats" && type === "single_select")
    || (source === "tracks" && type === "multi_select")
    || (source === "levels" && type === "single_select");
}

export function isBoundSource(value: unknown): value is BoundSource {
  return typeof value === "string" && (BOUND_SOURCES as readonly string[]).includes(value);
}

/**
 * The source a field is bound to, or null. Only select fields can bind — a
 * bound short-text field would be a promise nothing renders.
 */
export function boundSourceOf(field: { type: FormFieldType; config: Record<string, unknown> }): BoundSource | null {
  if (!isSelectType(field.type)) return null;
  return isBoundSource(field.config.source) && isBoundSourceCompatible(field.config.source, field.type)
    ? field.config.source
    : null;
}

/**
 * Write-side normalisation. A bound field never persists `options`: a stored
 * copy is exactly the stale snapshot binding exists to prevent, and it would
 * outlive the next rename. Returns the config to store, or an error message
 * naming what is wrong with it.
 */
export function normalizeFieldConfig(
  config: Record<string, unknown>,
  type: FormFieldType,
): { config: Record<string, unknown> } | { error: string } {
  if (config.source === undefined || config.source === null || config.source === "") {
    const { source: _dropped, ...rest } = config;
    return { config: rest };
  }
  if (!isBoundSource(config.source)) {
    return { error: `Options source must be one of ${BOUND_SOURCES.join(", ")}.` };
  }
  if (config.source === "levels" && Object.prototype.hasOwnProperty.call(config, "options") && config.options !== undefined) {
    return { error: "Conference levels use the event's level list; custom options are not allowed." };
  }
  if (!isSelectType(type) || !isBoundSourceCompatible(config.source, type)) {
    return {
      error: config.source === "formats"
        ? "Conference formats must be used by a single-select field."
        : config.source === "tracks"
          ? "Conference tracks must be used by a multi-select field."
          : config.source === "levels"
            ? "Conference levels must be used by a single-select field."
          : "Only single-select and multi-select fields can take their options from conference settings.",
    };
  }
  const { options: _stale, ...rest } = config;
  return { config: rest };
}

async function readSourceNames(
  db: D1Database,
  source: BoundSource,
  eventId: string,
): Promise<string[]> {
  const activeWhere = source === "formats" ? "" : " AND deleted_at IS NULL";
  const rows = await db
    .prepare(`SELECT name FROM ${source} WHERE event_id = ?${activeWhere} ORDER BY position ASC, id ASC`)
    .bind(eventId)
    .all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

/**
 * Replace the option list of every bound field with the live rows from its
 * source. Unbound fields are returned untouched, and a form with no bound field
 * costs no query at all — the public form GET is on the speed budget.
 */
export async function resolveBoundOptions(
  db: D1Database,
  eventId: string,
  fields: FormFieldView[],
): Promise<FormFieldView[]> {
  const needed = new Set<BoundSource>();
  for (const field of fields) {
    const source = boundSourceOf(field);
    if (source) needed.add(source);
  }
  if (needed.size === 0) return fields;
  const sources = [...needed];
  const lists = await Promise.all(sources.map((source) => readSourceNames(db, source, eventId)));
  const bySource = new Map<BoundSource, string[]>(sources.map((source, index) => [source, lists[index]]));
  return fields.map((field) => {
    const source = boundSourceOf(field);
    if (!source) return field;
    return { ...field, config: { ...field.config, options: bySource.get(source) ?? [] } };
  });
}
