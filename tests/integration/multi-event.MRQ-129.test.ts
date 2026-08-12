/**
 * Multi-event, driven through the shipped Worker.
 *
 * One file on purpose: every Worker-backed test file costs a Miniflare isolate
 * and the suite budget is 45 s. The pure-logic half of this band lives in
 * `tests/unit/event-selection.MRQ-129.test.ts`, which pays for neither.
 *
 * What is asserted here is the set of things the schema accepts in silence: a
 * round pointing at another conference's committee, a speaker task pointing at
 * another conference's form, a copied form still carrying last year's dates, a
 * created conference surviving the reset, and the demo oracle answering with
 * whichever conference happens to sort first.
 */
import { beforeEach, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../src/lib/auth/auth-sessions";
import { COPY_TABLES, declaredColumns } from "../../src/lib/events/copy-manifest";
import {
  SHIPPED_DEMO_EVENT_ID,
  SHIPPED_DEMO_ORGANIZATION_ID,
  SHIPPED_DEMO_ORGANIZER_PERSON_ID,
} from "../../src/lib/reset-demo/demo-fixture";
import { reseedDemo } from "../../src/lib/reset-demo/reseed-demo";
import { applyMigrations, env } from "./apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);
const ORG_ID = "org_multi_event";
const OWNER_ID = "per_multi_owner";
const REVIEWER_ID = "per_multi_reviewer";
const SOURCE_EVENT_ID = "evt_multi_source";
const OTHER_EVENT_ID = "evt_multi_other";
const COMMITTEE_ID = "com_multi_source";
const FORM_ID = "frm_multi_source";
const PLAN_ID = "plan_multi_source";
const ROUND_ID = "rnd_multi_source";
const BUILDING_ID = "bld_multi_source";

interface Envelope<T> {
  data: T;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, init);
}

async function sessionCookie(personId: string): Promise<string> {
  const session = await createSession(env.DB, { personId, userAgent: "mrq-129" });
  return `mq_session=${session.id}`;
}

function insert(sql: string, ...bindings: (string | number | null)[]): D1PreparedStatement {
  return env.DB.prepare(sql).bind(...bindings);
}

/**
 * One organization, two conferences, and a source conference carrying at least
 * one row in every table the copy contract touches — including the two that
 * point across tables (a round with a committee, a task template with a form).
 */
