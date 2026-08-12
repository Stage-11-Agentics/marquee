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

const ABSOLUTE_ANCHOR = /\bconst\s+(\w+)\s*=\s*Date\.UTC\(\s*\d{4}\s*,/;

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

  if (anchors.size > 0 && persistsFixtures) {
    const anchorNames = [...anchors].join("|");
    // An anchor is only a bomb where it reaches a column the server compares
    // against real time. A fixture date used for display or ordering is fine.
    // Same line, any distance. The column name usually sits inside a long SQL
    // string while the offset is over in `.bind(...)`, so a proximity window
    // just encodes how verbose the INSERT happens to be — the files-library
    // session bomb was 130 characters wide and slipped an 80-character window.
    const column = new RegExp(`\\b(${TIME_COMPARED_BINDINGS.join("|")})\\b`);
    const offsetFromAnchor = new RegExp(`\\b(${anchorNames})\\b\\s*[+\\-]`);
    lines.forEach((line, index) => {
      if (allowed(lines, index)) return;
      const code = stripComments(line);
      if (!column.test(code) || !offsetFromAnchor.test(code)) return;
      findings.push({
        rule: "absolute-anchor-on-time-compared-column",
        file: relative,
        line: index + 1,
        detail:
          "a deadline derived from a calendar-pinned anchor; the server compares it " +
          "against the real clock, so this fixture changes meaning as time passes",
        fix: "anchor to Date.now(), or derive just this column from the real clock",
      });
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
