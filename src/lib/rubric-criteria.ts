/**
 * A scorecard criterion is a field, not just a weighted number. The organizer
 * side writes these and the reviewer side renders them, so the small amount of
 * shape knowledge they share lives here rather than in either route module.
 */

export type CriterionKind = "numeric" | "select" | "text";

/** The scale a numeric criterion falls back to when the organizer set none. */
export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 5;

/** Options are stored as JSON text; every reader gets the array, never the string. */
export function parseCriterionOptions(options: string | null): string[] | null {
  if (options === null) return null;
  try {
    const parsed: unknown = JSON.parse(options);
    return Array.isArray(parsed) ? parsed.map((option) => String(option)) : null;
  } catch {
    return null;
  }
}