async function seedOrganization(): Promise<void> {
  await env.DB.batch([
    insert("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ORG_ID, "Great Lakes Infra", "great-lakes-infra", NOW, NOW),
    insert("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, ?)", SOURCE_EVENT_ID, ORG_ID, "Great Lakes 2026", "great-lakes-2026", "2026-10-19", "2026-10-21", "America/New_York", NOW, NOW),
    insert("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?)", OTHER_EVENT_ID, ORG_ID, "Great Lakes Code 2026", "great-lakes-code-2026", "2026-12-08", "2026-12-09", "America/New_York", NOW, NOW),
    insert("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', '{}', ?, ?)", OWNER_ID, ORG_ID, "sam@gl-infra.dev", "Sam Okonkwo-Barnes", NOW, NOW),
    insert("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', '{}', ?, ?)", REVIEWER_ID, ORG_ID, "rue@gl-infra.dev", "Rue Adeyemi-Castellanos", NOW, NOW),
    insert("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)", "mem_multi_owner", ORG_ID, OWNER_ID, NOW, NOW),
    // Event-scoped, and only on the source conference: this is the membership
    // that must not inherit sideways into the other one.
    insert("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'reviewer', ?, ?)", "mem_multi_reviewer", ORG_ID, SOURCE_EVENT_ID, REVIEWER_ID, NOW, NOW),
  ]);

  await env.DB.batch([
    insert("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 30, 20, 45, 0, ?, ?)", "fmt_multi", SOURCE_EVENT_ID, "Talk", NOW, NOW),
    insert("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)", "trk_multi", SOURCE_EVENT_ID, "Agents", "#3B82F6", NOW, NOW),
    insert("INSERT INTO buildings (id, event_id, name, address, position, access_minutes, access_note, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 7, ?, ?, ?)", BUILDING_ID, SOURCE_EVENT_ID, "Javits Center", "429 11th Ave", "Enter on 11th", NOW, NOW),
    insert("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, created_at, updated_at) VALUES (?, ?, ?, ?, 400, 0, '[]', ?, ?)", "rm_multi", SOURCE_EVENT_ID, BUILDING_ID, "Hall A", NOW, NOW),
    insert("INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'abstract', 'open', ?, ?, ?, ?, ?)", FORM_ID, SOURCE_EVENT_ID, "Call for speakers", "cfp", NOW - 1_000, NOW + 1_000, "argon2:whatever", NOW, NOW),
    insert("INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)", "tpl_multi", SOURCE_EVENT_ID, "accepted", "Accepted", "You're in", "Congratulations.", NOW, NOW),
    insert("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", COMMITTEE_ID, SOURCE_EVENT_ID, "Program committee", NOW, NOW),
    insert("INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at) VALUES (?, ?, ?, '', 1, 5, 'open', ?, ?)", PLAN_ID, SOURCE_EVENT_ID, "2026 Program Review", NOW, NOW),
  ]);

  await env.DB.batch([
    insert("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at) VALUES (?, ?, ?, ?, 'short_text', 1, 0, '{}', ?, ?)", "ff_multi_title", FORM_ID, "title", "Title", NOW, NOW),
    insert("INSERT INTO form_admins (id, form_id, person_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", "fa_multi", FORM_ID, OWNER_ID, NOW, NOW),
    insert("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, opens_at, closes_at, committee_id, created_at, updated_at) VALUES (?, ?, 0, ?, 'scorecard', 0, 3, ?, ?, ?, ?, ?)", ROUND_ID, PLAN_ID, "Round one", NOW - 1_000, NOW + 1_000, COMMITTEE_ID, NOW, NOW),
    insert("INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, position, auto_assign, created_at, updated_at) VALUES (?, ?, ?, 'form', '', NULL, 14, ?, 0, 1, ?, ?)", "tt_multi_form", SOURCE_EVENT_ID, "Speaker details", FORM_ID, NOW, NOW),
    insert("INSERT INTO task_templates (id, event_id, name, kind, description, due_at, due_offset_days, form_id, position, auto_assign, created_at, updated_at) VALUES (?, ?, ?, 'acknowledge', '', ?, NULL, NULL, 1, 0, ?, ?)", "tt_multi_fixed", SOURCE_EVENT_ID, "Confirm travel", NOW + 90_000_000, NOW, NOW),
    insert("INSERT INTO submissions (id, event_id, form_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, ?, 'abstract', ?, 'submitted', 'admin', ?, ?, ?)", "sub_multi", SOURCE_EVENT_ID, FORM_ID, "A talk", OWNER_ID, NOW, NOW),
  ]);
  await env.DB.prepare(
    "INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, kind, created_at, updated_at) VALUES (?, ?, ?, 100, 0, 'numeric', ?, ?)",
  ).bind("rc_multi", ROUND_ID, "Relevance", NOW, NOW).run();
}

async function createConference(cookie: string, body: Record<string, unknown>): Promise<Response> {
  return request("/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "Great Lakes 2027",
      starts_on: "2027-10-18",
      ends_on: "2027-10-20",
      timezone: "America/New_York",
      ...body,
    }),
  });
}

beforeEach(async () => {
  await applyMigrations();
});

test("CONTRACT · MRQ-129 the copy manifest accounts for every column in every table it copies", async () => {
  // Discovery means a new column is never silently dropped; this means it is
  // never silently leaked. A migration that adds one fails here, which is the
  // only moment anyone is in a position to rule on where it should go.
  for (const table of COPY_TABLES) {
    const info = await env.DB.prepare(`PRAGMA table_info(${table.table})`).all<{ name: string }>();
    const live = info.results.map((column) => column.name).sort();
    expect(live.length, `${table.table} has no columns — the PRAGMA did not run`).toBeGreaterThan(0);
    expect(declaredColumns(table).sort(), `${table.table} drifted from copy-manifest.ts`).toEqual(live);
  }
});

test("CONTRACT · MRQ-129 the events list is scoped to the organization and to what each seat can read", async () => {
  await seedOrganization();

  const owner = await request("/api/v1/events", { headers: { cookie: await sessionCookie(OWNER_ID) } });
  expect(owner.status).toBe(200);
  const ownerBody = await owner.json() as Envelope<{ id: string; role: string; submission_count: number; past: boolean }[]>;
  expect(ownerBody.data.map((event) => event.id).sort()).toEqual([OTHER_EVENT_ID, SOURCE_EVENT_ID].sort());
  const source = ownerBody.data.find((event) => event.id === SOURCE_EVENT_ID);
  expect(source?.role).toBe("owner");
  expect(source?.submission_count).toBe(1);

  // A reviewer membership never inherits across conferences (AC-214), so the
  // list is where that stops being an authorization detail and becomes a thing
  // the reviewer can see.
  const reviewer = await request("/api/v1/events", { headers: { cookie: await sessionCookie(REVIEWER_ID) } });
  const reviewerBody = await reviewer.json() as Envelope<{ id: string; role: string }[]>;
  expect(reviewerBody.data.map((event) => event.id)).toEqual([SOURCE_EVENT_ID]);
  expect(reviewerBody.data[0]?.role).toBe("reviewer");

  const anonymous = await request("/api/v1/events");
  expect(anonymous.status).toBe(401);
});

