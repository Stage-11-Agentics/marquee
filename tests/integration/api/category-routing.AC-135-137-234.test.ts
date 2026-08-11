import { beforeEach, describe, expect, test, vi } from "vitest";
import { SELF } from "cloudflare:test";

import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);
const EVENT_ID = "evt_mrq35_routing";
const FORM_ID = "form_mrq35_routing";
const PLAN_ID = "plan_mrq35_routing";
const ROUND_ID = "round_mrq35_routing";
const FORMAT_STAGE = "format_mrq35_stage";
const FORMAT_WORKSHOP = "format_mrq35_workshop";
const TRACK_PRIMARY = "track_mrq35_primary";
const TRACK_SECONDARY = "track_mrq35_secondary";
const TRACK_VENDOR = "track_mrq35_vendor";
const COMMITTEE_MAIN = "committee_mrq35_mainstage";
const COMMITTEE_WORKSHOP = "committee_mrq35_workshop";
const COMMITTEE_BAD = "committee_mrq35_bad_scope";
const REVIEWER_MAIN = "person_mrq35_main_reviewer";
const REVIEWER_WORKSHOP = "person_mrq35_workshop_reviewer";
const REVIEWER_BAD = "person_mrq35_bad_reviewer";
const ORGANIZER = "person_mrq35_organizer";
const REVIEWER_SESSION = "session_mrq35_workshop_reviewer";
const ORGANIZER_SESSION = "session_mrq35_organizer";
const RULE_SECONDARY = "rule_mrq35_secondary_plan";
const RULE_FORMAT = "rule_mrq35_stage_format_plan";
const RULE_VENDOR_BAD = "rule_mrq35_vendor_bad_scope";
const RULE_VENDOR_GOOD = "rule_mrq35_vendor_workshop";
let tokenSerial = 0;

function nextTurnstileToken(): string {
  tokenSerial += 1;
  return `mrq35-pass-${tokenSerial}`;
}

