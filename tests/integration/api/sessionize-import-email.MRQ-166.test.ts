import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_mrq166_email";
const ORG_ID = "org_mrq166_email";
const OWNER_ID = "person_mrq166_owner";
const NAME_MATCH_ID = "person_mrq166_name_match";
const DUPLICATE_A_ID = "person_mrq166_duplicate_a";
const DUPLICATE_B_ID = "person_mrq166_duplicate_b";

type Mapping = {
  sessions: Record<string, string | null>;
  speakers: Record<string, string | null>;
};

type Upload = {
  id: string;
  mapping: Mapping;
  preview: {
    speakers: { missing: string[] };
  };
};

type ImportRow = {
  row_index: number;
  entity: string;
  outcome: "created" | "updated" | "skipped" | "failed";
  reason: string | null;
  target_id?: string | null;
};

type RunResult = {
  counts: { created: number; updated: number; skipped: number; failed: number; speakers: number };
  rows: ImportRow[];
};

let ownerCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.parse("2026-08-13T12:00:00.000Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "MRQ-166 Import", "mrq-166-import", now, now),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Email Conference', 'mrq-166-email', '2026-10-01', '2026-10-03', 'UTC', 'live', 0, ?, ?)").bind(EVENT_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'owner@mrq166.test', 'MRQ-166 Owner', NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(OWNER_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'stored@mrq166.test', 'Unique Name Match', 'Stored title', 'Stored company', 'Stored bio', NULL, '[]', 0, 'marquee', ?, ?)").bind(NAME_MATCH_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'duplicate-a@mrq166.test', 'Duplicate Name', 'A title', 'A company', 'A bio', NULL, '[]', 0, 'marquee', ?, ?)").bind(DUPLICATE_A_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'duplicate-b@mrq166.test', 'Duplicate Name', 'B title', 'B company', 'B bio', NULL, '[]', 0, 'marquee', ?, ?)").bind(DUPLICATE_B_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq166_owner', ?, ?, ?, 'program_lead', ?, ?)").bind(ORG_ID, EVENT_ID, OWNER_ID, now, now),
  ]);
  ownerCookie = `mq_session=${(await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "mrq166-test", now })).id}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", ownerCookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function upload(speakersCsv: string): Promise<Upload> {
  const response = await request(`/api/v1/events/${EVENT_ID}/imports`, {
    method: "POST",
    body: JSON.stringify({ source: "sessionize", speakers_csv: speakersCsv }),
  });
  expect(response.status).toBe(201);
  return response.json<Upload>();
}

async function mapAndRun(imported: Upload): Promise<RunResult> {
  const mapped = await request(`/api/v1/events/${EVENT_ID}/imports/${imported.id}/mapping`, {
    method: "POST",
    body: JSON.stringify(imported.mapping),
  });
  expect(mapped.status).toBe(200);
  const run = await request(`/api/v1/events/${EVENT_ID}/imports/${imported.id}/run`, { method: "POST" });
  expect(run.status).toBe(200);
  return run.json<RunResult>();
}

describe.sequential("CONTRACT · MRQ-166 · Sessionize speaker email", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · MRQ-166 · a mapping without speakers.email is refused before persistence", async () => {
    const imported = await upload([
      "Name,Title",
      "No Email Export,Researcher",
    ].join("\n"));
    expect(imported.preview.speakers.missing).toContain("email");

    const mapped = await request(`/api/v1/events/${EVENT_ID}/imports/${imported.id}/mapping`, {
      method: "POST",
      body: JSON.stringify(imported.mapping),
    });
    expect(mapped.status).toBe(422);
    const error = await mapped.json<{ error: { field?: string; message: string } }>();
    expect(error.error.field).toBe("speakers.email");
    expect(error.error.message).toContain("speakers.email");

    const record = await env.DB.prepare("SELECT status, mapping FROM imports WHERE id = ?").bind(imported.id).first<{ status: string; mapping: string }>();
    expect(record?.status).toBe("uploaded");
    expect((JSON.parse(record?.mapping ?? "{}") as Mapping).speakers.email).toBeNull();
  });

  test("CONTRACT · MRQ-166 · a blank email fails its row, leaves no speaker placeholder, and stays failed on repeat", async () => {
    const imported = await upload([
      "Name,Email,Title,Company,Bio",
      "Blank Email,,Researcher,No Address," ,
      "Valid Email,valid@mrq166.test,Engineer,Marquee,Has a real address.",
    ].join("\n"));
    const first = await mapAndRun(imported);
    expect(first.counts).toMatchObject({ speakers: 2, created: 1, failed: 1 });
    const failed = first.rows.find((row) => row.entity === "speaker" && row.row_index === 1_000_000);
    expect(failed).toMatchObject({ outcome: "failed", reason: "speaker email is required" });

    const fabricated = await env.DB.prepare("SELECT id FROM people WHERE org_id = ? AND email LIKE 'speaker+%@example.invalid'").bind(ORG_ID).all();
    expect(fabricated.results).toEqual([]);

    const repeated = await request(`/api/v1/events/${EVENT_ID}/imports/${imported.id}/run`, { method: "POST" });
    expect(repeated.status).toBe(200);
    expect((await repeated.json<RunResult>()).counts).toMatchObject({ skipped: 1, failed: 1 });
    expect(await env.DB.prepare("SELECT id FROM people WHERE org_id = ? AND email LIKE 'speaker+%@example.invalid'").bind(ORG_ID).first()).toBeNull();
  });

  test("CONTRACT · MRQ-166 · a same-name row with another email creates a separate person", async () => {
    const imported = await upload([
      "Name,Email,Title,Company,Bio",
      "Unique Name Match,new-address@mrq166.test,Imported title,Imported company,Imported bio",
    ].join("\n"));
    const result = await mapAndRun(imported);

    const existing = await env.DB.prepare("SELECT email, title, company, bio FROM people WHERE id = ?").bind(NAME_MATCH_ID).first<{ email: string; title: string; company: string; bio: string }>();
    expect(existing).toMatchObject({ email: "stored@mrq166.test", title: "Stored title", company: "Stored company", bio: "Stored bio" });
    const separate = await env.DB.prepare("SELECT email, name, title, company, bio FROM people WHERE org_id = ? AND email = ?").bind(ORG_ID, "new-address@mrq166.test").first<{ email: string; name: string; title: string; company: string; bio: string }>();
    expect(separate).toMatchObject({ email: "new-address@mrq166.test", name: "Unique Name Match", title: "Imported title", company: "Imported company", bio: "Imported bio" });
    const row = result.rows.find((candidate) => candidate.entity === "speaker");
    expect(row).toMatchObject({ outcome: "created" });
    expect(row?.reason).toContain("same name exists with a different email; created separate person");
  });

  test("CONTRACT · MRQ-166 · a later import with the same external ref keeps the person when email changes", async () => {
    const first = await upload([
      "Speaker Id,Name,Email,Title,Company,Bio",
      "sessionize-speaker-1,External Ref Speaker,old-address@mrq166.test,Original title,Original company,Original bio",
    ].join("\n"));
    const firstResult = await mapAndRun(first);
    expect(firstResult.counts).toMatchObject({ created: 1, failed: 0 });
    const firstPerson = await env.DB.prepare("SELECT id FROM people WHERE org_id = ? AND email = ?")
      .bind(ORG_ID, "old-address@mrq166.test").first<{ id: string }>();
    expect(firstPerson?.id).toBeTruthy();

    const second = await upload([
      "Speaker Id,Name,Email,Title,Company,Bio",
      "sessionize-speaker-1,External Ref Speaker,external-ref-new-address@mrq166.test,Original title,Original company,Original bio",
    ].join("\n"));
    const secondResult = await mapAndRun(second);
    const row = secondResult.rows.find((candidate) => candidate.entity === "speaker");
    expect(row).toMatchObject({ outcome: "skipped", target_id: firstPerson?.id });
    expect(row?.reason).toContain("matched by source external_ref");
    expect(row?.reason).toContain("kept email (existing profile)");
    expect(await env.DB.prepare("SELECT id, email FROM people WHERE id = ?").bind(firstPerson?.id ?? "").first())
      .toMatchObject({ id: firstPerson?.id, email: "old-address@mrq166.test" });
    expect(await env.DB.prepare("SELECT id FROM people WHERE org_id = ? AND email = ?").bind(ORG_ID, "external-ref-new-address@mrq166.test").first()).toBeNull();
  });

  test("CONTRACT · MRQ-166 · duplicate names match neither existing person", async () => {
    const imported = await upload([
      "Name,Email,Title,Company,Bio",
      "Duplicate Name,new-duplicate@mrq166.test,Imported title,Imported company,Imported bio",
    ].join("\n"));
    const result = await mapAndRun(imported);

    const row = result.rows.find((candidate) => candidate.entity === "speaker");
    expect(row).toMatchObject({ outcome: "created" });
    expect(row?.reason).toContain("new person");
    expect(await env.DB.prepare("SELECT email, title FROM people WHERE id = ?").bind(DUPLICATE_A_ID).first()).toMatchObject({ email: "duplicate-a@mrq166.test", title: "A title" });
    expect(await env.DB.prepare("SELECT email, title FROM people WHERE id = ?").bind(DUPLICATE_B_ID).first()).toMatchObject({ email: "duplicate-b@mrq166.test", title: "B title" });
    expect(await env.DB.prepare("SELECT id FROM people WHERE org_id = ? AND email = 'new-duplicate@mrq166.test'").bind(ORG_ID).first()).toBeTruthy();
  });
});
