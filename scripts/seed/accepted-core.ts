/**
 * The real accepted core (SPEC §6): the 60 sessions of the published AI
 * Engineer Summit 2025 program that name a speaker, their 75 speakers, and the
 * participations that connect them — replayed as accepted abstracts and
 * bypassed sessions on the 2026 event so that a judge's first screen is real,
 * checkable material.
 *
 * What is real: names, job titles, companies, bios, public profile links,
 * session titles, and the public abstracts. What is synthetic, always:
 * every email address (`firstname.lastname@example.com`), and every headshot
 * (none seeded — the UI renders initials placeholders). See SEED-DATA.md.
 *
 * Provenance rides on each submission as `external_ref = 'aie-2025:<source id>'`.
 */

import { seedId, slugify, syntheticEmail } from "../../src/lib/ids.ts";
import type { SourceSession, SourceSpeaker } from "./_source.ts";
import { contentSessions, coreSpeakers, sessionSpeakers, socialLinks } from "./_source.ts";
import type { SeedContext, SeedModule } from "./_sql.ts";
import {
  EVENT_ID,
  FORMAT_IDS,
  FORM_IDS,
  ORG_ID,
  STAFF_PERSON_ID,
  TRACK_IDS,
  WAVE_IDS,
} from "./event.ts";

/** SPEC §6 status mix: Wave 1 sent (32), Wave 2 decided-not-sent (28). */
const WAVE_ONE_SIZE = 32;
/** Wave 1 decisions land on its Aug 15 decision date; Wave 2 was decided Aug 19. */
const WAVE_ONE_DECIDED_AT = Date.UTC(2026, 7, 15, 16, 0, 0, 0);
const WAVE_TWO_DECIDED_AT = Date.UTC(2026, 7, 19, 16, 0, 0, 0);
/** The CFP opened Aug 1; submissions arrive on a deterministic four-hour cadence. */
const FIRST_SUBMITTED_AT = Date.UTC(2026, 7, 1, 16, 0, 0, 0);
const SUBMISSION_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CONFIRMATION_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Keyword scorer for the primary track. Occurrences across title + abstract
 * are counted per track and the highest total wins; ties resolve to the
 * earliest track in this list, which is declaration order in `event.ts`. Only
 * a session that matches nothing at all falls back to its source track, and
 * an unmapped source track falls back to the mainstage track.
 */
const TRACK_KEYWORDS: ReadonlyArray<readonly [keyof typeof TRACK_IDS, readonly string[]]> = [
  ["fin", ["financial", "finance", "fintech", "bank", "wall street", "trading", "investment",
    "insurance", "payment", "capital market", "hedge", "asset management", "solana", "wealth"]],
  ["agents", ["agent", "agentic", "model context protocol", "mcp", "tool call", "function calling",
    "multi-agent", "copilot", "autonomous", "workflow automation", "voice ai", "scaffold"]],
  ["evals", ["eval", "evaluation", "benchmark", "judge", "hallucination", "observab", "metric",
    "accuracy", "test suite", "verify", "quality"]],
  ["infra", ["infrastructure", "inference", "gpu", "data center", "serving", "latency",
    "throughput", "kubernetes", "deployment", "platform", "scaling", "scaled", "compile", "sdk",
    "developer tools", "devops"]],
  ["open", ["open source", "open-source", "open model", "open ml", "llama", "mistral", "deepseek",
    "weights", "fine-tun", "local, private", "oss"]],
  ["rag", ["rag", "retrieval", "vector", "embedding", "knowledge graph", "graphrag", "search",
    "memory", "context window", "unstructured data"]],
  ["sec", ["security", "secure", "guardrail", "safety", "privacy", "adversarial",
    "prompt injection", "trust", "compliance", "governance", "risk"]],
  ["leadership", ["leadership", "strategy", "roi", "enterprise", "executive", "cto", "vps of ai",
    "adoption", "transformation", "hiring", "teams", "organization", "lessons from building",
    "insights on building"]],
];

