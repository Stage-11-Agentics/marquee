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
export const BOUND_SOURCES = ["formats", "tracks"] as const;

export type BoundSource = (typeof BOUND_SOURCES)[number];

/** The settings area each source is edited in, for operator-facing copy. */
export const BOUND_SOURCE_LABELS: Record<BoundSource, string> = {
  formats: "Formats",
  tracks: "Tracks",
};

function isSelectType(type: FormFieldType): boolean {
  return type === "single_select" || type === "multi_select";
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
  return isBoundSource(field.config.source) ? field.config.source : null;
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
  if (!isSelectType(type)) {
    return { error: "Only single-select and multi-select fields can take their options from conference settings." };
  }
  const { options: _stale, ...rest } = config;
  return { config: rest };
}

async function readSourceNames(
  db: D1Database,
  source: BoundSource,
  eventId: string,
): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT name FROM ${source} WHERE event_id = ? ORDER BY position ASC, id ASC`)
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