test("CONTRACT · MRQ-129 a copied conference carries the structure and none of the cross-conference references", async () => {
  await seedOrganization();
  const cookie = await sessionCookie(OWNER_ID);

  const response = await createConference(cookie, { copy_from: SOURCE_EVENT_ID });
  expect(response.status).toBe(201);
  const body = await response.json() as Envelope<{
    event: { id: string };
    copied: Record<string, number>;
    task_templates_skipped_fixed_due: number;
  }>;
  const created = body.data.event.id;

  expect(body.data.copied.formats).toBe(1);
  expect(body.data.copied.tracks).toBe(1);
  // Venues are the one set that is off unless asked for.
  expect(body.data.copied.buildings).toBeUndefined();

  const round = await env.DB.prepare(
    "SELECT r.committee_id, r.opens_at, r.closes_at FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?",
  ).bind(created).first<{ committee_id: string | null; opens_at: number | null; closes_at: number | null }>();
  expect(round?.committee_id).toBeNull();
  expect(round?.opens_at).toBeNull();
  expect(round?.closes_at).toBeNull();

  const plan = await env.DB.prepare("SELECT status FROM evaluation_plans WHERE event_id = ?").bind(created).first<{ status: string }>();
  expect(plan?.status).toBe("draft");

  const form = await env.DB.prepare("SELECT id, status, opens_at, closes_at, password_hash FROM forms WHERE event_id = ?").bind(created).first<{ id: string; status: string; opens_at: number | null; closes_at: number | null; password_hash: string | null }>();
  expect(form?.status).toBe("closed");
  expect(form?.opens_at).toBeNull();
  expect(form?.closes_at).toBeNull();
  expect(form?.password_hash).toBe("argon2:whatever");
  expect(form?.id).not.toBe(FORM_ID);

  // The remap the design's list forgot: a form-kind speaker task pointing at
  // last year's form is legal at the database level and wrong everywhere else.
  const template = await env.DB.prepare("SELECT form_id, due_offset_days FROM task_templates WHERE event_id = ? AND kind = 'form'").bind(created).first<{ form_id: string; due_offset_days: number }>();
  expect(template?.form_id).toBe(form?.id);
  expect(template?.due_offset_days).toBe(14);

  // The one with a fixed calendar deadline is declined and counted, not
  // silently reshaped into an offset that means something else.
  const fixed = await env.DB.prepare("SELECT COUNT(*) AS total FROM task_templates WHERE event_id = ? AND due_at IS NOT NULL").bind(created).first<{ total: number }>();
  expect(Number(fixed?.total)).toBe(0);
  expect(body.data.task_templates_skipped_fixed_due).toBe(1);

  // Structure copies; the conference's own record does not.
  const submissions = await env.DB.prepare("SELECT COUNT(*) AS total FROM submissions WHERE event_id = ?").bind(created).first<{ total: number }>();
  expect(Number(submissions?.total)).toBe(0);
  const committees = await env.DB.prepare("SELECT COUNT(*) AS total FROM committees WHERE event_id = ?").bind(created).first<{ total: number }>();
  expect(Number(committees?.total)).toBe(0);

  // A column three migrations added to a table in the copy set. Discovery, not
  // a literal list, is what keeps it travelling.
  const withVenues = await createConference(cookie, { name: "Great Lakes 2028", copy_from: SOURCE_EVENT_ID, copy: { venues: true } });
  expect(withVenues.status).toBe(201);
  const venueBody = await withVenues.json() as Envelope<{ event: { id: string } }>;
  const building = await env.DB.prepare("SELECT access_note, access_minutes FROM buildings WHERE event_id = ?").bind(venueBody.data.event.id).first<{ access_note: string; access_minutes: number }>();
  expect(building?.access_note).toBe("Enter on 11th");
  expect(building?.access_minutes).toBe(7);
  const room = await env.DB.prepare("SELECT building_id FROM rooms WHERE event_id = ?").bind(venueBody.data.event.id).first<{ building_id: string }>();
  expect(room?.building_id).not.toBe(BUILDING_ID);
});

