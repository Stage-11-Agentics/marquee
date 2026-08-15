import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSmokeAnswers,
  extractIcs,
  fromName,
  freshSmokeAddress,
  parseIcs,
} from "../../scripts/checks/inbox-smoke-lib.mjs";

test("CONTRACT · MRQ-238 · every smoke run gets a fresh ULID localpart", () => {
  const first = freshSmokeAddress({ to: "reused@example.test" });
  const second = freshSmokeAddress({ to: "reused@example.test" });
  assert.notEqual(first.address, second.address);
  assert.equal(first.domain, "example.test");
  assert.match(first.address, /^smoke-[0-9a-hjkmnp-tv-z]{26}@example\.test$/);
  assert.equal(first.runId.length, 26);
  assert.notEqual(first.address.split("@")[0], "reused");
});

test("CONTRACT · MRQ-238 · the smoke parser finds an attached ICS and checks calendar invariants", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:smoke-uid",
    "SEQUENCE:0",
    "DTSTART;TZID=America/New_York:20260909T150000",
    "DTEND;TZID=America/New_York:20260909T153000",
    "LOCATION:Main Stage",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const raw = [
    "From: Marquee <marquee@stage11.systems>",
    "Subject: Calendar invitation",
    "Content-Type: multipart/mixed; boundary=smoke",
    "",
    "--smoke",
    "Content-Type: text/calendar; name=invite.ics",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(ics).toString("base64"),
    "--smoke--",
    "",
  ].join("\r\n");
  assert.equal(fromName(raw), "Marquee <marquee@stage11.systems>");
  assert.match(extractIcs(raw), /BEGIN:VCALENDAR/);
  assert.deepEqual(parseIcs(raw), {
    uid: "smoke-uid",
    sequence: 0,
    method: "REQUEST",
    location: "Main Stage",
    dtstart: "DTSTART;TZID=America/New_York:20260909T150000",
    raw: ics,
  });
});

test("CONTRACT · MRQ-238 · generated public answers keep conditional fields honest", () => {
  const fields = [
    { key: "vendor_content", type: "single_select", required: true, config: { options: ["No", "Yes"] }, condition: null },
    { key: "vendor_product", type: "short_text", required: true, config: {}, condition: { all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] } },
    { key: "tracks", type: "multi_select", required: true, config: { options: ["Infrastructure"] }, condition: null },
  ];
  const answers = buildSmokeAnswers(fields, "01m03wfoo00000000000000000", "smoke@example.test");
  assert.equal(answers.vendor_content, "No");
  assert.equal("vendor_product" in answers, false);
  assert.deepEqual(answers.tracks, ["Infrastructure"]);
});
