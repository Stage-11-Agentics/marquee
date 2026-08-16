import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSmokeAnswers,
  commandArguments,
  extractIcs,
  fromName,
  freshSmokeAddress,
  parseIcs,
} from "../../scripts/checks/inbox-smoke-lib.mjs";

test("CONTRACT · MRQ-238 · exact recipients are preserved and omitted recipients get a fresh ULID", () => {
  const exact = freshSmokeAddress({ to: "fresh@example.test" });
  assert.equal(exact.address, "fresh@example.test");
  assert.deepEqual(exact.addresses, ["fresh@example.test"]);
  assert.deepEqual(exact.requestedTo, ["fresh@example.test"]);
  assert.equal(exact.generated, false);
  assert.equal(exact.generatedAddress, null);

  const first = freshSmokeAddress();
  const second = freshSmokeAddress();
  assert.notEqual(first.address, second.address);
  assert.equal(first.domain, "inbox.marquee.stage11.dev");
  assert.match(first.address, /^smoke-[0-9a-hjkmnp-tv-z]{26}@inbox\.marquee\.stage11\.dev$/);
  assert.equal(first.runId.length, 26);
  assert.equal(first.generatedAddress, first.address);
  assert.equal(first.requestedTo, null);
});

test("CONTRACT · MRQ-238 · repeated --to arguments remain expressible", () => {
  assert.deepEqual(
    commandArguments(["--to", "gmail@example.test", "--to=outlook@example.test", "--to", "apple@example.test"]).to,
    ["gmail@example.test", "outlook@example.test", "apple@example.test"],
  );
});

test("CONTRACT · MRQ-238 · the smoke parser finds an attached ICS and checks calendar invariants", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "DTSTART:19700308T020000",
    "END:VTIMEZONE",
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
  assert.equal(fromName(raw), "Marquee");
  assert.equal(fromName("From: marquee@stage11.systems\r\n\r\nbody"), null);
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

test("CONTRACT · MRQ-238 · quoted-printable calendar decoding precedes the raw MIME fallback", () => {
  const raw = [
    "From: Marquee <marquee@stage11.systems>",
    "Subject: Calendar invitation",
    "Content-Type: multipart/mixed; boundary=smoke",
    "",
    "--smoke",
    "Content-Type: text/calendar; charset=utf-8; method=REQUEST",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:qp-uid=",
    "part",
    "SEQUENCE:0",
    "DTSTART;TZID=3DAmerica/New_York:20260909T150000",
    "LOCATION:Main Stage",
    "END:VEVENT",
    "END:VCALENDAR",
    "--smoke--",
    "",
  ].join("\r\n");
  const parsed = parseIcs(raw);
  assert.equal(parsed.uid, "qp-uidpart");
  assert.equal(parsed.dtstart, "DTSTART;TZID=America/New_York:20260909T150000");
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