/** Source track → Marquee track, used only when nothing scores. */
const SOURCE_TRACK_FALLBACK: Readonly<Record<string, keyof typeof TRACK_IDS>> = {
  "AI Leadership": "leadership",
  "Agent Engineering": "agents",
  "Expo Stage": "evals",
  Workshops: "agents",
  Online: "agents",
};

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function primaryTrackKey(session: SourceSession): keyof typeof TRACK_IDS {
  const haystack = `${session.title} ${abstractOf(session) ?? ""}`.toLowerCase();
  let best: (keyof typeof TRACK_IDS) | undefined;
  let bestScore = 0;
  for (const [key, keywords] of TRACK_KEYWORDS) {
    let score = 0;
    for (const keyword of keywords) score += occurrences(haystack, keyword);
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best ?? SOURCE_TRACK_FALLBACK[session.track] ?? "fin";
}

/**
 * Format mapping, per plan: workshops by their source track (the capture types
 * three real workshops as OTHER), the Online track to Online, the Expo Stage's
 * short slots to Lightning — that stage is where the source ran its short-form
 * talks — everything else to Stage Talk.
 */
export function formatKeyFor(session: SourceSession): keyof typeof FORMAT_IDS {
  if (session.type === "WORKSHOP" || session.track === "Workshops") return "workshop";
  if (session.track === "Online") return "online";
  if (session.track === "Expo Stage" && session.duration_min <= 15) return "lightning";
  return "stageTalk";
}

export function formatIdFor(session: SourceSession): string {
  return FORMAT_IDS[formatKeyFor(session)];
}

/**
 * The 24 sessions the seeded agenda schedules, in grid order.
 *
 * The grid has to span the formats the conference runs, and program order alone
 * does not: the workshop day and the online track sit at the tail of it, so the
 * first 24 accepted sessions are 24 Stage Talks and the public agenda's format
 * filter has exactly one live answer. Fill a quota per format instead — four
 * mainstage talks first, because the seeded conflicts and the confirmation
 * fixture land on them, then the five parallel Workshop rooms, the Expo Stage's
 * Lightning block, the two Online sessions, and the rest of the mainstage grid.
 * Program order still decides which sessions fill each quota, so the seed stays
 * fixed run to run.
 */
const SCHEDULE_PLAN: ReadonlyArray<readonly [keyof typeof FORMAT_IDS, number]> = [
  ["stageTalk", 4],
  ["workshop", 5],
  ["lightning", 5],
  ["online", 2],
  ["stageTalk", 8],
];

export function scheduledSessions(): SourceSession[] {
  const pools = new Map<keyof typeof FORMAT_IDS, SourceSession[]>();
  for (const session of contentSessions()) {
    const key = formatKeyFor(session);
    const pool = pools.get(key) ?? [];
    pool.push(session);
    pools.set(key, pool);
  }
  const scheduled: SourceSession[] = [];
  for (const [key, count] of SCHEDULE_PLAN) {
    const taken = (pools.get(key) ?? []).splice(0, count);
    if (taken.length < count) throw new Error(`seed has fewer than ${count} ${key} sessions to schedule`);
    scheduled.push(...taken);
  }
  return scheduled;
}

/**
 * Wave 1 is the acceptance batch that was actually sent, so it has to cover
 * everything on the agenda: a scheduled speaker who was never invited is a
 * state no organizer would publish. The scheduled sessions go in first and
 * program order fills the rest of the batch, holding SPEC §6's 32/28 split.
 */
function waveOneSlugs(): Set<string> {
  const slugs = new Set(scheduledSessions().map((session) => session.slug));
  for (const session of contentSessions()) {
    if (slugs.size >= WAVE_ONE_SIZE) break;
    slugs.add(session.slug);
  }
  return slugs;
}

/** The published abstract, falling back to the published description. */
function abstractOf(session: SourceSession): string | null {
  const text = session.abstract ?? session.description ?? null;
  return text && text.trim().length > 0 ? text.trim() : null;
}

function nullableText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
}

/** Deterministic person ids, guarded against slug collisions between names. */
function personIds(speakers: readonly SourceSpeaker[]): Map<string, string> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const speaker of speakers) {
    let id = seedId("per", speaker.name);
    for (let suffix = 2; taken.has(id); suffix += 1) id = `${seedId("per", speaker.name)}-${suffix}`;
    taken.add(id);
    ids.set(speaker.name, id);
  }
  return ids;
}

