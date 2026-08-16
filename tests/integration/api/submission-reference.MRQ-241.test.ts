import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { MIRROR_INBOUND_ALLOWLIST } from "../../../src/jobs/mirror/inbound";
import { currentAirtableRecord } from "../../../src/jobs/mirror/records";
import { withSubmissionReferenceAllocation } from "../../../src/lib/submission-reference";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_mrq241_reference";
const EVENT_ID = "evt_mrq241_reference";
const OTHER_EVENT_ID = "evt_mrq241_reference_other";
const FORM_ID = "form_mrq241_reference";
const OWNER_ID = "person_mrq241_reference_owner";
const NOW = 1_760_000_000_000;

let cookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "MRQ-241 Reference Org", "mrq241-reference", NOW, NOW),
    env.DB.prepare(`INSERT INTO events
      (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Reference Conference', ?, '', '2026-10-01', '2026-10-02', 'UTC', '', 'live', 1, ?, ?),
             (?, ?, 'Other Reference Conference', ?, '', '2026-10-03', '2026-10-04', 'UTC', '', 'live', 1, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, EVENT_ID, NOW, NOW, OTHER_EVENT_ID, ORG_ID, OTHER_EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, welcome_md, per_submitter_limit, min_speakers, max_speakers, max_sponsors, admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Reference CFP', 'reference-cfp', 'abstract', 'open', '', 3, 1, 4, 0, '[]', 0, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO people
      (id, org_id, email, name, social_links, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, 'owner@mrq241.test', 'MRQ-241 Owner', '[]', 1, 'marquee', ?, ?)`)
      .bind(OWNER_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'program_lead', ?, ?)").bind("membership_mrq241_owner", ORG_ID, OWNER_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions
      (id, event_id, form_id, kind, title, abstract, status, origin, submitter_person_id, reference_code, search_blob, created_at, updated_at)
      VALUES (?, ?, ?, 'abstract', 'Reference code search', 'The code is the language of the call.', 'submitted', 'public', ?, 'SUB-41', 'reference code search', ?, ?),
             (?, ?, ?, 'session', 'Another event code', '', 'accepted', 'admin', ?, 'SUB-41', 'other event', ?, ?)`)
      .bind("submission_mrq241_search", EVENT_ID, FORM_ID, OWNER_ID, NOW, NOW, "submission_mrq241_other", OTHER_EVENT_ID, FORM_ID, OWNER_ID, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO submission_reference_ledger (event_id, last_sequence, updated_at) VALUES (?, 41, ?), (?, 41, ?)",
    ).bind(EVENT_ID, NOW, OTHER_EVENT_ID, NOW),
    env.DB.prepare(`INSERT INTO participations
      (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
      VALUES ('participation_mrq241_search', 'submission_mrq241_search', ?, 'speaker', 0, 'confirmed', ?, ?)`)
      .bind(OWNER_ID, NOW, NOW),
  ]);
  cookie = `mq_session=${(await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "mrq241-reference" })).id}`;
}

async function request(path: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, { headers: { cookie } });
}

describe.sequential("MRQ-241 submission reference codes", () => {
  beforeEach(seedFixture);

  test("AC-343 + AC-346 · codes are event-scoped and allocation continues after the highest code is deleted", async () => {
    const insert = (id: string, title: string) => withSubmissionReferenceAllocation(env.DB, EVENT_ID, NOW, (referenceCode) => [
      env.DB.prepare(`
        INSERT INTO submissions
          (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at, reference_code)
        VALUES (?, ?, 'abstract', ?, 'submitted', 'admin', ?, ?, ?, ?)
      `).bind(id, EVENT_ID, title, OWNER_ID, NOW, NOW, referenceCode),
    ]);

    await Promise.all([insert("submission_mrq241_alloc_a", "Concurrent A"), insert("submission_mrq241_alloc_b", "Concurrent B")]);
    const allocated = await env.DB.prepare("SELECT id, reference_code FROM submissions WHERE event_id = ? AND id LIKE 'submission_mrq241_alloc_%' ORDER BY reference_code").bind(EVENT_ID).all<{ id: string; reference_code: string }>();
    expect(allocated.results.map((row) => row.reference_code)).toEqual(["SUB-42", "SUB-43"]);

    const highest = allocated.results.at(-1);
    expect(highest).toMatchObject({ reference_code: "SUB-43" });
    await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(highest?.id).run();
    await insert("submission_mrq241_alloc_c", "After deletion");
    const afterDeletion = await env.DB.prepare("SELECT reference_code FROM submissions WHERE event_id = ? AND id LIKE 'submission_mrq241_alloc_%' ORDER BY reference_code").bind(EVENT_ID).all<{ reference_code: string }>();
    expect(afterDeletion.results.map((row) => row.reference_code)).toEqual(["SUB-42", "SUB-44"]);
    const ledger = await env.DB.prepare("SELECT last_sequence FROM submission_reference_ledger WHERE event_id = ?").bind(EVENT_ID).first<{ last_sequence: number }>();
    expect(ledger?.last_sequence).toBe(44);

    const sameCodeOtherEvent = await env.DB.prepare("SELECT reference_code FROM submissions WHERE event_id = ?").bind(OTHER_EVENT_ID).first<{ reference_code: string }>();
    expect(sameCodeOtherEvent?.reference_code).toBe("SUB-41");
  });

  test("AC-344 · quick, list, and board search resolve normalized reference-code input", async () => {
    const quick = await request(`/api/v1/events/${EVENT_ID}/search?q=sub41`);
    expect(quick.status).toBe(200);
    const quickBody = await quick.json<{ data: Array<{ id: string; subtitle: string }> }>();
    expect(quickBody.data.find((row) => row.id === "submission_mrq241_search")).toMatchObject({ subtitle: "SUB-41 · Abstract" });

    const list = await request(`/api/v1/events/${EVENT_ID}/submissions?q=sub%2041&per_page=50`);
    expect(list.status).toBe(200);
    const listBody = await list.json<{ data: Array<{ id: string; reference_code: string | null }> }>();
    expect(listBody.data.find((row) => row.id === "submission_mrq241_search")).toMatchObject({ reference_code: "SUB-41" });

    const board = await request(`/api/v1/events/${EVENT_ID}/board?q=SUB-41&per_page=50`);
    expect(board.status).toBe(200);
    const boardBody = await board.json<{ data: Array<{ id: string; reference_code: string | null }> }>();
    expect(boardBody.data.find((row) => row.id === "submission_mrq241_search")).toMatchObject({ reference_code: "SUB-41" });
  });

  test("AC-345 · Airtable reads the code from D1 outbound truth but never accepts it inbound", async () => {
    const record = await currentAirtableRecord(
      {
        DB: env.DB,
        mirror: { apiKey: "", baseId: "", mediaPublicOrigin: "", uploadTokenSecret: "" },
      },
      "submissions",
      "submission_mrq241_search",
    );

    expect(record?.fields.reference_code).toBe("SUB-41");
    expect(MIRROR_INBOUND_ALLOWLIST.submissions).not.toContain("reference_code");
  });
});
