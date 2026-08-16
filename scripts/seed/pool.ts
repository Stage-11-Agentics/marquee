/**
 * SPEC §6's A-prime seed: the real CODE 2025 accepted-speaker roster plus a
 * synthetic 940-submission non-accepted pool. Real CODE names are never
 * attached to invented submissions. Every address uses example.com and every
 * headshot stays null so no private contact data or external image is seeded.
 */

import { seedId, syntheticEmail } from "../../src/lib/ids.ts";
import type { SeedContext, SeedModule, SeedRow } from "./_sql.ts";
import {
  EVENT_ID,
  FORMAT_IDS,
  FORM_IDS,
  ORG_ID,
  STAFF_PERSON_ID,
  TRACK_IDS,
} from "./event.ts";

export const POOL_SIZE = 940;
export const MULTI_TRACK_POOL_SIZE = 150;

/**
 * Public AIE CODE Summit 2025 speakers, reconciled from the archived roster
 * and AIE's published talk recordings. The archive's five groups enumerate 80
 * people after every pair cell is split; nine additional recorded speakers
 * reconcile the published 89-person roster. Keep this list real-only.
 */
export const CODE_2025_ROSTER = [
  ["Kevin Hou", "Google Antigravity"],
  ["Steve Yegge", "Amp Code"],
  ["Gene Kim", "IT Revolution"],
  ["Ryan Carson", "Amp Code"],
  ["Beyang Liu", "Amp Code"],
  ["Itamar Friedman", "Qodo"],
  ["Robert Brennan", "AllHands / OpenHands"],
  ["Naman Jain", "Cursor / LiveCodeBench"],
  ["Alexander \"Al\" Harris", "Amazon Kiro"],
  ["Kath Korevec", "Google Labs / Jules"],
  ["Natalie Serrino", "Gimlet Labs"],
  ["Erik Thorelli", "CodeRabbit"],
  ["Michele Catasta", "Replit"],
  ["Peter Wielander", "Vercel"],
  ["Lee Robinson", "Cursor"],
  ["Eno Reyes", "Factory"],
  ["Nik Pash", "Cline"],
  ["Ivan Leo", "Manus"],
  ["Jed Borovik", "Google DeepMind"],
  ["Mahesh Murag", "Anthropic"],
  ["Barry Zhang", "Anthropic"],
  ["Anjali Sridhar", "Google DeepMind"],
  ["Paige Bailey", "Google DeepMind"],
  ["Ammaar Reshi", "Google DeepMind"],
  ["Kat Kampf", "Google DeepMind"],
  ["Thariq Shihipar", "Anthropic"],
  ["Katelyn Lesse", "Anthropic"],
  ["Jacob Kahn", "FAIR / Meta"],
  ["Olive Song", "MiniMax"],
  ["Eiso Kant", "Poolside"],
  ["Brian Fioca", "OpenAI"],
  ["Cathy Zhou", "OpenAI"],
  ["Bill Chen", "OpenAI"],
  ["Will Hang", "OpenAI"],
  ["Max Kanat-Alexander", "Capital One"],
  ["Samir Mody", "Browser Company of New York"],
  ["Tobin South", "WorkOS"],
  ["Lei Zhang", "Bloomberg"],
  ["Mike Lacsamana", "Workato"],
  ["Zayne Turner", "Workato"],
  ["Martin Harrysson", "McKinsey"],
  ["Asaf Bord", "Northwestern Mutual"],
  ["Cornelia Davis", "Temporal"],
  ["Patrick Riley", "Auth0"],
  ["Carlos Galan", "Auth0"],
  ["Jake Nations", "Netflix"],
  ["Kevin Madura", "AlixPartners"],
  ["Sarah Chieng", "Cerebras"],
  ["Natasha Maniar", "McKinsey"],
  ["Lisa Orr", "Zapier"],
  ["Alex Lieberman", "Tenex / Morning Brew"],
  ["Will Brown", "Prime Intellect"],
  ["Yegor Denisov-Blanch", "Stanford"],
  ["Nathaniel Whittemore", "Super.ai"],
  ["Aparna Dhinakaran", "Arize"],
  ["Rhythm Garg", "Applied Compute"],
  ["Linden Li", "Applied Compute"],
  ["Dex Horthy", "HumanLayer"],
  ["Justin Reock", "DX"],
  ["Jeremiah Lowin", "Prefect / FastMCP"],
  ["Dan Shipper", "Every.to"],
  ["Jared Zoneraich", "PromptLayer"],
  ["Arman Hezarkhani", "Tenex"],
  ["SallyAnn DeLucia", "Arize"],
  ["Ashpreet Bedi", "Agno AI"],
  ["Joel Becker", "METR"],
  ["Yuxuan Zhang", "Z.ai / GLM"],
  ["Alex Gavrilescu", "Funstage"],
  ["Ahmad Awais", "CommandCode.ai / Langbase"],
  ["Brian John", "BetterUp"],
  ["Nicholas Arcolano", "Jellyfish"],
  ["Johann Schleier-Smith", "Temporal"],
  ["Corey J. Gallon", "Rexmore"],
  ["Callan Fox", "WEKA"],
  ["Valentin Bercovici", "WEKA"],
  ["Samuel Colvin", "Pydantic"],
  ["Ofer Mendelevitch", "Vectara"],
  ["Mahmoud Abdelwahab", "Railway"],
  ["Alberto Romero", "Jointly"],
  ["Boris Bogatin", "Catio"],
  // Recorded CODE speakers omitted from the archived five-group enumeration.
  ["swyx", "Latent Space / AI Engineer"],
  ["Kitze", "Sizzy"],
  ["Jason Warner", "Poolside"],
  ["Fuad Ali", "Arize"],
  ["Jack Morris", "Cornell"],
  ["Zhenwei Gao", "Cerebras"],
  ["Aman Khan", "Arize"],
  ["Suman Debnath", "AWS"],
  ["Mark Myshatyn", "Los Alamos National Laboratory"],
] as const;

