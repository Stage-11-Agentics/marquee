import { beforeEach, expect, test } from "vitest";

import { resolvePersonForSignin } from "../../../src/lib/auth/person-signin";
import {
  executePersonMerge,
  previewPersonMerge,
  undoPersonMerge,
  type PersonMergeActor,
} from "../../../src/lib/person-merge";
import { applyMigrations, env } from "../apply-migrations";

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);
const ORG_ID = "org_mrq235";
const EVENT_ID = "evt_mrq235";
const SURVIVOR_ID = "person_mrq235_survivor";
const RETIRED_ID = "person_mrq235_retired";
const HELPER_ID = "person_mrq235_helper";
const ACTOR: PersonMergeActor = { actorKind: "user", actorPersonId: SURVIVOR_ID, requestId: "req_mrq235" };

function person(
  id: string,
  email: string,
  name: string,
  values: {
    title: string | null;
    company: string | null;
    bio: string | null;
    socialLinks: string;
    customFields: string;
    doNotContact: 0 | 1;
    createdAt: number;
  },
) {
  return env.DB.prepare(
    `INSERT INTO people
      (id, org_id, email, name, title, company, bio, company_id, social_links,
       custom_fields, do_not_contact, is_demo, kind, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 'human', 'marquee', ?, ?)`,
  ).bind(
    id,
    ORG_ID,
    email,
    name,
    values.title,
    values.company,
    values.bio,
    values.socialLinks,
    values.customFields,
    values.doNotContact,
    values.createdAt,
    values.createdAt,
  );
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "Merge Test", "mrq-235", NOW, NOW),
    env.DB.prepare(`INSERT INTO events
      (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Merge Test Conference', 'mrq-235', 'Identity continuity', '2026-10-01', '2026-10-03', 'UTC', 'Online', '#0d9488', 'live', 0, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, NOW, NOW),
    person(SURVIVOR_ID, "survivor@mrq235.test", "Survivor Person", {
      title: "Principal Engineer",
      company: "Northwind",
      bio: null,
      socialLinks: JSON.stringify(["https://survivor.test"]),
      customFields: JSON.stringify({ team: "platform", zero: 0 }),
      doNotContact: 0,
      createdAt: NOW,
    }),
    person(RETIRED_ID, "retired@mrq235.test", "Retired Person", {
      title: "Staff Engineer",
      company: "Northwind",
      bio: "Retained biography",
      socialLinks: JSON.stringify(["https://survivor.test", "https://retired.test"]),
      customFields: JSON.stringify({ team: "retired", timezone: "UTC" }),
      doNotContact: 1,
      createdAt: NOW + 1,
    }),
    person(HELPER_ID, "helper@mrq235.test", "Helper Person", {
      title: null,
      company: null,
      bio: null,
      socialLinks: JSON.stringify([]),
      customFields: JSON.stringify({}),
      doNotContact: 0,
      createdAt: NOW + 2,
    }),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)")
      .bind("membership_mrq235_survivor", ORG_ID, EVENT_ID, SURVIVOR_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)")
      .bind("membership_mrq235_retired", ORG_ID, EVENT_ID, RETIRED_ID, NOW + 1, NOW + 1),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, created_at, updated_at) VALUES (?, ?, 'speaker', ?, 'fixture', ?, ?)")
      .bind("session_mrq235", RETIRED_ID, Date.now() + 3 * 86_400_000, NOW, NOW),
    env.DB.prepare(`INSERT INTO magic_links
      (id, token_hash, person_id, event_id, purpose, redirect_to, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'login', '/portal', ?, ?, ?)`)
      .bind("magic_mrq235", "hash_mrq235", RETIRED_ID, EVENT_ID, Date.now() + 3 * 86_400_000, NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, admin_notify_person_ids, created_at, updated_at)
      VALUES (?, ?, 'Merge form', 'merge-form', 'abstract', ?, ?, ?)`)
      .bind("form_mrq235", EVENT_ID, JSON.stringify([RETIRED_ID, SURVIVOR_ID]), NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions
      (id, event_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES (?, ?, 'abstract', 'Retired proposal', 'A proposal', 'submitted', 'admin', ?, 'retired proposal', ?, ?)`)
      .bind("submission_mrq235", EVENT_ID, RETIRED_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO person_events
      (id, org_id, person_id, kind, value_json, actor_person_id, created_at)
      VALUES (?, ?, ?, 'tag', ?, NULL, ?), (?, ?, ?, 'stage', ?, NULL, ?)`)
      .bind(
        "person_event_mrq235_tag", ORG_ID, RETIRED_ID, JSON.stringify({ tag: "Platform", op: "add" }), NOW,
        "person_event_mrq235_stage", ORG_ID, RETIRED_ID, JSON.stringify({ stage: "contacted" }), NOW + 1,
      ),
    env.DB.prepare("INSERT INTO person_lists (id, org_id, name, kind, config_json, created_by, created_at, updated_at) VALUES (?, ?, 'Merge list', 'fixed', '{}', ?, ?, ?)")
      .bind("list_mrq235", ORG_ID, SURVIVOR_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO person_list_members (list_id, person_id, created_at) VALUES (?, ?, ?)")
      .bind("list_mrq235", RETIRED_ID, NOW),
    env.DB.prepare("INSERT INTO imports (id, event_id, source, file_key, mapping, status, created_at, updated_at) VALUES (?, ?, 'sessionize', 'merge.json', '{}', 'complete', ?, ?)")
      .bind("import_mrq235", EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO import_rows
      (id, import_id, row_index, entity, outcome, target_id, before_json, created_at, updated_at)
      VALUES (?, ?, 0, 'speaker', 'updated', ?, ?, ?, ?)`)
      .bind("import_row_mrq235", "import_mrq235", RETIRED_ID, JSON.stringify({ target_id: RETIRED_ID }), NOW, NOW),
    env.DB.prepare(`INSERT INTO audit_log
      (id, event_id, org_id, actor_person_id, actor_name, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, 'Retired Person', 'user', 'person.note_added', 'person', ?, '{}', '{}', ?)`)
      .bind("audit_mrq235", EVENT_ID, ORG_ID, RETIRED_ID, RETIRED_ID, NOW),
    env.DB.prepare("INSERT INTO mirror_outbox (id, table_name, row_id, op, payload, status, created_at, updated_at) VALUES (?, 'people', ?, 'upsert', ?, 'pending', ?, ?)")
      .bind("mirror_outbox_mrq235", RETIRED_ID, JSON.stringify({ marquee_id: RETIRED_ID, email: "retired@mrq235.test" }), NOW, NOW),
    env.DB.prepare(`INSERT INTO mirror_credentials
      (id, org_id, token_ciphertext, webhook_secret_ciphertext, token_fingerprint, base_id, set_at, set_by_person_id, created_at, updated_at)
      VALUES (?, ?, 'ciphertext', NULL, 'fingerprint', 'base', ?, ?, ?, ?)`)
      .bind("credential_mrq235", ORG_ID, NOW, RETIRED_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)")
      .bind("participation_mrq235", "submission_mrq235", RETIRED_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO speaker_helpers
      (id, event_id, speaker_person_id, helper_person_id, helper_name, added_by, added_at, removed_at)
      VALUES
        ('speaker_helper_mrq235_speaker', ?, ?, ?, 'Logistics Helper', ?, ?, NULL),
        ('speaker_helper_mrq235_helper', ?, ?, ?, 'Logistics Helper', ?, ?, NULL)`)
      .bind(EVENT_ID, RETIRED_ID, HELPER_ID, SURVIVOR_ID, NOW, EVENT_ID, HELPER_ID, RETIRED_ID, SURVIVOR_ID, NOW),
  ]);
}

