/**
 * Instance ownership: the one path from a database nobody owns to a person who
 * does, and the same path again for every organizer invited afterwards.
 *
 * Identity here cannot ride on the product's own magic-link sign-in, because
 * mail is one of the things setup configures — a claim link is printed by the
 * deploy and its only proof of ownership is that the operator could run the
 * deploy at all (SPEC Amendment 19, ruling D2). Everything below therefore
 * touches no mail binding, and nothing in this module may ever enqueue one.
 *
 * Claim and invite exchange share one implementation on purpose: an invite is
 * a claim against an instance that already has an owner, and two code paths
 * that both mint sessions from a token are two chances to get session minting
 * wrong (AC-282).
 */
import { newUlid } from "../../api/ids";
import type {
  AuthSessionRow,
  Id,
  MagicLinkPurpose,
  MagicLinkRow,
  MembershipRole,
  MembershipRow,
  OrganizationRow,
  PersonRow,
} from "../../db/schema";
import { ORG_ACTIVITY_ACTIONS } from "../activity-copy";
import { recordOrgActivity } from "../org-activity";
import { createSession } from "./auth-sessions";
import { consumeMagicLink, mintMagicLink, readMagicLink } from "./magic-links";
import { mintShortCode } from "./short-code";

/** The role a claim and an invite both land on: everyone who can run the instance. */
export const INSTANCE_ORGANIZER_ROLE = "owner" as const;

/** Where a freshly claimed instance sends its new owner. */
export const CLAIM_REDIRECT = "/dashboard";

export interface MintedInstanceLink {
  id: Id;
  /** Absolute URL, returned once. Never stored, never logged. */
  url: string;
  expires_at: number;
  /**
   * The speakable form of the same single-use row (ruling O4). Returned once,
   * beside the URL; null on links that have no desk to be read across.
   */
  short_code: string | null;
}

/** What an invite mints when it is exchanged: a seat, and where that seat sits. */
export interface InviteSeat {
  role: MembershipRole;
  /** Null is the whole organization; an id scopes the seat to one conference. */
  eventId: Id | null;
  /** Whose organization the seat is on — the inviter's, resolved at mint. */
  orgId: Id;
}

/**
 * The guard the unclaimed landing and the claim mint both ask. An instance is
 * unclaimed exactly when no person holds an org-wide `owner` membership — the
 * seeded demo holds one, so a seeded deployment is never unclaimed and its
 * landing page is byte-unchanged by any of this (AC-277).
 */
export async function instanceIsUnclaimed(db: D1Database): Promise<boolean> {
  const owner = await db
    .prepare("SELECT 1 AS present FROM memberships WHERE role = 'owner' LIMIT 1")
    .first<{ present: number }>();
  return owner === null;
}

/**
 * The organization the instance belongs to. `claim` creates it when the
 * database has none at all; every later exchange resolves the one that already
 * exists, so a co-organizer joins the instance rather than a second tenant.
 */
async function resolveOrganization(
  db: D1Database,
  now: number,
): Promise<OrganizationRow> {
  const existing = await db
    .prepare("SELECT * FROM organizations ORDER BY created_at ASC, id ASC LIMIT 1")
    .first<OrganizationRow>();
  if (existing) return existing;
  const organization: OrganizationRow = {
    id: newUlid(now),
    name: "Your organization",
    slug: `org-${newUlid(now).toLowerCase()}`,
    // A brand-new organization has expressed no preferences. Every default
    // stays null so it follows the product until someone sets one (§Amendment 21).
    accent: null,
    comms_from_name: null,
    comms_reply_to: null,
    default_theme: null,
    default_timezone: null,
    logo_key: null,
    created_at: now,
    updated_at: now,
  };
  await db
    .prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      organization.id,
      organization.name,
      organization.slug,
      organization.created_at,
      organization.updated_at,
    )
    .run();
  return organization;
}

