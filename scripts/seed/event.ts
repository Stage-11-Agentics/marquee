/**
 * Spine seeder: organization, event, taxonomy (formats/tracks), venue model
 * (buildings/rooms), waves, forms, and the Amendment-4 task templates.
 * Everything M-04b builds on, and everything MRQ-9's submissions list needs
 * beyond the accepted core itself.
 *
 * Static values follow SPEC §6 verbatim; anything invented is marked.
 */

import { seedId } from "../../src/lib/ids.ts";
import type { SeedContext, SeedModule } from "./_sql.ts";

export const ORG_ID = seedId("org", "aie-ny");
export const EVENT_ID = seedId("evt", "aie-ny-2026");
/** Frozen demo clock (SPEC §6): Aug 20, 2026, 12:00 ET (EDT, UTC-4). */
export const FROZEN_NOW = Date.UTC(2026, 7, 20, 16, 0, 0, 0);
const WAVE_ONE_SENT = Date.UTC(2026, 7, 15, 16, 0, 0, 0);

/** Synthetic staff person: decider of record on every seeded decision. */
export const STAFF_PERSON_ID = seedId("per", "aie-program-committee");

export const FORMAT_IDS = {
  stageTalk: seedId("fmt", "stage-talk"),
  workshop: seedId("fmt", "workshop"),
  lightning: seedId("fmt", "lightning"),
  online: seedId("fmt", "online"),
} as const;

/** Keys match the eight `--track-*` design tokens (skin-c / tokens.css). */
export const TRACK_IDS = {
  fin: seedId("trk", "fin"),
  agents: seedId("trk", "agents"),
  evals: seedId("trk", "evals"),
  infra: seedId("trk", "infra"),
  open: seedId("trk", "open"),
  rag: seedId("trk", "rag"),
  sec: seedId("trk", "sec"),
  leadership: seedId("trk", "leadership"),
} as const;

export const BUILDING_IDS = {
  sheraton: seedId("bld", "sheraton"),
  annex: seedId("bld", "workshop-annex"),
  online: seedId("bld", "online"),
} as const;

export const WAVE_IDS = {
  wave1: seedId("wav", "wave-1"),
  wave2: seedId("wav", "wave-2"),
  wave3: seedId("wav", "wave-3"),
} as const;

export const FORM_IDS = {
  cfp: seedId("frm", "cfp"),
  hotelTravel: seedId("frm", "hotel-travel"),
} as const;

export const TEMPLATE_IDS = {
  hotelTravel: seedId("tpl", "hotel-and-travel-reservations"),
  presentationUpload: seedId("tpl", "presentation-upload"),
  finalizeDescription: seedId("tpl", "finalize-talk-description"),
  finalizeBio: seedId("tpl", "finalize-bio-and-photos"),
  announce: seedId("tpl", "announce-your-participation"),
  invite: seedId("tpl", "invite-colleagues"),
} as const;

const CFP_OPENS = Date.UTC(2026, 7, 1, 16, 0, 0, 0);
/** "CFP closes Sep 12" (SPEC §6) — end of day ET. */
const CFP_CLOSES = Date.UTC(2026, 8, 13, 3, 59, 59, 0);

