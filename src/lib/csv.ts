/**
 * One way to write a CSV field, for every export in the product.
 *
 * There were three, written a day apart by three tickets that each needed an
 * export and each wrote the escaping at the point of use: the reviewer queue
 * (MRQ-18), the chair results (MRQ-109), and the submissions list (MRQ-9). Two
 * of them agreed. The third — the submissions export, the one that carries
 * conference titles and speaker names — quoted the field and doubled embedded
 * quotes but left line breaks alone.
 *
 * A field with a line break in it is still legal CSV; a reader that implements
 * RFC 4180 properly puts it back together. But the row stops being a line, and
 * that is what an organizer's tools are: a spreadsheet paste, a `grep`, a
 * script that reads the file a line at a time, a column count. What they see is
 * a row cut in half and every column after it shifted by one, in a file nobody
 * opens until the week after it was downloaded. Titles and speaker names arrive
 * from the Sessionize import and the API, carrying other people's typing — the
 * single-line form input is not the only door.
 *
 * So the rule is the stricter of the two that existed: one record, one line.
 */

/**
 * A single CSV field: always quoted, embedded quotes doubled, and every line
 * break flattened to a space so a record never spans two lines.
 *
 * Flattening is deliberately lossy and worth it. The alternative — trusting
 * every downstream reader to be RFC 4180-complete — is a bet an organizer
 * loses silently.
 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""').replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ")}"`;
}

/** One CSV record: cells escaped, comma-separated. */
export function csvRow(values: ReadonlyArray<string | number | null | undefined>): string {
  return values.map(csvCell).join(",");
}