export const CODE_2025_ROSTER_COUNT = 89;

/** Published spelling correction: both source strings identify one person. */
const CODE_DEDUPE_ALIASES = new Map<string, string>([
  ["Aparna Dhinakaran", "Aparna Dhinkaran"],
]);

const IN_REVIEW_COUNT = 280;
const REJECTED_COUNT = 550;
const WAITLISTED_COUNT = 70;
const DRAFT_COUNT = 40;
const FIRST_SAVED_AT = Date.UTC(2026, 7, 2, 13, 0, 0, 0);
const SAVE_INTERVAL_MS = 19 * 60 * 1000;

const GIVEN_NAMES = [
  "Avery", "Briar", "Cleo", "Devon", "Emery", "Farah", "Gray", "Hollis", "Indra", "Jules",
  "Kai", "Lena", "Micah", "Nia", "Orin", "Priya", "Quinn", "Rafi", "Sana", "Tavi",
] as const;

const FAMILY_NAMES = [
  "Alder", "Bellmere", "Cairn", "Dovetail", "Elmstead", "Farrow", "Gable", "Harbor", "Ivory",
  "Juniper", "Kestrel", "Larkspur", "Morrow", "North", "Orchard", "Peregrine", "Quarry", "Rill",
  "Sable", "Thicket", "Umber", "Vale", "Willow", "Xander", "Yarrow", "Zephyr", "Ashdown",
  "Brookfield", "Copper", "Drift", "Evergreen", "Foxglove", "Glen", "Hearth", "Islet", "Jetty",
  "Keystone", "Lantern", "Meadow", "Nightingale", "Oakley", "Pine", "Quince", "Rowan", "Stone",
  "Tern", "Vesper",
] as const;

const COMPANIES = [
  "Northstar Ledger", "Mosaic Relay", "Copper Finch Systems", "Juniper Signal", "Open Harbor Labs",
  "Keystone Compute", "Lantern River", "Blue Orchard", "Quiet Circuit", "Ternworks",
] as const;

const TITLE_PREFIXES = [
  "Operating", "Evaluating", "Debugging", "Governing", "Shipping", "Scaling", "Observing", "Securing",
] as const;
const TITLE_SUBJECTS = [
  "agent workflows", "retrieval systems", "open-model infrastructure", "financial AI", "evaluation loops",
  "production copilots", "context pipelines", "human-in-the-loop systems",
] as const;
const TITLE_SUFFIXES = [
  "under real-world constraints", "without losing the operator", "from prototype to production",
  "when the happy path disappears", "with measurable reliability", "across regulated teams",
] as const;

const TRACKS = Object.values(TRACK_IDS);
const FORMATS = Object.values(FORMAT_IDS);

function table(ctx: SeedContext, name: string): SeedRow["row"][] {
  return ctx.rows.filter((entry) => entry.table === name).map((entry) => entry.row);
}

