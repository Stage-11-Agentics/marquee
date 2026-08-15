/**
 * Sponsorships, their contacts, their deliverables, and their Sessions.
 *
 * Both prototype views ship as seed data by operator ruling (2026-08-14, "keep
 * the different prototype views in whatever we build"), because each one proves
 * something the other cannot:
 *
 *   GOLD — Ashworth–Meridian, booth-bearing, three contacts, an overdue
 *   deliverable assigned to someone who is not the primary contact, a cancelled
 *   deliverable with its reason, and two Sessions of which one has no speaker
 *   named yet. This is the anyone-completes-with-attribution demo and the
 *   booth-card demo.
 *
 *   SILVER — Tapestry, no booth, one contact, one Session that is scheduled but
 *   not yet public. This is the ruling-5 proof: a boothless sponsorship is not a
 *   special case, it is the same page with null columns.
 *
 * Provenance (SPEC §6): unlike `accepted-core`, NOTHING here is real. Both
 * companies, all four contacts, every deliverable and both sponsor Sessions are
 * fabricated — AIE's actual sponsors are not this project's to publish. Emails
 * are `@example.com`, which can never deliver. See SEED-DATA.md.
 */

import { seedId } from "../../src/lib/ids.ts";
import { SPONSOR_WRITEBACK_TEMPLATE_IDS } from "../../src/lib/sponsors/deliverable-templates.ts";
import type { SeedContext, SeedModule } from "./_sql.ts";
import { BUILDING_IDS, EVENT_ID, FORMAT_IDS, ORG_ID, STAFF_PERSON_ID, TRACK_IDS } from "./event.ts";

export const COMPANY_IDS = {
  gold: seedId("cmp", "ashworth-meridian"),
  silver: seedId("cmp", "tapestry-lending"),
} as const;

export const SPONSOR_TIER_IDS = {
  gold: seedId("spt", "gold"),
  silver: seedId("spt", "silver"),
  bronze: seedId("spt", "bronze"),
} as const;

export const SPONSORSHIP_IDS = {
  gold: seedId("spn", "ashworth-meridian-2026"),
  silver: seedId("spn", "tapestry-2026"),
} as const;

export const SPONSOR_CONTACT_IDS = {
  dana: seedId("per", "dana-okafor"),
  priya: seedId("per", "priya-raghunathan"),
  grzegorz: seedId("per", "grzegorz-wlodarczyk-o-braonain"),
  mona: seedId("per", "mona-haddad"),
} as const;

/**
 * The speaker on Gold's scheduled Session — a person from the company who is NOT
 * a sponsorship contact. Keeping her separate is the point: a marketing lead's
 * name must never be published as the person on stage just because they filed
 * the paperwork.
 */
export const SPONSOR_SPEAKER_IDS = {
  nadia: seedId("per", "nadia-el-amin"),
} as const;

export const SPONSOR_FORM_IDS = {
  companyDetails: seedId("frm", "sponsor-company-details"),
  nameYourSpeaker: seedId("frm", "sponsor-name-your-speaker"),
  boothPowerAv: seedId("frm", "sponsor-booth-power-av"),
  boothStaff: seedId("frm", "sponsor-booth-staff"),
  sessionContent: seedId("frm", "sponsor-session-content"),
} as const;

/**
 * Template ids the deliverables use. Three of them mean something to the server
 * beyond storing an answer, and those three are imported from the shared leaf
 * (`src/lib/sponsors/deliverable-templates.ts`) rather than restated, so one
 * identity cannot drift into two.
 */
export const SPONSOR_TEMPLATE_IDS = {
  agreement: seedId("tpl", "sponsor-agreement"),
  companyDetails: SPONSOR_WRITEBACK_TEMPLATE_IDS.companyDetails,
  logo: seedId("tpl", "sponsor-logo-vector"),
  nameYourSpeaker: SPONSOR_WRITEBACK_TEMPLATE_IDS.nameYourSpeaker,
  boothPowerAv: seedId("tpl", "sponsor-booth-power-av"),
  insurance: seedId("tpl", "sponsor-certificate-of-insurance"),
  boothStaff: seedId("tpl", "sponsor-booth-staff"),
  bannerArtwork: seedId("tpl", "sponsor-banner-artwork"),
  sessionContent: SPONSOR_WRITEBACK_TEMPLATE_IDS.sessionContent,
} as const;