test("CONTRACT · MRQ-129 an illegal copy selection is refused before anything is written, not rolled back after", async () => {
  await seedOrganization();
  const cookie = await sessionCookie(OWNER_ID);

  // CHECK (kind <> 'form' OR form_id IS NOT NULL) would roll the whole batch
  // back and answer 500 on a checkbox combination the screen itself offered.
  const response = await createConference(cookie, {
    copy_from: SOURCE_EVENT_ID,
    copy: { task_templates: true, forms: false },
  });
  expect(response.status).toBe(422);
  const body = await response.json() as { error: { code: string; message: string } };
  expect(body.error.code).toBe("unprocessable");
  expect(body.error.message).toContain("Speaker details");

  const events = await env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE org_id = ?").bind(ORG_ID).first<{ total: number }>();
  expect(Number(events?.total)).toBe(2);

  // A form whose dropdowns are filled from formats and tracks BY NAME is
  // unsubmittable without them.
  await env.DB.prepare("UPDATE form_fields SET type = 'single_select', config = ? WHERE id = ?")
    .bind(JSON.stringify({ source: "formats" }), "ff_multi_title").run();
  const bound = await createConference(cookie, {
    copy_from: SOURCE_EVENT_ID,
    copy: { forms: true, formats: false, tracks: true },
  });
  expect(bound.status).toBe(422);

  const unknown = await createConference(cookie, { copy_from: "evt_someone_elses" });
  expect(unknown.status).toBe(404);
});

test("CONTRACT · MRQ-129 the copy plan reports what would travel, what is locked, and what will be declined", async () => {
  await seedOrganization();
  const cookie = await sessionCookie(OWNER_ID);
  const response = await request(`/api/v1/events/${SOURCE_EVENT_ID}/copy-plan`, { headers: { cookie } });
  expect(response.status).toBe(200);
  const body = await response.json() as Envelope<{
    counts: Record<string, number>;
    task_templates_skipped_fixed_due: number;
    requires: Record<string, string[]>;
    reasons: Record<string, string>;
  }>;
  expect(body.data.counts.formats).toBe(1);
  expect(body.data.counts.form_fields).toBe(1);
  expect(body.data.counts.task_templates).toBe(1);
  expect(body.data.task_templates_skipped_fixed_due).toBe(1);
  expect(body.data.requires.task_templates).toEqual(["forms"]);
  expect(body.data.reasons.task_templates).toContain("Speaker details");
});

test("CONTRACT · MRQ-129 the reset sweeps the demo organization, and the demo oracle stays the seeded conference", async () => {
  // `npm run seed` — the documented production path — stamps every seeded row
  // with a frozen clock that is currently in the future, which is exactly the
  // condition that made "oldest demo conference" the wrong oracle.
  const seedClock = Date.now() + 8 * 24 * 60 * 60 * 1000;
  await reseedDemo(env.DB, seedClock, env.MEDIA);
  const cookie = await sessionCookie(SHIPPED_DEMO_ORGANIZER_PERSON_ID);

  const created = await createConference(cookie, { name: "Forward Summit 2028" });
  expect(created.status).toBe(201);
  const createdId = (await created.json() as Envelope<{ event: { id: string; demo_mode?: number } }>).data.event.id;
  const inherited = await env.DB.prepare("SELECT demo_mode, created_at FROM events WHERE id = ?").bind(createdId).first<{ demo_mode: number; created_at: number }>();
  expect(Number(inherited?.demo_mode)).toBe(1);

  // The seeded conference is stamped with a frozen clock in the future, so the
  // created one genuinely sorts first by age. Resolving by identity is what
  // keeps the whole product pointed at the demo it seeded.
  const seededAt = await env.DB.prepare("SELECT created_at FROM events WHERE id = ?").bind(SHIPPED_DEMO_EVENT_ID).first<{ created_at: number }>();
  expect(Number(inherited?.created_at)).toBeLessThan(Number(seededAt?.created_at));
  const me = await request("/api/v1/auth/me", { headers: { cookie } });
  const identity = await me.json() as { demo_event_id: string };
  expect(identity.demo_event_id).toBe(SHIPPED_DEMO_EVENT_ID);

  const uploadKey = `uploads/${createdId}/task_upload/deck.pdf`;
  await env.MEDIA.put(uploadKey, "not really a deck");

  await reseedDemo(env.DB, seedClock + 1_000, env.MEDIA);

  const survivor = await env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE org_id = ? AND id <> ?")
    .bind(SHIPPED_DEMO_ORGANIZATION_ID, SHIPPED_DEMO_EVENT_ID)
    .first<{ total: number }>();
  expect(Number(survivor?.total)).toBe(0);
  // Deleting the attachments rows and leaving the partition behind is how the
  // bucket accretes objects nothing can index.
  expect(await env.MEDIA.get(uploadKey)).toBeNull();
  const seeded = await env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE id = ?").bind(SHIPPED_DEMO_EVENT_ID).first<{ total: number }>();
  expect(Number(seeded?.total)).toBe(1);
});