function seedCodeRoster(ctx: SeedContext): void {
  const normalized = CODE_2025_ROSTER.map(([name, company]) => ({ name: name.trim(), company }));
  const rosterNames = new Set(normalized.map(({ name }) => name));
  if (normalized.length !== CODE_2025_ROSTER_COUNT || rosterNames.size !== normalized.length) {
    throw new Error(`CODE 2025 roster must contain ${CODE_2025_ROSTER_COUNT} unique trimmed names`);
  }

  const existingPeople = table(ctx, "people");
  const peopleByName = new Map<string, SeedRow["row"]>();
  for (const person of existingPeople) {
    const name = String(person.name).trim();
    if (peopleByName.has(name)) throw new Error(`seed already has two people named ${name}`);
    peopleByName.set(name, person);
  }
  const takenEmails = new Set(existingPeople.map((person) => String(person.email)));

  // Name/alias resolution happens before either helper can silently mint a
  // suffixed ID or email for a human who is already in the February core.
  for (const speaker of normalized) {
    const identityName = CODE_DEDUPE_ALIASES.get(speaker.name) ?? speaker.name;
    if (peopleByName.has(identityName)) continue;
    const personId = seedId("per", `aie-code-2025-${identityName}`);
    ctx.add("people", {
      id: personId,
      org_id: ORG_ID,
      email: syntheticEmail(identityName, takenEmails),
      name: identityName,
      title: null,
      company: speaker.company,
      bio: "Public AIE CODE Summit 2025 speaker; no private contact or image data is reproduced.",
      headshot_attachment_id: null,
      social_links: "[]",
      is_demo: 1,
      last_write_source: "marquee",
      created_at: ctx.now,
      updated_at: ctx.now,
    });
    peopleByName.set(identityName, { id: personId, name: identityName });
  }
}

export function poolSubmissionId(index: number): string {
  return seedId("sub", `synthetic-pool-${String(index + 1).padStart(4, "0")}`);
}

function poolStatus(index: number): "submitted" | "in_review" | "rejected" | "waitlisted" | "withdrawn" | "draft" {
  // Keep the 1,000-row demo spine and every deterministic pool identity intact
  // while making the two status filters reachable. These are synthetic pool
  // records, deliberately outside the published accepted core.
  // STORYLINE: See SEED-STORYLINES.md § “Filter reachability fixtures”. The
  // boundary indexes below are the lone Submitted and Withdrawn rows.
  // Changing either literal makes its organizer filter disappear.
  if (index === IN_REVIEW_COUNT - 1) return "submitted";
  if (index === IN_REVIEW_COUNT + REJECTED_COUNT - 1) return "withdrawn";
  if (index < IN_REVIEW_COUNT) return "in_review";
  if (index < IN_REVIEW_COUNT + REJECTED_COUNT) return "rejected";
  if (index < IN_REVIEW_COUNT + REJECTED_COUNT + WAITLISTED_COUNT) return "waitlisted";
  return "draft";
}

function titleFor(index: number): string {
  if (index === 0) {
    return "The Extremely Long and Deliberately Unabridged Field Guide to Coordinating Heterogeneous Agent Systems Across Regulated Financial Institutions Without Losing Auditability, Operator Trust, or the Plot";
  }
  if (index === 1) {
    return "Taming 40-Minute CI";
  }
  return `${TITLE_PREFIXES[index % TITLE_PREFIXES.length]} ${TITLE_SUBJECTS[index % TITLE_SUBJECTS.length]} ${TITLE_SUFFIXES[index % TITLE_SUFFIXES.length]}`;
}