export const SPONSOR_SUBMISSION_IDS = {
  goldScheduled: seedId("sub", "sponsor-risk-models-in-the-loop"),
  goldSpeakerless: seedId("sub", "sponsor-meridian-data-mesh-teardown"),
  silver: seedId("sub", "sponsor-underwriting-copilots-auditors"),
} as const;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Sponsor Sessions land on the conference's third day, which the seeded agenda
 * leaves empty. A sponsor Session dropped into an already-filled mainstage hour
 * would manufacture a room double-booking and make the conflict detector shout
 * about the seed rather than about the program.
 */
const GOLD_SLOT_STARTS_AT = Date.UTC(2026, 9, 14, 15, 30);
const SILVER_SLOT_STARTS_AT = Date.UTC(2026, 9, 14, 18, 15);

type FormFieldSpec = {
  key: string;
  label: string;
  help: string | null;
  type: string;
  required: 0 | 1;
  config?: Record<string, unknown>;
};

/**
 * Task forms are `closed`, not `open`. A form's status governs its PUBLIC door
 * (`/f/<slug>`), and sponsors-design ruling 6 is explicit that there is no
 * public sponsor intake — sponsors are sold by humans and entered post-sale.
 * Nothing in the portal's task rendering reads the status, so a closed form
 * still answers its deliverable while the public URL truthfully says closed.
 */
