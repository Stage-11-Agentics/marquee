/**
 * The guard's own regression suite.
 *
 * check:clocks shipped to prevent exactly one failure and then failed to see it:
 * on 2026-08-13 four suites went to 401 on a session dated 2026-08-12, and the
 * guard reported "no calendar-pinned deadlines" the whole time. Its rule wanted
 * the column and the offset on ONE line, and every real INSERT in this codebase
 * is written across three.
 *
 * So these cases are written as source, not as prose about source: the first is
 * the verbatim shape of the statement that slipped through. A guard nobody tests
 * is a guard that reports what it can parse rather than what is true.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { clockFindings, liveClockFindings } from "../../scripts/checks/clock-policy.mjs";

const rules = (source) => clockFindings("tests/fixture.test.ts", source).map((finding) => finding.rule);
const marginRules = (source) => liveClockFindings("tests/fixture.test.ts", source).map((finding) => finding.rule);

test("CONTRACT · the session that took the suite red on 2026-08-13 is caught", () => {
  // Verbatim from people.MRQ-131.test.ts at 17242b06: the column is on one line
  // and its binding on the next, which is the whole of why this was missed.
  const source = `
const NOW = Date.UTC(2026, 7, 12, 9, 0, 0);
await env.DB.batch([
  env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)")
    .bind(AUTH_SESSION, ORGANIZER, NOW + 86_400_000, NOW, NOW),
]);
`;
  assert.deepEqual(
    rules(source).sort(),
    ["absolute-anchor-on-time-compared-column", "auth-session-expiry-from-literal-date"],
  );
});

test("CONTRACT · a template-literal INSERT split over three lines is caught too", () => {
  const source = `
const now = Date.UTC(2026, 7, 12, 12, 0, 0);
env.DB.prepare(
  \`INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
   VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)\`,
).bind(SESSION_ID, PERSON_ID, now + 86_400_000, now, now);
`;
  assert.ok(rules(source).includes("auth-session-expiry-from-literal-date"));
});

test("CONTRACT · a date reached through Date.parse is still a date", () => {
  const source = `
const now = Date.parse("2026-08-11T12:00:00.000Z");
env.DB.prepare("INSERT INTO auth_sessions (id, person_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
  .bind(SESSION_ID, OWNER_ID, now + 86_400_000, now, now);
`;
  assert.ok(rules(source).includes("auth-session-expiry-from-literal-date"));
});

test("CONTRACT · createSession handed a pinned clock is the same defect, and is caught", () => {
  const source = `
const NOW = Date.parse("2026-08-10T12:00:00.000Z");
env.DB.prepare("SELECT 1");
const session = await createSession(env.DB, { personId: "per_mail", roleHint: "owner", userAgent: "x", now: NOW });
`;
  assert.ok(rules(source).includes("auth-session-expiry-from-literal-date"));
});

test("CONTRACT · a session minted from the real clock is not a finding", () => {
  const source = `
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const SESSION_EXPIRES_AT = Date.now() + 86_400_000;
// clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
env.DB.prepare("INSERT INTO auth_sessions (id, person_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
  .bind(AUTH_SESSION, PERSON_ID, SESSION_EXPIRES_AT, NOW, NOW);
`;
  assert.deepEqual(rules(source), []);
});

test("CONTRACT · a fixture date that never reaches a time-compared column is left alone", () => {
  const source = `
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
env.DB.prepare("INSERT INTO people (id, org_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
  .bind(PERSON_ID, ORG_ID, "Ada Lovelace", NOW, NOW);
`;
  assert.deepEqual(rules(source), []);
});

test("CONTRACT · the escape hatch exempts the statement, and only with a reason", () => {
  const armed = `
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
env.DB.prepare("INSERT INTO auth_sessions (id, person_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
  .bind(AUTH_SESSION, PERSON_ID, NOW + 86_400_000, NOW, NOW);
`;
  const excused = armed.replace(
    "env.DB.prepare(\"INSERT INTO auth_sessions",
    "// clock-check: allow — this suite injects its clock\nenv.DB.prepare(\"INSERT INTO auth_sessions",
  );
  const bare = armed.replace(
    "env.DB.prepare(\"INSERT INTO auth_sessions",
    "// clock-check: allow\nenv.DB.prepare(\"INSERT INTO auth_sessions",
  );
  assert.ok(rules(armed).length > 0);
  assert.deepEqual(rules(excused), []);
  assert.ok(rules(bare).length > 0, "a marker with no reason is not a marker");
});

test("CONTRACT · SQL parentheses do not end a statement early", () => {
  // `COUNT(*)` and `VALUES (?, ?)` live inside the string; a naive paren counter
  // closes the statement mid-SQL and reads the offset as belonging to nothing.
  const source = `
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
env.DB.prepare(
  \`INSERT INTO auth_sessions (id, person_id, expires_at, created_at, updated_at)
   SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM people) > 0\`,
).bind(AUTH_SESSION, PERSON_ID, NOW + 86_400_000, NOW, NOW);
`;
  assert.ok(rules(source).includes("auth-session-expiry-from-literal-date"));
});

test("CONTRACT · a one-day live-clock offset feeding due_at is caught", () => {
  const source = `
const NOW = Date.now();
const DAY_MS = 86_400_000;
const OVERDUE_AT = NOW - DAY_MS;
env.DB.prepare(
  "INSERT INTO speaker_tasks (id, due_at, created_at, updated_at) VALUES (?, ?, ?, ?)"
).bind("task", OVERDUE_AT, NOW, NOW);
`;
  assert.deepEqual(marginRules(source), ["live-clock-calendar-margin"]);
  assert.ok(rules(source).includes("live-clock-calendar-margin"));
});

test("CONTRACT · a two-day live-clock margin is stable across the local-day boundary", () => {
  const source = `
const NOW = Date.now();
const DAY_MS = 86_400_000;
const OVERDUE_AT = NOW - 2 * DAY_MS;
env.DB.prepare(
  "INSERT INTO speaker_tasks (id, due_at, created_at, updated_at) VALUES (?, ?, ?, ?)"
).bind("task", OVERDUE_AT, NOW, NOW);
`;
  assert.deepEqual(marginRules(source), []);
});

test("CONTRACT · the margin rule sees direct offsets and keeps the existing escape hatch", () => {
  const armed = `
env.DB.prepare("UPDATE forms SET closes_at = ? WHERE id = ?")
  .bind(Date.now() - 1_000, FORM_ID);
`;
  const excused = armed.replace(
    "env.DB.prepare(\"UPDATE forms",
    "// clock-check: allow — this is an intentional millisecond boundary test; forms compare exact instants\nenv.DB.prepare(\"UPDATE forms",
  );
  const bare = armed.replace(
    "env.DB.prepare(\"UPDATE forms",
    "// clock-check: allow\nenv.DB.prepare(\"UPDATE forms",
  );
  assert.deepEqual(marginRules(armed), ["live-clock-calendar-margin"]);
  assert.deepEqual(marginRules(excused), []);
  assert.deepEqual(marginRules(bare), ["live-clock-calendar-margin"]);
});
