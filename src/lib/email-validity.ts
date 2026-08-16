/**
 * The deliberately small address predicate used by decision mail. It is not
 * an RFC 5322 parser: it catches the operator typo that would otherwise make
 * a decision look sendable while the queue refuses it.
 */
const DECISION_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string | null | undefined): boolean {
  const candidate = value?.trim() ?? "";
  return candidate.length > 0 && DECISION_EMAIL.test(candidate);
}

/**
 * SQL equivalent of isValidEmail for a string expression. The address is
 * trimmed exactly as the TypeScript predicate trims it. SQLite has no portable
 * regexp operator in the Worker runtime, so the shape is expressed with
 * string functions and explicit ASCII whitespace checks.
 */
export function emailValiditySql(expression: string): string {
  const value = `trim(${expression})`;
  const at = `instr(${value}, '@')`;
  const domain = `substr(${value}, ${at} + 1)`;
  return `(
    ${value} <> ''
    AND instr(${value}, char(9)) = 0
    AND instr(${value}, char(10)) = 0
    AND instr(${value}, char(11)) = 0
    AND instr(${value}, char(12)) = 0
    AND instr(${value}, char(13)) = 0
    AND instr(${value}, ' ') = 0
    AND length(${value}) - length(replace(${value}, '@', '')) = 1
    AND ${at} > 1
    AND ${at} < length(${value})
    AND instr(${domain}, '.') > 0
    AND instr(${domain}, '.') < length(${domain})
  )`;
}