async function request(path: string, init: RequestInit = {}, sessionId?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (sessionId) headers.set("cookie", `mq_session=${sessionId}`);
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

async function count(table: "people" | "submissions" | "round_assignments" | "outbox"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

function submitBody(email: string, input: { format: string; tracks: string[]; vendor?: "No" | "Yes"; title: string }) {
  return {
    turnstileToken: nextTurnstileToken(),
    answers: {
      title: input.title,
      speaker_name: "MRQ-35 Speaker",
      speaker_email: email,
      format: input.format,
      tracks: input.tracks,
      vendor_content: input.vendor ?? "No",
    },
  };
}

function personStatement(id: string, email: string, name: string) {
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
     VALUES (?, 'org_mrq35_routing', ?, ?, ?, ?)`,
  ).bind(id, email, name, NOW, NOW);
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org_mrq35_routing', 'MRQ-35 Org', 'mrq35-routing', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, 'org_mrq35_routing', 'MRQ-35 Conference', 'mrq35-routing', '2026-10-12', '2026-10-14', 'America/New_York', 'live', 0, ?, ?)").bind(EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, 'Stage', 20, 15, 30, 0, ?, ?), (?, ?, 'Workshop', 30, 20, 60, 1, ?, ?)").bind(FORMAT_STAGE, EVENT_ID, NOW, NOW, FORMAT_WORKSHOP, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Primary', '#db4c3f', 0, ?, ?), (?, ?, 'Secondary', '#0d9488', 1, ?, ?), (?, ?, 'Vendor', '#7c3aed', 2, ?, ?)").bind(TRACK_PRIMARY, EVENT_ID, NOW, NOW, TRACK_SECONDARY, EVENT_ID, NOW, NOW, TRACK_VENDOR, EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'MRQ-35 CFP', 'mrq35-cfp', 'abstract', 'open', 0, ?, 'Submit to the conference.', 10, 1, 4, 0, '[]', 1, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, Date.UTC(2099, 0, 1), NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_mrq35_title', ?, 'title', 'Title', NULL, 'short_text', 1, 0, '{"maxLength":120}', NULL, ?, ?),
      ('field_mrq35_name', ?, 'speaker_name', 'Speaker name', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
      ('field_mrq35_email', ?, 'speaker_email', 'Speaker email', NULL, 'email', 1, 2, '{}', NULL, ?, ?),
      ('field_mrq35_format', ?, 'format', 'Format', NULL, 'single_select', 1, 3, ?, NULL, ?, ?),
      ('field_mrq35_tracks', ?, 'tracks', 'Tracks', NULL, 'multi_select', 1, 4, ?, NULL, ?, ?),
      ('field_mrq35_vendor', ?, 'vendor_content', 'Vendor content', NULL, 'single_select', 1, 5, ?, NULL, ?, ?)`)
      .bind(
        FORM_ID, NOW, NOW,
        FORM_ID, NOW, NOW,
        FORM_ID, NOW, NOW,
        FORM_ID, JSON.stringify({ options: ["Stage", "Workshop"] }), NOW, NOW,
        FORM_ID, JSON.stringify({ options: ["Primary", "Secondary", "Vendor"], minItems: 1 }), NOW, NOW,
        FORM_ID, JSON.stringify({ options: ["No", "Yes"] }), NOW, NOW,
      ),
    personStatement(REVIEWER_MAIN, "main@mrq35.example", "Mainstage reviewer"),
    personStatement(REVIEWER_WORKSHOP, "workshop@mrq35.example", "Workshop reviewer"),
    personStatement(REVIEWER_BAD, "bad@mrq35.example", "Bad-scope reviewer"),
    personStatement(ORGANIZER, "organizer@mrq35.example", "MRQ-35 Organizer"),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq35_main', 'org_mrq35_routing', ?, ?, 'reviewer', ?, ?), ('membership_mrq35_workshop', 'org_mrq35_routing', ?, ?, 'reviewer', ?, ?), ('membership_mrq35_bad', 'org_mrq35_routing', ?, ?, 'reviewer', ?, ?), ('membership_mrq35_owner', 'org_mrq35_routing', NULL, ?, 'owner', ?, ?)").bind(EVENT_ID, REVIEWER_MAIN, NOW, NOW, EVENT_ID, REVIEWER_WORKSHOP, NOW, NOW, EVENT_ID, REVIEWER_BAD, NOW, NOW, ORGANIZER, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'reviewer', ?, 'mrq35', NULL, ?, ?), (?, ?, 'owner', ?, 'mrq35', NULL, ?, ?)").bind(REVIEWER_SESSION, REVIEWER_WORKSHOP, NOW + 86_400_000, NOW, NOW, ORGANIZER_SESSION, ORGANIZER, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO evaluation_plans (id, event_id, name, instructions, status, created_at, updated_at) VALUES (?, ?, 'MRQ-35 Review Plan', '', 'open', ?, ?)").bind(PLAN_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES (?, ?, 0, 'Initial review', 'scorecard', 0, 1, ?, ?)").bind(ROUND_ID, PLAN_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, 'Mainstage pool', ?, ?), (?, ?, 'Workshop pool', ?, ?), (?, ?, 'Bad scope pool', ?, ?)").bind(COMMITTEE_MAIN, EVENT_ID, NOW, NOW, COMMITTEE_WORKSHOP, EVENT_ID, NOW, NOW, COMMITTEE_BAD, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at) VALUES ('member_mrq35_main', ?, ?, 'reviewer', ?, ?), ('member_mrq35_workshop', ?, ?, 'reviewer', ?, ?), ('member_mrq35_bad', ?, ?, 'reviewer', ?, ?)").bind(COMMITTEE_MAIN, REVIEWER_MAIN, NOW, NOW, COMMITTEE_WORKSHOP, REVIEWER_WORKSHOP, NOW, NOW, COMMITTEE_BAD, REVIEWER_BAD, NOW, NOW),
    env.DB.prepare("INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at) VALUES ('scope_mrq35_main', ?, ?, ?, ?, ?), ('scope_mrq35_workshop', ?, ?, ?, ?, ?), ('scope_mrq35_bad', ?, ?, ?, ?, ?)").bind(EVENT_ID, REVIEWER_MAIN, TRACK_PRIMARY, NOW, NOW, EVENT_ID, REVIEWER_WORKSHOP, TRACK_VENDOR, NOW, NOW, EVENT_ID, REVIEWER_BAD, TRACK_PRIMARY, NOW, NOW),
    env.DB.prepare(`INSERT INTO routing_rules (id, event_id, name, when_json, then_json, position, enabled, created_at, updated_at) VALUES (?, ?, 'Secondary review plan', '{"field":"track","op":"equals","value":"Secondary"}', ?, 0, 1, ?, ?), (?, ?, 'Stage format plan', '{"field":"format","op":"equals","value":"Stage"}', ?, 1, 1, ?, ?), (?, ?, 'Vendor isolation trap', '{"field":"vendor","op":"equals","value":true}', ?, 2, 1, ?, ?), (?, ?, 'Vendor workshop pool', '{"field":"vendor","op":"equals","value":true}', ?, 3, 0, ?, ?)`)
      .bind(RULE_SECONDARY, EVENT_ID, JSON.stringify({ plan_id: PLAN_ID }), NOW, NOW, RULE_FORMAT, EVENT_ID, JSON.stringify({ plan_id: PLAN_ID }), NOW, NOW, RULE_VENDOR_BAD, EVENT_ID, JSON.stringify({ committee_id: COMMITTEE_BAD, round_id: ROUND_ID }), NOW, NOW, RULE_VENDOR_GOOD, EVENT_ID, JSON.stringify({ committee_id: COMMITTEE_WORKSHOP, round_id: ROUND_ID }), NOW, NOW),
  ]);
}