export function run(ctx: SeedContext): void {
  const { now } = ctx;
  const sessions = contentSessions();
  const speakers = coreSpeakers();
  const ids = personIds(speakers);
  const waveOne = waveOneSlugs();

  // People first: submissions reference their submitter, participations their
  // person. Emails are synthesized in this stable order so collision suffixes
  // are deterministic across runs.
  const takenEmails = new Set<string>();
  for (const speaker of speakers) {
    ctx.add("people", {
      id: ids.get(speaker.name)!,
      org_id: ORG_ID,
      email: syntheticEmail(speaker.name, takenEmails),
      name: speaker.name,
      title: nullableText(speaker.title),
      company: nullableText(speaker.company),
      bio: nullableText(speaker.bio),
      headshot_attachment_id: null,
      social_links: JSON.stringify(socialLinks(speaker)),
      is_demo: 1,
      last_write_source: "marquee",
      created_at: now,
      updated_at: now,
    });
  }

  sessions.forEach((session, index) => {
    const inWaveOne = waveOne.has(session.slug);
    const submissionId = seedId("sub", session.slug);
    const decidedAt = inWaveOne ? WAVE_ONE_DECIDED_AT : WAVE_TWO_DECIDED_AT;
    const submittedAt = FIRST_SUBMITTED_AT + index * SUBMISSION_INTERVAL_MS;
    const trackId = TRACK_IDS[primaryTrackKey(session)];

    ctx.add("submissions", {
      id: submissionId,
      event_id: EVENT_ID,
      form_id: FORM_IDS.cfp,
      // The first half is the walkthrough's accepted Session inventory. Those
      // records intentionally bypass evaluation; the second half retains the
      // accepted Abstract path and its reviewer decisions.
      kind: index < 30 ? "session" : "abstract",
      bypass_evaluation: index < 30 ? 1 : 0,
      title: session.title.trim(),
      abstract: abstractOf(session),
      status: "accepted",
      format_id: formatIdFor(session),
      primary_track_id: trackId,
      origin: "public",
      vendor_affiliation: "none",
      wave_id: inWaveOne ? WAVE_IDS.wave1 : WAVE_IDS.wave2,
      submitter_person_id: ids.get(sessionSpeakers(session)[0]!.name)!,
      decided_at: decidedAt,
      decided_by_person_id: STAFF_PERSON_ID,
      submitted_at: submittedAt,
      last_saved_at: submittedAt,
      is_published: 0,
      external_ref: `aie-2025:${session.id}`,
      last_write_source: "marquee",
      created_at: now,
      updated_at: now,
    });

    ctx.add("submission_tracks", {
      id: seedId("sbt", session.slug),
      submission_id: submissionId,
      track_id: trackId,
      is_primary: 1,
      created_at: now,
      updated_at: now,
    });

    // The decision history the acceptance screens read. Wave 1 was dispatched,
    // so its rows would carry an outbox id in a live system; the seeded
    // communications belong to the comms seeder, so `outbox_id` stays NULL.
    ctx.add("submission_decisions", {
      id: seedId("dec", session.slug),
      event_id: EVENT_ID,
      submission_id: submissionId,
      decision: "approve",
      resulting_status: "accepted",
      feedback_md: null,
      decided_by_person_id: STAFF_PERSON_ID,
      decided_at: decidedAt,
      outbox_id: null,
      created_at: now,
      updated_at: now,
    });

    // Source order is billing order: the first named speaker is the speaker of
    // record, everyone after is a co-speaker.
    sessionSpeakers(session).forEach((speaker, position) => {
      ctx.add("participations", {
        id: seedId("par", `${session.slug}-${position}-${slugify(speaker.name)}`),
        submission_id: submissionId,
        person_id: ids.get(speaker.name)!,
        role: position === 0 ? "speaker" : "co_speaker",
        position,
        confirmation_status: inWaveOne ? "confirmed" : "pending",
        confirmed_at: inWaveOne ? decidedAt + (index + 1) * CONFIRMATION_INTERVAL_MS : null,
        invited_at: inWaveOne ? decidedAt : null,
        created_at: now,
        updated_at: now,
      });
    });
  });
}

export const seed: SeedModule = { name: "accepted-core", order: 20, run };
