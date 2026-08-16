import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import handler, { captureIncomingEmail } from "../../tooling/inbox-worker/src/index.ts";

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    this.database.runs.push({ sql: this.sql, values: this.values });
    return { success: true, meta: { changes: 1 } };
  }
}

class FakeDatabase {
  constructor() {
    this.runs = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function emailMessage(raw = "From: sender@example.test\r\nSubject: Hello\r\n\r\nbody\r\n") {
  return {
    from: "sender@example.test",
    to: "smoke-01@example.test",
    headers: new Headers({ subject: "Hello" }),
    raw: new Response(raw).body,
  };
}

test("CONTRACT · MRQ-238 · inbound mail is stored as envelope metadata plus lossless RFC-822", async () => {
  const db = new FakeDatabase();
  const raw = [
    "From: Marquee <marquee@stage11.systems>",
    "To: smoke-01@example.test",
    "Subject: We received a talk",
    "Content-Type: text/calendar; charset=utf-8; method=REQUEST",
    "",
    "BEGIN:VCALENDAR",
    "METHOD:REQUEST",
    "UID:uid-01",
    "SEQUENCE:0",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const captured = await captureIncomingEmail(
    emailMessage(raw),
    { DB: db },
    { id: "message-01", receivedAt: "2026-08-15T23:00:00.000Z" },
  );

  assert.deepEqual(captured, {
    id: "message-01",
    received_at: "2026-08-15T23:00:00.000Z",
    from_email: "sender@example.test",
    to_email: "smoke-01@example.test",
    subject: "Hello",
    raw_rfc822: raw,
  });
  assert.equal(db.runs.length, 1);
  assert.match(db.runs[0].sql, /INSERT INTO inbox_messages/);
  assert.deepEqual(db.runs[0].values, [
    "message-01",
    "2026-08-15T23:00:00.000Z",
    "sender@example.test",
    "smoke-01@example.test",
    "Hello",
    raw,
  ]);
});

test("CONTRACT · MRQ-238 · the email handler captures and HTTP never exposes the mailbox", async () => {
  const db = new FakeDatabase();
  await handler.email(emailMessage(), { DB: db });
  assert.equal(db.runs.length, 1);

  const response = await handler.fetch(new Request("https://inbox.example.test/"), { DB: db });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found");
});

test("CONTRACT · MRQ-238 · the worker has its own migration and catch-all D1 configuration", async () => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const migration = await readFile(resolve(repositoryRoot, "tooling/inbox-worker/migrations/0001_inbox_messages.sql"), "utf8");
  const config = await readFile(resolve(repositoryRoot, "tooling/inbox-worker/wrangler.jsonc"), "utf8");
  const readme = await readFile(resolve(repositoryRoot, "tooling/inbox-worker/README.md"), "utf8");

  assert.match(migration, /CREATE TABLE inbox_messages/);
  assert.match(migration, /raw_rfc822 TEXT NOT NULL/);
  assert.match(migration, /idx_inbox_messages_to_received_at/);
  assert.match(config, /"addresses"\s*:\s*\["\*@inbox\.marquee\.stage11\.dev"\]/);
  assert.match(config, /"binding"\s*:\s*"DB"/);
  assert.match(config, /"migrations_dir"\s*:\s*"\.\/migrations"/);
  assert.match(readme, /never reuse|never replace/i);
});
