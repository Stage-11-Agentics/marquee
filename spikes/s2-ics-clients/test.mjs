import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { buildSeries, ORGANIZER, UID } from "./send.mjs";

const RECIPIENT = "recipient@example.com";
const NOW = new Date("2026-08-09T06:20:00Z");

test("builds the stable UID request, update, and cancel lifecycle", () => {
  const series = buildSeries(RECIPIENT, { now: NOW, runId: "test-run" });

  assert.deepEqual(series.map(({ method }) => method), ["REQUEST", "REQUEST", "CANCEL"]);
  assert.deepEqual(series.map(({ sequence }) => sequence), [0, 1, 2]);
  for (const item of series) {
    assert.match(item.ics, new RegExp(`UID:${UID}\\r\\n`));
    assert.match(item.ics, new RegExp(`METHOD:${item.method}\\r\\n`));
    assert.match(item.ics, new RegExp(`SEQUENCE:${item.sequence}\\r\\n`));
    assert.match(item.ics, new RegExp(`ORGANIZER;CN=Marquee:${ORGANIZER}\\r\\n`));
    assert.match(item.ics, /ATTENDEE;[\s\S]*RSVP=TRUE:mailto:recipient@example\.com\r\n/);
    assert.equal(item.ics.replaceAll("\r\n", "").includes("\n"), false);
    for (const line of item.ics.split("\r\n")) {
      assert.ok(Buffer.byteLength(line, "utf8") <= 75, `overlong ICS line: ${line}`);
    }
  }

  assert.match(series[0].ics, /DTSTART;TZID=America\/New_York:20260909T150000/);
  assert.match(series[1].ics, /DTSTART;TZID=America\/New_York:20260909T160000/);
  assert.match(series[2].ics, /DTSTART;TZID=America\/New_York:20260909T160000/);
  assert.match(series[2].ics, /STATUS:CANCELLED/);
});

test("renders text, HTML, and calendar as multipart alternatives", async () => {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });

  for (const item of buildSeries(RECIPIENT, { now: NOW, runId: "mime-test" })) {
    const info = await transport.sendMail(item.mail);
    const mime = info.message.toString("utf8");
    assert.match(mime, /Content-Type: multipart\/alternative;/i);
    assert.match(mime, /Content-Type: text\/plain; charset=utf-8/i);
    assert.match(mime, /Content-Type: text\/html; charset=utf-8/i);
    assert.match(mime, new RegExp(`Content-Type: text/calendar;[\\s\\S]*method=${item.method}`, "i"));
    assert.match(mime, /Content-Type: application\/ics;/i);
  }
});

test("rejects missing or header-injection recipients", () => {
  assert.throws(() => buildSeries(), /usage:/);
  assert.throws(() => buildSeries("victim@example.com\r\nBcc: attacker@example.com"), /usage:/);
});