export function run(ctx: SeedContext): void {
  seedCodeRoster(ctx);
  const takenEmails = new Set(table(ctx, "people").map((person) => String(person.email)));

  for (let index = 0; index < POOL_SIZE; index += 1) {
    const number = String(index + 1).padStart(4, "0");
    const name = `${GIVEN_NAMES[index % GIVEN_NAMES.length]} ${FAMILY_NAMES[Math.floor(index / GIVEN_NAMES.length)]}`;
    const personId = seedId("per", `synthetic-pool-${number}`);
    const submissionId = poolSubmissionId(index);
    const status = poolStatus(index);
    const savedAt = FIRST_SAVED_AT + index * SAVE_INTERVAL_MS;
    const primaryTrackIndex = index % TRACKS.length;
    const primaryTrackId = TRACKS[primaryTrackIndex]!;
    // The withdrawn fixture represents a synthetic proposal that was decided
    // against and then withdrawn. Keeping its prior decision preserves the
    // established seed cardinalities while the current status reaches the
    // organizer's Withdrawn filter.
    const decided = status === "rejected" || status === "waitlisted" || status === "withdrawn";
    const malformedNoFormat = index >= POOL_SIZE - 2;

    ctx.add("people", {
      id: personId,
      org_id: ORG_ID,
      email: syntheticEmail(name, takenEmails),
      name,
      title: `Principal ${index % 2 === 0 ? "Engineer" : "Researcher"}`,
      company: COMPANIES[index % COMPANIES.length]!,
      bio: `Synthetic demo profile ${number}; no contact or travel data is real.`,
      headshot_attachment_id: null,
      social_links: "[]",
      is_demo: 1,
      last_write_source: "marquee",
      created_at: ctx.now,
      updated_at: ctx.now,
    });

    ctx.add("submissions", {
      id: submissionId,
      event_id: EVENT_ID,
      form_id: FORM_IDS.cfp,
      kind: "abstract",
      bypass_evaluation: 0,
      title: titleFor(index),
      abstract: index === 1
        ? "A practical account of shrinking a 40-minute CI loop in a monorepo through build caching, dependency boundaries, and measurable developer feedback."
        : status === "draft" && index % 2 === 0
        ? null
        : `A synthetic proposal about ${TITLE_SUBJECTS[index % TITLE_SUBJECTS.length]}, designed to exercise Marquee at realistic scale without attributing invented work to a real person.`,
      status,
      format_id: malformedNoFormat ? null : FORMATS[index % FORMATS.length]!,
      primary_track_id: primaryTrackId,
      origin: "public",
      vendor_affiliation: index % 11 === 0 ? "vendor_with_champion" : index % 7 === 0 ? "vendor_to_fi" : "none",
      wave_id: null,
      submitter_person_id: personId,
      decided_at: decided ? savedAt + 5 * 24 * 60 * 60 * 1000 : null,
      decided_by_person_id: decided ? STAFF_PERSON_ID : null,
      submitted_at: status === "draft" ? null : savedAt,
      last_saved_at: savedAt,
      resume_token_hash: status === "draft" ? `synthetic-resume-hash-${number}` : null,
      is_published: 0,
      external_ref: `synthetic:${number}`,
      last_write_source: "marquee",
      created_at: ctx.now,
      updated_at: ctx.now,
    });

    ctx.add("submission_tracks", {
      id: seedId("sbt", `synthetic-${number}-primary`),
      submission_id: submissionId,
      track_id: primaryTrackId,
      is_primary: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
    if (index < MULTI_TRACK_POOL_SIZE) {
      ctx.add("submission_tracks", {
        id: seedId("sbt", `synthetic-${number}-secondary`),
        submission_id: submissionId,
        track_id: TRACKS[(primaryTrackIndex + 3) % TRACKS.length]!,
        is_primary: 0,
        created_at: ctx.now,
        updated_at: ctx.now,
      });
    }

    ctx.add("participations", {
      id: seedId("par", `synthetic-${number}-speaker`),
      submission_id: submissionId,
      person_id: personId,
      role: "speaker",
      position: 0,
      confirmation_status: "pending",
      confirmed_at: null,
      invited_at: null,
      created_at: ctx.now,
      updated_at: ctx.now,
    });

    if (decided) {
      const waitlisted = status === "waitlisted";
      ctx.add("submission_decisions", {
        id: seedId("dec", `synthetic-${number}`),
        event_id: EVENT_ID,
        submission_id: submissionId,
        decision: waitlisted ? "maybe" : "deny",
        resulting_status: waitlisted ? "waitlisted" : "rejected",
        feedback_md: null,
        decided_by_person_id: STAFF_PERSON_ID,
        decided_at: savedAt + 5 * 24 * 60 * 60 * 1000,
        outbox_id: null,
        created_at: ctx.now,
        updated_at: ctx.now,
      });
    }
  }

  if (POOL_SIZE !== IN_REVIEW_COUNT + REJECTED_COUNT + WAITLISTED_COUNT + DRAFT_COUNT) {
    throw new Error("synthetic pool status counts no longer sum to POOL_SIZE");
  }
}

export const seed: SeedModule = { name: "pool", order: 30, run };
