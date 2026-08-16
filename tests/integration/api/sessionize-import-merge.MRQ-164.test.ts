/**
 * MRQ-164 Part 3 — the Sessionize import is an import, never an erase.
 *
 * A blank CSV cell means "this export does not carry that field", not "delete
 * what the speaker wrote in their portal". A filled cell can fill a missing
 * value, but does not overwrite an existing organizer value.
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_mrq164_import";
const ORG_ID = "org_mrq164_import";
const OWNER_ID = "person_mrq164_owner";
const EXISTING_ID = "person_mrq164_existing";
const BLANK_ID = "person_mrq164_blank";
const HEADSHOT_ID = "person_mrq164_headshot";
const HEADSHOT_ATTACHMENT_ID = "attachment_mrq164_old_headshot";
const LEGACY_ID = "person_mrq164_legacy";
const PORTAL_BIO = "A careful, speaker-written biography that took an afternoon to get right.";

const SPEAKERS_CSV = [
  "Speaker ID,Name,Email,Job Title,Company,Bio,Photo URL",
  // A conflicting title and bio must not replace the organizer's values.
  "speaker-priya,Priya Raman,priya@mrq164.test,Staff Engineer,,Imported biography from the export,",
].join("\n");

const SESSIONS_CSV = [
  "Session ID,Title,Description,Status,Speaker Ids,Session format,Track",
  "sess-mrq164,Taming 40-Minute CI,An import fixture.,Accepted,speaker-priya,Talk,Platform",
].join("\n");

let ownerCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.parse("2026-08-13T12:00:00.000Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "MRQ-164 Import", "mrq-164-import", now, now),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Merge Conference', 'mrq-164-import', '2026-10-01', '2026-10-03', 'UTC', 'live', 0, ?, ?)").bind(EVENT_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES ('format_mrq164_talk', ?, 'Talk', 45, 15, 90, 0, ?, ?)").bind(EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track_mrq164_platform', ?, 'Platform', '#0d9488', 0, ?, ?)").bind(EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'owner@mrq164.test', 'MRQ-164 Owner', NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(OWNER_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'priya@mrq164.test', 'Priya Raman', 'Principal Engineer', 'Northwind Data', ?, NULL, '[]', 0, 'marquee', ?, ?)").bind(EXISTING_ID, ORG_ID, PORTAL_BIO, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'blank@mrq164.test', 'Blank Profile', '   ', '', NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(BLANK_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'headshot@mrq164.test', 'Headshot Profile', NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(HEADSHOT_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'legacy@mrq164.test', 'Legacy Profile', NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(LEGACY_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, created_at, updated_at) VALUES (?, ?, 'person_headshot', ?, 'external:https://cdn.example.test/old.jpg', 'old.jpg', 'image/jpeg', 0, 'pending', ?, ?)").bind(HEADSHOT_ATTACHMENT_ID, EVENT_ID, HEADSHOT_ID, now, now),
    env.DB.prepare("UPDATE people SET headshot_attachment_id = ? WHERE id = ?").bind(HEADSHOT_ATTACHMENT_ID, HEADSHOT_ID),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq164_owner', ?, ?, ?, 'program_lead', ?, ?)").bind(ORG_ID, EVENT_ID, OWNER_ID, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq164_blank', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, EVENT_ID, BLANK_ID, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq164_headshot', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, EVENT_ID, HEADSHOT_ID, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq164_legacy', ?, ?, ?, 'speaker', ?, ?)").bind(ORG_ID, EVENT_ID, LEGACY_ID, now, now),
  ]);
  ownerCookie = `mq_session=${(await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "mrq164-test", now })).id}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", ownerCookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

describe.sequential("MRQ-164 Sessionize import merge", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · MRQ-164 · an import fills gaps but keeps existing profile values, and the row says which", async () => {
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, {
      method: "POST",
      body: JSON.stringify({ source: "sessionize", sessions_csv: SESSIONS_CSV, speakers_csv: SPEAKERS_CSV }),
    });
    expect(uploaded.status).toBe(201);
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
    expect((await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) })).status).toBe(200);

    const run = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(run.status).toBe(200);
    const result = await run.json<{ rows: Array<{ entity: string; outcome: string; reason: string | null }> }>();

    const person = await env.DB.prepare("SELECT title, company, bio FROM people WHERE id = ?").bind(EXISTING_ID).first<{ title: string | null; company: string | null; bio: string | null }>();
    // The speaker's own words survive the export's conflicting bio.
    expect(person?.bio).toBe(PORTAL_BIO);
    expect(person?.company).toBe("Northwind Data");
    // A filled cell that disagrees cannot erase the organizer's value.
    expect(person?.title).toBe("Principal Engineer");

    const speakerRow = result.rows.find((row) => row.entity === "speaker");
    expect(speakerRow?.outcome).toBe("skipped");
    expect(speakerRow?.reason).toContain("matched by normalized email");
    expect(speakerRow?.reason).toContain("kept title, bio (existing value)");
    expect(speakerRow?.reason).toContain("kept company (blank in CSV)");
  });

  test("CONTRACT · MRQ-164 · a filled cell can populate a missing existing profile field", async () => {
    const csv = [
      "Speaker ID,Name,Email,Job Title,Company,Bio,Photo URL",
      "speaker-owner,MRQ-164 Owner,owner@mrq164.test,Program lead,Marquee,The organizer's profile.,",
    ].join("\n");
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, {
      method: "POST",
      body: JSON.stringify({ source: "sessionize", speakers_csv: csv }),
    });
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
    await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
    const result = await (await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" })).json<{ rows: Array<{ entity: string; reason: string | null }> }>();

    const person = await env.DB.prepare("SELECT title, company, bio FROM people WHERE id = ?").bind(OWNER_ID).first<{ title: string | null; company: string | null; bio: string | null }>();
    expect(person).toMatchObject({ title: "Program lead", company: "Marquee", bio: "The organizer's profile." });
    expect(result.rows.find((row) => row.entity === "speaker")?.reason).toContain("filled title, company, bio");
  });

  test("CONTRACT · MRQ-164 · blank stored fields audit as fills and rerun undo preserves a later edit", async () => {
    const csv = [
      "Speaker ID,Name,Email,Job Title,Company,Bio,Photo URL",
      "speaker-blank,Blank Profile,blank@mrq164.test,Imported title,Imported company,Imported bio,",
    ].join("\n");
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, {
      method: "POST",
      body: JSON.stringify({ source: "sessionize", speakers_csv: csv }),
    });
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
    await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
    const firstRun = await (await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" })).json<{ rows: Array<{ entity: string; outcome: string; reason: string | null }> }>();
    const firstRow = firstRun.rows.find((row) => row.entity === "speaker");
    expect(firstRow).toMatchObject({ outcome: "updated" });
    expect(firstRow?.reason).toContain("filled title, company, bio");

    const repeated = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(repeated.status).toBe(200);
    expect((await repeated.json<{ rows: Array<{ entity: string; outcome: string }> }>()).rows.find((row) => row.entity === "speaker")?.outcome).toBe("skipped");
    await env.DB.prepare("UPDATE people SET email = ?, name = ?, updated_at = ? WHERE id = ?").bind("renamed@mrq164.test", "Organizer renamed", Date.now(), BLANK_ID).run();
    const personCountBeforeRepeat = await env.DB.prepare("SELECT COUNT(*) AS count FROM people").first<{ count: number }>();
    const repeatAfterIdentityEdit = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(repeatAfterIdentityEdit.status).toBe(200);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM people").first<{ count: number }>())?.count)).toBe(Number(personCountBeforeRepeat?.count));
    await env.DB.prepare("UPDATE people SET title = ?, updated_at = ? WHERE id = ?").bind("Organizer replacement", Date.now(), BLANK_ID).run();

    const undone = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/undo`, { method: "POST" });
    expect(undone.status).toBe(200);
    expect(await env.DB.prepare("SELECT email, name, title, company, bio FROM people WHERE id = ?").bind(BLANK_ID).first()).toMatchObject({ email: "renamed@mrq164.test", name: "Organizer renamed", title: "Organizer replacement", company: "", bio: null });
  });

  test("CONTRACT · MRQ-164 · replacing a headshot keeps the foreign key valid and undo restores the old attachment", async () => {
    const csv = [
      "Speaker ID,Name,Email,Title,Company,Bio,Photo URL",
      "speaker-headshot,Headshot Profile,headshot@mrq164.test,,,,https://cdn.example.test/new.jpg",
    ].join("\n");
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, { method: "POST", body: JSON.stringify({ source: "sessionize", speakers_csv: csv }) });
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
    await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
    const run = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(run.status).toBe(200);
    const newAttachment = await env.DB.prepare("SELECT id, r2_key FROM attachments WHERE owner_type = 'person_headshot' AND owner_id = ?").bind(HEADSHOT_ID).first<{ id: string; r2_key: string }>();
    expect(newAttachment).toMatchObject({ r2_key: "external:https://cdn.example.test/new.jpg" });
    expect(newAttachment?.id).not.toBe(HEADSHOT_ATTACHMENT_ID);
    expect(await env.DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(HEADSHOT_ATTACHMENT_ID).first()).toBeNull();

    const undone = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/undo`, { method: "POST" });
    expect(undone.status).toBe(200);
    expect(await env.DB.prepare("SELECT headshot_attachment_id FROM people WHERE id = ?").bind(HEADSHOT_ID).first()).toMatchObject({ headshot_attachment_id: HEADSHOT_ATTACHMENT_ID });
    expect(await env.DB.prepare("SELECT r2_key FROM attachments WHERE id = ?").bind(HEADSHOT_ATTACHMENT_ID).first()).toMatchObject({ r2_key: "external:https://cdn.example.test/old.jpg" });
    expect(await env.DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(newAttachment?.id ?? "").first()).toBeNull();
  });

  test("CONTRACT · MRQ-164 · legacy snapshots restore when untouched but never clobber a later edit", async () => {
    const csv = [
      "Speaker ID,Name,Email,Title,Company,Bio",
      "speaker-legacy,Legacy Profile,legacy@mrq164.test,Imported title,Imported company,Imported bio",
    ].join("\n");
    const runLegacyImport = async (): Promise<string> => {
      const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, { method: "POST", body: JSON.stringify({ source: "sessionize", speakers_csv: csv }) });
      const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
      await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
      expect((await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" })).status).toBe(200);
      return uploadBody.id;
    };
    const firstImport = await runLegacyImport();
    const firstRow = await env.DB.prepare("SELECT before_json FROM import_rows WHERE import_id = ? AND entity = 'speaker'").bind(firstImport).first<{ before_json: string }>();
    const firstLegacySnapshot = JSON.parse(firstRow?.before_json ?? "{}") as Record<string, unknown>;
    delete firstLegacySnapshot.speaker_changes;
    delete firstLegacySnapshot.speaker_attachment_changed;
    delete firstLegacySnapshot.speaker_attachment_after_id;
    await env.DB.prepare("UPDATE import_rows SET before_json = ? WHERE import_id = ? AND entity = 'speaker'").bind(JSON.stringify(firstLegacySnapshot), firstImport).run();
    expect((await request(`/api/v1/events/${EVENT_ID}/imports/${firstImport}/undo`, { method: "POST" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT title, company, bio FROM people WHERE id = ?").bind(LEGACY_ID).first()).toMatchObject({ title: null, company: null, bio: null });

    const secondImport = await runLegacyImport();
    const secondRow = await env.DB.prepare("SELECT before_json, created_at, updated_at FROM import_rows WHERE import_id = ? AND entity = 'speaker'").bind(secondImport).first<{ before_json: string; created_at: number; updated_at: number }>();
    const secondLegacySnapshot = JSON.parse(secondRow?.before_json ?? "{}") as Record<string, unknown>;
    delete secondLegacySnapshot.speaker_changes;
    delete secondLegacySnapshot.speaker_attachment_changed;
    delete secondLegacySnapshot.speaker_attachment_after_id;
    await env.DB.prepare("UPDATE import_rows SET before_json = ? WHERE import_id = ? AND entity = 'speaker'").bind(JSON.stringify(secondLegacySnapshot), secondImport).run();
    await env.DB.prepare("UPDATE people SET title = ?, updated_at = ? WHERE id = ?").bind("Legacy organizer edit", Number(secondRow?.created_at ?? 0) + 1, LEGACY_ID).run();
    expect((await request(`/api/v1/events/${EVENT_ID}/imports/${secondImport}/run`, { method: "POST" })).status).toBe(200);
    expect((await request(`/api/v1/events/${EVENT_ID}/imports/${secondImport}/undo`, { method: "POST" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT title, company, bio FROM people WHERE id = ?").bind(LEGACY_ID).first()).toMatchObject({ title: "Legacy organizer edit", company: "Imported company", bio: "Imported bio" });
  });

  test("CONTRACT · MRQ-164 · a created row does not claim it matched an existing person", async () => {
    const csv = [
      "Speaker ID,Name,Email,Job Title,Company,Bio,Photo URL",
      "speaker-newcomer,Dana Kowalski,dana@mrq164.test,Researcher,Cloudreach,Writes about evaluation.,",
    ].join("\n");
    const sessions = [
      "Session ID,Title,Description,Status,Speaker Emails,Session format,Track",
      "sess-mrq164-two,Evaluating agents,An import fixture.,Accepted,speaker-newcomer,Talk,Platform",
    ].join("\n");
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, {
      method: "POST",
      body: JSON.stringify({ source: "sessionize", sessions_csv: sessions, speakers_csv: csv }),
    });
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
    await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
    const result = await (await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" })).json<{ rows: Array<{ entity: string; outcome: string; reason: string | null }> }>();

    const speakerRow = result.rows.find((row) => row.entity === "speaker");
    expect(speakerRow?.outcome).toBe("created");
    expect(speakerRow?.reason).not.toContain("matched");
  });

test("SPEC §7 · Sessionize merge and undo preserve a live session's workflow status and publication", async () => {
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, created_at, updated_at) VALUES ('building_mrq164_live', ?, 'Live Hall', '1 Live Way', 0, ?, ?)").bind(EVENT_ID, now, now),
      env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES ('room_mrq164_live', ?, 'building_mrq164_live', 'Live Room', 100, 0, ?, ?)").bind(EVENT_ID, now, now),
      env.DB.prepare(
        `INSERT INTO submissions
          (id, event_id, kind, title, abstract, status, origin, submitter_person_id, is_published, external_ref, created_at, updated_at)
         VALUES ('sub_mrq164_live', ?, 'session', 'Original live title', 'Original live abstract', 'accepted', 'admin', ?, 1, 'live-mrq164', ?, ?)`,
      ).bind(EVENT_ID, EXISTING_ID, now, now),
      // clock-check: allow — this is a fixed published agenda instant used only to establish the live-session guard.
      env.DB.prepare(
        `INSERT INTO agenda_items
          (id, event_id, submission_id, kind, starts_at, duration_min, room_id, is_published, created_at, updated_at)
         VALUES ('agenda_mrq164_live', ?, 'sub_mrq164_live', 'session', ?, 30, 'room_mrq164_live', 1, ?, ?)`,
      ).bind(EVENT_ID, now + 86_400_000, now, now),
    ]);

    const sessions = [
      "Session ID,Title,Description,Status,Speaker Emails,Session format,Track",
      "live-mrq164,Imported live title,Imported live abstract,Rejected,priya@mrq164.test,Talk,Platform",
    ].join("\n");
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, {
      method: "POST",
      body: JSON.stringify({ source: "sessionize", sessions_csv: sessions, speakers_csv: SPEAKERS_CSV }),
    });
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
    await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
    const run = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(run.status).toBe(200);
    const runBody = await run.json<{ rows: Array<{ entity: string; reason: string | null }> }>();
    expect(runBody.rows.find((row) => row.entity === "session")?.reason).toContain("published session status kept unchanged");
    expect(await env.DB.prepare("SELECT title, status, is_published FROM submissions WHERE id = 'sub_mrq164_live'").first()).toEqual({ title: "Imported live title", status: "accepted", is_published: 1 });
    expect(await env.DB.prepare("SELECT is_published FROM agenda_items WHERE id = 'agenda_mrq164_live'").first()).toEqual({ is_published: 1 });

    const undone = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/undo`, { method: "POST" });
    expect(undone.status).toBe(200);
    expect(await env.DB.prepare("SELECT title, status, is_published FROM submissions WHERE id = 'sub_mrq164_live'").first()).toEqual({ title: "Original live title", status: "accepted", is_published: 1 });
    expect(await env.DB.prepare("SELECT is_published FROM agenda_items WHERE id = 'agenda_mrq164_live'").first()).toEqual({ is_published: 1 });
  });
});
