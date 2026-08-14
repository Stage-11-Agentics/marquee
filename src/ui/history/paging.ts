/**
 * Appending the next page of an append-only log, without showing a row twice.
 *
 * Offset paging over a table that is still being written to will repeat rows:
 * something lands between the two fetches, every later row shifts down one, and
 * the tail of page N arrives again at the head of page N+1. On a log that is
 * the worst possible duplicate — the same fact, listed twice, in the surface
 * whose entire promise is that it is a faithful account — and in Preact it also
 * means two children sharing a `key`.
 *
 * All three MRQ-211 lenses page the same way, so they dedupe the same way. The
 * organization log is the most exposed of the three: it is org-wide and every
 * organizer writes to it.
 */
export function appendUnseen<Row extends { id: string }>(
  existing: readonly Row[],
  incoming: readonly Row[],
): Row[] {
  const seen = new Set(existing.map((row) => row.id));
  return [...existing, ...incoming.filter((row) => !seen.has(row.id))];
}