function addForm(
  ctx: SeedContext,
  id: string,
  name: string,
  slug: string,
  fields: readonly FormFieldSpec[],
): void {
  ctx.add("forms", {
    id,
    event_id: EVENT_ID,
    name,
    slug,
    kind: "session",
    status: "closed",
    opens_at: null,
    closes_at: null,
    turnstile_required: 0,
    created_at: ctx.now,
    updated_at: ctx.now,
  });
  fields.forEach((field, position) => {
    ctx.add("form_fields", {
      id: seedId("fld", `${slug}-${field.key}`),
      form_id: id,
      key: field.key,
      label: field.label,
      help_text: field.help,
      type: field.type,
      required: field.required,
      position,
      config: JSON.stringify(field.config ?? {}),
      condition: null,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  });
}

type TemplateSpec = {
  id: string;
  name: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  dueOffsetDays: number;
  formId?: string;
  fileConfig?: Record<string, unknown>;
};

const SPONSOR_TEMPLATES: readonly TemplateSpec[] = [
  {
    id: SPONSOR_TEMPLATE_IDS.agreement,
    name: "Sponsor agreement",
    kind: "acknowledge",
    description: "Accept the sponsorship terms: booth build rules, the code of conduct, and the recording policy for sponsored Sessions.",
    dueOffsetDays: 1,
  },
  {
    id: SPONSOR_TEMPLATE_IDS.companyDetails,
    name: "Confirm your company details",
    kind: "form",
    description: "Your organizer entered the sponsorship; you confirm the public-facing facts we publish on the event site.",
    dueOffsetDays: 8,
    formId: SPONSOR_FORM_IDS.companyDetails,
  },
  {
    // Vector PDF, not SVG or EPS. `task_upload` narrows DOCUMENT_RULES, which has
    // sniffers for pdf/pptx/key and nothing else — so an accept list naming .svg
    // presigns nothing and the sponsor meets "that file type is not accepted"
    // after being told to send one. Stating what the product can actually take is
    // the honest version; widening the sniffer is a security-surface change and
    // wants its own ticket.
    id: SPONSOR_TEMPLATE_IDS.logo,
    name: "Company logo — vector PDF",
    kind: "file",
    description: "Used on the event site, the sponsor wall, and printed signage. Export your primary mark as a vector PDF — signage prints larger than any raster file survives.",
    dueOffsetDays: 15,
    fileConfig: { accept: [".pdf"], maxBytes: 26_214_400 },
  },
  {
    id: SPONSOR_TEMPLATE_IDS.nameYourSpeaker,
    name: "Name your speaker",
    kind: "form",
    description: "Completing this fills your Session's speaker. They will hold their own speaker seat, with their bio, headshot, and A/V tasks.",
    dueOffsetDays: 22,
    formId: SPONSOR_FORM_IDS.nameYourSpeaker,
  },
  {
    id: SPONSOR_TEMPLATE_IDS.boothPowerAv,
    name: "Booth power & A/V requirements",
    kind: "form",
    description: "Orders lock with the venue on Sep 26. Changes after that go through your organizer contact.",
    dueOffsetDays: 29,
    formId: SPONSOR_FORM_IDS.boothPowerAv,
  },
  {
    id: SPONSOR_TEMPLATE_IDS.insurance,
    name: "Certificate of insurance (COI)",
    kind: "file",
    description: "Naming the venue as additional insured. Required before dock access at load-in.",
    dueOffsetDays: 36,
    fileConfig: { accept: [".pdf"], maxBytes: 26_214_400 },
  },
  {
    id: SPONSOR_TEMPLATE_IDS.boothStaff,
    name: "Booth staff list & conference passes",
    kind: "form",
    description: "Passes activate at check-in; names can change until Oct 9.",
    dueOffsetDays: 43,
    formId: SPONSOR_FORM_IDS.boothStaff,
  },
  {
    id: SPONSOR_TEMPLATE_IDS.bannerArtwork,
    name: "Secondary banner artwork — escalator wall",
    kind: "file",
    description: "Large-format artwork for the escalator wall placement.",
    dueOffsetDays: 29,
    fileConfig: { accept: [".pdf"], maxBytes: 52_428_800 },
  },
  {
    id: SPONSOR_TEMPLATE_IDS.sessionContent,
    name: "Session title & description",
    kind: "form",
    description: "Rendered on the public agenda under your Session's title.",
    dueOffsetDays: 29,
    formId: SPONSOR_FORM_IDS.sessionContent,
  },
];

type ContactSpec = {
  id: string;
  name: string;
  email: string;
  title: string;
  company: string;
  companyId: string;
  bio: string;
};

const CONTACTS: readonly ContactSpec[] = [
  {
    id: SPONSOR_CONTACT_IDS.dana,
    name: "Dana Okafor",
    email: "dana.okafor@example.com",
    title: "Head of Developer Marketing",
    company: "Ashworth–Meridian Capital Intelligence Group",
    companyId: COMPANY_IDS.gold,
    bio: "Runs developer marketing for Ashworth–Meridian's agentic risk platform.",
  },
  {
    id: SPONSOR_CONTACT_IDS.priya,
    name: "Priya Raghunathan",
    email: "priya.raghunathan@example.com",
    title: "Events & Field Marketing Manager",
    company: "Ashworth–Meridian Capital Intelligence Group",
    companyId: COMPANY_IDS.gold,
    bio: "Owns Ashworth–Meridian's conference presence, from booth build to booth staffing.",
  },
  {
    // A long name with two diacritics and a hyphen, on purpose: DESIGN's
    // real-ugly-data rule. Every place this name appears has to survive it.
    id: SPONSOR_CONTACT_IDS.grzegorz,
    name: "Grzegorz Włodarczyk-Ó Braonáin",
    email: "grzegorz.wlodarczyk@example.com",
    title: "Brand Design Lead",
    company: "Ashworth–Meridian Capital Intelligence Group",
    companyId: COMPANY_IDS.gold,
    bio: "Keeps Ashworth–Meridian's mark consistent across every surface it appears on.",
  },
  {
    id: SPONSOR_CONTACT_IDS.mona,
    name: "Mona Haddad",
    email: "mona.haddad@example.com",
    title: "VP Marketing",
    company: "Tapestry Small-Business Lending",
    companyId: COMPANY_IDS.silver,
    bio: "Leads marketing for Tapestry's credit-decisioning copilots.",
  },
];

type DeliverableSpec = {
  key: string;
  sponsorshipId: string;
  templateId: string;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  assignee: string;
  dueInDays: number;
  submissionId?: string;
  done?: { completedByPersonId: string; completedDaysAgo: number };
  cancelledDaysAgo?: number;
};

const GOLD_DELIVERABLES: readonly DeliverableSpec[] = [
  {
    key: "gold-agreement",
    sponsorshipId: SPONSORSHIP_IDS.gold,
    templateId: SPONSOR_TEMPLATE_IDS.agreement,
    title: "Sponsor agreement",
    kind: "acknowledge",
    description: "Accept the sponsorship terms: booth build rules, the code of conduct, and the recording policy for sponsored Sessions.",
    assignee: SPONSOR_CONTACT_IDS.dana,
    dueInDays: 1,
    done: { completedByPersonId: SPONSOR_CONTACT_IDS.dana, completedDaysAgo: 4 },
  },
  {
    key: "gold-company-details",
    sponsorshipId: SPONSORSHIP_IDS.gold,
    templateId: SPONSOR_TEMPLATE_IDS.companyDetails,
    title: "Confirm your company details",
    kind: "form",
    description: "Your organizer entered the sponsorship; you confirm the public-facing facts we publish on the event site.",
    assignee: SPONSOR_CONTACT_IDS.dana,
    dueInDays: 8,
    done: { completedByPersonId: SPONSOR_CONTACT_IDS.dana, completedDaysAgo: 2 },
  },
  {
    // The anyone-completes demo: overdue, and assigned to the contact least
    // likely to be the one signing in. Any contact can finish it, and whoever
    // does is named on the row afterwards.
    key: "gold-logo",
    sponsorshipId: SPONSORSHIP_IDS.gold,
    templateId: SPONSOR_TEMPLATE_IDS.logo,
    title: "Company logo — vector PDF",
    kind: "file",
    description: "Used on the event site, the sponsor wall, and printed signage. Export your primary mark as a vector PDF — signage prints larger than any raster file survives.",
    assignee: SPONSOR_CONTACT_IDS.grzegorz,
    dueInDays: -5,
  },
  {
    key: "gold-name-your-speaker",
    sponsorshipId: SPONSORSHIP_IDS.gold,
    templateId: SPONSOR_TEMPLATE_IDS.nameYourSpeaker,
    title: "Name your speaker — Building the Meridian data mesh",
    kind: "form",
    description: "Completing this fills your Session's speaker. They will hold their own speaker seat, with their bio, headshot, and A/V tasks.",
    assignee: SPONSOR_CONTACT_IDS.dana,
    dueInDays: 22,
    submissionId: SPONSOR_SUBMISSION_IDS.goldSpeakerless,
  },
  {
    key: "gold-booth-power",
    sponsorshipId: SPONSORSHIP_IDS.gold,
    templateId: SPONSOR_TEMPLATE_IDS.boothPowerAv,
    title: "Booth power & A/V requirements",
    kind: "form",
    description: "Orders lock with the venue on Sep 26. Changes after that go through your organizer contact.",
    assignee: SPONSOR_CONTACT_IDS.priya,
    dueInDays: 29,
    done: { completedByPersonId: SPONSOR_CONTACT_IDS.priya, completedDaysAgo: 6 },
  },
  {
    key: "gold-insurance",
    sponsorshipId: SPONSORSHIP_IDS.gold,
    templateId: SPONSOR_TEMPLATE_IDS.insurance,
    title: "Certificate of insurance (COI)",
    kind: "file",
    description: "Naming the venue as additional insured. Required before dock access at load-in.",
    assignee: SPONSOR_CONTACT_IDS.priya,
    dueInDays: 36,
  },
  {
    key: "gold-booth-staff",
    sponsorshipId: SPONSORSHIP_IDS.gold,
    templateId: SPONSOR_TEMPLATE_IDS.boothStaff,
    title: "Booth staff list & conference passes",
    kind: "form",
    description: "Six conference passes are included with Gold. Passes activate at check-in; names can change until Oct 9.",
    assignee: SPONSOR_CONTACT_IDS.priya,
    dueInDays: 43,
  },
  {
    // Cancelled, and the reason is a real sentence about the sponsorship rather
    // than a shrug. Its `completed_at` is null because it was never finished —
    // cancellation never touches finished work (SPEC §3.7).
    key: "gold-banner",
    sponsorshipId: SPONSORSHIP_IDS.gold,
    templateId: SPONSOR_TEMPLATE_IDS.bannerArtwork,
    title: "Secondary banner artwork — escalator wall",
    kind: "file",
    description: "Large-format artwork for the escalator wall placement.",
    assignee: SPONSOR_CONTACT_IDS.grzegorz,
    dueInDays: 29,
    cancelledDaysAgo: 9,
  },
];

const SILVER_DELIVERABLES: readonly DeliverableSpec[] = [
  {
    key: "silver-agreement",
    sponsorshipId: SPONSORSHIP_IDS.silver,
    templateId: SPONSOR_TEMPLATE_IDS.agreement,
    title: "Sponsor agreement",
    kind: "acknowledge",
    description: "Accept the sponsorship terms: the code of conduct and the recording policy for sponsored Sessions.",
    assignee: SPONSOR_CONTACT_IDS.mona,
    dueInDays: 1,
    done: { completedByPersonId: SPONSOR_CONTACT_IDS.mona, completedDaysAgo: 5 },
  },
  {
    key: "silver-company-details",
    sponsorshipId: SPONSORSHIP_IDS.silver,
    templateId: SPONSOR_TEMPLATE_IDS.companyDetails,
    title: "Confirm your company details",
    kind: "form",
    description: "Your organizer entered the sponsorship; you confirm the public-facing facts we publish on the event site.",
    assignee: SPONSOR_CONTACT_IDS.mona,
    dueInDays: 8,
    done: { completedByPersonId: SPONSOR_CONTACT_IDS.mona, completedDaysAgo: 1 },
  },
  {
    key: "silver-logo",
    sponsorshipId: SPONSORSHIP_IDS.silver,
    templateId: SPONSOR_TEMPLATE_IDS.logo,
    title: "Company logo — vector PDF",
    kind: "file",
    description: "Used on the event site and the sponsor wall. Export your primary mark as a vector PDF — signage prints larger than any raster file survives.",
    assignee: SPONSOR_CONTACT_IDS.mona,
    dueInDays: 22,
  },
  {
    key: "silver-session-content",
    sponsorshipId: SPONSORSHIP_IDS.silver,
    templateId: SPONSOR_TEMPLATE_IDS.sessionContent,
    title: "Session title & description — Underwriting copilots",
    kind: "form",
    description: "Rendered on the public agenda under your Session's title.",
    assignee: SPONSOR_CONTACT_IDS.mona,
    dueInDays: 29,
    submissionId: SPONSOR_SUBMISSION_IDS.silver,
  },
];

function addSponsorSession(
  ctx: SeedContext,
  input: {
    id: string;
    sponsorshipId: string;
    title: string;
    abstract: string | null;
    formatKey: keyof typeof FORMAT_IDS;
    submitterPersonId: string;
    speakerPersonId: string | null;
    slot: { startsAt: number; roomId: string; durationMin: number; published: boolean } | null;
  },
): void {
  ctx.add("submissions", {
    id: input.id,
    event_id: EVENT_ID,
    form_id: null,
    // A sponsor Session is a guaranteed Session, not an abstract competing for a
    // place — `kind = session` with `bypass_evaluation` is R9's model for it.
    kind: "session",
    bypass_evaluation: 1,
    title: input.title,
    abstract: input.abstract,
    status: "accepted",
    format_id: FORMAT_IDS[input.formatKey],
    primary_track_id: TRACK_IDS.fin,
    origin: "admin",
    vendor_affiliation: "vendor_to_fi",
    wave_id: null,
    submitter_person_id: input.submitterPersonId,
    sponsorship_id: input.sponsorshipId,
    decided_at: ctx.now - 20 * DAY,
    decided_by_person_id: STAFF_PERSON_ID,
    submitted_at: ctx.now - 20 * DAY,
    last_saved_at: ctx.now - 20 * DAY,
    is_published: 0,
    external_ref: null,
    search_blob: `${input.title} ${input.abstract ?? ""}`.toLowerCase(),
    last_write_source: "marquee",
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  ctx.add("submission_tracks", {
    id: seedId("sbt", input.id),
    submission_id: input.id,
    track_id: TRACK_IDS.fin,
    is_primary: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  // The sponsor contact is the submitter of record — the column — and holds no
  // participation at all. A `speaker` row would publish a marketing lead's name
  // as the person on stage, and a `submitter` row would hand them a submitter
  // seat in the SPEAKER portal, which is not the surface they were invited to.
  // "Speaker not named yet" is the honest state until the deliverable fills it.
  if (input.speakerPersonId) {
    ctx.add("participations", {
      id: seedId("par", `${input.id}-speaker`),
      submission_id: input.id,
      person_id: input.speakerPersonId,
      role: "speaker",
      position: 0,
      confirmation_status: "confirmed",
      confirmed_at: ctx.now - 12 * DAY,
      invited_at: ctx.now - 18 * DAY,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
    // A named sponsor speaker is a speaker of this conference, so they hold the
    // membership every other accepted speaker holds — the row the roster, portal
    // sign-in, headshot ownership and comms audience all read. Their onboarding
    // task set is minted by `ugliness.ts`, which runs after this module and
    // applies SPEC §6's "every accepted speaker carries these two" to them for
    // the same reason it applies it to everybody else.
    ctx.add("memberships", {
      id: seedId("mem", `${input.speakerPersonId}-speaker`),
      org_id: ORG_ID,
      event_id: EVENT_ID,
      person_id: input.speakerPersonId,
      role: "speaker",
      confirmation_status: "confirmed",
      confirmed_at: ctx.now - 12 * DAY,
      invited_at: ctx.now - 18 * DAY,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }

  if (input.slot) {
    ctx.add("agenda_items", {
      id: seedId("agi", input.id),
      event_id: EVENT_ID,
      submission_id: input.id,
      kind: "session",
      title: null,
      starts_at: input.slot.startsAt,
      duration_min: input.slot.durationMin,
      room_id: input.slot.roomId,
      track_id: TRACK_IDS.fin,
      is_published: input.slot.published ? 1 : 0,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }
}

export function run(ctx: SeedContext): void {
  const { now } = ctx;

  ctx.add("companies", {
    id: COMPANY_IDS.gold,
    org_id: ORG_ID,
    name: "Ashworth–Meridian Capital Intelligence Group",
    website: "https://ashworth-meridian.example.com",
    domain: "ashworth-meridian.example.com",
    blurb: "Agentic risk and underwriting intelligence for regulated capital markets.",
    notes: "Sponsored the 2025 summit at Silver; upgraded to Gold for 2026.",
    is_demo: 1,
    last_write_source: "marquee",
    created_at: now,
    updated_at: now,
  });
  ctx.add("companies", {
    id: COMPANY_IDS.silver,
    org_id: ORG_ID,
    name: "Tapestry Small-Business Lending",
    website: "https://tapestrylending.example.com",
    domain: "tapestrylending.example.com",
    blurb: "Credit decisioning copilots for community lenders.",
    notes: "First-time sponsor.",
    is_demo: 1,
    last_write_source: "marquee",
    created_at: now,
    updated_at: now,
  });

  // Gold/Silver/Bronze seeded and renameable, in the order an organizer reads
  // them. Per-tier deliverable template sets belong to the tier-settings surface
  // that authors them and are deliberately not modelled here.
  const tiers: ReadonlyArray<readonly [string, string, number]> = [
    [SPONSOR_TIER_IDS.gold, "Gold", 0],
    [SPONSOR_TIER_IDS.silver, "Silver", 1],
    [SPONSOR_TIER_IDS.bronze, "Bronze", 2],
  ];
  for (const [id, name, position] of tiers) {
    ctx.add("sponsor_tiers", { id, event_id: EVENT_ID, name, position, created_at: now, updated_at: now });
  }

  ctx.add("sponsorships", {
    id: SPONSORSHIP_IDS.gold,
    event_id: EVENT_ID,
    company_id: COMPANY_IDS.gold,
    tier_id: SPONSOR_TIER_IDS.gold,
    status: "committed",
    passes: 6,
    booth_number: "214",
    booth_size: "3 m × 3 m corner",
    booth_hall: "Exhibit Hall · Level 2",
    booth_building_id: BUILDING_IDS.sheraton,
    booth_load_in: "Sun Oct 11 · 14:00–20:00 · freight dock on W 53rd St",
    booth_access_note: "Photo ID required at the dock; your COI must be on file before load-in.",
    booth_leave_note: "Freight elevator queues peak after 15:00 — book the 14:00 slot and be at the dock by 13:40.",
    notes: null,
    created_at: now,
    updated_at: now,
  });
  // Every booth column null. Not a variant of the record, not a flag anybody
  // branches on — the same row with nothing in those columns (ruling 5).
  ctx.add("sponsorships", {
    id: SPONSORSHIP_IDS.silver,
    event_id: EVENT_ID,
    company_id: COMPANY_IDS.silver,
    tier_id: SPONSOR_TIER_IDS.silver,
    status: "committed",
    passes: 2,
    booth_number: null,
    booth_size: null,
    booth_hall: null,
    booth_building_id: null,
    booth_load_in: null,
    booth_access_note: null,
    booth_leave_note: null,
    notes: null,
    created_at: now,
    updated_at: now,
  });

  // The named speaker on Gold's scheduled Session. A `people` row and a speaker
  // membership, no sponsorship-contact link: she speaks, she does not hold the
  // deal, and the portal must not offer her its deliverables.
  ctx.add("people", {
    id: SPONSOR_SPEAKER_IDS.nadia,
    org_id: ORG_ID,
    email: "nadia.el-amin@example.com",
    name: "Nadia El-Amin",
    title: "Principal Risk Engineer",
    company: "Ashworth–Meridian Capital Intelligence Group",
    company_id: COMPANY_IDS.gold,
    bio: "Builds the model-risk controls behind Ashworth–Meridian's agentic underwriting desk.",
    headshot_attachment_id: null,
    social_links: "[]",
    is_demo: 1,
    last_write_source: "marquee",
    created_at: now,
    updated_at: now,
  });

  for (const contact of CONTACTS) {
    ctx.add("people", {
      id: contact.id,
      org_id: ORG_ID,
      email: contact.email,
      name: contact.name,
      title: contact.title,
      company: contact.company,
      company_id: contact.companyId,
      bio: contact.bio,
      headshot_attachment_id: null,
      social_links: "[]",
      is_demo: 1,
      last_write_source: "marquee",
      created_at: now,
      updated_at: now,
    });
  }

  const contactLinks: ReadonlyArray<readonly [string, string, 0 | 1]> = [
    [SPONSORSHIP_IDS.gold, SPONSOR_CONTACT_IDS.dana, 1],
    [SPONSORSHIP_IDS.gold, SPONSOR_CONTACT_IDS.priya, 0],
    [SPONSORSHIP_IDS.gold, SPONSOR_CONTACT_IDS.grzegorz, 0],
    [SPONSORSHIP_IDS.silver, SPONSOR_CONTACT_IDS.mona, 1],
  ];
  for (const [sponsorshipId, personId, isPrimary] of contactLinks) {
    ctx.add("sponsorship_contacts", {
      id: seedId("spc", `${sponsorshipId}-${personId}`),
      sponsorship_id: sponsorshipId,
      person_id: personId,
      is_primary: isPrimary,
      created_at: now,
      updated_at: now,
    });
  }

  addForm(ctx, SPONSOR_FORM_IDS.companyDetails, "Confirm your company details", "sponsor-company-details", [
    { key: "company_name", label: "Company legal name", help: "The name we print on signage and invoices.", type: "short_text", required: 1, config: { maxLength: 160 } },
    { key: "company_website", label: "Website", help: null, type: "url", required: 0 },
    { key: "logo_alt_text", label: "Logo alt text", help: "Read aloud by screen readers wherever your mark appears.", type: "short_text", required: 0, config: { maxLength: 120 } },
    { key: "company_blurb", label: "Public blurb — event site & app", help: "One or two sentences, in your own words.", type: "long_text", required: 0, config: { maxLength: 400 } },
  ]);
  addForm(ctx, SPONSOR_FORM_IDS.nameYourSpeaker, "Name your speaker", "sponsor-name-your-speaker", [
    { key: "speaker_name", label: "Speaker name", help: null, type: "short_text", required: 1, config: { maxLength: 120 } },
    { key: "speaker_email", label: "Speaker email", help: "Where their own speaker-portal invitation goes.", type: "email", required: 1 },
    { key: "speaker_title", label: "Title & company", help: "e.g. Principal Engineer, Ashworth–Meridian", type: "short_text", required: 0, config: { maxLength: 160 } },
  ]);
  addForm(ctx, SPONSOR_FORM_IDS.boothPowerAv, "Booth power & A/V requirements", "sponsor-booth-power-av", [
    {
      key: "booth_services",
      label: "Booth services",
      help: "Booth Wi-Fi is included; everything here is an add-on.",
      type: "multi_select",
      required: 0,
      config: { options: ["2 × 20A power drop", "55″ monitor rental", "Lead scanner × 2", "Hardline internet"] },
    },
    { key: "booth_av_notes", label: "Anything else the A/V team should know?", help: null, type: "long_text", required: 0, config: { maxLength: 600 } },
  ]);
  addForm(ctx, SPONSOR_FORM_IDS.boothStaff, "Booth staff list & conference passes", "sponsor-booth-staff", [
    { key: "booth_staff", label: "Booth staff — one per line", help: "Names as they should appear on badges.", type: "long_text", required: 1, config: { maxLength: 1200 } },
  ]);
  addForm(ctx, SPONSOR_FORM_IDS.sessionContent, "Session title & description", "sponsor-session-content", [
    { key: "session_title", label: "Session title", help: "What the agenda will show.", type: "short_text", required: 0, config: { maxLength: 160 } },
    { key: "session_description", label: "Session description", help: "Rendered on the public agenda under your Session's title.", type: "long_text", required: 1, config: { maxLength: 1200 } },
  ]);

  for (const [index, template] of SPONSOR_TEMPLATES.entries()) {
    ctx.add("task_templates", {
      id: template.id,
      event_id: EVENT_ID,
      name: template.name,
      kind: template.kind,
      description: template.description,
      due_at: null,
      due_offset_days: template.dueOffsetDays,
      form_id: template.formId ?? null,
      file_config: template.fileConfig ? JSON.stringify(template.fileConfig) : null,
      // After the six speaker templates seeded by `event.ts`.
      position: 6 + index,
      // Sponsor deliverables are assigned when a sponsorship commits, not by the
      // acceptance cascade that auto-assigns speaker work.
      auto_assign: 0,
      created_at: now,
      updated_at: now,
    });
  }

  addSponsorSession(ctx, {
    id: SPONSOR_SUBMISSION_IDS.goldScheduled,
    sponsorshipId: SPONSORSHIP_IDS.gold,
    title: "Risk models in the loop: agentic underwriting at Ashworth–Meridian",
    abstract: "How a regulated underwriting desk put agents inside its risk models without losing its audit trail — the controls that made it defensible, and the two that did not survive review.",
    formatKey: "stageTalk",
    submitterPersonId: SPONSOR_CONTACT_IDS.dana,
    speakerPersonId: SPONSOR_SPEAKER_IDS.nadia,
    slot: {
      startsAt: GOLD_SLOT_STARTS_AT,
      roomId: seedId("rm", "metropolitan-ballroom"),
      durationMin: 30,
      published: true,
    },
  });
  // The speakerless, unscheduled Session. Its only way to gain a speaker is the
  // name-your-speaker deliverable — the task machinery is the single write path.
  addSponsorSession(ctx, {
    id: SPONSOR_SUBMISSION_IDS.goldSpeakerless,
    sponsorshipId: SPONSORSHIP_IDS.gold,
    title: "Building the Meridian data mesh: a live teardown",
    abstract: null,
    formatKey: "lightning",
    submitterPersonId: SPONSOR_CONTACT_IDS.dana,
    speakerPersonId: null,
    slot: null,
  });
  addSponsorSession(ctx, {
    id: SPONSOR_SUBMISSION_IDS.silver,
    sponsorshipId: SPONSORSHIP_IDS.silver,
    title: "Underwriting copilots that survive the auditors",
    abstract: null,
    formatKey: "lightning",
    submitterPersonId: SPONSOR_CONTACT_IDS.mona,
    speakerPersonId: null,
    slot: {
      startsAt: SILVER_SLOT_STARTS_AT,
      roomId: seedId("rm", "marquis-room-a"),
      durationMin: 15,
      // Scheduled but not published: the portal says "Not yet public" rather
      // than implying the attendee-facing agenda already carries it.
      published: false,
    },
  });

  for (const deliverable of [...GOLD_DELIVERABLES, ...SILVER_DELIVERABLES]) {
    const cancelled = deliverable.cancelledDaysAgo !== undefined;
    ctx.add("speaker_tasks", {
      id: seedId("tsk", deliverable.key),
      event_id: EVENT_ID,
      person_id: deliverable.assignee,
      submission_id: deliverable.submissionId ?? null,
      sponsorship_id: deliverable.sponsorshipId,
      template_id: deliverable.templateId,
      title: deliverable.title,
      kind: deliverable.kind,
      description: deliverable.description,
      due_at: now + deliverable.dueInDays * DAY,
      status: deliverable.done ? "done" : "open",
      completed_at: deliverable.done ? now - deliverable.done.completedDaysAgo * DAY : null,
      completed_by_person_id: deliverable.done?.completedByPersonId ?? null,
      cancelled_at: cancelled ? now - deliverable.cancelledDaysAgo! * DAY : null,
      response_json: deliverable.done ? JSON.stringify(completedResponse(deliverable)) : null,
      attachment_id: null,
      last_write_source: "marquee",
      created_at: now,
      updated_at: now,
    });
  }

  // Why the banner artwork vanished, said once, in a sentence about this
  // sponsorship. Read back through the same audit shape the withdrawal cascade
  // uses for speaker tasks, so the portal has one way of answering "why".
  ctx.add("audit_log", {
    id: seedId("aud", "gold-banner-cancelled"),
    event_id: EVENT_ID,
    actor_person_id: STAFF_PERSON_ID,
    actor_kind: "user",
    action: "sponsorship.tasks_cancelled",
    entity_type: "sponsorship",
    entity_id: SPONSORSHIP_IDS.gold,
    before_json: null,
    after_json: JSON.stringify({
      reason: "The escalator-wall placement left the Gold package when the venue reassigned that space. Nothing else about your sponsorship changes.",
      cancelled: 1,
    }),
    created_at: now - 9 * DAY,
  });
}

/** A completed deliverable's stored answers, shaped like its form. */
function completedResponse(deliverable: DeliverableSpec): Record<string, unknown> {
  if (deliverable.kind === "acknowledge") return { acknowledged: true };
  if (deliverable.templateId === SPONSOR_TEMPLATE_IDS.companyDetails) {
    const gold = deliverable.sponsorshipId === SPONSORSHIP_IDS.gold;
    return {
      company_name: gold ? "Ashworth–Meridian Capital Intelligence Group" : "Tapestry Small-Business Lending",
      company_website: gold ? "https://ashworth-meridian.example.com" : "https://tapestrylending.example.com",
      logo_alt_text: gold ? "Ashworth–Meridian logo" : "Tapestry logo",
      company_blurb: gold
        ? "Agentic risk and underwriting intelligence for regulated capital markets."
        : "Credit decisioning copilots for community lenders.",
    };
  }
  if (deliverable.templateId === SPONSOR_TEMPLATE_IDS.boothPowerAv) {
    return { booth_services: ["2 × 20A power drop", "Lead scanner × 2"], booth_av_notes: "" };
  }
  return {};
}

// Order 55: after the spine and the submissions it needs, and deliberately
// BEFORE `ugliness` (60), whose job includes minting every accepted speaker's
// required task set. A named sponsor speaker is an accepted speaker, and having
// that rule reach them automatically beats restating it here.
export const seed: SeedModule = { name: "sponsors", order: 55, run };