beforeEach(seedFixture);

test("AC-384 · MRQ-235 · preview and execute retain identity continuity across references", async () => {
  const input = { firstPersonId: SURVIVOR_ID, secondPersonId: RETIRED_ID, survivorPersonId: SURVIVOR_ID };
  const preview = await previewPersonMerge(env.DB, ORG_ID, input, NOW + 10);
  expect(preview.default_survivor_id).toBe(SURVIVOR_ID);
  expect(preview.fields.find((field) => field.field === "bio")).toMatchObject({ result: "Retained biography", source: "retired" });
  expect(preview.fields.find((field) => field.field === "social_links")).toMatchObject({ source: "union" });
  expect(preview.collisions.some((collision) => collision.table === "memberships" && collision.outcome === "deduped")).toBe(true);
  // Membership and both sides of the helper relationship overlap on one
  // conference. The bounded per-source reads must retain UNION's DISTINCT
  // event scope while seeing speaker_person_id, helper_person_id, and added_by.
  expect(preview.event_scope).toEqual([EVENT_ID]);
  expect(preview.summary.references).toMatchObject({
    auth_sessions: 1,
    magic_links: 1,
    forms: 1,
    import_rows: 1,
    audit_log: 1,
    mirror_outbox: 1,
    mirror_credentials: 1,
    speaker_helpers: 2,
  });

  const receipt = await executePersonMerge(env.DB, ORG_ID, { ...input, idempotencyKey: "5d9b5c62-a79b-4a9e-8f99-235000000001" }, ACTOR, NOW + 10);
  expect(receipt).toMatchObject({ status: "clean", can_undo: true, retired_person_id: RETIRED_ID, survivor_person_id: SURVIVOR_ID });
  expect((await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(RETIRED_ID).first())).toBeNull();
  expect(await env.DB.prepare("SELECT bio, social_links, custom_fields, do_not_contact, last_write_source FROM people WHERE id = ?").bind(SURVIVOR_ID).first()).toEqual({
    bio: "Retained biography",
    social_links: JSON.stringify(["https://survivor.test", "https://retired.test"]),
    custom_fields: JSON.stringify({ team: "platform", zero: 0, timezone: "UTC" }),
    do_not_contact: 1,
    last_write_source: "marquee",
  });
  expect(await env.DB.prepare("SELECT person_id FROM person_aliases WHERE email = ?").bind("retired@mrq235.test").first()).toEqual({ person_id: SURVIVOR_ID });
  expect(await env.DB.prepare("SELECT person_id FROM auth_sessions WHERE id = 'session_mrq235'").first()).toEqual({ person_id: SURVIVOR_ID });
  expect(await env.DB.prepare("SELECT person_id FROM magic_links WHERE id = 'magic_mrq235'").first()).toEqual({ person_id: SURVIVOR_ID });
  expect(await env.DB.prepare("SELECT admin_notify_person_ids FROM forms WHERE id = 'form_mrq235'").first()).toEqual({ admin_notify_person_ids: JSON.stringify([SURVIVOR_ID]) });
  expect(await env.DB.prepare("SELECT submitter_person_id FROM submissions WHERE id = 'submission_mrq235'").first()).toEqual({ submitter_person_id: SURVIVOR_ID });
  expect(await env.DB.prepare("SELECT target_id FROM import_rows WHERE id = 'import_row_mrq235'").first()).toEqual({ target_id: SURVIVOR_ID });
  expect(await env.DB.prepare("SELECT actor_person_id, entity_id FROM audit_log WHERE id = 'audit_mrq235'").first()).toEqual({ actor_person_id: SURVIVOR_ID, entity_id: SURVIVOR_ID });
  expect(await env.DB.prepare("SELECT row_id, payload FROM mirror_outbox WHERE id = 'mirror_outbox_mrq235'").first()).toEqual({ row_id: SURVIVOR_ID, payload: JSON.stringify({ marquee_id: SURVIVOR_ID, email: "retired@mrq235.test" }) });
  expect(await env.DB.prepare("SELECT set_by_person_id FROM mirror_credentials WHERE id = 'credential_mrq235'").first()).toEqual({ set_by_person_id: SURVIVOR_ID });
  expect(await env.DB.prepare("SELECT person_id FROM person_list_members WHERE list_id = 'list_mrq235'").first()).toEqual({ person_id: SURVIVOR_ID });
  const aliasResolution = await resolvePersonForSignin(env.DB, { email: "retired@mrq235.test" });
  expect(aliasResolution).toMatchObject({ kind: "found", person: { id: SURVIVOR_ID } });
});

