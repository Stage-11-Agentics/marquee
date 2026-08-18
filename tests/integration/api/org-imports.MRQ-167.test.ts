/**
 * MRQ-167 — org-level people imports must retain a receipt that can restore
 * hand-entered profile values, while blank cells remain "not carried".
 */
import { beforeAll, describe, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { createSession } from "../../../src/lib/auth/auth-sessions";
import { mintPortalMagicLink } from "../../../src/lib/auth/magic-links";
import { applyMigrations, env } from "../apply-migrations";

const NOW = Date.UTC(2026, 7, 13, 9, 0, 0);
const SESSION_EXPIRES_AT = Date.now() + 86_400_000;
const ORG_ID = "org_mrq167";
const EVENT_ID = "evt_mrq167";
const OWNER_ID = "per_mrq167_owner";
const SPEAKER_ID = "per_mrq167_speaker";
const AUTH_SESSION = "sess_mrq167";
const ORIGIN = "https://marquee.stage11.dev";
const SHELL = "<!doctype html><html><head><title>Marquee</title></head><body><div id=\"app\"></div></body></html>";
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(): Env {
  return {
    ...env,
    ASSETS: assets,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    UPLOAD_TOKEN_SECRET: "mrq167-upload-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "mrq167-upload-rate-secret",
  } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}, cookie = `mq_session=${AUTH_SESSION}`): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (cookie) headers.set("cookie", cookie);
  else headers.delete("cookie");
  return app.request(`${ORIGIN}${path}`, { ...init, headers }, runtimeEnv());
}

