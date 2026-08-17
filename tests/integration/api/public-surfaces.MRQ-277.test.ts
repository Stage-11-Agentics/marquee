/**
 * MRQ-277 D4 and D9 — two public surfaces that told an organizer something
 * untrue in eval round 15.
 *
 * D4: `/announce` published "Call for speakers · open" pointing at Hotel and
 * Travel Reservations. The query behind it took whichever non-draft form sorted
 * first, and a conference's post-acceptance forms are non-draft too — so
 * closing the real call promoted a speaker-logistics form into the one surface
 * whose entire job is handing out correct public links.
 *
 * D9: choosing "iCal feed" on `/embed/config` left the previous output's body
 * in the preview pane. The frame is pointed at the feed itself, and a browser
 * will not render `text/calendar` in a frame — it treats it as a download and
 * keeps the document it already had.
 */
import { beforeAll, describe, expect, test } from "vitest";

import { app } from "../../../src/index";
import { loadPublicCfp } from "../../../src/lib/public-site";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);
const ORG_ID = "org_mrq277_public";
const EVENT_ID = "evt_mrq277_public";
const EVENT_SLUG = "mrq-277-public";

function form(id: string, name: string, slug: string, kind: "abstract" | "session", status: string, opensAt: number | null): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, min_speakers, max_speakers, submitter_limit_inherit, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, 1, ?, ?)`,
  ).bind(id, EVENT_ID, name, slug, kind, status, opensAt, NOW, NOW);
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "MRQ-277 Public", "mrq-277-public-org", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Round 15 Conference', ?, 'Ship it', '2027-03-01', '2027-03-03', 'America/New_York', 'Somewhere', '#0b6a72', 'live', 1, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, EVENT_SLUG, NOW, NOW),
    // The call for papers, and a logistics form that opened later — the exact
    // pair the graded conference holds.
    form("form_mrq277_cfp", "Call for Speakers", "mrq277-cfp", "abstract", "open", NOW - 86_400_000),
    form("form_mrq277_hotel", "Hotel and Travel Reservations", "mrq277-hotel-travel", "session", "open", NOW),
  ]);
}

describe.sequential("MRQ-277 · public surfaces tell the truth", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · MRQ-277 · the call-for-speakers link is the call for speakers, open or closed", async () => {
    const open = await loadPublicCfp(env.DB, EVENT_ID);
    expect(open?.formSlug).toBe("mrq277-cfp");
    expect(open?.url).toBe("/f/mrq277-cfp");
    expect(open?.status).toBe("open");

    // Closing the call must not hand the link to a different form. This is the
    // state the graded conference was in when it advertised the hotel form.
    await env.DB.prepare("UPDATE forms SET status = 'closed' WHERE id = 'form_mrq277_cfp'").run();
    const closed = await loadPublicCfp(env.DB, EVENT_ID);
    expect(closed?.formSlug).toBe("mrq277-cfp");
    expect(closed?.status).toBe("closed");

    // And a conference with no call for papers at all says so, rather than
    // promoting a logistics form into the slot.
    await env.DB.prepare("UPDATE forms SET kind = 'session' WHERE id = 'form_mrq277_cfp'").run();
    expect(await loadPublicCfp(env.DB, EVENT_ID)).toBeNull();

    await env.DB.prepare("UPDATE forms SET kind = 'abstract', status = 'open' WHERE id = 'form_mrq277_cfp'").run();
  });

  test("CONTRACT · MRQ-277 · the iCal preview is served as readable text while the feed itself stays a calendar", async () => {
    const feed = await app.request(`${ORIGIN}/embed/${EVENT_SLUG}-agenda.ics`, {}, env);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    const body = await feed.text();
    expect(body).toContain("BEGIN:VCALENDAR");

    const preview = await app.request(`${ORIGIN}/embed/${EVENT_SLUG}-agenda.ics?preview=ical`, {}, env);
    expect(preview.status).toBe(200);
    // A frame renders text/plain and refuses text/calendar; same bytes either way.
    expect(preview.headers.get("content-type")).toContain("text/plain");
    expect(await preview.text()).toBe(body);
  });
});