export function run(ctx: SeedContext): void {
  const { now } = ctx;

  ctx.add("organizations", {
    id: ORG_ID,
    name: "AI Engineer New York",
    slug: "aie-ny",
    created_at: now,
    updated_at: now,
  });

  ctx.add("events", {
    id: EVENT_ID,
    org_id: ORG_ID,
    name: "AI Engineer New York 2026",
    slug: "aie-ny-2026",
    tagline: "Where AI Engineering Meets Wall Street",
    starts_on: "2026-10-12",
    ends_on: "2026-10-14",
    timezone: "America/New_York",
    venue: "Sheraton New York Times Square",
    logo_key: null,
    accent: "#0b6a72",
    status: "live",
    demo_mode: 1,
    created_at: now,
    updated_at: now,
  });

  // SPEC §6 formats, verbatim ranges — asserted by AC-8.
  const formats: Array<[string, string, number, number, number, number]> = [
    // [id, name, min, default, max, position]
    [FORMAT_IDS.stageTalk, "Stage Talk", 15, 20, 20, 0],
    [FORMAT_IDS.workshop, "Workshop", 60, 90, 120, 1],
    [FORMAT_IDS.lightning, "Lightning", 5, 10, 10, 2],
    [FORMAT_IDS.online, "Online", 5, 25, 55, 3],
  ];
  for (const [id, name, min, def, max, position] of formats) {
    ctx.add("formats", {
      id,
      event_id: EVENT_ID,
      name,
      default_duration_min: def,
      min_duration_min: min,
      max_duration_min: max,
      position,
      created_at: now,
      updated_at: now,
    });
  }

  // SPEC §6 tracks in order. Colors lift from the skin-c tokens; the token
  // set defines only seven, so Leadership's `#be185d` is the seeded eighth
  // (flagged to the Orchestrator — no token file touched here).
  const tracks: Array<[string, string, string, number]> = [
    [TRACK_IDS.fin, "AI in Financial Services", "#635bff", 0],
    [TRACK_IDS.agents, "Agents", "#db4c3f", 1],
    [TRACK_IDS.evals, "Evals", "#0d9488", 2],
    [TRACK_IDS.infra, "Infra", "#d97706", 3],
    [TRACK_IDS.open, "Open Models", "#2563eb", 4],
    [TRACK_IDS.rag, "RAG/Retrieval", "#9333ea", 5],
    [TRACK_IDS.sec, "Security", "#0f766e", 6],
    [TRACK_IDS.leadership, "Leadership", "#be185d", 7],
  ];
  for (const [id, name, color, position] of tracks) {
    ctx.add("tracks", {
      id,
      event_id: EVENT_ID,
      name,
      color,
      position,
      created_at: now,
      updated_at: now,
    });
  }

  // Amendment 11: the Sheraton-coherent trio (AC-252).
  const buildings: Array<[string, string, string, number]> = [
    [BUILDING_IDS.sheraton, "Sheraton New York Times Square", "811 7th Ave, New York, NY 10019", 0],
    [BUILDING_IDS.annex, "Workshop Annex — Lower Conference Level", "811 7th Ave, New York, NY 10019", 1],
    [BUILDING_IDS.online, "Online", "Virtual", 2],
  ];
  for (const [id, name, address, position] of buildings) {
    ctx.add("buildings", {
      id,
      event_id: EVENT_ID,
      name,
      address,
      position,
      created_at: now,
      updated_at: now,
    });
  }

  // SPEC §6 rooms, each attached to a building. Only the three ballrooms are
  // verified; other capacities are plausible generics, as §6 intends. The
  // "Online" room gives the Online building somewhere to hold virtual
  // sessions — §6's room list omits it, flagged to the Orchestrator.
  const rooms: Array<[string, string, string, number, number]> = [
    // [id, building_id, name, capacity, position-within-building]
    [seedId("rm", "metropolitan-ballroom"), BUILDING_IDS.sheraton, "Metropolitan Ballroom", 2500, 0],
    [seedId("rm", "central-park-ballroom"), BUILDING_IDS.sheraton, "Central Park Ballroom", 1100, 1],
    [seedId("rm", "new-york-ballroom"), BUILDING_IDS.sheraton, "New York Ballroom", 1200, 2],
    [seedId("rm", "expo-stage"), BUILDING_IDS.sheraton, "Expo Stage", 400, 3],
    [seedId("rm", "workshop-room-a"), BUILDING_IDS.annex, "Workshop Room A", 60, 0],
    [seedId("rm", "workshop-room-b"), BUILDING_IDS.annex, "Workshop Room B", 60, 1],
    [seedId("rm", "workshop-room-c"), BUILDING_IDS.annex, "Workshop Room C", 60, 2],
    [seedId("rm", "workshop-room-d"), BUILDING_IDS.annex, "Workshop Room D", 60, 3],
    [seedId("rm", "workshop-room-e"), BUILDING_IDS.annex, "Workshop Room E", 60, 4],
    [seedId("rm", "online"), BUILDING_IDS.online, "Online", 0, 0],
  ];
  for (const [id, buildingId, name, capacity, position] of rooms) {
    ctx.add("rooms", {
      id,
      event_id: EVENT_ID,
      building_id: buildingId,
      name,
      capacity,
      position,
      av_capabilities: "[]",
      notes: null,
      created_at: now,
      updated_at: now,
    });
  }

  // SPEC §6 waves: Aug 15 (sent) · Sep 1 (pending) · Sep 15 (planned).
  const waves: Array<[string, string, string, number, number | null, number]> = [
    [WAVE_IDS.wave1, "Wave 1", "2026-08-15", 32, WAVE_ONE_SENT, 0],
    [WAVE_IDS.wave2, "Wave 2", "2026-09-01", 28, null, 1],
    [WAVE_IDS.wave3, "Wave 3", "2026-09-15", 55, null, 2],
  ];
  for (const [id, name, decisionOn, targetCount, sentAt, position] of waves) {
    ctx.add("waves", {
      id,
      event_id: EVENT_ID,
      name,
      decision_on: decisionOn,
      target_count: targetCount,
      sent_at: sentAt,
      position,
      created_at: now,
      updated_at: now,
    });
  }

  ctx.add("forms", {
    id: FORM_IDS.cfp,
    event_id: EVENT_ID,
    name: "2026 CFP",
    slug: "cfp",
    kind: "abstract",
    status: "open",
    opens_at: CFP_OPENS,
    closes_at: CFP_CLOSES,
    created_at: now,
    updated_at: now,
  });

  // "Hotel and Travel Reservations" is a form task, so the schema requires a
  // backing form. forms.kind has no task-form value (flagged SPEC/schema
  // gap); 'session' is the non-competitive intake kind and the least-wrong.
  ctx.add("forms", {
    id: FORM_IDS.hotelTravel,
    event_id: EVENT_ID,
    name: "Hotel and Travel Reservations",
    slug: "hotel-travel",
    kind: "session",
    status: "open",
    opens_at: null,
    closes_at: null,
    created_at: now,
    updated_at: now,
  });

  const hotelFields: Array<[string, string, string, number, number]> = [
    // [key, label, type, required, position]
    ["arrival_date", "Arrival date", "short_text", 1, 0],
    ["departure_date", "Departure date", "short_text", 1, 1],
    ["notes", "Anything we should know?", "long_text", 0, 2],
  ];
  for (const [key, label, type, required, position] of hotelFields) {
    ctx.add("form_fields", {
      id: seedId("fld", `hotel-travel-${key}`),
      form_id: FORM_IDS.hotelTravel,
      key,
      label,
      help_text: null,
      type,
      required,
      position,
      config: "{}",
      condition: null,
      created_at: now,
      updated_at: now,
    });
  }

  // Amendment 4: swyx's named task templates. The leading two auto-assign to
  // every accepted speaker; the optional four sit ready for M-04b to spread
  // across a subset. due_offset_days chosen (not spec'd): hotel 21, upload
  // 14, the optional four 7–10 days after acceptance.
  const templates: Array<[
    string, string, string, string, number, string | null, string | null, number, number,
  ]> = [
    // [id, name, kind, description, due_offset_days, form_id, file_config, position, auto_assign]
    [TEMPLATE_IDS.hotelTravel, "Hotel and Travel Reservations", "form",
      "Share your arrival and departure dates so we can hold your room in the speaker hotel block.",
      21, FORM_IDS.hotelTravel, null, 0, 1],
    [TEMPLATE_IDS.presentationUpload, "Presentation Upload", "file",
      "Upload your final deck so the AV team can stage it before your session.",
      14, null, JSON.stringify({ accept: [".pdf", ".pptx", ".key"], maxBytes: 26_214_400 }), 1, 1],
    [TEMPLATE_IDS.finalizeDescription, "Finalize talk description", "acknowledge",
      "Confirm the abstract and title we will publish on the event site.",
      10, null, null, 2, 0],
    [TEMPLATE_IDS.finalizeBio, "Finalize bio & photos", "acknowledge",
      "Review your bio and add a headshot for the speaker gallery.",
      10, null, null, 3, 0],
    [TEMPLATE_IDS.announce, "Announce your participation", "acknowledge",
      "Tell your network you are speaking — graphics and copy are in the portal.",
      7, null, null, 4, 0],
    [TEMPLATE_IDS.invite, "Invite colleagues", "acknowledge",
      "Share your speaker discount code with colleagues who should attend.",
      7, null, null, 5, 0],
  ];
  for (const [id, name, kind, description, dueOffset, formId, fileConfig, position, autoAssign] of templates) {
    ctx.add("task_templates", {
      id,
      event_id: EVENT_ID,
      name,
      kind,
      description,
      due_at: null,
      due_offset_days: dueOffset,
      form_id: formId,
      file_config: fileConfig,
      position,
      auto_assign: autoAssign,
      created_at: now,
      updated_at: now,
    });
  }

  // Synthetic staff person: the decider of record on every seeded decision, and
  // the submitter of record wherever a seeded record needs one and no real
  // speaker owns it. Never a real person (SPEC §6). `is_demo=1` puts it inside
  // `reset:demo`'s scope with the rest of the seed (SPEC §3.2).
  ctx.add("people", {
    id: STAFF_PERSON_ID,
    org_id: ORG_ID,
    email: "program.committee@example.com",
    name: "AIE Program Committee",
    title: null,
    company: null,
    bio: null,
    headshot_attachment_id: null,
    social_links: "[]",
    is_demo: 1,
    last_write_source: "marquee",
    created_at: now,
    updated_at: now,
  });
}

export const seed: SeedModule = { name: "event", order: 10, run };
