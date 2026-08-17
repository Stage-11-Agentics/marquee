import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { sha256Hex } from "../../../src/lib/auth/random-token";
import { IDEMPOTENCY_REGISTRY } from "../../../src/jobs/mail/idempotency";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-mrq225-announce";
const TOKEN = "mq_mrq225-announce-token";
const SPEAKER_ID = "person-mrq225-speaker";
const NOW = Date.parse("2026-08-16T12:00:00.000Z");

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const tokenHash = await sha256Hex(TOKEN);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org-mrq225-announce', 'MRQ-225 Org', 'mrq225-announce', ?, ?)").bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
       VALUES (?, 'org-mrq225-announce', 'MRQ-225 Conference', 'mrq225-announce', 'A ready public program', '2026-10-01', '2026-10-02', 'UTC', 'The Marquee Hall', '#0b6a72', 'live', 0, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track-mrq225-announce', ?, 'Main', '#0b6a72', 0, ?, ?)").bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at)
       VALUES ('building-mrq225-announce', ?, 'The Marquee Hall', '1 Main Street', 0, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at)
       VALUES ('room-mrq225-announce', ?, 'building-mrq225-announce', 'Main stage', 100, 0, '[]', NULL, ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, created_at, updated_at)
       VALUES
        ('person-mrq225-actor', 'org-mrq225-announce', 'organizer@mrq225.test', 'Program Lead', NULL, NULL, NULL, '[]', ?, ?),
        ('person-mrq225-speaker', 'org-mrq225-announce', 'speaker@mrq225.test', 'Ada Lovelace', 'Analyst', 'Analytical Engines', 'Published speaker bio', '[]', ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('membership-mrq225-announce', 'org-mrq225-announce', ?, 'person-mrq225-actor', 'program_lead', ?, ?)`,
    ).bind(EVENT_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens
        (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('token-mrq225-announce', 'org-mrq225-announce', NULL, 'MRQ-225 test token', ?, 'mq_mrq225', ?, 'person-mrq225-actor', ?, ?)`,
    ).bind(tokenHash, JSON.stringify({ permissions: ["program:read", "program:write"], event_ids: [EVENT_ID] }), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions
        (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
       VALUES ('sub-mrq225-announce', ?, 'session', 'The shareable talk', 'A talk worth sharing publicly.', 'accepted', 'track-mrq225-announce', 'public', ?, 'The shareable talk Ada Lovelace', ?, ?)`,
    ).bind(EVENT_ID, SPEAKER_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
       VALUES ('submission-track-mrq225-announce', 'sub-mrq225-announce', 'track-mrq225-announce', 1, ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
       VALUES ('participation-mrq225-announce', 'sub-mrq225-announce', ?, 'speaker', 0, 'confirmed', ?, ?)`,
    ).bind(SPEAKER_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
       VALUES ('agenda-mrq225-announce', ?, 'sub-mrq225-announce', 'session', ?, 45, 'room-mrq225-announce', 'track-mrq225-announce', 1, ?, ?)`,
    ).bind(EVENT_ID, Date.parse("2026-10-01T14:00:00.000Z"), NOW, NOW),
  ]);
}

function authHeaders(): HeadersInit {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

describe.sequential("MRQ-225 Announce kit", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · MRQ-225 · snapshot reads only the published audience and emits canonical public assets", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/announce`, { headers: authHeaders() });
    expect(response.status).toBe(200);
    const snapshot = await response.json<{
      publication: { live: number; session_count: number; speaker_count: number };
      urls: { agenda: string; speakers: string };
      embed: { source: string; snippet: string } | null;
      announcement_copy: string | null;
      speakers: Array<{ id: string; public_link: string; email: string; talk_title: string }>;
    }>();
    expect(snapshot.publication).toMatchObject({ live: 1, session_count: 1, speaker_count: 1 });
    expect(snapshot.urls.agenda).toBe(`${ORIGIN}/agenda?event=mrq225-announce`);
    expect(snapshot.urls.speakers).toBe(`${ORIGIN}/speakers?event=mrq225-announce`);
    expect(snapshot.embed?.source).toBe(`${ORIGIN}/embed/mrq225-announce-agenda`);
    expect(snapshot.embed?.snippet).toContain('title="MRQ-225 Conference agenda"');
    expect(snapshot.announcement_copy).toContain("The public program for MRQ-225 Conference is live");
    expect(snapshot.speakers).toEqual([
      expect.objectContaining({
        id: SPEAKER_ID,
        email: "speaker@mrq225.test",
        public_link: `${ORIGIN}/p/ada-lovelace?event=mrq225-announce`,
        talk_title: "The shareable talk",
      }),
    ]);
  });

  test("CONTRACT · MRQ-225 · the reviewed plan renders each speaker link and apply queues one idempotent outbox action", async () => {
    const body = {
      selector: { ids: [SPEAKER_ID] },
      subject: "Share your public page",
      body: "Hi {{speaker.first_name}},\n\nShare {{speaker.public_link}}.",
    };
    const planResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/announce/mail-plan`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    expect(planResponse.status).toBe(200);
    const plan = await planResponse.json<{
      action: string;
      rows: Array<{ disposition: string; count: number }>;
      recipient_preview: { to_email: string; text: string; html: string } | null;
      plan_fingerprint: string;
      etag: string;
    }>();
    expect(plan.action).toBe("announce");
    expect(plan.rows.map((row) => row.count)).toEqual([1, 0, 0, 0]);
    expect(plan.recipient_preview).toMatchObject({ to_email: "speaker@mrq225.test" });
    expect(plan.recipient_preview?.text).toContain(`${ORIGIN}/p/ada-lovelace?event=mrq225-announce`);
    expect(plan.recipient_preview?.html).toContain(`${ORIGIN}/p/ada-lovelace?event=mrq225-announce`);
    expect(plan.plan_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.etag).toBe(`"${plan.plan_fingerprint}:0"`);

    const applied = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/announce/mail`, {
      method: "POST",
      headers: { ...authHeaders(), "if-match": plan.etag },
      body: JSON.stringify({ ...body, plan_fingerprint: plan.plan_fingerprint }),
    });
    expect(applied.status).toBe(202);
    expect(await applied.json()).toMatchObject({ selected: 1, succeeded: 1, failed: 0, outbox_enqueued: 1 });

    const outbox = await env.DB.prepare(
      "SELECT entity_id, subject, text, status FROM outbox WHERE event_id = ? ORDER BY created_at ASC",
    ).bind(EVENT_ID).all<{ entity_id: string; subject: string; text: string; status: string }>();
    expect(outbox.results).toHaveLength(1);
    expect(outbox.results[0]).toMatchObject({
      entity_id: IDEMPOTENCY_REGISTRY.announceRecipient(EVENT_ID, SPEAKER_ID),
      subject: "Share your public page",
      status: "queued",
    });
    expect(outbox.results[0]?.text).toContain(`${ORIGIN}/p/ada-lovelace?event=mrq225-announce`);

    const secondPlanResponse = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/announce/mail-plan`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const secondPlan = await secondPlanResponse.json<{ rows: Array<{ disposition: string; count: number }> }>();
    expect(secondPlan.rows.map((row) => row.count)).toEqual([0, 1, 0, 0]);
  });
});
