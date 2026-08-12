#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
assert.ok(
  nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5),
  `schema-verify requires Node >=22.5 for node:sqlite (found ${process.versions.node})`,
);
const { DatabaseSync } = await import("node:sqlite");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const state = mkdtempSync(join(tmpdir(), "marquee-schema-"));
const migrations = readdirSync(join(root, "migrations"))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort()
  .map((name) => readFileSync(join(root, "migrations", name), "utf8"));
const migration = migrations.join("\n");
const initialMigration = migrations[0];
const typeMirror = readFileSync(join(root, "src", "db", "schema.ts"), "utf8");

function runWrangler(args, { expectFailure = false } = {}) {
  const result = spawnSync(wrangler, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
  });

  if (expectFailure) {
    assert.notEqual(
      result.status,
      0,
      `Expected Wrangler command to fail:\n${args.join(" ")}\n${result.stdout}`,
    );
    return result;
  }

  assert.equal(
    result.status,
    0,
    `Wrangler command failed:\n${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

function execute(command, options) {
  return runWrangler(
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      state,
      "--command",
      command,
      "--json",
    ],
    options,
  );
}

function query(command) {
  const result = execute(command);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload[0]?.success, true, `D1 query was not successful: ${command}`);
  return payload[0].results;
}

function expectConstraint(label, command) {
  const result = execute(command, { expectFailure: true });
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /constraint|foreign key|not null/i,
    `[${label}] failed for an unexpected reason`,
  );
}

function names(pattern, source) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function findSqliteFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findSqliteFiles(path));
    if (entry.isFile() && entry.name.endsWith(".sqlite")) files.push(path);
  }
  return files;
}

function parseMirrorColumns(source) {
  const interfaces = new Map();
  for (const match of source.matchAll(
    /export interface (\w+Row)(?: extends (MutableRecord|ImmutableRecord))? \{([\s\S]*?)\n\}/g,
  )) {
    const columns = names(/^\s{2}(\w+):/gm, match[3]);
    if (match[2]) {
      columns.push("id", "created_at");
      if (match[2] === "MutableRecord") columns.push("updated_at");
    }
    interfaces.set(match[1], sorted(columns));
  }

  const rowsBody = source.match(
    /export interface CoreTableRows \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(rowsBody, "CoreTableRows mapping is missing");

  const mapping = new Map();
  for (const match of rowsBody.matchAll(/^\s{2}(\w+): (\w+Row);$/gm)) {
    assert.ok(interfaces.has(match[2]), `Missing row interface ${match[2]}`);
    mapping.set(match[1], interfaces.get(match[2]));
  }
  return mapping;
}

const initialTables = names(/^CREATE TABLE (\w+) \(/gm, initialMigration);
// Rebuild migrations create transient *_new tables before dropping and
// renaming them. They are not part of the final product table registry.
const expectedTables = names(/^CREATE TABLE (\w+) \(/gm, migration)
  .filter((name) => !name.endsWith("_new"));
// A rebuild recreates the original named indexes after dropping the old
// table. The final schema has one of each, even though the migration history
// contains the declaration twice.
const expectedIndexes = [...new Set(names(/^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)/gm, migration))];
const expectedTriggers = [...new Set(names(/^CREATE TRIGGER (\w+)/gm, migration))];
const mirrorColumns = parseMirrorColumns(typeMirror);
const requiredIndexes = [
  "idx_agenda_event_published_starts",
  "idx_agenda_event_starts_room",
  "idx_agenda_room_starts",
  "idx_agenda_track_starts",
  "idx_attachments_draft_files",
  "idx_attachments_owner",
  "idx_attachments_submission_files",
  "idx_form_admins_person_form",
  "idx_outbox_event_created",
  "idx_outbox_person_created",
  "idx_outbox_status_scheduled_created",
  "idx_participations_person_confirmation",
  "idx_participations_submission_role_position",
  "idx_reviewer_track_scopes_person_event_track",
  "idx_reviewer_track_scopes_track_event_person",
  "idx_saved_views_person_event",
  "idx_speaker_tasks_event_status_due",
  "idx_speaker_tasks_person_status_due",
  "idx_speaker_tasks_submission_status",
  "idx_webhook_deliveries_endpoint_created",
  "idx_submission_tracks_track_submission",
  "idx_submissions_event_kind_status",
  "idx_submissions_event_status",
  "uq_evaluations_round_submission_reviewer",
  "uq_form_admins_form_person",
  "uq_memberships_event",
  "uq_memberships_org",
  "uq_participations_person_submission_role",
  "uq_reviewer_track_scopes_event_person_track",
  "uq_saved_views_event_person_name",
  "uq_submission_tracks_one_primary",
  "uq_submission_tracks_submission_track",
];

assert.equal(initialTables.length, 46, "0001 must define exactly 46 product tables");
assert.equal(new Set(initialTables).size, 46, "0001 contains duplicate table names");
assert.equal(expectedTables.length, 53, "Applied migrations must define exactly 53 product tables");
assert.equal(new Set(expectedTables).size, 53, "Applied migrations contain duplicate table names");
for (const index of requiredIndexes) {
  assert.ok(expectedIndexes.includes(index), `Required schema index is missing: ${index}`);
}
assert.match(
  migration,
  /send_policy TEXT NOT NULL DEFAULT 'demo_safe'[\s\S]*?send_policy IN \('demo_safe', 'always_live'\)/,
  "outbox.send_policy declaration drifted",
);
assert.match(migration, /'waitlisted'/, "Complete submission status enum lost waitlisted");
assert.match(
  migration,
  /owner_type IN \([\s\S]*?'draft_file'[\s\S]*?'submission_file'/,
  "Draft/submission attachment relations are missing",
);
assert.deepEqual(
  sorted(mirrorColumns.keys()),
  sorted(expectedTables),
  "SQL and CoreTableRows table registries diverge",
);

let sqlite;
try {
  const firstApply = runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    state,
  ]);
  assert.match(firstApply.stdout, /0001_init\.sql/);
  assert.match(firstApply.stdout, /0002_venue_geography\.sql/);
  assert.match(firstApply.stdout, /0003_building_access_note\.sql/);
  assert.match(firstApply.stdout, /0004_calendar_reversal\.sql/);
  assert.match(firstApply.stdout, /0005_task_cancellation_webhooks\.sql/);
  assert.match(firstApply.stdout, /0006_audit_log_request_id\.sql/);
  assert.match(firstApply.stdout, /0007_embed_widget_kinds\.sql/);
  assert.match(firstApply.stdout, /0008_form_field_dates\.sql/);
  assert.match(firstApply.stdout, /0009_criterion_kinds\.sql/);
  assert.match(firstApply.stdout, /0010_bound_form_options\.sql/);
  assert.match(firstApply.stdout, /0010_saved_embeds\.sql/);
  assert.match(firstApply.stdout, /0010_evaluation_round_committees\.sql/);

  const secondApply = runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    state,
  ]);
  assert.match(
    `${secondApply.stdout}\n${secondApply.stderr}`,
    /No migrations to apply|already applied/i,
    "Wrangler did not treat 0001 as already applied",
  );

  const sqliteFiles = findSqliteFiles(state).filter(
    (path) => path.includes("/d1/") && !path.endsWith("/metadata.sqlite"),
  );
  assert.equal(sqliteFiles.length, 1, `Expected one Wrangler local D1 file, found ${sqliteFiles}`);
  sqlite = new DatabaseSync(sqliteFiles[0]);

  const appliedObjects = sqlite
    .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all();
  const appliedTables = appliedObjects
    .filter(({ type, name }) => type === "table" && !["_cf_METADATA", "d1_migrations"].includes(name))
    .map(({ name }) => name);
  const appliedIndexes = appliedObjects
    .filter(({ type }) => type === "index")
    .map(({ name }) => name)
    .filter((name) => !name.startsWith("sqlite_autoindex_"));
  const appliedTriggers = appliedObjects
    .filter(({ type }) => type === "trigger")
    .map(({ name }) => name);

  assert.deepEqual(sorted(appliedTables), sorted(expectedTables), "Applied D1 table set diverges");
  assert.deepEqual(sorted(appliedIndexes), sorted(expectedIndexes), "Applied D1 index set diverges");
  assert.deepEqual(sorted(appliedTriggers), sorted(expectedTriggers), "Applied D1 triggers diverge");

  const appliedColumns = sqlite.prepare(
    "SELECT m.name AS table_name, p.name AS column_name, p.[notnull] AS not_null, p.dflt_value AS default_value " +
      "FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p " +
      "WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid",
  ).all();
  for (const table of expectedTables) {
    const sqlColumns = appliedColumns
      .filter(({ table_name }) => table_name === table)
      .map(({ column_name }) => column_name);
    assert.deepEqual(
      sorted(sqlColumns),
      mirrorColumns.get(table),
      `SQL/TypeScript column mismatch for ${table}`,
    );
  }

  const sendPolicy = appliedColumns.find(
    ({ table_name, column_name }) => table_name === "outbox" && column_name === "send_policy",
  );
  assert.equal(sendPolicy?.not_null, 1, "outbox.send_policy must be NOT NULL");
  assert.equal(sendPolicy?.default_value, "'demo_safe'", "outbox.send_policy default drifted");
  const attachmentSha = appliedColumns.find(
    ({ table_name, column_name }) => table_name === "attachments" && column_name === "sha256",
  );
  const attachmentEtag = appliedColumns.find(
    ({ table_name, column_name }) => table_name === "attachments" && column_name === "r2_etag",
  );
  assert.equal(attachmentSha?.not_null, 0, "SPEC Amendment 12 requires nullable sha256");
  assert.equal(attachmentEtag?.not_null, 0, "SPEC Amendment 12 requires nullable r2_etag");
  const cancelledAt = appliedColumns.find(
    ({ table_name, column_name }) => table_name === "speaker_tasks" && column_name === "cancelled_at",
  );
  assert.equal(cancelledAt?.not_null, 0, "speaker_tasks.cancelled_at must be nullable");
  const speakerTasksSql = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='speaker_tasks'")
    .get()?.sql;
  assert.match(
    speakerTasksSql,
    /status IN \('open', 'done'\)/,
    "speaker_tasks status enum must remain open/done",
  );

  const foreignKeyRows = sqlite.prepare(
    "SELECT m.name AS table_name, f.[table] AS parent_table, f.[from] AS child_column, f.[to] AS parent_column " +
      "FROM sqlite_master AS m JOIN pragma_foreign_key_list(m.name) AS f " +
      "WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'",
  ).all();
  assert.equal(foreignKeyRows.length, 104, "Expected the exact foreign-key graph");
  const foreignKeyCheck = sqlite.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(foreignKeyCheck, [], "Fresh migration has unresolved foreign keys");

  execute(`
    INSERT INTO organizations VALUES ('org1','Org One','org-one',1,1);
    INSERT INTO organizations VALUES ('org2','Org Two','org-two',1,1);
    INSERT INTO events
      (id,org_id,name,slug,starts_on,ends_on,timezone,status,demo_mode,created_at,updated_at)
      VALUES ('event1','org1','Event One','event-one','2026-09-01','2026-09-03','UTC','draft',1,1,1);
    INSERT INTO events
      (id,org_id,name,slug,starts_on,ends_on,timezone,status,demo_mode,created_at,updated_at)
      VALUES ('event2','org1','Event Two','event-two','2026-10-01','2026-10-03','UTC','draft',0,1,1);
    INSERT INTO buildings (id,event_id,name,address,position,created_at,updated_at)
      VALUES ('building1','event1','Main','1 Main St',0,1,1);
    INSERT INTO rooms
      (id,event_id,building_id,name,capacity,position,av_capabilities,created_at,updated_at)
      VALUES ('room1','event1','building1','Grand',500,0,'["projector"]',1,1);
    INSERT INTO attachments
      (id,event_id,owner_type,owner_id,r2_key,filename,content_type,size_bytes,status,
       sha256,r2_etag,created_at,updated_at)
      VALUES ('draft-file1','event1','draft_file','draft-capability-1','draft/key','draft.pdf',
       'application/pdf',100,'pending',NULL,NULL,1,1);
    INSERT INTO attachments
      (id,event_id,owner_type,owner_id,r2_key,filename,content_type,size_bytes,status,
       sha256,r2_etag,created_at,updated_at)
      VALUES ('submission-file1','event1','submission_file','submission1','submission/key',
       'submission.pdf','application/pdf',100,'ready',NULL,'etag-1',1,1);
    INSERT INTO tracks VALUES ('track1','event1','AI','#112233',0,1,1);
    INSERT INTO tracks VALUES ('track2','event1','Systems','#445566',1,1,1);
    INSERT INTO tracks VALUES ('track3','event2','Other','#778899',0,1,1);
    INSERT INTO people
      (id,org_id,email,name,social_links,is_demo,last_write_source,created_at,updated_at)
      VALUES ('person1','org1','one@example.test','One','[]',1,'marquee',1,1);
    INSERT INTO people
      (id,org_id,email,name,social_links,is_demo,last_write_source,created_at,updated_at)
      VALUES ('person2','org2','one@example.test','Two','[]',0,'marquee',1,1);
    INSERT INTO memberships (id,org_id,event_id,person_id,role,created_at,updated_at)
      VALUES ('membership1','org1','event1','person1','owner',1,1);
    INSERT INTO memberships (id,org_id,event_id,person_id,role,created_at,updated_at)
      VALUES ('membership2','org1','event1','person1','reviewer',1,1);
    INSERT INTO forms
      (id,event_id,name,slug,kind,status,opens_at,closes_at,welcome_md,per_submitter_limit,
       min_speakers,max_speakers,max_sponsors,password_hash,reminder_offset_hours,
       thankyou_template_key,admin_notify_person_ids,turnstile_required,created_at,updated_at)
      VALUES ('form1','event1','CFP','cfp','abstract','open',NULL,NULL,'',3,1,4,0,NULL,NULL,NULL,'[]',1,1,1);
    INSERT INTO submissions
      (id,event_id,kind,title,origin,submitter_person_id,created_at,updated_at)
      VALUES ('session-default','event1','session','Session default','admin','person1',1,1);
    INSERT INTO submissions
      (id,event_id,kind,title,origin,submitter_person_id,created_at,updated_at)
      VALUES ('abstract-default','event1','abstract','Abstract default','admin','person1',1,1);
    INSERT INTO submissions
      (id,event_id,form_id,kind,bypass_evaluation,title,abstract,status,origin,
       vendor_affiliation,submitter_person_id,is_published,search_blob,last_write_source,
       created_at,updated_at)
      VALUES ('submission1','event1','form1','abstract',0,'A Great Talk','About systems',
       'waitlisted','public','none','person1',0,'','marquee',1,1);
    INSERT INTO submission_tracks VALUES ('submission_track1','submission1','track1',1,1,1);
    UPDATE submissions SET primary_track_id='track1' WHERE id='submission1';
    INSERT INTO participations VALUES
      ('participation1','submission1','person1','speaker',0,'pending',NULL,NULL,1,1);
    INSERT INTO participations VALUES
      ('participation2','submission1','person1','moderator',1,'confirmed',1,1,1,1);
    INSERT INTO outbox
      (id,event_id,template_key,person_id,to_email,subject,html,text,status,idempotency_key,
       created_at,updated_at)
      VALUES ('outbox1','event1','acceptance','person1','one@example.test','Subject','<p>Body</p>',
       'Body','queued','decision-submission1',1,1);
    INSERT INTO submission_decisions VALUES
      ('decision1','event1','submission1','maybe','waitlisted',NULL,'person1',2,'outbox1',1,1);
    INSERT INTO submission_decisions VALUES
      ('decision2','event1','submission1','approve','accepted','Welcome','person1',3,NULL,1,1);
    INSERT INTO saved_views VALUES
      ('view1','event1','person1','Mine','{"q":"","filters":{},"sort":[],"columns":["title"]}',1,1);
    INSERT INTO evaluation_plans VALUES
      ('plan1','event1','Plan','',NULL,NULL,'open',1,1);
    INSERT INTO evaluation_rounds
      (id,plan_id,position,name,mode,anonymized,target_reviews_per_submission,opens_at,closes_at,created_at,updated_at,committee_id)
      VALUES ('round1','plan1',0,'Round 1','scorecard',0,1,NULL,NULL,1,1,NULL);
    INSERT INTO evaluation_rounds
      (id,plan_id,position,name,mode,anonymized,target_reviews_per_submission,opens_at,closes_at,created_at,updated_at,committee_id)
      VALUES ('round2','plan1',1,'Round 2','comparison',0,1,NULL,NULL,1,1,NULL);
    INSERT INTO reviewer_track_scopes VALUES ('scope1','event1','person1','track1',1,1);
    INSERT INTO committees VALUES ('committee1','event1','Committee',1,1);
    INSERT INTO round_assignments VALUES
      ('assignment1','round1','submission1','person1',NULL,'open',1,1);
    INSERT INTO evaluations VALUES
      ('evaluation1','round1','submission1','person1','approve',NULL,NULL,'',0,1,1);
    INSERT INTO evaluations VALUES
      ('evaluation2','round2','submission1','person1','maybe',NULL,NULL,'',0,1,1);
    INSERT INTO comparisons VALUES
      ('comparison1','round2','person1','["submission1","s2","s3"]',
       '["submission1",["s2","s3"]]',1,1);
    INSERT INTO agenda_items VALUES
      ('agenda1','event1','submission1','session',NULL,1000,30,'room1','track1',0,1,1);
    INSERT INTO webhook_endpoints
      (id,event_id,url,secret_hash,events_json,created_at)
      VALUES ('endpoint1','event1','https://hooks.example.test/receive','hash-1',
       '["submission.created","submission.status_changed","evaluation.completed","speaker_task.completed","agenda.published","speaker.confirmed"]',1);
    INSERT INTO webhook_deliveries
      (id,endpoint_id,event_type,payload,status,created_at)
      VALUES ('delivery1','endpoint1','submission.created','{}','queued',1);
  `);

  assert.equal(
    query("SELECT search_blob FROM submissions WHERE id='submission1'")[0].search_blob,
    "a great talk about systems",
    "search_blob insert trigger did not normalize title and abstract",
  );
  execute("UPDATE submissions SET title='Changed' WHERE id='submission1'");
  assert.equal(
    query("SELECT search_blob FROM submissions WHERE id='submission1'")[0].search_blob,
    "changed about systems",
    "search_blob update trigger did not refresh the projection",
  );

  assert.equal(
    query("SELECT send_policy FROM outbox WHERE id='outbox1'")[0].send_policy,
    "demo_safe",
    "outbox did not use the demo_safe default",
  );
  assert.equal(
    query("SELECT bypass_evaluation FROM submissions WHERE id='session-default'")[0]
      .bypass_evaluation,
    1,
    "Session inserts must derive bypass_evaluation=1",
  );
  assert.equal(
    query("SELECT bypass_evaluation FROM submissions WHERE id='abstract-default'")[0]
      .bypass_evaluation,
    0,
    "Abstract inserts must retain bypass_evaluation=0",
  );
  execute("UPDATE submissions SET bypass_evaluation=0 WHERE id='session-default'");
  assert.equal(
    query("SELECT bypass_evaluation FROM submissions WHERE id='session-default'")[0]
      .bypass_evaluation,
    0,
    "The insert derivation must not override a later admin toggle",
  );
  execute(
    "INSERT INTO outbox (id,event_id,template_key,to_email,subject,html,text,status,send_policy,idempotency_key,created_at,updated_at) " +
      "VALUES ('outbox2','event1','custom','live@example.test','S','H','T','queued','always_live','live-1',1,1)",
  );

  assert.equal(
    query(
      "SELECT count(*) AS count FROM memberships WHERE person_id='person1' AND event_id='event1'",
    )[0].count,
    2,
    "Organizer and reviewer roles must coexist for one event",
  );
  assert.equal(
    query("SELECT count(*) AS count FROM submission_decisions WHERE submission_id='submission1'")[0]
      .count,
    2,
    "Decision history was collapsed",
  );
  assert.equal(
    query(
      "SELECT count(*) AS count FROM submission_tracks WHERE submission_id='submission1' AND is_primary=1",
    )[0].count,
    1,
    "Submission must have exactly one primary track in the committed fixture",
  );
  assert.equal(
    query(
      "SELECT count(*) AS count FROM submission_tracks st JOIN submissions s ON s.id=st.submission_id " +
        "WHERE s.id='submission1' AND st.is_primary=1 AND st.track_id=s.primary_track_id",
    )[0].count,
    1,
    "Primary track denormalization and join row diverged",
  );
  assert.equal(
    query(
      "SELECT count(*) AS count FROM attachments WHERE owner_type='draft_file' " +
        "AND owner_id='draft-capability-1' AND sha256 IS NULL AND r2_etag IS NULL",
    )[0].count,
    1,
    "A pending file must attach to a durable draft before a submission exists",
  );
  assert.equal(
    query(
      "SELECT count(*) AS count FROM attachments WHERE owner_type='submission_file' " +
        "AND owner_id='submission1' AND status='ready' AND r2_etag='etag-1'",
    )[0].count,
    1,
    "A completed file must attach to its submission with the observed R2 ETag",
  );
  const endpoint = query(
    "SELECT enabled,last_delivery_at FROM webhook_endpoints WHERE id='endpoint1'",
  )[0];
  assert.deepEqual(endpoint, { enabled: 1, last_delivery_at: null }, "Webhook endpoint defaults drifted");
  const delivery = query(
    "SELECT attempts,response_code,error,delivered_at FROM webhook_deliveries WHERE id='delivery1'",
  )[0];
  assert.deepEqual(
    delivery,
    { attempts: 0, response_code: null, error: null, delivered_at: null },
    "Webhook delivery defaults drifted",
  );
  const webhookPlan = query(
    "EXPLAIN QUERY PLAN SELECT id FROM webhook_deliveries " +
      "WHERE endpoint_id='endpoint1' ORDER BY created_at",
  )
    .map(({ detail }) => detail)
    .join("\n");
  assert.match(
    webhookPlan,
    /idx_webhook_deliveries_endpoint_created/,
    "Webhook delivery log did not use its endpoint/created index",
  );

  const reviewerPlan = query(
    "EXPLAIN QUERY PLAN SELECT s.id FROM submissions s " +
      "JOIN submission_tracks st ON st.submission_id=s.id " +
      "JOIN reviewer_track_scopes rts ON rts.track_id=st.track_id AND rts.event_id=s.event_id " +
      "WHERE rts.person_id='person1' AND rts.event_id='event1'",
  )
    .map(({ detail }) => detail)
    .join("\n");
  assert.match(
    reviewerPlan,
    /idx_reviewer_track_scopes_person_event_track|uq_reviewer_track_scopes_event_person_track/,
    "Reviewer-scope intersection did not use a scope index",
  );
  assert.match(
    reviewerPlan,
    /idx_submission_tracks_track_submission|uq_submission_tracks_submission_track/,
    "Reviewer-scope intersection did not use a track intersection index",
  );

  const draftPlan = query(
    "EXPLAIN QUERY PLAN SELECT id,last_saved_at,submitter_person_id,form_id FROM submissions " +
      "WHERE event_id='event1' AND status='draft'",
  )
    .map(({ detail }) => detail)
    .join("\n");
  assert.match(draftPlan, /idx_submissions_event_status/, "Draft queue did not use status index");

  expectConstraint(
    "AC-176 complete status enum",
    "INSERT INTO submissions (id,event_id,kind,title,status,origin,vendor_affiliation,submitter_person_id,created_at,updated_at) " +
      "VALUES ('bad-status','event1','abstract','Bad','unknown','admin','none','person1',1,1)",
  );
  expectConstraint(
    "AC-212 org-scoped email",
    "INSERT INTO people (id,org_id,email,name,created_at,updated_at) " +
      "VALUES ('person3','org1','one@example.test','Duplicate',1,1)",
  );
  expectConstraint(
    "AC-214 reviewer event requirement",
    "INSERT INTO memberships (id,org_id,event_id,person_id,role,created_at,updated_at) VALUES ('bad-membership','org1',NULL,'person1','reviewer',1,1)",
  );
  expectConstraint(
    "membership exact uniqueness",
    "INSERT INTO memberships (id,org_id,event_id,person_id,role,created_at,updated_at) VALUES ('duplicate-membership','org1','event1','person1','reviewer',1,1)",
  );
  expectConstraint(
    "AC-222 participation triple",
    "INSERT INTO participations VALUES " +
      "('duplicate-participation','submission1','person1','speaker',2,'pending',NULL,NULL,1,1)",
  );
  expectConstraint(
    "AC-234 one primary",
    "INSERT INTO submission_tracks VALUES ('second-primary','submission1','track2',1,1,1)",
  );
  expectConstraint(
    "AC-246 scope uniqueness",
    "INSERT INTO reviewer_track_scopes VALUES ('duplicate-scope','event1','person1','track1',1,1)",
  );
  expectConstraint(
    "AC-246 cross-event track scope",
    "INSERT INTO reviewer_track_scopes VALUES ('cross-scope','event2','person1','track1',1,1)",
  );
  expectConstraint(
    "AC-247 saved-view ownership",
    "INSERT INTO saved_views VALUES ('duplicate-view','event1','person1','Mine','{}',1,1)",
  );
  expectConstraint(
    "AC-252 building required",
    "INSERT INTO rooms (id,event_id,building_id,name,capacity,position,created_at,updated_at) " +
      "VALUES ('bad-room','event1','missing','Bad',1,0,1,1)",
  );
  expectConstraint(
    "AC-252 same-event building",
    "INSERT INTO rooms (id,event_id,building_id,name,capacity,position,created_at,updated_at) " +
      "VALUES ('cross-room','event2','building1','Bad',1,0,1,1)",
  );
  expectConstraint(
    "AC-253 AV JSON array",
    "INSERT INTO rooms (id,event_id,building_id,name,capacity,position,av_capabilities,created_at,updated_at) " +
      "VALUES ('bad-av','event1','building1','Bad',1,0,'{}',1,1)",
  );
  expectConstraint(
    "ready attachment requires R2 ETag",
    "INSERT INTO attachments " +
      "(id,event_id,owner_type,owner_id,r2_key,filename,content_type,size_bytes,status,created_at,updated_at) " +
      "VALUES ('bad-ready','event1','submission_file','submission1','bad/key','bad.pdf'," +
      "'application/pdf',100,'ready',1,1)",
  );
  expectConstraint(
    "round-aware evaluation uniqueness",
    "INSERT INTO evaluations VALUES " +
      "('duplicate-evaluation','round1','submission1','person1','deny',NULL,NULL,'',0,1,1)",
  );
  expectConstraint(
    "assignment XOR neither",
    "INSERT INTO round_assignments VALUES " +
      "('bad-assignment1','round1','submission1',NULL,NULL,'open',1,1)",
  );
  expectConstraint(
    "assignment XOR both",
    "INSERT INTO round_assignments VALUES " +
      "('bad-assignment2','round1','submission1','person1','committee1','open',1,1)",
  );
  expectConstraint(
    "comparison triplet",
    "INSERT INTO comparisons VALUES " +
      "('bad-comparison','round2','person1','[\"submission1\",\"s2\"]','[]',1,1)",
  );
  expectConstraint(
    "agenda break shape",
    "INSERT INTO agenda_items VALUES " +
      "('bad-agenda','event1','submission1','break','Break',2000,15,'room1',NULL,0,1,1)",
  );
  expectConstraint(
    "webhook endpoint URL scheme",
    "INSERT INTO webhook_endpoints (id,event_id,url,secret_hash,events_json,created_at) " +
      "VALUES ('bad-endpoint-url','event1','http://hooks.example.test','hash','[]',1)",
  );
  expectConstraint(
    "webhook event allowlist",
    "INSERT INTO webhook_endpoints (id,event_id,url,secret_hash,events_json,created_at) " +
      "VALUES ('bad-endpoint-event','event1','https://hooks.example.test','hash','[\"person.updated\"]',1)",
  );
  expectConstraint(
    "webhook delivery event allowlist",
    "INSERT INTO webhook_deliveries (id,endpoint_id,event_type,payload,status,created_at) " +
      "VALUES ('bad-delivery-event','endpoint1','person.updated','{}','queued',1)",
  );
  expectConstraint(
    "webhook delivery status",
    "INSERT INTO webhook_deliveries (id,endpoint_id,event_type,payload,status,created_at) " +
      "VALUES ('bad-delivery-status','endpoint1','submission.created','{}','retrying',1)",
  );
  expectConstraint(
    "API scopes shape",
    "INSERT INTO api_tokens (id,org_id,name,token_hash,prefix,scopes,created_by,created_at,updated_at) " +
      "VALUES ('bad-token','org1','Bad','hash','mq_bad','[]','person1',1,1)",
  );

  console.log(
    `schema verification passed: ${expectedTables.length} tables, ` +
      `${expectedIndexes.length} named indexes, ${foreignKeyRows.length} foreign keys, ` +
      `${expectedTriggers.length} triggers`,
  );
} finally {
  sqlite?.close();
  if (process.env.MARQUEE_KEEP_SCHEMA_STATE === "1") {
    console.log(`kept local D1 state at ${state}`);
  } else {
    rmSync(state, { force: true, recursive: true });
  }
}
