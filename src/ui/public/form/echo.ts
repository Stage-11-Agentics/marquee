/**
 * Every draft write on the public form echoes the answers the server stored,
 * and adopting that echo wholesale discards anything typed while the request
 * was in flight. The headshot upload made that routine rather than theoretical:
 * creating the draft and pushing the file take seconds, and a long answer
 * written in that window came back erased.
 *
 * So the echo is authoritative only for answers the person did not touch. Any
 * key that moved between the request leaving and the response arriving is
 * theirs, and stays — including one they cleared, and one the echo has never
 * heard of.
 */
export function reconcileEchoedAnswers(
  sent: Record<string, unknown>,
  echoed: Record<string, unknown>,
  current: Record<string, unknown>,
): { answers: Record<string, unknown>; edited: boolean } {
  const answers: Record<string, unknown> = { ...echoed };
  let edited = false;
  for (const key of new Set([...Object.keys(current), ...Object.keys(sent)])) {
    if (sameAnswer(current[key], sent[key])) continue;
    edited = true;
    if (current[key] === undefined) delete answers[key];
    else answers[key] = current[key];
  }
  return { answers, edited };
}

/** Answers are JSON values — a file answer is an object, a multi-select an array. */
function sameAnswer(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