test("AC-385 · MRQ-235 · clean undo restores the retired row and moved references without overwriting later edits", async () => {
  const merge = await executePersonMerge(
    env.DB,
    ORG_ID,
    { firstPersonId: SURVIVOR_ID, secondPersonId: RETIRED_ID, survivorPersonId: SURVIVOR_ID, idempotencyKey: "5d9b5c62-a79b-4a9e-8f99-235000000002" },
    ACTOR,
    NOW + 10,
  );
  await env.DB.prepare("UPDATE people SET bio = ?, updated_at = ? WHERE id = ?").bind("Later organizer edit", NOW + 20, SURVIVOR_ID).run();

  const undone = await undoPersonMerge(env.DB, ORG_ID, merge.merge_id, ACTOR, NOW + 30);
  expect(undone.status).toBe("undone");
  expect(undone.skipped_rows).toContainEqual({ table: "people", primary_key: SURVIVOR_ID, reason: "survivor_changed_since_merge" });
  expect(await env.DB.prepare("SELECT id, bio FROM people WHERE id = ?").bind(RETIRED_ID).first()).toEqual({ id: RETIRED_ID, bio: "Retained biography" });
  expect(await env.DB.prepare("SELECT bio FROM people WHERE id = ?").bind(SURVIVOR_ID).first()).toEqual({ bio: "Later organizer edit" });
  expect(await env.DB.prepare("SELECT person_id FROM auth_sessions WHERE id = 'session_mrq235'").first()).toEqual({ person_id: RETIRED_ID });
  expect(await env.DB.prepare("SELECT id FROM person_aliases WHERE id = ?").bind(merge.merge_id).first()).toBeNull();
  expect(await env.DB.prepare("SELECT status FROM person_merges WHERE id = ?").bind(merge.merge_id).first()).toEqual({ status: "undone" });
});

