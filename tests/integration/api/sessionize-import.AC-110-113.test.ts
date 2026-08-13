import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import sessionsCsv from "../../../fixtures/sessionize/sessions.csv?raw";
import speakersCsv from "../../../fixtures/sessionize/speakers.csv?raw";
import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_mrq31_import";
const ORG_ID = "org_mrq31_import";
const OWNER_ID = "person_mrq31_owner";
const SEEDED_PERSON_ID = "person_mrq31_seeded";
const SEEDED_SUBMISSION_ID = "submission_mrq31_seeded";
const SEEDED_EVALUATION_ID = "evaluation_mrq31_seeded";
const SESSION_ID = "session_mrq31_import";

let ownerCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  // Nothing here asserts a calendar date, and the session row below is a
  // credential: pinned to 2026-08-11 it expired on the 12th and stayed expired.
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "MRQ-31 Import", "mrq-31-import", now, now),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Import Conference', 'mrq-31-import', '2026-10-01', '2026-10-03', 'UTC', 'live', 0, ?, ?)").bind(EVENT_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES ('format_mrq31_talk', ?, 'Talk', 45, 15, 90, 0, ?, ?), ('format_mrq31_workshop', ?, 'Workshop', 90, 30, 180, 1, ?, ?)").bind(EVENT_ID, now, now, EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track_mrq31_platform', ?, 'Platform', '#0d9488', 0, ?, ?), ('track_mrq31_operations', ?, 'Operations', '#d97706', 1, ?, ?)").bind(EVENT_ID, now, now, EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at) VALUES ('form_mrq31_seeded', ?, 'Seeded CFP', 'mrq31-seeded', 'abstract', 'open', ?, ?)").bind(EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'owner@mrq31.test', 'MRQ-31 Owner', NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(OWNER_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'seeded@mrq31.test', 'Seeded unrelated person', 'Seeded title', 'Seeded company', 'Do not touch this person.', NULL, '[]', 0, 'marquee', ?, ?)").bind(SEEDED_PERSON_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES ('person_mrq31_reviewer', ?, 'reviewer@example.test', 'Seeded Review Lead', 'Seeded reviewer', 'Seeded committee', 'Seeded reviewer bio', NULL, '[]', 0, 'marquee', ?, ?)").bind(ORG_ID, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq31_owner', ?, ?, ?, 'program_lead', ?, ?)").bind(ORG_ID, EVENT_ID, OWNER_ID, now, now),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'program_lead', ?, 'mrq31-import', NULL, ?, ?)").bind(SESSION_ID, OWNER_ID, now + 86_400_000, now, now),
    env.DB.prepare("INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at) VALUES ('plan_mrq31_seeded', ?, 'Seeded plan', '', 1, 5, 'open', ?, ?)").bind(EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES ('round_mrq31_seeded', 'plan_mrq31_seeded', 0, 'Seeded round', 'scorecard', 0, 1, ?, ?)").bind(now, now),
    env.DB.prepare("INSERT INTO submissions (id, event_id, form_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, external_ref, created_at, updated_at) VALUES (?, ?, 'form_mrq31_seeded', 'abstract', 0, 'Seeded unrelated submission', 'Keep this record.', 'submitted', 'public', ?, 'seeded-ref', ?, ?)").bind(SEEDED_SUBMISSION_ID, EVENT_ID, SEEDED_PERSON_ID, now, now),
    env.DB.prepare("INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, comment, abstained, created_at, updated_at) VALUES (?, 'round_mrq31_seeded', ?, 'person_mrq31_reviewer', 'maybe', 2.5, 'Unrelated seeded evaluation.', 0, ?, ?)").bind(SEEDED_EVALUATION_ID, SEEDED_SUBMISSION_ID, now, now),
  ]);
  ownerCookie = `mq_session=${(await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "mrq31-test", now })).id}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", ownerCookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function counts(): Promise<Record<string, number>> {
  const tables = ["people", "submissions", "participations", "evaluations", "submission_answers", "attachments", "forms"];
  const entries = await Promise.all(tables.map(async (table) => {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
    return [table, Number(row?.count ?? 0)] as const;
  }));
  return Object.fromEntries(entries);
}

describe.sequential("MRQ-31 Sessionize import", () => {
  beforeAll(seedFixture, 20_000);

  test("AC-110 + AC-111 · mapping preview is write-free, then relationships, canonical status, raw status, headshots, scores, and unattributed reviewers persist", async () => {
    const beforePreview = await counts();
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, { method: "POST", body: JSON.stringify({ source: "sessionize", sessions_csv: sessionsCsv, speakers_csv: speakersCsv }) });
    expect(uploaded.status).toBe(201);
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>>; preview: { sessions: { rows: Array<Record<string, string>> } } }>();
    expect(uploadBody.preview.sessions.rows[0]?.title).toBe("Designing for trust in a conference import");
    expect(await counts()).toEqual(beforePreview);

    const mapped = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
    expect(mapped.status).toBe(200);
    expect(await counts()).toEqual(beforePreview);

    const run = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(run.status).toBe(200);
    const result = await run.json<{ counts: { created: number; failed: number; evaluations: number }; rows: Array<{ entity: string; outcome: string; reason: string | null }> }>();
    expect(result.counts).toMatchObject({ created: 5, updated: 1, failed: 1, evaluations: 2 });
    expect(result.rows.some((row) => row.entity === "session" && row.reason?.includes("source status 'undecided' mapped to in_review"))).toBe(true);

    const status = await env.DB.prepare("SELECT status FROM submissions WHERE event_id = ? AND external_ref = 'sess-trust-101'").bind(EVENT_ID).first<{ status: string }>();
    expect(status?.status).toBe("in_review");
    const rawStatusRow = await env.DB.prepare("SELECT reason FROM import_rows WHERE import_id = ? AND entity = 'session' AND row_index = 0").bind(uploadBody.id).first<{ reason: string }>();
    expect(rawStatusRow?.reason).toContain("undecided");
    const headshot = await env.DB.prepare("SELECT status, r2_key FROM attachments WHERE owner_type = 'person_headshot' AND owner_id = (SELECT id FROM people WHERE email = 'ada@example.test')").first<{ status: string; r2_key: string }>();
    expect(headshot?.status).toBe("pending");
    expect(headshot?.r2_key).toBe("external:https://cdn.example.test/ada.jpg");
    const relationships = await env.DB.prepare("SELECT COUNT(*) AS count FROM participations p JOIN submissions s ON s.id = p.submission_id WHERE s.event_id = ? AND s.origin = 'import'").bind(EVENT_ID).first<{ count: number }>();
    expect(Number(relationships?.count)).toBe(4);
    const matchedEvaluation = await env.DB.prepare("SELECT score, comment, reviewer_person_id FROM evaluations WHERE submission_id = (SELECT id FROM submissions WHERE external_ref = 'sess-trust-101')").first<{ score: number; comment: string; reviewer_person_id: string }>();
    expect(matchedEvaluation).toMatchObject({ score: 4.5, comment: "Clear and useful for organizers.", reviewer_person_id: "person_mrq31_reviewer" });
    const unattributed = await env.DB.prepare("SELECT score, comment FROM evaluations WHERE submission_id = (SELECT id FROM submissions WHERE external_ref = 'sess-trust-102')").first<{ score: number; comment: string }>();
    expect(unattributed).toMatchObject({ score: 3.5 });
    expect(unattributed?.comment).toContain("unattributed reviewer");
    const answers = await env.DB.prepare("SELECT COUNT(*) AS count FROM submission_answers WHERE submission_id IN (SELECT id FROM submissions WHERE origin = 'import')").first<{ count: number }>();
    expect(Number(answers?.count)).toBe(3);

    const sameImportAgain = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(sameImportAgain.status).toBe(200);
    expect((await sameImportAgain.json<{ counts: { skipped: number; failed: number } }>()).counts).toMatchObject({ skipped: 6, failed: 1 });
  }, 20_000);

  test("AC-112 · the same export preserves row counts, while an updated export changes matched values and inserts a new row", async () => {
    const firstCounts = await counts();
    const repeated = await request(`/api/v1/events/${EVENT_ID}/imports`, { method: "POST", body: JSON.stringify({ source: "sessionize", sessions_csv: sessionsCsv, speakers_csv: speakersCsv }) });
    expect(repeated.status).toBe(201);
    const repeatedBody = await repeated.json<{ id: string; mapping: unknown }>();
    const repeatedMapped = await request(`/api/v1/events/${EVENT_ID}/imports/${repeatedBody.id}/mapping`, { method: "POST", body: JSON.stringify(repeatedBody.mapping) });
    expect(repeatedMapped.status).toBe(200);
    const repeatedRun = await request(`/api/v1/events/${EVENT_ID}/imports/${repeatedBody.id}/run`, { method: "POST" });
    expect(repeatedRun.status).toBe(200);
    const repeatedResult = await repeatedRun.json<{ counts: { skipped: number; failed: number } }>();
    expect(repeatedResult.counts).toMatchObject({ skipped: 6, failed: 1 });
    expect(await counts()).toEqual(firstCounts);
    const positive = await env.DB.prepare("SELECT COUNT(*) AS count FROM submissions WHERE origin = 'import'").first<{ count: number }>();
    expect(Number(positive?.count)).toBe(3);

    const updatedSessions = `${sessionsCsv.trimEnd()}\n"sess-trust-103","Newly inserted conference clinic","A new row proves the second import is not only a status check.",submitted,Platform,Talk,grace@example.test,,2.0,"New row review.","{""Level"":""Advanced""}"\n`.replace("4.5", "4.8").replace("Clear and useful for organizers.", "Updated after organizer correction.");
    const updatedSpeakers = speakersCsv.replace("Builds reliable conference programs.", "Updated conference program bio.");
    const updated = await request(`/api/v1/events/${EVENT_ID}/imports`, { method: "POST", body: JSON.stringify({ source: "sessionize", sessions_csv: updatedSessions, speakers_csv: updatedSpeakers }) });
    expect(updated.status).toBe(201);
    const updatedBody = await updated.json<{ id: string; mapping: unknown }>();
    expect((await request(`/api/v1/events/${EVENT_ID}/imports/${updatedBody.id}/mapping`, { method: "POST", body: JSON.stringify(updatedBody.mapping) })).status).toBe(200);
    const updatedRun = await request(`/api/v1/events/${EVENT_ID}/imports/${updatedBody.id}/run`, { method: "POST" });
    expect(updatedRun.status).toBe(200);
    const updatedResult = await updatedRun.json<{ counts: { updated: number; created: number; failed: number } }>();
    expect(updatedResult.counts.updated).toBeGreaterThanOrEqual(2);
    expect(updatedResult.counts.created).toBeGreaterThanOrEqual(1);
    expect(updatedResult.counts.failed).toBe(1);
    expect((await env.DB.prepare("SELECT bio FROM people WHERE email = 'ada@example.test'").first<{ bio: string }>())?.bio).toBe("Updated conference program bio.");
    expect((await env.DB.prepare("SELECT score, comment FROM evaluations WHERE submission_id = (SELECT id FROM submissions WHERE external_ref = 'sess-trust-101')").first<{ score: number; comment: string }>())).toMatchObject({ score: 4.8, comment: "Updated after organizer correction." });
    const newRow = await env.DB.prepare("SELECT id FROM submissions WHERE event_id = ? AND external_ref = 'sess-trust-103'").bind(EVENT_ID).first<{ id: string }>();
    expect(newRow?.id).toBeTruthy();
  }, 20_000);

  test("AC-113 · batch undo removes the updated import and then the original rows without touching seeded controls", async () => {
    const beforeUndoControl = await Promise.all([
      env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(SEEDED_PERSON_ID).first(),
      env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(SEEDED_SUBMISSION_ID).first(),
      env.DB.prepare("SELECT * FROM evaluations WHERE id = ?").bind(SEEDED_EVALUATION_ID).first(),
    ]);
    const imports = await env.DB.prepare("SELECT id FROM imports WHERE event_id = ? ORDER BY created_at").bind(EVENT_ID).all<{ id: string }>();
    expect(imports.results).toHaveLength(3);
    const [firstImport, secondImport, updatedImport] = imports.results.map((row) => row.id);
    expect(await env.DB.prepare("SELECT id FROM submissions WHERE external_ref = 'sess-trust-103'").first()).toBeTruthy();

    const undoUpdated = await request(`/api/v1/events/${EVENT_ID}/imports/${updatedImport}/undo`, { method: "POST" });
    expect(undoUpdated.status).toBe(200);
    expect(await undoUpdated.json()).toMatchObject({ retained_manifest: true });
    expect(await env.DB.prepare("SELECT id FROM submissions WHERE external_ref = 'sess-trust-103'").first()).toBeNull();
    expect((await env.DB.prepare("SELECT bio FROM people WHERE email = 'ada@example.test'").first<{ bio: string }>())?.bio).toBe("Builds reliable conference programs.");
    expect((await env.DB.prepare("SELECT score FROM evaluations WHERE submission_id = (SELECT id FROM submissions WHERE external_ref = 'sess-trust-101')").first<{ score: number }>())?.score).toBe(4.5);

    const undoRepeated = await request(`/api/v1/events/${EVENT_ID}/imports/${secondImport}/undo`, { method: "POST" });
    expect(undoRepeated.status).toBe(200);
    const undoFirst = await request(`/api/v1/events/${EVENT_ID}/imports/${firstImport}/undo`, { method: "POST" });
    expect(undoFirst.status).toBe(200);
    expect(await undoFirst.json()).toMatchObject({ retained_manifest: true });
    expect(await env.DB.prepare("SELECT id FROM submissions WHERE origin = 'import'").all()).toMatchObject({ results: [] });
    expect(await env.DB.prepare("SELECT id FROM people WHERE email = 'ada@example.test'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM attachments WHERE owner_type = 'person_headshot' AND r2_key LIKE 'external:%'").first()).toBeNull();
    expect(await Promise.all([
      env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(SEEDED_PERSON_ID).first(),
      env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(SEEDED_SUBMISSION_ID).first(),
      env.DB.prepare("SELECT * FROM evaluations WHERE id = ?").bind(SEEDED_EVALUATION_ID).first(),
    ])).toEqual(beforeUndoControl);
  }, 20_000);

  test("AC-110 + AC-113 · speakers-only CSV accepts no external_ref and makes the person durable", async () => {
    const speakersOnlyCsv = [
      "Name,Email,Job Title,Company,Bio",
      'Dana Kowalski,dana-only@example.test,Conference operator,Open Programs,"Keeps speaker rosters coherent."',
    ].join("\n");
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, { method: "POST", body: JSON.stringify({ source: "sessionize", speakers_csv: speakersOnlyCsv }) });
    expect(uploaded.status).toBe(201);
    const uploadBody = await uploaded.json<{ id: string; mapping: { sessions: Record<string, string | null>; speakers: Record<string, string | null> }; preview: { sessions: { rows: unknown[] }; speakers: { missing: string[] } } }>();
    expect(uploadBody.preview.sessions.rows).toEqual([]);
    expect(uploadBody.preview.speakers.missing).toContain("external_ref");
    expect(uploadBody.mapping.speakers.external_ref).toBeNull();

    const mapped = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
    expect(mapped.status).toBe(200);
    const run = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(run.status).toBe(200);
    expect(await run.json<{ counts: { created: number; speakers: number; sessions: number; failed: number } }>()).toMatchObject({ counts: { created: 1, speakers: 1, sessions: 0, failed: 0 } });
    expect(await env.DB.prepare("SELECT name, email FROM people WHERE email = 'dana-only@example.test'").first()).toMatchObject({ name: "Dana Kowalski", email: "dana-only@example.test" });

    const undone = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/undo`, { method: "POST" });
    expect(undone.status).toBe(200);
    expect(await env.DB.prepare("SELECT id FROM people WHERE email = 'dana-only@example.test'").first()).toBeNull();
  }, 20_000);
});
