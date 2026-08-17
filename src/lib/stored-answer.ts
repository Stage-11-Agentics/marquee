/**
 * One reading of a stored answer row, for every surface that reads one back.
 *
 * `submission_answers` keeps an answer in whichever column fits it: text
 * answers in `value_text`, structured ones (a multi-select's array, a file
 * answer's descriptor) in `value_json`. A select bound to Conference levels is
 * the single answer written to *both* — `value_text` holds the label the
 * submitter chose, and `value_json` holds `{ bound_source, id, label }` so
 * routing can resolve the level row without a second lookup.
 *
 * A reader that reaches for the JSON first therefore hands a `<select>` an
 * object, and a select renders an object as no answer at all. That is how a
 * saved Audience level vanished from a resumed call for speakers while every
 * other answer survived: the form re-rendered empty, and the submit that
 * followed was refused — "Choose an option from the list" — for a value the
 * submitter could no longer see. Text wins whenever it is present, because it
 * is written only for answers that *are* text.
 */
export function readStoredAnswerValue(row: {
  value_text: string | null;
  value_json: string | null;
}): unknown {
  if (row.value_text !== null) return row.value_text;
  if (row.value_json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value_json) as unknown;
  } catch {
    return null;
  }
  return unwrapBoundAnswer(parsed);
}

/**
 * A bound-source descriptor with no companion text still describes one chosen
 * label, so read it as that label rather than as an object no control renders.
 */
function unwrapBoundAnswer(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.bound_source !== "string") return value;
  return typeof record.label === "string" ? record.label : null;
}
