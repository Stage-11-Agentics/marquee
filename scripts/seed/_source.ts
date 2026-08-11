/**
 * Loads and normalizes the public seed fixture derived from the published
 * AI Engineer Summit 2025 program. It contains no emails or headshot URLs;
 * nothing here invents contact details for real people.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SourceSpeaker {
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  /** Newline-separated public profile URLs from the published program. */
  social: string | null;
}

export interface SourceSession {
  id: string;
  slug: string;
  title: string;
  track: string;
  type: string;
  room: string;
  start: string;
  duration_min: number;
  abstract: string | null;
  /** Some published items carry a description instead of an abstract. */
  description: string | null;
  speakers: SourceSpeaker[];
}

interface SourcePayload {
  sessions: SourceSession[];
}

const SOURCE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "seed",
  "aie-summit-2025-program.json",
);

let cached: SourcePayload | undefined;

export function loadSource(): SourcePayload {
  if (!cached) {
    const payload = JSON.parse(readFileSync(SOURCE_PATH, "utf8")) as SourcePayload;
    if (!Array.isArray(payload.sessions) || payload.sessions.length === 0) {
      throw new Error(`source program at ${SOURCE_PATH} has no sessions`);
    }
    cached = payload;
  }
  return cached;
}

/**
 * The real accepted core: the 60 grid items of the Feb 2025 program that name
 * at least one speaker, in deterministic program order.
 *
 * The capture's `type` field is unreliable — three real workshops are typed
 * OTHER ("Building (Agents) with Model Context Protocol", "An Opinionated
 * Blueprint…", "Agent Memory and the LLM OS"), and three pieces of agenda
 * furniture are typed TALK ("AI Leadership Welcome", "Workshop Day and Online
 * Track Welcome", "Workshop Afternoon Break"). Selecting on named speakers
 * instead reproduces both numbers the source itself asserts and SPEC §6
 * requires: `all_items_with_named_speakers: 60` and `unique_speakers: 75`.
 * A filter on `type` yields 60 items but only 72 speakers, and seeds a coffee
 * break as an accepted conference abstract.
 */
export function contentSessions(): SourceSession[] {
  return loadSource()
    .sessions.filter((session) => session.speakers.length > 0)
    .sort((left, right) =>
      left.start === right.start
        ? left.slug.localeCompare(right.slug)
        : left.start.localeCompare(right.start),
    );
}

/** Every named speaker on the accepted core, deduped by name, stable order. */
export function coreSpeakers(): SourceSpeaker[] {
  const seen = new Set<string>();
  const speakers: SourceSpeaker[] = [];
  for (const session of contentSessions()) {
    for (const speaker of session.speakers) {
      const name = speaker.name.trim();
      if (seen.has(name)) continue;
      seen.add(name);
      speakers.push({ ...speaker, name });
    }
  }
  return speakers;
}

/** Speakers on one session, deduped and trimmed the same way. */
export function sessionSpeakers(session: SourceSession): SourceSpeaker[] {
  const seen = new Set<string>();
  const speakers: SourceSpeaker[] = [];
  for (const speaker of session.speakers) {
    const name = speaker.name.trim();
    if (seen.has(name)) continue;
    seen.add(name);
    speakers.push({ ...speaker, name });
  }
  return speakers;
}

export function socialLinks(speaker: SourceSpeaker): string[] {
  return (speaker.social ?? "")
    .split("\n")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}
