/**
 * MRQ-215 · the SQL chase rollup must use the event's calendar, not UTC.
 *
 * A fixed due date is stored as the end of its UTC-encoded day. At 00:30Z on
 * April 1, Los Angeles is still on March 31, so a March 31 deadline is risk
 * rather than overdue. This drives the live list query at a fixed instant and
 * checks both its SQL counts/filter and its hydrated task state.
 */
import { beforeEach, expect, test } from "vitest";

import { dueAtFromDateInput } from "../../../src/lib/task-due";
import { listOnboarding } from "../../../src/routes/onboarding.queries";
import { applyMigrations, env } from "../apply-migrations";

const ORG_ID = "org_onboarding_calendar_mrq215";
const EVENT_ID = "evt_onboarding_calendar_mrq215";
const NOW = Date.parse("2027-04-01T00:30:00.000Z");

const CASES = [
  { id: "person-calendar-late", name: "Late Speaker", date: "2027-03-29", state: "overdue", overdue: 1, risk: 0, severity: 2 },
  { id: "person-calendar-today", name: "Today Speaker", date: "2027-03-31", state: "risk", overdue: 0, risk: 1, severity: 0 },
  { id: "person-calendar-edge", name: "Edge Speaker", date: "2027-04-14", state: "risk", overdue: 0, risk: 1, severity: 0 },
  { id: "person-calendar-future", name: "Future Speaker", date: "2027-04-15", state: "upcoming", overdue: 0, risk: 0, severity: 0 },
] as const;

function personRow(person: (typeof CASES)[number], now: number) {
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`,
  ).bind(person.id, ORG_ID, `${person.id}@example.test`, person.name, now, now);
}

function templateRow(person: (typeof CASES)[number], now: number) {
  return env.DB.prepare(
    `INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
     VALUES (?, ?, ?, 'acknowledge', '', ?, NULL, NULL, NULL, ?, 0, ?, ?)`,
  ).bind(`template-${person.id}`, EVENT_ID, `Deadline for ${person.name}`, dueAtFromDateInput(person.date), CASES.indexOf(person), now, now);
}

function taskRow(person: (typeof CASES)[number], now: number) {
  return env.DB.prepare(
    `INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'acknowledge', '', ?, 'open', ?, ?)`,
  ).bind(`task-${person.id}`, EVENT_ID, person.id, `template-${person.id}`, `Deadline for ${person.name}`, dueAtFromDateInput(person.date), now, now);
}

async function seedFixture(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "Calendar arithmetic", "calendar-mrq215", NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, 'Calendar arithmetic', 'calendar-mrq215', '2027-03-01', '2027-04-30', 'America/Los_Angeles', 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, NOW, NOW),
    ...CASES.flatMap((person) => [personRow(person, NOW), templateRow(person, NOW), taskRow(person, NOW)]),
    env.DB.prepare(
      "INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
    ).bind("track-calendar-ai", EVENT_ID, "Calendar AI", "#0a6c73", NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, created_at, updated_at)
       VALUES (?, ?, NULL, 'session', ?, '', 'accepted', 'admin', ?, ?, ?)`,
    ).bind("submission-calendar-edge", EVENT_ID, "Track-bound session", "person-calendar-edge", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)",
    ).bind("participation-calendar-edge", "submission-calendar-edge", "person-calendar-edge", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind("submission-track-calendar-edge", "submission-calendar-edge", "track-calendar-ai", NOW, NOW),
  ]);
}

beforeEach(async () => {
  await applyMigrations();
  await seedFixture();
});

test("CONTRACT · MRQ-215 · SQL overdue/risk rollup follows a non-UTC calendar day", async () => {
  const snapshot = await listOnboarding(env.DB, EVENT_ID, {}, NOW);
  const rows = new Map(snapshot.data.map((row) => [row.id, row]));

  expect(snapshot.counts).toEqual({ all: 4, overdue: 1, incomplete: 4, risk: 2 });
  expect(snapshot.metrics).toMatchObject({ overdue_tasks: 1, at_risk: 2 });
  expect(snapshot.facets.tracks).toEqual([{ id: "track-calendar-ai", name: "Calendar AI", color: "#0a6c73", count: 1 }]);

  for (const expected of CASES) {
    const row = rows.get(expected.id);
    expect(row, expected.id).toBeDefined();
    expect(row).toMatchObject({
      overdue_task_count: expected.overdue,
      risk_task_count: expected.risk,
      severity: expected.severity,
      tasks: expect.arrayContaining([
        expect.objectContaining({ template_id: `template-${expected.id}`, state: expected.state }),
      ]),
    });
  }

  const overdue = await listOnboarding(env.DB, EVENT_ID, { filter: "overdue" }, NOW);
  expect(overdue.total).toBe(1);
  expect(overdue.data.map((row) => row.id)).toEqual(["person-calendar-late"]);

  const risk = await listOnboarding(env.DB, EVENT_ID, { filter: "risk" }, NOW);
  expect(risk.total).toBe(2);
  expect(new Set(risk.data.map((row) => row.id))).toEqual(new Set(["person-calendar-today", "person-calendar-edge"]));

  const byTaskType = await listOnboarding(env.DB, EVENT_ID, { taskType: "template-person-calendar-today" }, NOW);
  expect(byTaskType.total).toBe(1);
  expect(byTaskType.data.map((row) => row.id)).toEqual(["person-calendar-today"]);

  const byTrack = await listOnboarding(env.DB, EVENT_ID, { track: "track-calendar-ai" }, NOW);
  expect(byTrack.total).toBe(1);
  expect(byTrack.data.map((row) => row.id)).toEqual(["person-calendar-edge"]);

  const bySearch = await listOnboarding(env.DB, EVENT_ID, { search: "Track-bound session" }, NOW);
  expect(bySearch.total).toBe(1);
  expect(bySearch.data.map((row) => row.id)).toEqual(["person-calendar-edge"]);
});
