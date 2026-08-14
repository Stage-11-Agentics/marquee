import type { PublicEmbedData, PublicSession, PublicSpeaker } from "./public-site";

function escapeXml(value: unknown, attribute = false): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", attribute ? "&apos;" : "'");
}

function element(name: string, value: unknown, indent = "    "): string {
  return `${indent}<${name}>${escapeXml(value)}</${name}>`;
}

function sessionXml(session: PublicSession, fields: ReadonlySet<string>): string[] {
  const lines = [`  <session id="${escapeXml(session.id, true)}" slug="${escapeXml(session.slug, true)}">`];
  if (fields.has("time")) {
    lines.push(
      element("day", session.day),
      element("date", session.date),
      element("time", session.time),
      element("end-time", session.endTime),
      element("starts-at", session.startsAt),
      element("duration-minutes", session.durationMin),
    );
  }
  if (fields.has("title")) lines.push(element("title", session.title));
  if (fields.has("abstract")) lines.push(element("abstract", session.abstract));
  if (fields.has("location")) {
    lines.push(element("room", session.roomLabel));
    if (session.building) lines.push(element("building", session.building));
    if (session.buildingAddress) lines.push(element("address", session.buildingAddress));
  }
  if (fields.has("format") && session.format) {
    lines.push(`    <format id="${escapeXml(session.format.id, true)}">${escapeXml(session.format.name)}</format>`);
  }
  if (fields.has("track")) {
    lines.push("    <tracks>");
    for (const track of session.tracks) lines.push(`      <track id="${escapeXml(track.id, true)}" color="${escapeXml(track.color, true)}">${escapeXml(track.name)}</track>`);
    lines.push("    </tracks>");
  }
  if (fields.has("speakers")) {
    lines.push("    <speakers>");
    for (const speaker of session.speakers) lines.push(`      <speaker id="${escapeXml(speaker.id, true)}"><name>${escapeXml(speaker.name)}</name></speaker>`);
    lines.push("    </speakers>");
  }
  lines.push("  </session>");
  return lines;
}

function speakerXml(speaker: PublicSpeaker, fields: ReadonlySet<string>): string[] {
  const lines = [`  <speaker id="${escapeXml(speaker.id, true)}" slug="${escapeXml(speaker.slug, true)}">`];
  if (fields.has("name")) lines.push(element("name", speaker.name));
  if (fields.has("title")) lines.push(element("title", speaker.title));
  if (fields.has("company")) lines.push(element("company", speaker.company));
  if (fields.has("bio")) lines.push(element("bio", speaker.bio));
  if (fields.has("headshot")) lines.push(element("headshot-url", speaker.headshotUrl));
  if (fields.has("sessions")) {
    lines.push("    <sessions>");
    for (const session of speaker.sessions) lines.push(`      <session id="${escapeXml(session.id, true)}" slug="${escapeXml(session.slug, true)}"><title>${escapeXml(session.title)}</title><time>${escapeXml(session.time)}</time><room>${escapeXml(session.roomLabel)}</room></session>`);
    lines.push("    </sessions>");
  }
  if (fields.has("social")) {
    lines.push("    <social-links>");
    for (const link of speaker.socialLinks) lines.push(`      <link>${escapeXml(link)}</link>`);
    lines.push("    </social-links>");
  }
  lines.push("  </speaker>");
  return lines;
}

/** A stable, dependency-free XML representation of a public embed. */
export function buildPublicXml(data: PublicEmbedData): string {
  const fields = new Set(data.config.fields);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<marquee-embed kind="${escapeXml(data.kind, true)}" slug="${escapeXml(data.slug, true)}">`,
    `  <event slug="${escapeXml(data.event.slug, true)}">`,
    element("name", data.event.name, "    "),
    element("starts-on", data.event.startsOn, "    "),
    element("ends-on", data.event.endsOn, "    "),
    "  </event>",
  ];

  if (data.kind === "cfp") {
    if (data.cfp) {
      lines.push("  <call-for-speakers>");
      if (fields.has("status")) lines.push(element("status", data.cfp.status));
      if (fields.has("deadline")) lines.push(element("deadline", data.cfp.closesAt));
      if (fields.has("formats")) {
        lines.push("    <formats>");
        for (const format of data.cfp.formats) lines.push(element("format", format, "      "));
        lines.push("    </formats>");
      }
      if (fields.has("link")) lines.push(element("url", data.cfp.url));
      lines.push("  </call-for-speakers>");
    }
  } else if (data.kind === "speakers") {
    lines.push("  <speakers>");
    for (const speaker of data.speakers) lines.push(...speakerXml(speaker, fields));
    lines.push("  </speakers>");
  } else {
    lines.push("  <sessions>");
    for (const session of data.sessions) lines.push(...sessionXml(session, fields));
    lines.push("  </sessions>");
  }
  lines.push("</marquee-embed>");
  return `${lines.join("\n")}\n`;
}