function post(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function person(id: string, name: string, email: string, company: string, title: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'A biography', '[]', '{}', 0, ?, ?)`,
  ).bind(id, ORG_ID, email, name, title, company, NOW, NOW);
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "MRQ-167 Import", "mrq-167-import", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Import Conference', 'mrq-167-import', 'Ship it', '2027-05-12', '2027-05-14', 'America/Los_Angeles', 'Moscone West', '#0b6a72', 'live', 0, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, NOW, NOW),
    person(OWNER_ID, "Jordan Alvarez", "jordan@mrq167.test", "DevFlow", "Program lead"),
    person(SPEAKER_ID, "Priya Raman", "priya@mrq167.test", "Latticework Systems", "Principal Engineer"),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq167_owner', ?, ?, ?, 'owner', ?, ?)")
      .bind(ORG_ID, OWNER_ID, EVENT_ID, NOW, NOW),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)")
      .bind(AUTH_SESSION, OWNER_ID, SESSION_EXPIRES_AT, NOW, NOW),
  ]);
}

describe.sequential("MRQ-167 org people import receipt", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · MRQ-167 · a people import receipt snapshots updates and batch undo restores them", async () => {
    const csv = [
      "Full Name,Email,Company,Job Title,Bio",
      "Stale Export Name,PRIYA@mrq167.test,Stale Export Co,Stale Export Title,Stale export bio.",
    ].join("\n");
    const response = await post("/api/v1/org/imports", { csv, filename: "stale-speakers.csv" });
    expect(response.status).toBe(202);
    const result = await response.json() as { import_id: string; updated: number };
    expect(result.updated).toBe(1);

    const receipt = await env.DB.prepare(
      "SELECT outcome, target_id, before_json, after_json FROM import_rows WHERE import_id = ? AND row_index = 0",
    ).bind(result.import_id).first<{ outcome: string; target_id: string; before_json: string | null; after_json: string | null }>();
    expect(receipt?.outcome).toBe("updated");
    expect(receipt?.target_id).toBe(SPEAKER_ID);
    expect(JSON.parse(receipt?.before_json ?? "null")).toEqual({
      name: "Priya Raman",
      title: "Principal Engineer",
      company: "Latticework Systems",
      bio: "A biography",
    });
    expect(JSON.parse(receipt?.after_json ?? "null")).toEqual({
      name: "Stale Export Name",
      title: "Stale Export Title",
      company: "Stale Export Co",
      bio: "Stale export bio.",
    });

    expect(await env.DB.prepare("SELECT name, title, company, bio FROM people WHERE id = ?").bind(SPEAKER_ID).first()).toEqual({
      name: "Stale Export Name",
      title: "Stale Export Title",
      company: "Stale Export Co",
      bio: "Stale export bio.",
    });

    const undone = await post(`/api/v1/org/imports/${result.import_id}/undo`, {});
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({ undone: 1, retained_manifest: true });
    expect(await env.DB.prepare("SELECT name, title, company, bio FROM people WHERE id = ?").bind(SPEAKER_ID).first()).toEqual({
      name: "Priya Raman",
      title: "Principal Engineer",
      company: "Latticework Systems",
      bio: "A biography",
    });

    const importState = await env.DB.prepare("SELECT status, undone_at FROM imports WHERE id = ?").bind(result.import_id).first<{ status: string; undone_at: number | null }>();
    expect(importState?.status).toBe("undone");
    expect(importState?.undone_at).not.toBeNull();
  });

  test("CONTRACT · MRQ-167 · blank profile cells still leave hand-entered values alone", async () => {
    const csv = [
      "Full Name,Email,Company,Job Title,Bio",
      "Priya Raman,PRIYA@mrq167.test,,,",
    ].join("\n");
    const response = await post("/api/v1/org/imports", { csv, filename: "partial-speakers.csv" });
    expect(response.status).toBe(202);
    expect((await response.json() as { updated: number }).updated).toBe(1);

    expect(await env.DB.prepare("SELECT name, title, company, bio FROM people WHERE id = ?").bind(SPEAKER_ID).first()).toEqual({
      name: "Priya Raman",
      title: "Principal Engineer",
      company: "Latticework Systems",
      bio: "A biography",
    });
  });

  test("CONTRACT · MRQ-167 · undo keeps a field corrected after the import", async () => {
    const csv = [
      "Full Name,Email,Company,Job Title,Bio",
      "Imported Name,PRIYA@mrq167.test,Imported Co,Imported Title,Imported bio.",
    ].join("\n");
    const response = await post("/api/v1/org/imports", { csv, filename: "human-correction.csv" });
    expect(response.status).toBe(202);
    const result = await response.json() as { import_id: string; updated: number };
    expect(result.updated).toBe(1);

    await env.DB.prepare("UPDATE people SET name = ? WHERE id = ?").bind("Priya Raman (Corrected By Human)", SPEAKER_ID).run();

    const undone = await post(`/api/v1/org/imports/${result.import_id}/undo`, {});
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({
      undone: 1,
      skipped: 1,
      skipped_rows: [{
        target_id: SPEAKER_ID,
        reason: "changed_after_import",
        fields: ["name"],
        references: [],
      }],
      retained_manifest: true,
    });
    expect(await env.DB.prepare("SELECT name, title, company, bio FROM people WHERE id = ?").bind(SPEAKER_ID).first()).toEqual({
      name: "Priya Raman (Corrected By Human)",
      title: "Principal Engineer",
      company: "Latticework Systems",
      bio: "A biography",
    });
  });

  test("CONTRACT · MRQ-167 · references skip only their created rows", async () => {
    const csv = [
      "Full Name,Email,Company",
      "Annotated Speaker,annotated@mrq167.test,Notes Co",
      "Listed Speaker,listed@mrq167.test,List Co",
      "Unreferenced Speaker,unreferenced@mrq167.test,Free Co",
    ].join("\n");
    const response = await post("/api/v1/org/imports", { csv, filename: "referenced-people.csv" });
    expect(response.status).toBe(202);
    const result = await response.json() as { import_id: string; created: number };
    expect(result.created).toBe(3);

    const annotated = await env.DB.prepare("SELECT id FROM people WHERE email = ?").bind("annotated@mrq167.test").first<{ id: string }>();
    const listed = await env.DB.prepare("SELECT id FROM people WHERE email = ?").bind("listed@mrq167.test").first<{ id: string }>();
    const unreferenced = await env.DB.prepare("SELECT id FROM people WHERE email = ?").bind("unreferenced@mrq167.test").first<{ id: string }>();
    expect(annotated?.id).toBeTruthy();
    expect(listed?.id).toBeTruthy();
    expect(unreferenced?.id).toBeTruthy();

    await env.DB.batch([
      env.DB.prepare("INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, created_at) VALUES (?, ?, ?, 'note', ?, ?, ?)")
        .bind("note_mrq167_annotated", ORG_ID, annotated?.id, JSON.stringify({ body: "Keep this note" }), OWNER_ID, NOW),
      env.DB.prepare("INSERT INTO person_lists (id, org_id, name, kind, config_json, created_by, created_at, updated_at) VALUES (?, ?, 'MRQ-167 list', 'fixed', '{}', ?, ?, ?)")
        .bind("list_mrq167", ORG_ID, OWNER_ID, NOW, NOW),
      env.DB.prepare("INSERT INTO person_list_members (list_id, person_id, created_at) VALUES (?, ?, ?)")
        .bind("list_mrq167", listed?.id, NOW),
    ]);

    const undone = await post(`/api/v1/org/imports/${result.import_id}/undo`, {});
    expect(undone.status).toBe(200);
    const undoResult = await undone.json() as {
      undone: number;
      skipped: number;
      skipped_rows: Array<{ target_id: string; reason: string; fields: string[]; references: string[] }>;
      retained_manifest: true;
    };
    expect(undoResult.undone).toBe(1);
    expect(undoResult.skipped).toBe(2);
    expect(undoResult.skipped_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_id: annotated?.id, reason: "has_references", references: expect.arrayContaining(["person_events"]) }),
      expect.objectContaining({ target_id: listed?.id, reason: "has_references", references: expect.arrayContaining(["person_list_members"]) }),
    ]));
    expect(undoResult.retained_manifest).toBe(true);
    expect(await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(annotated?.id).first()).toEqual({ id: annotated?.id });
    expect(await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(listed?.id).first()).toEqual({ id: listed?.id });
    expect(await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(unreferenced?.id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT status FROM imports WHERE id = ?").bind(result.import_id).first()).toEqual({ status: "undone" });
  });
  /**
   * MRQ-277 D3. The import reported "3 created" over a conference roster that
   * had not moved and a CONFS column reading 0 — org-level creation without the
   * event-scoped seat is a half-done import wearing a success receipt.
   */
  test("CONTRACT · MRQ-277 · a roster import seats everyone on the named conference, and undo withdraws the seats", async () => {
    const rosterCount = async (): Promise<number> => Number((await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM memberships WHERE event_id = ? AND role = 'speaker'",
    ).bind(EVENT_ID).first<{ count: number }>())?.count);
    const before = await rosterCount();

    const csv = [
      "Full Name,Email,Company,Job Title",
      "Rowan Fairweather,rowan@mrq277.test,Lantern Labs,Principal Engineer",
      "Isla Petrov,isla@mrq277.test,Meridian Data,Director of AI",
    ].join("\n");
    const response = await post("/api/v1/org/imports", { csv, filename: "roster.csv", event: "mrq-167-import", roster: true });
    expect(response.status).toBe(202);
    const result = await response.json() as { import_id: string; created: number; roster_placements: number; event: string | null };
    expect(result.created).toBe(2);
    expect(result.roster_placements).toBe(2);
    expect(result.event).toBe("mrq-167-import");
    expect(await rosterCount()).toBe(before + 2);

    const seated = await env.DB.prepare(
      `SELECT person.email FROM memberships seat
         JOIN people person ON person.id = seat.person_id
        WHERE seat.event_id = ? AND seat.role = 'speaker' AND person.email IN ('rowan@mrq277.test', 'isla@mrq277.test')
        ORDER BY person.email`,
    ).bind(EVENT_ID).all<{ email: string }>();
    expect(seated.results.map((row) => row.email)).toEqual(["isla@mrq277.test", "rowan@mrq277.test"]);

    // Re-running the same file seats nobody twice, like every other part of it.
    const again = await post("/api/v1/org/imports", { csv, filename: "roster.csv", event: "mrq-167-import", roster: true });
    expect(again.status).toBe(202);
    expect(await rosterCount()).toBe(before + 2);
    const secondId = (await again.json() as { import_id: string }).import_id;

    // Each import's undo reverses exactly its OWN writes. The re-run created
    // nothing — it matched two seats that already existed — so its undo removes
    // nothing, and the first import's undo removes the two it wrote.
    //
    // This is deliberately not "a row survives while anything still claims it",
    // which is right for `event_attendances` because every import-sourced row
    // there IS import-created (the unique key carries `source`). A membership
    // has no such separation, so a claim-based rule has to reach rows it did not
    // create — and that is the data loss this scoping exists to prevent. The
    // cost is that undoing the first import drops a seat the live re-run still
    // asserts; re-running the file restores it, and no row anyone else wrote is
    // ever at risk.
    const secondUndo = await post(`/api/v1/org/imports/${secondId}/undo`, {});
    expect(secondUndo.status).toBe(200);
    expect(await secondUndo.json()).toMatchObject({ roster_placements_removed: 0 });
    expect(await rosterCount()).toBe(before + 2);

    const firstUndo = await post(`/api/v1/org/imports/${result.import_id}/undo`, {});
    expect(firstUndo.status).toBe(200);
    expect(await firstUndo.json()).toMatchObject({ roster_placements_removed: 2 });
    expect(await rosterCount()).toBe(before);
  });

  test("CONTRACT · MRQ-277 · a roster placement without a named conference is refused, not guessed at", async () => {
    const response = await post("/api/v1/org/imports", {
      csv: "Full Name,Email\nNo Conference,noconference@mrq277.test",
      filename: "roster.csv",
      roster: true,
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("name the conference in `event`");
    expect(await env.DB.prepare("SELECT id FROM people WHERE email = 'noconference@mrq277.test'").first()).toBeNull();
  });
  /**
   * MRQ-277 review correction. An undo may remove a seat the import CREATED and
   * never one it merely matched.
   *
   * The person-scoped predicate this replaced deleted any speaker seat held by
   * anyone the import touched. Importing a file that only updated an existing
   * speaker's job title, then undoing it, destroyed the seat the seat's real
   * author had written — and that row is what gates speaker-portal sign-in, so
   * the person silently lost their way back in. The consequence is what is
   * asserted here, not a row count.
   */
  test("CONTRACT · MRQ-277 · undo leaves a matched person's pre-existing speaker seat, and their portal access, intact", async () => {
    const seatFor = async (personId: string): Promise<{ id: string } | null> => env.DB.prepare(
      "SELECT id FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'speaker'",
    ).bind(EVENT_ID, personId).first<{ id: string }>();
    /** The predicate the speaker portal signs someone in with. */
    const portalResolves = async (personId: string): Promise<boolean> => Boolean(await env.DB.prepare(
      `SELECT 1 AS present FROM memberships
        WHERE org_id = ? AND person_id = ? AND event_id IS NOT NULL AND role IN ('speaker', 'co_speaker', 'moderator')
        LIMIT 1`,
    ).bind(ORG_ID, personId).first<{ present: number }>());

    // A seat somebody else wrote — the seed, the acceptance cascade, an
    // organizer. Not this import's, and not this import's to take away.
    await env.DB.prepare(
      "INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq277_preexisting', ?, ?, ?, 'speaker', ?, ?)",
    ).bind(ORG_ID, SPEAKER_ID, EVENT_ID, NOW, NOW).run();
    expect(await portalResolves(SPEAKER_ID)).toBe(true);

    // An import that MATCHES that person by email, and creates one new one.
    const csv = [
      "Full Name,Email,Company,Job Title",
      "Priya Raman,PRIYA@mrq167.test,Latticework Systems,Staff Engineer",
      "Newly Imported,newly@mrq277.test,Lantern Labs,Principal Engineer",
    ].join("\n");
    const response = await post("/api/v1/org/imports", { csv, filename: "mixed.csv", event: "mrq-167-import", roster: true });
    expect(response.status).toBe(202);
    const result = await response.json() as { import_id: string; roster_placements: number; roster_already_seated: number };
    // One seat written, one person already seated — counted apart, because only
    // the first is a row this undo may reverse.
    expect(result.roster_placements).toBe(1);
    expect(result.roster_already_seated).toBe(1);
    expect((await seatFor(SPEAKER_ID))?.id).toBe("mem_mrq277_preexisting");

    const newcomer = await env.DB.prepare("SELECT id FROM people WHERE email = 'newly@mrq277.test'").first<{ id: string }>();
    expect(await seatFor(newcomer!.id)).not.toBeNull();

    const undone = await post(`/api/v1/org/imports/${result.import_id}/undo`, {});
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({ roster_placements_removed: 1 });

    // The seat this import created is gone.
    expect(await seatFor(newcomer!.id)).toBeNull();
    // The seat it merely matched is untouched — same row, same id — and the
    // person can still sign in to the portal.
    expect((await seatFor(SPEAKER_ID))?.id).toBe("mem_mrq277_preexisting");
    expect(await portalResolves(SPEAKER_ID)).toBe(true);

    await env.DB.prepare("DELETE FROM memberships WHERE id = 'mem_mrq277_preexisting'").run();
  });

  test("CONTRACT · MRQ-281 · undo retains a seat adopted by Add speaker, and the current portal still resolves it", async () => {
    const csv = [
      "Full Name,Email,Company,Job Title",
      "Priya Raman,PRIYA@mrq167.test,Latticework Systems,Principal Engineer",
    ].join("\n");
    const response = await post("/api/v1/org/imports", { csv, filename: "adopted-speaker.csv", event: "mrq-167-import", roster: true });
    expect(response.status).toBe(202);
    const result = await response.json() as { import_id: string; roster_placements: number };
    expect(result.roster_placements).toBe(1);

    const importedSeat = await env.DB.prepare(
      "SELECT id, invited_at FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'speaker'",
    ).bind(EVENT_ID, SPEAKER_ID).first<{ id: string; invited_at: number | null }>();
    expect(importedSeat).toMatchObject({ invited_at: null });

    // This is the organizer's later claim: the API returns 201 against the
    // imported row and records the invitation on that same row.
    const adopted = await post(`/api/v1/events/${EVENT_ID}/speakers`, {
      name: "Priya Raman",
      email: "priya@mrq167.test",
      invited: true,
    });
    expect(adopted.status).toBe(201);
    expect((await adopted.json() as { speaker: { is_member: boolean } }).speaker.is_member).toBe(true);

    const adoptedSeat = await env.DB.prepare(
      "SELECT id, invited_at FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'speaker'",
    ).bind(EVENT_ID, SPEAKER_ID).first<{ id: string; invited_at: number | null }>();
    expect(adoptedSeat?.id).toBe(importedSeat?.id);
    expect(adoptedSeat?.invited_at).toEqual(expect.any(Number));

    const undone = await post(`/api/v1/org/imports/${result.import_id}/undo`, {});
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({
      undone: 1,
      roster_placements_removed: 0,
      roster_placements_retained: 1,
      retained_manifest: true,
    });
    expect(await env.DB.prepare(
      "SELECT id, invited_at FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'speaker'",
    ).bind(EVENT_ID, SPEAKER_ID).first()).toMatchObject({ id: importedSeat?.id, invited_at: expect.any(Number) });

    // Exercise the current speaker sign-in door, then the current `/me` portal
    // resolver. A row count alone would miss the user-facing consequence.
    const link = await mintPortalMagicLink(env.DB, {
      personId: SPEAKER_ID,
      eventId: EVENT_ID,
      redirectTo: "/portal",
      now: Date.now(),
    });
    const exchanged = await request(`/api/v1/auth/exchange?token=${encodeURIComponent(link.token)}`, { redirect: "manual" }, "");
    expect(exchanged.status).toBe(302);
    const sessionCookie = exchanged.headers.get("set-cookie")?.split(";", 1)[0];
    expect(sessionCookie).toMatch(/^mq_session=/);

    const portal = await request(`/api/v1/me/portal?eventId=${EVENT_ID}`, {}, sessionCookie ?? "");
    expect(portal.status).toBe(200);
    expect(await portal.json()).toMatchObject({ seat: "speaker", event: { id: EVENT_ID }, person: { id: SPEAKER_ID } });
  });
});
