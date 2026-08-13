/**
 * MRQ-164 Part 2 — a task authored after conference setup is trackable at list
 * level, with real per-speaker state.
 *
 * The round-4 judge read this off `/onboarding`'s matrix and saw a speaker
 * whose only work was new render as a row of em dashes. The column set is
 * derived from `task_templates`, so the data is there; this pins the contract
 * the page renders against, so a regression that drops a template from the
 * payload fails here rather than in a screenshot.
 */
import { beforeEach, expect, test } from "vitest";

import { app } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";
import { dueAtFromDateInput } from "../../../src/lib/task-due";
import type { OnboardingSnapshot } from "../../../src/routes/onboarding.queries";

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_onboarding_mrq164";
const EVENT_ID = "evt_onboarding_mrq164";
const SESSION_ID = "session_onboarding_mrq164";
const COOKIE = `mq_session=${SESSION_ID}`;
const ORGANIZER_ID = "person_onboarding_organizer_mrq164";
const PRIYA_ID = "person_onboarding_priya_mrq164";
const MARCUS_ID = "person_onboarding_marcus_mrq164";
const SUBMISSION_ID = "sub_onboarding_mrq164";
const ORIGINAL_TEMPLATE_ID = "tpl_onboarding_original_mrq164";
const NEW_TASK_DUE = dueAtFromDateInput("2027-04-01") as number;

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, { ...init, headers: { cookie: COOKIE, ...(init.headers ?? {}) } }, env);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function personRow(id: string, name: string, email: string) {
  const now = Date.now();
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`,
  ).bind(id, ORG_ID, email, name, now, now);
}

async function seedFixture(): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "Onboarding columns", "onboarding-mrq164", now, now),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, "DevFlow Conf 2027", "devflow-2027-mrq164", "2027-05-12", "2027-05-14", "America/Los_Angeles", now, now),
    personRow(ORGANIZER_ID, "Jordan Alvarez", "jordan@mrq164.test"),
    personRow(PRIYA_ID, "Priya Raman", "priya@mrq164.test"),
    personRow(MARCUS_ID, "Marcus Okafor", "marcus@mrq164.test"),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)")
      .bind("membership_organizer_mrq164", ORG_ID, EVENT_ID, ORGANIZER_ID, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)")
      .bind("membership_priya_mrq164", ORG_ID, EVENT_ID, PRIYA_ID, now, now),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'program_lead', ?, 'onboarding-mrq164', NULL, ?, ?)`,
    ).bind(SESSION_ID, ORGANIZER_ID, now + 3_600_000, now, now),
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, last_write_source, created_at, updated_at)
       VALUES (?, ?, NULL, 'session', ?, '', 'accepted', 'admin', ?, 'marquee', ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, "Lightning: Agents in Production Q&A", MARCUS_ID, now, now),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)")
      .bind("part_marcus_mrq164", SUBMISSION_ID, MARCUS_ID, now, now),
    // The conference's original task, authored at setup and assigned to Priya
    // alone — so Marcus's only work is the task authored later.
    env.DB.prepare(
      `INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, created_at, updated_at)
       VALUES (?, ?, 'Acknowledge acceptance', 'acknowledge', '', ?, NULL, NULL, NULL, 0, 0, ?, ?)`,
    ).bind(ORIGINAL_TEMPLATE_ID, EVENT_ID, NEW_TASK_DUE, now, now),
    env.DB.prepare(
      `INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'Acknowledge acceptance', 'acknowledge', '', ?, 'open', ?, ?)`,
    ).bind("task_original_priya_mrq164", EVENT_ID, PRIYA_ID, ORIGINAL_TEMPLATE_ID, NEW_TASK_DUE, now, now),
  ]);
}

beforeEach(async () => {
  await applyMigrations();
  await seedFixture();
});

test("CONTRACT · MRQ-164 · a task authored after setup gets its own column with real per-speaker state", async () => {
  const before = await (await request(`/api/v1/events/${EVENT_ID}/onboarding`)).json() as OnboardingSnapshot;
  expect(before.task_templates.map((template) => template.name)).toEqual(["Acknowledge acceptance"]);

  const created = await postJson(`/api/v1/events/${EVENT_ID}/task-templates`, {
    name: "Confirm participation",
    kind: "acknowledge",
    description: "Confirm you are still speaking.",
    due_at: NEW_TASK_DUE,
    assign_to: [PRIYA_ID, MARCUS_ID],
  });
  expect(created.status).toBe(201);
  const newTemplateId = ((await created.json()) as { data: { id: string } }).data.id;

  const after = await (await request(`/api/v1/events/${EVENT_ID}/onboarding`)).json() as OnboardingSnapshot;
  // The column exists, and it is not the only thing that has to be true: the
  // matrix reads state out of `cells`, keyed by template id.
  expect(after.task_templates.map((template) => template.name)).toContain("Confirm participation");

  const marcus = after.rows.find((row) => row.person.id === MARCUS_ID);
  expect(marcus, "Marcus is on the board through his accepted session").toBeDefined();
  expect(marcus!.cells[newTemplateId]?.state).toBe("upcoming");
  // His row is not blank state everywhere — the newly authored task is real
  // work the board can see, which is exactly what round 4 could not read.
  expect(marcus!.tasks.some((task) => task.state !== "unassigned")).toBe(true);

  const priya = after.rows.find((row) => row.person.id === PRIYA_ID);
  expect(priya!.cells[newTemplateId]?.state).toBe("upcoming");
  expect(priya!.cells[ORIGINAL_TEMPLATE_ID]?.state).toBe("upcoming");

  // The facet the judge found working and the column set stay the same list.
  expect(after.facets.task_types.map((facet) => facet.id).sort()).toEqual([ORIGINAL_TEMPLATE_ID, newTemplateId].sort());
});

test("CONTRACT · MRQ-164 · a speaker owing nothing is distinguishable from one whose tasks are unstarted", async () => {
  const snapshot = await (await request(`/api/v1/events/${EVENT_ID}/onboarding`)).json() as OnboardingSnapshot;
  const marcus = snapshot.rows.find((row) => row.person.id === MARCUS_ID);
  const priya = snapshot.rows.find((row) => row.person.id === PRIYA_ID);
  // Marcus holds no task of any template; Priya holds one, unstarted. The two
  // cases must not read the same, which is what the matrix row now says.
  expect(marcus!.tasks.every((task) => task.state === "unassigned")).toBe(true);
  expect(priya!.tasks.some((task) => task.state === "upcoming")).toBe(true);
});