describe.sequential("MRQ-35 category routing", () => {
  beforeEach(async () => {
    await seedFixture();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
  });

  test("AC-135 + AC-136 + AC-234 · track and format rules apply at submit, preserve the first primary track, and name the applied rule", async () => {
    const empty = await request("/api/v1/public/forms/mrq35-cfp/submissions", {
      method: "POST",
      body: JSON.stringify(submitBody("zero@mrq35.example", { format: "Stage", tracks: [], title: "Zero tracks" })),
    });
    expect(empty.status).toBe(422);
    expect(await count("submissions")).toBe(0);
    expect(await count("people")).toBe(4);

    const anyTrack = await request("/api/v1/public/forms/mrq35-cfp/submissions", {
      method: "POST",
      body: JSON.stringify(submitBody("any-track@mrq35.example", { format: "Stage", tracks: ["Primary", "Secondary", "Vendor"], title: "Any carried track" })),
    });
    expect(anyTrack.status).toBe(201);
    await json(anyTrack);
    const anyTrackRow = await env.DB.prepare("SELECT id, applied_rule_id, primary_track_id FROM submissions WHERE title = ?").bind("Any carried track").first<{ id: string; applied_rule_id: string; primary_track_id: string }>();
    const anyTrackId = anyTrackRow?.id;
    expect(anyTrackId).toBeTruthy();
    expect(anyTrackRow).toMatchObject({ applied_rule_id: RULE_SECONDARY, primary_track_id: TRACK_PRIMARY });
    const carried = await env.DB.prepare("SELECT track_id, is_primary FROM submission_tracks WHERE submission_id = ? ORDER BY is_primary DESC, track_id").bind(anyTrackId).all<{ track_id: string; is_primary: number }>();
    expect(carried.results).toHaveLength(3);
    expect(carried.results[0]).toMatchObject({ track_id: TRACK_PRIMARY, is_primary: 1 });

    const formatOnly = await request("/api/v1/public/forms/mrq35-cfp/submissions", {
      method: "POST",
      body: JSON.stringify(submitBody("format-only@mrq35.example", { format: "Stage", tracks: ["Primary"], title: "Format route" })),
    });
    expect(formatOnly.status).toBe(201);
    await json(formatOnly);
    const formatRow = await env.DB.prepare("SELECT applied_rule_id FROM submissions WHERE title = ?").bind("Format route").first<{ applied_rule_id: string }>();
    expect(formatRow?.applied_rule_id).toBe(RULE_FORMAT);
  });

  test("AC-137 + AC-234 · an out-of-scope committee route is refused with no assignment, then the scoped workshop route is a positive control", async () => {
    const before = {
      assignments: await count("round_assignments"),
      outbox: await count("outbox"),
      people: await count("people"),
      submissions: await count("submissions"),
    };
    const refused = await request("/api/v1/public/forms/mrq35-cfp/submissions", {
      method: "POST",
      body: JSON.stringify(submitBody("refused@mrq35.example", { format: "Workshop", tracks: ["Vendor"], vendor: "Yes", title: "Out of scope route" })),
    });
    expect(refused.status).toBe(422);
    const refusedBody = await json<{ error: { message: string } }>(refused);
    expect(refusedBody.error.message).toContain("review pool");
    expect(JSON.stringify(refusedBody)).not.toContain(COMMITTEE_BAD);
    expect(JSON.stringify(refusedBody)).not.toContain(REVIEWER_BAD);
    expect(await count("round_assignments")).toBe(before.assignments);
    expect(await count("outbox")).toBe(before.outbox);
    expect(await count("people")).toBe(before.people);
    expect(await count("submissions")).toBe(before.submissions);

    await env.DB.batch([
      env.DB.prepare("UPDATE routing_rules SET enabled = 0 WHERE id = ?").bind(RULE_VENDOR_BAD),
      env.DB.prepare("UPDATE routing_rules SET enabled = 1 WHERE id = ?").bind(RULE_VENDOR_GOOD),
    ]);
    const accepted = await request("/api/v1/public/forms/mrq35-cfp/submissions", {
      method: "POST",
      body: JSON.stringify(submitBody("accepted@mrq35.example", { format: "Workshop", tracks: ["Vendor"], vendor: "Yes", title: "Workshop route" })),
    });
    expect(accepted.status).toBe(201);
    await json(accepted);
    const acceptedRow = await env.DB.prepare("SELECT id FROM submissions WHERE title = ?").bind("Workshop route").first<{ id: string }>();
    const acceptedId = acceptedRow?.id;
    expect(acceptedId).toBeTruthy();
    expect(await count("round_assignments")).toBe(before.assignments + 1);
    const assignment = await env.DB.prepare("SELECT committee_id, reviewer_person_id FROM round_assignments WHERE submission_id = ?").bind(acceptedId).first<{ committee_id: string; reviewer_person_id: string | null }>();
    expect(assignment).toEqual({ committee_id: COMMITTEE_WORKSHOP, reviewer_person_id: null });
    const stored = await env.DB.prepare("SELECT applied_rule_id, vendor_affiliation, primary_track_id FROM submissions WHERE id = ?").bind(acceptedId).first<{ applied_rule_id: string; vendor_affiliation: string; primary_track_id: string }>();
    expect(stored).toEqual({ applied_rule_id: RULE_VENDOR_GOOD, vendor_affiliation: "vendor_to_fi", primary_track_id: TRACK_VENDOR });

    const queue = await request(`/api/v1/events/${EVENT_ID}/rounds/${ROUND_ID}/queue`, {}, REVIEWER_SESSION);
    expect(queue.status).toBe(200);
    const queueBody = await json<{ data: Array<{ id: string }> }>(queue);
    expect(queueBody.data.map((row) => row.id)).toContain(acceptedId);

    const record = await request(`/api/v1/events/${EVENT_ID}/submissions/${acceptedId}`, {}, ORGANIZER_SESSION);
    expect(record.status).toBe(200);
    const recordBody = await json<{ routing: { rule_id: string; name: string } | null }>(record);
    expect(recordBody.routing).toEqual({ rule_id: RULE_VENDOR_GOOD, name: "Vendor workshop pool" });
  });
});
