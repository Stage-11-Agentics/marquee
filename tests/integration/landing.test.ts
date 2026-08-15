import { beforeEach, expect, test } from "vitest";

import { loadLandingData, renderLandingDocument } from "../../src/routes/landing.route";
import { LANDING_THEMES, THEMES } from "../../src/ui/shell/theme";
import { applyMigrations, env } from "./apply-migrations";

// Anchored to the real clock: the fixtures below are offsets ("due yesterday"),
// and the server compares those columns against Date.now().
const NOW = Date.now();
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
    // clock-check: allow — this task uses a due_offset_days template, so its override is compared as an exact instant
    env.DB.prepare("INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'acknowledge', ?, ?, 'open', ?, ?)").bind("task-one", "evt_landing", "person-two", "sub-accepted", "template-task", "Confirm participation", "Confirm the session.", NOW - 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, ?, ?, ?, ?, ?, ?)").bind("agenda-private", "evt_landing", "sub-accepted", NOW, 30, "room-main", "track-agents", 0, NOW, NOW),
    env.DB.prepare("INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, ?, ?, ?, ?, ?, ?)").bind("agenda-public", "evt_landing", "sub-review", NOW, 30, "room-main", "track-agents", 1, NOW, NOW),
  ]);
});

test("AC-1, AC-2 · the SSR landing exposes both reachable demo entries and live non-zero preview counts", async () => {
  const data = await loadLandingData(env.DB);
  expect(data.conferenceName).toBe("AIE NYC 2026");
  expect(data.counts).toEqual({
    submitted: 1,
    inReview: 1,
    accepted: 0,
    onboarding: 0,
    scheduled: 1,
    published: 1,
    reviewPressure: 2,
    overdueSpeakers: 1,
  });

  const html = renderLandingDocument(SHELL, data);
  expect(html).toContain("Fantastic conferences, effortlessly.");
  expect(html).toContain('data-demo-role="organizer"');
  expect(html).toContain('data-demo-role="speaker"');
  // MRQ-107: the third door. ABS-S3 step 1 starts by reaching a reviewer seat,
  // and the reviewer queue is the only surface that answers it.
  expect(html).toContain('data-demo-role="reviewer"');
  expect(html).toContain("/reviewer?demo=reviewer");
  expect(html).toContain("Submitted");
  expect(html).toContain(">1</strong>");
  expect(html).toContain(">1</strong>");
  expect(html).toContain("/submissions?demo=organizer");
  // The speaker demo must land in the Speaker Portal. Sending it to the
  // organizer register is a 403 dead end: the speaker persona has no read
  // access to the submission list.
  expect(html).toContain("/portal?demo=speaker");
  expect(html).not.toContain("/submissions?demo=speaker");
  // The public CFP door is for a signed-out visitor: it must open the public
  // form, not the organizer register behind a sign-in.
  expect(html).toContain('href="/f/cfp"');
});

test("AC-4 · the landing render has crawlable destinations and no placeholder copy", async () => {
  const html = renderLandingDocument(SHELL, await loadLandingData(env.DB));
  expect(html).toContain("https://github.com/Stage-11-Agentics/marquee");
  expect(html).toContain('href="/submissions?demo=organizer"');
  expect(html).toContain('href="/f/cfp"');
  expect(html).not.toMatch(/lorem|TODO|placeholder|coming soon|Tab \d/i);
  expect(html).not.toContain("No data");
});

test("CONTRACT · CFP-03 landing brand copy follows the current conference name", async () => {
  await env.DB.prepare("UPDATE events SET name = ? WHERE id = ?").bind("Future Summit 2028", "evt_landing").run();
  const html = renderLandingDocument(SHELL, await loadLandingData(env.DB));

  expect(html).toContain("Future Summit 2028");
  expect(html).toContain("Built for Future Summit 2028");
  expect(html).toContain("the populated Future Summit 2028 workspace");
  expect(html).not.toContain("Built for AIE NYC 2026");
  expect(html).not.toContain("populated AIE NYC 2026 workspaces");
});

test("CONTRACT · the landing offers the four front-door themes, previewed, before the role doors", async () => {
  const html = renderLandingDocument(SHELL, await loadLandingData(env.DB));

  // The front door shows four cards, each with a real preview image.
  expect(LANDING_THEMES).toHaveLength(4);
  for (const theme of LANDING_THEMES) {
    expect(html).toContain(`data-theme-choice="${theme.id}"`);
    expect(html).toContain(`/themes/${theme.id}.webp`);
    expect(html).toContain(theme.label);
  }

  // The picker is curated, not a catalogue: a theme the registry carries but
  // the landing set omits must not appear on the front door. It stays reachable
  // from the top-bar switcher, which still offers every registered theme.
  for (const theme of THEMES.filter((registered) => !LANDING_THEMES.includes(registered))) {
    expect(html).not.toContain(`data-theme-choice="${theme.id}"`);
  }

  // The ask ordering is the feature: the look is chosen before the role. The
  // picker section must render ahead of the role doors, and the skip path to
  // them must exist for a visitor who wants none of it.
  // (The nav's "Enter demo" shortcut legitimately sits above the picker; the
  // ordering that matters is against the hero's role doors.)
  expect(html.indexOf("data-theme-choice")).toBeGreaterThan(-1);
  expect(html.indexOf("data-theme-choice")).toBeLessThan(html.indexOf("Enter as organizer"));
  expect(html).toContain('id="choose-role"');
  expect(html).toContain('href="#choose-role"');

  // The choice must persist into the app: the picker writes the same storage
  // key the shell's switcher and the pre-paint script read.
  expect(html).toContain("marquee-theme");
});

test("CONTRACT · picking a theme enters the hero outright, and never by scrolling", async () => {
  const html = renderLandingDocument(SHELL, await loadLandingData(env.DB));

  // Two screens, one document: the picker and the hero both ship, and the stage
  // attribute decides which one is showing.
  expect(html).toContain('html[data-landing-stage="choose"] .hero { display: none; }');
  expect(html).toContain('html[data-landing-stage="enter"] .theme-choose { display: none; }');

  // The stage is resolved in the head, ahead of the markup it governs — a
  // visitor deep-linked past the picker must not see it flash by first.
  const stageScript = html.indexOf("data-marquee-landing-stage");
  expect(stageScript).toBeGreaterThan(-1);
  expect(stageScript).toBeLessThan(html.indexOf("data-theme-choice"));

  // Choosing is arriving. The old behaviour slid the hero up under a picker
  // that stayed on screen; nothing on this page scrolls the visitor anywhere.
  expect(html).not.toContain("scrollIntoView");
  expect(html).toContain('history.pushState(null, "", "#choose-role")');

  // And it is not a one-way door.
  expect(html).toContain("data-landing-back");
});
