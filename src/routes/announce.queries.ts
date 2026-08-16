import type { D1Database } from "@cloudflare/workers-types";

import { readAgendaPublication } from "./agenda.queries";
import {
  loadPublicAgenda,
  loadPublicCfp,
  publicAbstractSnippet,
  publicSpeakerUrl,
} from "../lib/public-site";
import { isValidEmail } from "../lib/email-validity";
import { embedIframeSnippet } from "../lib/embed-snippet";

export interface AnnounceAudienceRow {
  id: string;
  name: string;
  email: string;
  do_not_contact: boolean;
  public_link: string;
  talk_title: string;
  talk_titles: string[];
  talk_summary: string;
}

export interface AnnounceEventRow {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  accent: string | null;
  starts_on: string;
  ends_on: string;
  timezone: string;
  venue: string | null;
  status: string;
  demo_mode: number;
  updated_at: number;
}

export interface AnnounceSnapshot {
  event: {
    id: string;
    name: string;
    slug: string;
    starts_on: string;
    ends_on: string;
    timezone: string;
    venue: string | null;
    status: string;
  };
  publication: {
    live: number;
    session_count: number;
    speaker_count: number;
    public_agenda_url: string;
  };
  urls: {
    agenda: string;
    speakers: string;
    cfp: string;
  };
  cfp: { url: string; status: "open" | "closed" } | null;
  announcement_copy: string | null;
  mail: { subject: string; body: string };
  embed: { source: string; snippet: string; configure_url: string } | null;
  speakers: AnnounceAudienceRow[];
}

export async function announceEventFor(db: D1Database, eventId: string): Promise<AnnounceEventRow | null> {
  const row = await db
    .prepare(
      `SELECT id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent,
              status, demo_mode, updated_at
       FROM events WHERE id = ? LIMIT 1`,
    )
    .bind(eventId)
    .first<AnnounceEventRow>();
  return row ?? null;
}

async function contactRowsFor(db: D1Database, ids: readonly string[]): Promise<Map<string, { email: string; do_not_contact: boolean }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .prepare(
      `SELECT id, email, do_not_contact
       FROM people
       WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
    )
    .bind(JSON.stringify([...new Set(ids)]))
    .all<{ id: string; email: string; do_not_contact: number }>();
  return new Map(rows.results.map((row) => [row.id, { email: row.email ?? "", do_not_contact: Number(row.do_not_contact) === 1 }]));
}

/**
 * Read one row per published public speaker. The public agenda loader owns the
 * audience predicate; this module only folds its already-published projection
 * into the event-scoped Announce shape.
 */
export async function readAnnounceAudience(
  db: D1Database,
  event: AnnounceEventRow,
  origin: string,
): Promise<AnnounceAudienceRow[]> {
  if (event.status !== "live") return [];
  const agenda = await loadPublicAgenda(db, { eventSlug: event.slug, allDays: true });
  if (!agenda) return [];
  const speakers = new Map<string, { name: string; slug: string; titles: string[]; summary: string }>();
  for (const session of agenda.sessions) {
    for (const speaker of session.speakers) {
      const current = speakers.get(speaker.id);
      if (current) {
        if (!current.titles.includes(session.title)) current.titles.push(session.title);
        continue;
      }
      speakers.set(speaker.id, {
        name: speaker.name,
        slug: speaker.slug,
        titles: [session.title],
        summary: publicAbstractSnippet(session.abstract)?.head ?? "Published on the conference agenda.",
      });
    }
  }
  const contacts = await contactRowsFor(db, [...speakers.keys()]);
  return [...speakers.entries()]
    .map(([id, speaker]) => {
      const contact = contacts.get(id) ?? { email: "", do_not_contact: false };
      const publicLink = publicSpeakerUrl(origin, event.slug, speaker.slug);
      const doNotContact = contact.do_not_contact;
      return {
        id,
        name: speaker.name,
        email: contact.email,
        do_not_contact: doNotContact,
        public_link: publicLink,
        talk_title: speaker.titles[0] ?? "Published session",
        talk_titles: speaker.titles,
        talk_summary: speaker.summary,
      } satisfies AnnounceAudienceRow;
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function suggestedAnnouncementCopy(input: {
  event: Pick<AnnounceEventRow, "name" | "starts_on" | "ends_on" | "venue">;
  live: number;
  speakerCount: number;
  agendaUrl: string;
}): string {
  const dates = input.event.starts_on === input.event.ends_on
    ? input.event.starts_on
    : `${input.event.starts_on}–${input.event.ends_on}`;
  const venue = input.event.venue?.trim() || "the conference venue";
  return `The public program for ${input.event.name} is live on ${dates} at ${venue}. It includes ${input.live} published session${input.live === 1 ? "" : "s"} with ${input.speakerCount} speaker${input.speakerCount === 1 ? "" : "s"}. See the agenda: ${input.agendaUrl}`;
}

export function suggestedAnnouncementMail(eventName: string): { subject: string; body: string } {
  return {
    subject: `Share your ${eventName} speaker link`,
    body: `Hi {{speaker.first_name}},\n\nYour public speaker page for ${eventName} is ready to share:\n\n{{speaker.public_link}}\n\nPaste the link into a post or message and it will show the conference share card.`,
  };
}

export async function readAnnounceSnapshot(
  db: D1Database,
  eventId: string,
  origin: string,
): Promise<AnnounceSnapshot | null> {
  const event = await announceEventFor(db, eventId);
  if (!event) return null;
  const publication = await readAgendaPublication(db, event.id, event.slug);
  const agenda = event.status === "live" && publication.live > 0
    ? await loadPublicAgenda(db, { eventSlug: event.slug, allDays: true })
    : null;
  const speakers = agenda ? await readAnnounceAudience(db, event, origin) : [];
  const agendaUrl = `${origin.replace(/\/+$/, "")}/agenda?event=${encodeURIComponent(event.slug)}`;
  const speakerUrl = `${origin.replace(/\/+$/, "")}/speakers?event=${encodeURIComponent(event.slug)}`;
  const cfp = event.status === "live" ? await loadPublicCfp(db, event.id) : null;
  const live = publication.live;
  const sessionCount = agenda?.sessions.length ?? 0;
  const speakerCount = speakers.length;
  const embedSource = `${origin.replace(/\/+$/, "")}/embed/${encodeURIComponent(event.slug)}-agenda`;
  const cfpUrl = cfp ? `${origin.replace(/\/+$/, "")}${cfp.url}` : "";
  return {
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      starts_on: event.starts_on,
      ends_on: event.ends_on,
      timezone: event.timezone,
      venue: event.venue,
      status: event.status,
    },
    publication: {
      live,
      session_count: sessionCount,
      speaker_count: speakerCount,
      public_agenda_url: agendaUrl,
    },
    urls: {
      agenda: agendaUrl,
      speakers: speakerUrl,
      cfp: cfpUrl,
    },
    cfp: cfp ? { url: cfpUrl, status: cfp.status } : null,
    announcement_copy: live > 0 && agenda
      ? suggestedAnnouncementCopy({ event, live, speakerCount, agendaUrl })
      : null,
    mail: suggestedAnnouncementMail(event.name),
    embed: live > 0 && agenda
      ? {
          source: embedSource,
          snippet: embedIframeSnippet(embedSource, `${event.name} agenda`, "agenda"),
          configure_url: `${origin.replace(/\/+$/, "")}/embed/config`,
        }
      : null,
    speakers,
  };
}

export function announceRowCanSend(row: Pick<AnnounceAudienceRow, "email" | "do_not_contact">): boolean {
  return isValidEmail(row.email) && !row.do_not_contact;
}
