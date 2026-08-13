/**
 * check:clocks — a test may not pin a deadline to a calendar date, and may not
 * spend a rate limit to prove it exists.
 *
 * Both rules exist because of failures that had no commit behind them.
 *
 * RULE 1 — absolute anchors feeding real-clock comparisons.
 *
 * A fixture that says `const NOW = Date.UTC(2026, 7, 11, 15)` and then writes
 * `expires_at: NOW + 86_400_000` reads as "expires tomorrow". The code under
 * test compares that column against the real `Date.now()`, so the sentence stops
 * being true the moment the wall clock passes it. On 2026-08-12T15:00:00Z the
 * portal suite went red with no diff behind it: a task asserted `risk` had
 * become `overdue`, and a form window asserted open began answering 403. A sweep
 * then found twelve more suites armed the same way — eleven of them minting
 * `auth_sessions` rows whose `expires_at` was an offset from the fixture anchor,
 * which turn the whole file into 401s on a date nobody wrote down.
 *
 * The fix is always the same shape: anchor to `Date.now()` so the offset keeps
 * meaning what it says. Where a suite genuinely needs a fixed calendar date —
 * `files-export` asserts ZIP entry names built from a session's weekday — keep
 * the anchor and derive only the time-compared column from the real clock.
 *
 * The rule reads PREPARED STATEMENTS, not lines. The column name lives in the
 * SQL string and the offset lives over in `.bind(...)`, and nothing obliges an
 * author to put them on one line — the two suites that went red on 2026-08-13
 * both wrote the INSERT across three, which is exactly how a per-line rule read
 * a live bomb as innocent.
 *
 * RULE 3 — a session that expires on a calendar date.
 *
 * Rule 1 is a judgement call about which columns matter; this one is not. A
 * test session is a credential, and a credential minted against a frozen clock
 * turns its whole file into 401s on a date nobody chose. So: an `auth_sessions`
 * row may not carry a calendar date anywhere in the statement that writes it —
 * not through an anchor, not inline. Session fixtures ride the real clock,
 * always, without exception worth arguing about.
 *
 * RULE 2 — bursts that race a fixed window.
 *
 * Spending a rate limit means issuing limit+1 requests inside one window, which
 * races the window boundary rather than testing the limiter. With a limit of 30
 * and a 35-request burst: inside one window the counts reach [30] and it trips;
 * with a boundary ten requests in they reach [10, 25] and it does not; at two
 * seconds per request they reach [30, 5] and it does not, because the request
 * that would observe the limit lands in the next window. Once a request takes
 * longer than the window is wide — ordinary when several agents share a machine
 * — no window can fill and the limiter is untestable rather than flaky.
 *
 * Seed the counter to its limit and send one request instead.
 *
 * Both rules take an escape hatch on the offending line or the one above it:
 *
 *   // clock-check: allow — <why this one is actually safe>
 *
 * A reason is required. The marker is for cases the rule cannot see, not for
 * silencing it.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

const TEST_ROOT = resolve(REPOSITORY_ROOT, "tests");
const ALLOW = /clock-check:\s*allow\s*[—-]\s*\S/;

/** Columns a server compares against the real clock to decide access or state. */
const TIME_COMPARED_BINDINGS = [
  "expires_at",
  "closes_at",
  "opens_at",
  "due_at",
  "starts_at",
  "ends_at",
];

/**
 * A calendar date written into source: `Date.UTC(2026, 7, 12)`, `Date.parse(
 * "2026-08-11T12:00:00Z")`, `new Date("2026-08-11")`. All three name a moment
 * the wall clock eventually passes; only `Date.now()` does not.
 */