test("AC-386 · MRQ-235 · alias continuity flattens across a chained merge and blocks the old undo boundary", async () => {
  await env.DB.prepare(
    `INSERT INTO people
      (id, org_id, email, name, title, company, bio, company_id, social_links, custom_fields, do_not_contact, is_demo, kind, last_write_source, created_at, updated_at)
     VALUES ('person_mrq235_third', ?, 'third@mrq235.test', 'Third Person', NULL, NULL, NULL, NULL, '[]', '{}', 0, 0, 'human', 'marquee', ?, ?)`,
  ).bind(ORG_ID, NOW + 2, NOW + 2).run();
  const first = await executePersonMerge(
    env.DB,
    ORG_ID,
    { firstPersonId: SURVIVOR_ID, secondPersonId: RETIRED_ID, survivorPersonId: SURVIVOR_ID, idempotencyKey: "5d9b5c62-a79b-4a9e-8f99-235000000003" },
    ACTOR,
    NOW + 10,
  );
  const second = await executePersonMerge(
    env.DB,
    ORG_ID,
    { firstPersonId: SURVIVOR_ID, secondPersonId: "person_mrq235_third", survivorPersonId: "person_mrq235_third", idempotencyKey: "5d9b5c62-a79b-4a9e-8f99-235000000004" },
    { ...ACTOR, actorPersonId: "person_mrq235_third" },
    NOW + 20,
  );
  expect(second.status).toBe("clean");
  expect(await env.DB.prepare("SELECT person_id FROM person_aliases WHERE email = 'retired@mrq235.test'").first()).toEqual({ person_id: "person_mrq235_third" });
  await expect(undoPersonMerge(env.DB, ORG_ID, first.merge_id, ACTOR, NOW + 30)).rejects.toMatchObject({ code: "undo_blocked" });
  expect(await env.DB.prepare("SELECT status, undo_reason FROM person_merges WHERE id = ?").bind(first.merge_id).first()).toEqual({ status: "undo_blocked", undo_reason: "survivor_remerged" });
});

test("CONTRACT · MRQ-286 · merging a helper into the speaker they help cannot create a self-reference", async () => {
  const merge = await executePersonMerge(
    env.DB,
    ORG_ID,
    { firstPersonId: HELPER_ID, secondPersonId: RETIRED_ID, survivorPersonId: HELPER_ID, idempotencyKey: "5d9b5c62-a79b-4a9e-8f99-235000000005" },
    { ...ACTOR, actorPersonId: HELPER_ID },
    NOW + 10,
  );

  // The two seeded rows point both directions between the selected helper and
  // retired speaker. Execution must complete cleanly; the migration CHECK is
  // the last line of defence, not the expected merge outcome.
  expect(merge.status).toBe("clean");
  expect(await env.DB.prepare("SELECT id FROM speaker_helpers WHERE speaker_person_id = helper_person_id").first()).toBeNull();
  expect(await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(RETIRED_ID).first()).toBeNull();
});
