/**
 * Work fans out per role, and the decision does not.
 *
 * One accepted session with four people on it: a submitter who is also the
 * speaker, a co-speaker, a moderator, and a comms manager who submitted on
 * behalf of the speaker and never steps on stage. Every assertion here is about
 * a different person getting a different thing, which is the whole ticket.
 */
import { beforeEach, expect, test } from "vitest";

import { applyMigrations, env } from "./apply-migrations";
import { reconcileTaskSet } from "../../src/jobs/cascade/decisions";
import { WORK_HOLDING_PARTICIPATION_ROLES } from "../../src/lib/participants";

const NOW = Date.now();
const ORG_ID = "org_mrq224";
const EVENT_ID = "evt_mrq224";
const SUBMISSION_ID = "sub_mrq224";
const SPEAKER = "per_mrq224_speaker";
const CO_SPEAKER = "per_mrq224_cospeaker";
const MODERATOR = "per_mrq224_moderator";
const OFF_STAGE_SUBMITTER = "per_mrq224_submitter";
const EVERYONE_TEMPLATE = "tt_mrq224_everyone";
const SPEAKER_ONLY_TEMPLATE = "tt_mrq224_speaker_only";

function person(id: string, name: string, email: string) {
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, '[]', 0, 'marquee', ?, ?)`,
  ).bind(id, ORG_ID, email, name, NOW, NOW);
}

function participation(id: string, personId: string, role: string, position: number) {
  return env.DB.prepare(
    `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(id, SUBMISSION_ID, personId, role, position, NOW, NOW);
}

function template(id: string, name: string, position: number, appliesToRoles: readonly string[] | null) {
  return env.DB.prepare(
    `INSERT INTO task_templates
      (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, applies_to_roles, created_at, updated_at)
     VALUES (?, ?, ?, 'acknowledge', '', NULL, 14, NULL, NULL, ?, 1, ?, ?, ?)`,
  ).bind(
    id,
    EVENT_ID,
    name,
    position,
    JSON.stringify(appliesToRoles ?? WORK_HOLDING_PARTICIPATION_ROLES),
    NOW,
    NOW,
  );
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "Participant fan-out", "mrq224", NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, '2027-05-04', '2027-05-06', 'America/New_York', NULL, 'live', 0, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, "Participant fan-out", "mrq224", NOW, NOW),
    person(SPEAKER, "Robin Alvarez", "robin@example.com"),
    person(CO_SPEAKER, "Dana Kowalski", "dana@example.com"),
    person(MODERATOR, "Ana Reyes", "ana@example.com"),
    person(OFF_STAGE_SUBMITTER, "Sam Chen", "sam@example.com"),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at)
       VALUES (?, ?, 'session', ?, 'accepted', 'public', ?, ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, "The panel that finished", OFF_STAGE_SUBMITTER, NOW, NOW),
    participation("part_mrq224_submitter", OFF_STAGE_SUBMITTER, "submitter", 0),
    participation("part_mrq224_speaker", SPEAKER, "speaker", 0),
    participation("part_mrq224_cospeaker", CO_SPEAKER, "co_speaker", 1),
    participation("part_mrq224_moderator", MODERATOR, "moderator", 2),
    template(EVERYONE_TEMPLATE, "Upload your slides", 0, null),
    template(SPEAKER_ONLY_TEMPLATE, "Sign the speaker release", 1, ["speaker"]),
  ]);
});

async function assignees(templateId: string): Promise<string[]> {
  const rows = await env.DB
    .prepare("SELECT person_id FROM speaker_tasks WHERE template_id = ? AND cancelled_at IS NULL")
    .bind(templateId)
    .all<{ person_id: string }>();
  return rows.results.map((row) => row.person_id).sort();
}

test("CONTRACT · MRQ-224 · a task goes to the roles its template names, and no further", async () => {
  await reconcileTaskSet(env.DB, EVENT_ID, [SUBMISSION_ID], NOW);

  // "Upload your slides" is everyone on stage — including the moderator, who
  // before this ticket held no task, no invite, and no portal seat.
  expect(await assignees(EVERYONE_TEMPLATE)).toEqual([CO_SPEAKER, MODERATOR, SPEAKER].sort());

  // "Sign the speaker release" is the organizer's narrowing, and it is honoured.
  expect(await assignees(SPEAKER_ONLY_TEMPLATE)).toEqual([SPEAKER]);

  // The comms manager who submitted on someone else's behalf holds no stage
  // role, so the conference owes them nothing to do (AC-272). Their seat in the
  // portal shows the submission's status and an empty task list.
  expect(await assignees(EVERYONE_TEMPLATE)).not.toContain(OFF_STAGE_SUBMITTER);
});

test("CONTRACT · MRQ-224 · reconciling twice assigns once, per template and person", async () => {
  await reconcileTaskSet(env.DB, EVENT_ID, [SUBMISSION_ID], NOW);
  const first = await assignees(EVERYONE_TEMPLATE);
  await reconcileTaskSet(env.DB, EVENT_ID, [SUBMISSION_ID], NOW + 1_000);
  expect(await assignees(EVERYONE_TEMPLATE)).toEqual(first);

  // The submission stores its submitter as a participant *and* as a speaker
  // where they are the same person; a moderator can equally also be a
  // co-speaker. The task set is keyed on template, submission, and person, so a
  // second role is a duplicate row in the join, never a second task.
  await env.DB
    .prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
       VALUES (?, ?, ?, 'co_speaker', 3, 'pending', ?, ?)`,
    )
    .bind("part_mrq224_moderator_also", SUBMISSION_ID, MODERATOR, NOW, NOW)
    .run();
  await reconcileTaskSet(env.DB, EVENT_ID, [SUBMISSION_ID], NOW + 2_000);
  expect(await assignees(EVERYONE_TEMPLATE)).toEqual(first);
});

test("CONTRACT · MRQ-224 · a template with unreadable targeting reaches everyone, never nobody", async () => {
  // No CHECK stands behind this column, so an import, a hand-run statement, or
  // a future migration can leave it malformed. Reaching everyone is the
  // behaviour that predates the column and is obvious the moment it is wrong; a
  // template that silently reaches no one is invisible on every screen.
  await env.DB
    .prepare("UPDATE task_templates SET applies_to_roles = ? WHERE id = ?")
    .bind("not json at all", EVERYONE_TEMPLATE)
    .run();
  await reconcileTaskSet(env.DB, EVENT_ID, [SUBMISSION_ID], NOW);
  expect(await assignees(EVERYONE_TEMPLATE)).toEqual([CO_SPEAKER, MODERATOR, SPEAKER].sort());
});

test("CONTRACT · MRQ-224 · acceptance seats every on-stage participant in the event", async () => {
  await reconcileTaskSet(env.DB, EVENT_ID, [SUBMISSION_ID], NOW);
  const rows = await env.DB
    .prepare("SELECT person_id FROM memberships WHERE event_id = ? AND role = 'speaker'")
    .bind(EVENT_ID)
    .all<{ person_id: string }>();
  // The membership row is what portal sign-in, headshot ownership, and the
  // comms audience read. The moderator is the person this ticket exists for.
  expect(rows.results.map((row) => row.person_id).sort()).toEqual([CO_SPEAKER, MODERATOR, SPEAKER].sort());
  expect(rows.results.map((row) => row.person_id)).not.toContain(OFF_STAGE_SUBMITTER);
});
