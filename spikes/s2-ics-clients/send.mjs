import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

export const FROM = "Marquee <marquee@stage11.systems>";
export const ORGANIZER = "mailto:marquee@stage11.systems";
export const UID = "mrq-55-s2-20260909@stage11.systems";
export const TZID = "America/New_York";

const STEPS = [
  {
    method: "REQUEST",
    sequence: 0,
    start: "20260909T150000",
    end: "20260909T153000",
    subject: "[S-2 spike 1/3] Invite — 15:00 ET",
    stampOffset: 0,
  },
  {
    method: "REQUEST",
    sequence: 1,
    start: "20260909T160000",
    end: "20260909T163000",
    subject: "[S-2 spike 2/3] Update — 16:00 ET",
    stampOffset: 1,
  },
  {
    method: "CANCEL",
    sequence: 2,
    start: "20260909T160000",
    end: "20260909T163000",
    subject: "[S-2 spike 3/3] Cancel — 16:00 ET",
    stampOffset: 2,
  },
];

function assertRecipient(recipient) {
  if (
    typeof recipient !== "string" ||
    recipient.includes("\r") ||
    recipient.includes("\n") ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
  ) {
    throw new Error("usage: node send.mjs <recipient-email>");
  }
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function foldLine(line) {
  const folded = [];
  let current = "";
  let limit = 75;

  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > limit) {
      folded.push(current);
      current = ` ${character}`;
      limit = 75;
    } else {
      current += character;
    }
  }
  folded.push(current);
  return folded.join("\r\n");
}

function calendar(step, recipient, stamp) {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Stage 11//Marquee S-2 ICS Client Spike//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${step.method}`,
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    `X-LIC-LOCATION:${TZID}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${UID}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${step.sequence}`,
    `DTSTART;TZID=${TZID}:${step.start}`,
    `DTEND;TZID=${TZID}:${step.end}`,
    "SUMMARY:Marquee S-2 ICS client spike",
    `DESCRIPTION:${escapeIcs("MRQ-55 client-rendering probe. No product action required.")}`,
    `LOCATION:${escapeIcs("Metropolitan Ballroom · Sheraton New York Times Square")}`,
    "URL:https://marquee.stage11.dev/i/mrq-55-s2-20260909",
    "ORGANIZER;CN=Marquee:mailto:marquee@stage11.systems",
    `ATTENDEE;CN=ICS Spike Recipient;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${recipient}`,
    `STATUS:${step.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function buildSeries(recipient, { now = new Date(), runId = randomUUID() } = {}) {
  assertRecipient(recipient);
  const stampBase = new Date(Math.floor(now.getTime() / 1000) * 1000);

  return STEPS.map((step, index) => {
    const stamp = utcStamp(new Date(stampBase.getTime() + step.stampOffset * 1000));
    const ics = calendar(step, recipient, stamp);
    const messageId = `<mrq-55-s2-${index + 1}-${runId}@stage11.systems>`;
    const action = step.method === "CANCEL" ? "cancels" : step.sequence === 0 ? "invites you to" : "reschedules";
    const text = `Marquee ${action} the S-2 ICS client spike. See the calendar controls in this message.`;

    return {
      step: index + 1,
      method: step.method,
      sequence: step.sequence,
      subject: step.subject,
      messageId,
      ics,
      mail: {
        from: FROM,
        to: recipient,
        subject: step.subject,
        messageId,
        text,
        html: `<p>${text}</p>`,
        headers: {
          "Content-Class": "urn:content-classes:calendarmessage",
          "X-Entity-Ref-ID": `${UID}/${step.sequence}/${runId}`,
        },
        icalEvent: {
          filename: "marquee-s2-spike.ics",
          method: step.method,
          content: ics,
        },
      },
    };
  });
}

async function findResendId(apiKey, { subject, recipient, notBefore }) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "marquee-s2-ics-spike/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`Resend list API returned HTTP ${response.status}`);
    }
    const body = await response.json();
    const match = body.data?.find(
      (email) =>
        email.subject === subject &&
        email.to?.includes(recipient) &&
        new Date(email.created_at).getTime() >= notBefore,
    );
    if (match) return match.id;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Resend accepted SMTP delivery but its API did not index subject ${subject}`);
}

export async function sendSeries(recipient, apiKey, { fromStep = 1 } = {}) {
  if (!apiKey) throw new Error("RESEND_API_KEY is required");
  if (![1, 2, 3].includes(fromStep)) throw new Error("--from-step must be 1, 2, or 3");
  const transport = nodemailer.createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: { user: "resend", pass: apiKey },
  });
  const results = [];

  try {
    for (const item of buildSeries(recipient).slice(fromStep - 1)) {
      const notBefore = Date.now() - 1000;
      const info = await transport.sendMail(item.mail);
      if (!info.accepted.includes(recipient) || info.rejected.length > 0) {
        throw new Error(`Resend SMTP did not accept step ${item.step}`);
      }
      const resendId = await findResendId(apiKey, {
        subject: item.subject,
        recipient,
        notBefore,
      });
      results.push({ step: item.step, subject: item.subject, id: resendId });
      console.log(`${item.subject} — accepted Resend ID ${resendId}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    transport.close();
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const recipient = process.argv[2];
  const fromStepArgument = process.argv[3];
  const fromStep = fromStepArgument?.startsWith("--from-step=")
    ? Number(fromStepArgument.split("=", 2)[1])
    : 1;
  try {
    assertRecipient(recipient);
    if (fromStepArgument && !fromStepArgument.startsWith("--from-step=")) {
      throw new Error("usage: node send.mjs <recipient-email> [--from-step=1|2|3]");
    }
    await sendSeries(recipient, process.env.RESEND_API_KEY, { fromStep });
  } catch (error) {
    const secret = process.env.RESEND_API_KEY;
    const message = secret ? String(error.message).replaceAll(secret, "[REDACTED]") : String(error.message);
    console.error(message);
    process.exitCode = 1;
  }
}