const LITERAL_DATE = /Date\.UTC\(\s*\d{4}\s*,|Date\.parse\(\s*["'`]\d{4}-|new Date\(\s*["'`]\d{4}-/;

const ABSOLUTE_ANCHOR = new RegExp(`\\bconst\\s+(\\w+)\\s*=\\s*(?:${LITERAL_DATE.source})`);

function allowed(lines, index) {
  return ALLOW.test(lines[index] ?? "") || ALLOW.test(lines[index - 1] ?? "");
}

async function testFiles() {
  const entries = await readdir(TEST_ROOT, { recursive: true });
  return entries
    .filter((path) => /\.(test|spec)\.(ts|mjs|js)$/.test(path))
    .map((path) => resolve(TEST_ROOT, path));
}

/** Comments are prose. A rule that reads them reports on sentences about 429. */
function stripComments(line) {
  return line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
}

/**
 * Walk from `start` to the character after the balanced close of the bracket
 * opened just before it, ignoring brackets that live inside string literals —
 * SQL is full of `COUNT(*)` and `VALUES (?, ?)`, and a naive counter would end
 * a statement in the middle of one.
 */
function closeOf(source, start) {
  let depth = 1;
  let index = start;
  let quote = "";
  while (index < source.length && depth > 0) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    index += 1;
  }
  return index;
}

/** Every call to `name(...)`, argument list included, as one unit of text. */
function calls(source, name) {
  const found = [];
  const opener = new RegExp(`\\b${name}\\s*\\(`, "g");
  let match;
  while ((match = opener.exec(source)) !== null) {
    const end = closeOf(source, match.index + match[0].length);
    found.push({
      text: source.slice(match.index, end),
      startLine: source.slice(0, match.index).split("\n").length,
    });
    opener.lastIndex = end;
  }
  return found;
}

/**
 * Every `DB.prepare(...)` and the chained calls that carry its bindings, as one
 * unit of text. This is the scope a fixture INSERT actually occupies.
 */
function preparedStatements(source) {
  const found = [];
  const opener = /\b(?:\w+\.)*(?:DB|db)\.prepare\(/g;
  let match;
  while ((match = opener.exec(source)) !== null) {
    let end = closeOf(source, match.index + match[0].length);
    for (;;) {
      const chained = /^\s*\.\s*\w+(?:<[^>]*>)?\s*\(/.exec(source.slice(end));
      if (!chained) break;
      end = closeOf(source, end + chained[0].length);
    }
    found.push({
      text: source.slice(match.index, end),
      startLine: source.slice(0, match.index).split("\n").length,
      endLine: source.slice(0, end).split("\n").length,
    });
    opener.lastIndex = end;
  }
  return found;
}

/**
 * The lines of a loop's own body, by brace depth. A fixed lookahead window
 * reads whatever follows the loop, which is how a seeding loop gets blamed for
 * an assertion written after it.
 */
function loopBody(lines, start) {
  const body = [];
  let depth = 0;
  let opened = false;
  for (let index = start; index < lines.length; index += 1) {
    const line = stripComments(lines[index]);
    for (const character of line) {
      if (character === "{") { depth += 1; opened = true; }
      else if (character === "}") depth -= 1;
    }
    body.push(line);
    if (opened && depth <= 0) break;
  }
  return body.join("\n");
}

const findings = [];

for (const file of await testFiles()) {
  const source = await readFile(file, "utf8");
  const lines = source.split("\n");
  const relative = file.slice(REPOSITORY_ROOT.length + 1);
  // Rule 1 only applies where fixtures are PERSISTED and read back by the
  // server. A pure unit test that passes `now` in as an argument has an
  // injected clock, and an injected clock can never drift — that is the whole
  // point of injecting it.
  const persistsFixtures = /env\.DB\.(prepare|batch)/.test(source);

  // Which identifiers in this file are absolute calendar anchors?
  const anchors = new Set();
  lines.forEach((line, index) => {
    const match = ABSOLUTE_ANCHOR.exec(line);
    if (match && !allowed(lines, index)) anchors.add(match[1]);
  });

  const statements = persistsFixtures ? preparedStatements(source) : [];
  // A statement is exempt if the marker sits anywhere inside it, or on the line
  // above — the reason usually reads better above the INSERT than buried in it.
  const statementAllowed = (statement) => {
    for (let index = statement.startLine - 2; index < statement.endLine; index += 1) {
      if (ALLOW.test(lines[index] ?? "")) return true;
    }
    return false;
  };
  const column = new RegExp(`\\b(${TIME_COMPARED_BINDINGS.join("|")})\\b`);

  // An anchor is only a bomb where it reaches a column the server compares
  // against real time. A fixture date used for display or ordering is fine, and
  // so is a bare anchor on `created_at` — it is the arithmetic that reads as a
  // promise about the future ("expires tomorrow") and then stops being one.
  const offsetFromAnchor = anchors.size
    ? new RegExp(`\\b(${[...anchors].join("|")})\\b\\s*[+\\-]`)
    : /(?!)/;

  if (anchors.size > 0 && statements.length > 0) {
    for (const statement of statements) {
      if (statementAllowed(statement)) continue;
      const code = stripComments(statement.text);
      if (!column.test(code) || !offsetFromAnchor.test(code)) continue;
      findings.push({
        rule: "absolute-anchor-on-time-compared-column",
        file: relative,
        line: statement.startLine,
        detail:
          "a deadline derived from a calendar-pinned anchor; the server compares it " +
          "against the real clock, so this fixture changes meaning as time passes",
        fix: "anchor to Date.now(), or derive just this column from the real clock",
      });
    }
  }

  // Rule 3: a session credential minted against a calendar date. Rule 1 asks
  // whether a column is one the server compares against real time; for a
  // session row there is nothing to ask, so this one also catches the date
  // written inline in the bindings rather than through a named anchor.
  for (const statement of statements) {
    if (statementAllowed(statement)) continue;
    const code = stripComments(statement.text);
    if (!/INSERT\s+INTO\s+auth_sessions\b/i.test(code)) continue;
    if (!LITERAL_DATE.test(code) && !offsetFromAnchor.test(code)) continue;
    findings.push({
      rule: "auth-session-expiry-from-literal-date",
      file: relative,
      line: statement.startLine,
      detail:
        "an auth_sessions row minted from a calendar date; resolveSession compares " +
        "expires_at against the real Date.now(), so this credential dies on a date " +
        "nobody wrote down and takes the whole file to 401 with it",
      fix: "mint expires_at (and the row's timestamps) from Date.now()",
    });
  }

  // The same defect through the other door. `createSession` computes expires_at
  // from the `now` it is handed, so a suite that passes its fixture anchor gets
  // a credential dated to the fixture and dies 30 days after a date in the
  // source — no INSERT anywhere for a statement rule to read.
  for (const call of calls(source, "createSession")) {
    const code = stripComments(call.text);
    if (!new RegExp(`\\bnow\\s*:\\s*(?:${LITERAL_DATE.source})`).test(code)
      && !(anchors.size && new RegExp(`\\bnow\\s*:\\s*(${[...anchors].join("|")})\\b`).test(code))) continue;
    if (ALLOW.test(lines[call.startLine - 1] ?? "") || ALLOW.test(lines[call.startLine - 2] ?? "")) continue;
    findings.push({
      rule: "auth-session-expiry-from-literal-date",
      file: relative,
      line: call.startLine,
      detail:
        "createSession handed a calendar-pinned clock; it dates expires_at from that " +
        "clock while resolveSession reads the real one, so the session outlives the " +
        "fixture date by exactly one TTL and not a moment longer",
      fix: "let createSession default its own now, or pass Date.now()",
    });
  }

  // Rule 2: a loop that both ISSUES requests and inspects them for 429 inside
  // its own body. Either half alone is innocent — a loop that seeds a counter
  // makes no requests, and an assertion after a loop is not a burst.
  lines.forEach((line, index) => {
    if (!/\b(for|while)\s*\(/.test(stripComments(line))) return;
    const body = loopBody(lines, index);
    const issuesRequests = /\b(await\s+)?(request|fetch|SELF\.fetch|app\.request)\s*\(/.test(body);
    const inspects429 = /\b429\b/.test(body);
    if (!issuesRequests || !inspects429) return;
    if (allowed(lines, index) || ALLOW.test(body)) return;
    findings.push({
      rule: "burst-spent-rate-limit",
      file: relative,
      line: index + 1,
      detail:
        "a loop that spends a rate limit to observe 429; this races the limiter's " +
        "window boundary and cannot trip at all once a request outlasts the window",
      fix: "seed the limiter's counter to its limit, then send one request",
    });
  });
}

for (const finding of findings) {
  process.stdout.write(`\n[check:clocks] ${finding.file}:${finding.line}  ${finding.rule}\n`);
  process.stdout.write(`  ${finding.detail}\n`);
  process.stdout.write(`  fix: ${finding.fix}\n`);
}
if (findings.length === 0) process.stdout.write("[check:clocks] no calendar-pinned deadlines, no burst-spent limits\n");

emit({
  command: "check:clocks",
  status: findings.length ? "fail" : "pass",
  findings,
});
process.exitCode = findings.length ? 1 : 0;
