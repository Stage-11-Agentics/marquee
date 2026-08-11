import { beforeEach, expect, test } from "vitest";

import { loadLandingData, renderLandingDocument } from "../../src/routes/landing.route";
import { applyMigrations, env } from "./apply-migrations";

const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const SHELL = `<!doctype html><html><head></head><body><div id="app"></div></body></html>`;

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_landing", "Landing Conference", "landing", NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)").bind("evt_landing", "org_landing", "AIE NYC 2026", "aie-nyc-2026", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-agents", "evt_landing", "Agents", "#db4c3f", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("building-main", "evt_landing", "Main", "1 Main St", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("room-main", "evt_landing", "building-main", "Main Room", 100, 0, NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, position, created_at, updated_at) VALUES (?, ?, ?, 'acknowledge', ?, ?, ?, ?, ?)").bind("template-task", "evt_landing", "Confirm participation", "Confirm your participation.", 7, 0, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)").bind("person-one", "org_landing", "one@example.com", "Avery One", NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)").bind("person-two", "org_landing", "two@example.com", "Briar Two", NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, primary_track_id, origin, submitter_person_id, submitted_at, last_saved_at, created_at, updated_at) VALUES (?, ?, 'abstract', ?, ?, ?, 'public', ?, ?, ?, ?, ?)").bind("sub-submitted", "evt_landing", "Submitted abstract", "submitted", "track-agents", "person-one", NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, primary_track_id, origin, submitter_person_id, submitted_at, last_saved_at, created_at, updated_at) VALUES (?, ?, 'abstract', ?, ?, ?, 'public', ?, ?, ?, ?, ?)").bind("sub-review", "evt_landing", "Review abstract", "in_review", "track-agents", "person-one", NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, primary_track_id, origin, submitter_person_id, submitted_at, last_saved_at, created_at, updated_at) VALUES (?, ?, 'abstract', ?, ?, ?, 'public', ?, ?, ?, ?, ?)").bind("sub-accepted", "evt_landing", "Accepted abstract", "accepted", "track-agents", "person-two", NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, primary_track_id, origin, submitter_person_id, last_saved_at, created_at, updated_at) VALUES (?, ?, 'abstract', ?, 'draft', ?, 'public', ?, ?, ?, ?)").bind("sub-draft", "evt_landing", "Draft abstract", "track-agents", "person-two", NOW, NOW, NOW),
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'acknowledge', ?, ?, 'open', ?, ?)").bind("task-one", "evt_landing", "person-two", "sub-accepted", "template-task", "Confirm participation", "Confirm the session.", NOW - 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, ?, ?, ?, ?, ?, ?)").bind("agenda-private", "evt_landing", "sub-accepted", NOW, 30, "room-main", "track-agents", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, ?, ?, ?, ?, ?, ?)").bind("agenda-public", "evt_landing", "sub-review", NOW, 30, "room-main", "track-agents", 1, NOW, NOW),
  ]);
});

test("AC-1, AC-2 · the SSR landing exposes both reachable demo entries and live non-zero preview counts", async () => {
  const data = await loadLandingData(env.DB);
  expect(data.conferenceName).toBe("AIE NYC 2026");
  expect(data.counts).toEqual({
    submitted: 3,
    inReview: 1,
    accepted: 1,
    onboarding: 1,
    scheduled: 2,
    published: 1,
    reviewPressure: 2,
    overdueSpeakers: 1,
  });

  const html = renderLandingDocument(SHELL, data);
  expect(html).toContain("Fantastic conferences, effortlessly.");
  expect(html).toContain('data-demo-role="organizer"');
  expect(html).toContain('data-demo-role="speaker"');
  expect(html).toContain("Submitted");
  expect(html).toContain(">3</strong>");
  expect(html).toContain(">1</strong>");
  expect(html).toContain("/submissions?demo=organizer");
  expect(html).toContain("/submissions?demo=speaker");
});

test("AC-4 · the landing render has crawlable destinations and no placeholder copy", async () => {
  const html = renderLandingDocument(SHELL, await loadLandingData(env.DB));
  expect(html).toContain("https://github.com/Stage-11-Agentics/marquee");
  expect(html).toContain('href="/submissions"');
  expect(html).not.toMatch(/lorem|TODO|placeholder|coming soon|Tab \d/i);
  expect(html).not.toContain("No data");
});