function absoluteLink(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

/**
 * Mint the one-time claim link the deploy prints.
 *
 * Only one claim token is ever live: minting marks every prior unused claim
 * link consumed, so re-running the CLI is a real recovery path rather than a
 * way to accumulate live keys to an unowned instance (AC-275). Refused once
 * the instance has an owner — after that the door is Settings → Organizers.
 */
export async function mintClaimLink(
  db: D1Database,
  input: { origin: string; now?: number },
): Promise<MintedInstanceLink | null> {
  if (!(await instanceIsUnclaimed(db))) return null;
  const now = input.now ?? Date.now();
  await db
    .prepare("UPDATE magic_links SET used_at = ?, updated_at = ? WHERE purpose = 'claim' AND used_at IS NULL")
    .bind(now, now)
    .run();
  const link = await mintMagicLink(db, {
    personId: null,
    purpose: "claim",
    redirectTo: CLAIM_REDIRECT,
    now,
  });
  const row = await db
    .prepare("SELECT expires_at FROM magic_links WHERE id = ?")
    .bind(link.id)
    .first<{ expires_at: number }>();
  return {
    id: link.id,
    url: absoluteLink(input.origin, `/claim/${link.token}`),
    expires_at: row?.expires_at ?? now,
    // A claim link is read off a deploy terminal, where copy-paste works and
    // nobody is standing at a desk. It gets no spoken form.
    short_code: null,
  };
}

/**
 * Mint an organizer invite. Same shape as the claim link and equally
 * independent of mail: the owner hands the link over on whatever channel they
 * already share, and mail — once configured — only ever *offers* to carry it
 * (ruling D7).
 */
export async function mintOrganizerInvite(
  db: D1Database,
  input: { origin: string; seat: InviteSeat; now?: number },
): Promise<MintedInstanceLink> {
  const now = input.now ?? Date.now();
  const shortCode = mintShortCode();
  const link = await mintMagicLink(db, {
    personId: null,
    purpose: "org_invite",
    redirectTo: CLAIM_REDIRECT,
    now,
    invite: input.seat,
    shortCode,
  });
  const row = await db
    .prepare("SELECT expires_at FROM magic_links WHERE id = ?")
    .bind(link.id)
    .first<{ expires_at: number }>();
  return {
    id: link.id,
    url: absoluteLink(input.origin, `/join/${link.token}`),
    expires_at: row?.expires_at ?? now,
    short_code: shortCode,
  };
}

export type InstanceLinkState =
  | {
      status: "live";
      purpose: Extract<MagicLinkPurpose, "claim" | "org_invite">;
      /** The seat this link will mint. A claim link's is always the owner seat. */
      seat: InviteSeat;
    }
  | { status: "inert" };

/**
 * The seat a live link carries, defaulted for the links that pre-date the
 * columns. An `org_invite` minted before SPEC Amendment 21 has no role and no
 * scope on its row; it meant "org-wide owner", which is what it minted, so that
 * is what it must keep meaning. Reading `null` as anything narrower would
 * silently demote invites already in people's inboxes.
 */
function seatOf(link: MagicLinkRow, fallbackOrgId: Id): InviteSeat {
  return {
    role: link.invite_role ?? INSTANCE_ORGANIZER_ROLE,
    eventId: link.invite_event_id ?? null,
    orgId: link.invite_org_id ?? fallbackOrgId,
  };
}

/**
 * Read a claim or invite token WITHOUT consuming it, so the page a human lands
 * on can be rendered before they have typed anything. The token is spent only
 * by `exchangeInstanceLink`.
 */
export async function readInstanceLink(
  db: D1Database,
  token: string,
  expectedPurpose: "claim" | "org_invite",
  now = Date.now(),
): Promise<InstanceLinkState> {
  const state = await readMagicLink(db, token, now, { purposes: [expectedPurpose] });
  if (state.status !== "live") return { status: "inert" };
  return {
    status: "live",
    purpose: expectedPurpose,
    // A claim token lands ownership by definition (ruling D2); only an invite
    // carries a seat someone chose.
    seat:
      expectedPurpose === "claim"
        ? { role: INSTANCE_ORGANIZER_ROLE, eventId: null, orgId: "" }
        : seatOf(state.link, ""),
  };
}

export interface ExchangeResult {
  organization: OrganizationRow;
  person: PersonRow;
  membership: MembershipRow;
  session: AuthSessionRow;
  redirectTo: string;
}

/**
 * Spend a claim or invite token and land ownership on a person.
 *
 * The token is consumed by the same single UPDATE that read it (see
 * `consumeMagicLink`), so a replayed link cannot create a second owner even
 * under a race — the loser gets `changes = 0` and this returns null, which the
 * caller renders as the inert page.
 */
export async function exchangeInstanceLink(
  db: D1Database,
  input: {
    token: string;
    purpose: "claim" | "org_invite";
    name: string;
    email: string;
    userAgent: string;
    now?: number;
    /** The originating request, so the log line joins the operational log. */
    requestId?: string | null;
  },
): Promise<ExchangeResult | null> {
  const now = input.now ?? Date.now();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (email.length === 0 || name.length === 0) return null;

  // Read the purpose before spending the token: a claim token presented to the
  // invite door (or the reverse) must be left live, not burned.
  const state = await readInstanceLink(db, input.token, input.purpose, now);
  if (state.status !== "live") return null;
  const link = await consumeMagicLink(db, input.token, now);
  if (!link || link.purpose !== input.purpose) return null;

  // Whose organization this seat is on.
  //
  // An invite names its own — the organization that minted it — and **an invite
  // that names none is refused outright**. It must never reach
  // `resolveOrganization`'s first-row fallback: that helper answers "the oldest
  // organization row", which is the right answer for a claim creating the first
  // organization there has ever been, and an arbitrary tenant for anybody else.
  //
  // Rows minted before Amendment 21 carry no `invite_org_id`. Migration 0020
  // backfills the unambiguous case — an instance holding exactly one
  // organization — so the only invites this refuses are the ones genuinely
  // impossible to attribute. For those, refusing is correct and minting into
  // whichever tenant sorts first is not: an unspent invite is worth far less
  // than a membership in someone else's organization.
  let organization: OrganizationRow | null;
  if (input.purpose === "org_invite") {
    if (link.invite_org_id === null) return null;
    organization = await db
      .prepare("SELECT * FROM organizations WHERE id = ?")
      .bind(link.invite_org_id)
      .first<OrganizationRow>();
  } else {
    organization = await resolveOrganization(db, now);
  }
  // The organization was deleted between mint and exchange. Nothing to join.
  if (!organization) return null;
  const existingPerson = await db
    .prepare("SELECT * FROM people WHERE org_id = ? AND email = ?")
    .bind(organization.id, email)
    .first<PersonRow>();
  const person = existingPerson ?? (await insertPerson(db, organization.id, name, email, now));

  // The seat comes off the consumed row, never off the request: the recipient
  // types their name and email into this exchange, and if they could also name
  // their own role the invite would be an invitation to choose one.
  const seat: InviteSeat =
    input.purpose === "claim"
      ? { role: INSTANCE_ORGANIZER_ROLE, eventId: null, orgId: organization.id }
      : seatOf(link, organization.id);
  // A conference-scoped invite is only meaningful against a conference that
  // still exists. If it was deleted between mint and exchange, the seat widens
  // to nothing rather than silently to the whole organization.
  if (seat.eventId !== null) {
    const event = await db
      .prepare("SELECT id FROM events WHERE id = ? AND org_id = ?")
      .bind(seat.eventId, organization.id)
      .first<{ id: string }>();
    if (!event) return null;
  }

  const membership = await upsertMembership(db, organization.id, person.id, seat, now);
  // Who got in, and through which door. The claim is the first fact this
  // instance has about itself, and an invite exchange is the only admin action
  // whose actor is the person it is about — so both are recorded against the
  // person's own record, where lens two will find them.
  await recordOrgActivity(db, {
    orgId: organization.id,
    actorKind: "user",
    actorPersonId: person.id,
    action:
      input.purpose === "claim"
        ? ORG_ACTIVITY_ACTIONS.instanceClaimed
        : ORG_ACTIVITY_ACTIONS.inviteClaimed,
    entityType: "person",
    entityId: person.id,
    after: { role: membership.role, email: person.email, name: person.name },
    now,
    requestId: input.requestId ?? null,
  });
  const session = await createSession(db, {
    personId: person.id,
    roleHint: seat.role,
    userAgent: input.userAgent,
    now,
  });
  return { organization, person, membership, session, redirectTo: link.redirect_to };
}

async function insertPerson(
  db: D1Database,
  orgId: Id,
  name: string,
  email: string,
  now: number,
): Promise<PersonRow> {
  const person: PersonRow = {
    id: newUlid(now),
    org_id: orgId,
    email,
    name,
    bio: null,
    company: null,
    company_id: null,
    custom_fields: "{}" as PersonRow["custom_fields"],
    do_not_contact: 0,
    headshot_attachment_id: null,
    is_demo: 0,
    kind: "human",
    last_write_source: "marquee",
    social_links: "{}" as PersonRow["social_links"],
    title: null,
    created_at: now,
    updated_at: now,
  };
  await db
    .prepare(
      `INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'marquee', '{}', ?, ?)`,
    )
    .bind(person.id, person.org_id, person.email, person.name, person.created_at, person.updated_at)
    .run();
  return person;
}

/**
 * The seat the exchange lands, org-wide or scoped to one conference.
 *
 * `uq_memberships_org` and `uq_memberships_event` both key on role, so the same
 * person may legitimately hold several seats; this only ever adds the one the
 * invite named, and returns the existing row when they already hold exactly it.
 */
async function upsertMembership(
  db: D1Database,
  orgId: Id,
  personId: Id,
  seat: InviteSeat,
  now: number,
): Promise<MembershipRow> {
  const existing = await db
    .prepare(
      seat.eventId === null
        ? "SELECT * FROM memberships WHERE org_id = ? AND person_id = ? AND role = ? AND event_id IS NULL"
        : "SELECT * FROM memberships WHERE org_id = ? AND person_id = ? AND role = ? AND event_id = ?",
    )
    .bind(...[orgId, personId, seat.role, ...(seat.eventId === null ? [] : [seat.eventId])])
    .first<MembershipRow>();
  if (existing) return existing;
  const membership: MembershipRow = {
    confirmation_status: "pending",
    confirmed_at: null,
    id: newUlid(now),
    org_id: orgId,
    event_id: seat.eventId,
    invited_at: null,
    person_id: personId,
    role: seat.role,
    created_at: now,
    updated_at: now,
  };
  await db
    .prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      membership.id,
      membership.org_id,
      membership.event_id,
      membership.person_id,
      membership.role,
      now,
      now,
    )
    .run();
  return membership;
}
