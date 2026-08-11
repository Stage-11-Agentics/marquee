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
  marquis: seedId("bld", "new-york-marriott-marquis"),
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
  // (kept explicit so no token file is touched here).
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

  // MRQ-62 / Amendment 14: Sheraton stays primary, while the overflow venue
  // is a real Midtown conference hotel with an address-derived OSM coordinate.
  // Online is intentionally unpinned because a virtual venue has no honest
  // map position. Access notes belong to buildings; room notes stay room-local.
  const buildings: Array<[
    string, string, string, number, number | null, number | null, number, string | null,
  ]> = [
    [
      BUILDING_IDS.sheraton,
      "Sheraton New York Times Square",
      "811 7th Ave, New York, NY 10019",
      0,
      40.7625188,
      -73.9814528,
      0,
      "Photo ID required at the main entrance. Allow ten minutes for building security.",
    ],
    [
      BUILDING_IDS.marquis,
      "New York Marriott Marquis",
      "1535 Broadway, New York, NY 10036",
      1,
      40.7585971,
      -73.9861935,
      3,
      "Use the Broadway lobby for conference access. Allow three minutes for building security.",
    ],
    [BUILDING_IDS.online, "Online", "Virtual", 2, null, null, 0, null],
  ];
  for (const [id, name, address, position, lat, lng, accessMinutes, accessNote] of buildings) {
    ctx.add("buildings", {
      id,
      event_id: EVENT_ID,
      name,
      address,
      position,
      lat,
      lng,
      access_minutes: accessMinutes,
      access_note: accessNote,
      created_at: now,
      updated_at: now,
    });
  }

  const rooms: Array<[string, string, string, number, number, string[], string | null]> = [
    // [id, building_id, name, capacity, position, AV tags, room note]
    [seedId("rm", "metropolitan-ballroom"), BUILDING_IDS.sheraton, "Metropolitan Ballroom", 2500, 0, ["Projector", "Confidence monitor", "Mics", "Livestream"], "Main stage. Confidence monitors downstage; the livestream feed powers the conference site."],
    [seedId("rm", "central-park-ballroom"), BUILDING_IDS.sheraton, "Central Park Ballroom", 1100, 1, ["Projector", "Mics"], "Breakout room. Shares a wall with New York Ballroom; avoid amplified sessions in both at once."],
    [seedId("rm", "new-york-ballroom"), BUILDING_IDS.sheraton, "New York Ballroom", 1200, 2, ["Projector", "Confidence monitor", "Mics"], "Breakout room. Livestream is not cabled; record locally and upload after the session."],
    [seedId("rm", "expo-stage"), BUILDING_IDS.sheraton, "Expo Stage", 400, 3, ["Projector", "Mics"], "Expo room. Hard stop at 17:30 for the evening close."],
    [seedId("rm", "marquis-room-a"), BUILDING_IDS.marquis, "Marquis Room A", 60, 0, ["Projector", "Mics"], "Overflow room. Confirm the presenter handoff with the room producer."],
    [seedId("rm", "marquis-room-b"), BUILDING_IDS.marquis, "Marquis Room B", 60, 1, ["Projector", "Confidence monitor", "Mics"], "Overflow room. Keep the center aisle clear for production."],
    [seedId("rm", "marquis-room-c"), BUILDING_IDS.marquis, "Marquis Room C", 60, 2, ["Projector", "Mics"], "Overflow room. Test the presentation input before the session."],
    [seedId("rm", "marquis-room-d"), BUILDING_IDS.marquis, "Marquis Room D", 60, 3, ["Projector", "Mics", "Livestream"], "Overflow room. Livestream feed is available on request."],
    [seedId("rm", "marquis-room-e"), BUILDING_IDS.marquis, "Marquis Room E", 60, 4, ["Projector", "Mics"], "Overflow room. Leave the rear service path unobstructed."],
    [seedId("rm", "online"), BUILDING_IDS.online, "Online", 0, 0, ["Livestream"], "Virtual room; no physical arrival instructions."],
  ];
  for (const [id, buildingId, name, capacity, position, avCapabilities, notes] of rooms) {
    ctx.add("rooms", {
      id,
      event_id: EVENT_ID,
      building_id: buildingId,
      name,
      capacity,
      position,
      av_capabilities: JSON.stringify(avCapabilities),
      notes,
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

  // M-12's baseline CFP. These are ordinary schema fields; the public form
  // and every later draft/submission consumer read the same ordered rows.
  const cfpFields: Array<{
    key: string;
    label: string;
    help_text: string | null;
    type: string;
    required: number;
    config: Record<string, unknown>;
    condition: Record<string, unknown> | null;
  }> = [
    { key: "title", label: "Session title", help_text: "Make the promise to attendees clear.", type: "short_text", required: 1, config: { minLength: 8, maxLength: 120 }, condition: null },
    { key: "abstract", label: "Abstract", help_text: "What will you cover, and why does it matter now?", type: "long_text", required: 1, config: { minLength: 40, maxLength: 1200 }, condition: null },
    { key: "audience_outcome", label: "What will attendees be able to do after your session?", help_text: "Name one concrete outcome for the audience.", type: "long_text", required: 1, config: { minLength: 20, maxLength: 500 }, condition: null },
    { key: "format", label: "Format", help_text: "Choose the format you want to present.", type: "single_select", required: 1, config: { options: ["Stage Talk", "Workshop", "Lightning", "Online"] }, condition: null },
    { key: "tracks", label: "Tracks", help_text: "Choose one or more. The first selected track is primary for agenda placement.", type: "multi_select", required: 1, config: { options: ["AI in Financial Services", "Agents", "Evals", "Infra", "Open Models", "RAG/Retrieval", "Security", "Leadership"], minItems: 1 }, condition: null },
    { key: "speaker_name", label: "Primary speaker name", help_text: null, type: "short_text", required: 1, config: {}, condition: null },
    { key: "speaker_email", label: "Primary speaker email", help_text: null, type: "email", required: 1, config: {}, condition: null },
    { key: "speaker_role", label: "Primary speaker role", help_text: null, type: "short_text", required: 1, config: {}, condition: null },
    { key: "speaker_company", label: "Primary speaker company", help_text: null, type: "short_text", required: 1, config: {}, condition: null },
    { key: "biography", label: "Biography", help_text: "A short speaker bio for reviewers and the event site.", type: "long_text", required: 1, config: { minLength: 20, maxLength: 1200 }, condition: null },
    { key: "headshot", label: "Headshot", help_text: "JPG or PNG · crop preview appears before submission.", type: "file", required: 1, config: { accept: ["image/jpeg", "image/png"], maxBytes: 5_242_880 }, condition: null },
    { key: "co_speaker_name", label: "Co-speaker name", help_text: null, type: "short_text", required: 0, config: {}, condition: null },
    { key: "co_speaker_email", label: "Co-speaker email", help_text: null, type: "email", required: 0, config: {}, condition: null },
    { key: "supporting_file", label: "Supporting material", help_text: "Optional deck, paper, diagram, or sample bundle.", type: "file", required: 0, config: { accept: ["application/pdf", "image/png", "image/jpeg", "application/zip"], maxBytes: 10_485_760 }, condition: null },
    { key: "vendor_content", label: "Does the session substantially discuss a product or service?", help_text: null, type: "single_select", required: 1, config: { options: ["No", "Yes"], default: "No" }, condition: null },
    { key: "vendor_product", label: "Which product or service?", help_text: "This conditional answer routes the abstract to workshop review.", type: "short_text", required: 1, config: { minLength: 2, maxLength: 200 }, condition: { all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] } },
  ];
  for (const [position, field] of cfpFields.entries()) {
    ctx.add("form_fields", {
      id: seedId("fld", `cfp-${field.key}`),
      form_id: FORM_IDS.cfp,
      key: field.key,
      label: field.label,
      help_text: field.help_text,
      type: field.type,
      required: field.required,
      position,
      config: JSON.stringify(field.config),
      condition: field.condition ? JSON.stringify(field.condition) : null,
      created_at: now,
      updated_at: now,
    });
  }

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
