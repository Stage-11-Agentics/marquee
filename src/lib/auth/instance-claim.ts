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
  MembershipRow,
  OrganizationRow,
  PersonRow,
} from "../../db/schema";
import { createSession } from "./auth-sessions";
import { consumeMagicLink, mintMagicLink, readMagicLink } from "./magic-links";

/** The role a claim and an invite both land on: everyone who can run the instance. */
export const INSTANCE_ORGANIZER_ROLE = "owner" as const;

/** Where a freshly claimed instance sends its new owner. */
export const CLAIM_REDIRECT = "/dashboard";

export interface MintedInstanceLink {
  id: Id;
  /** Absolute URL, returned once. Never stored, never logged. */
  url: string;
  expires_at: number;
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
  input: { origin: string; now?: number },
): Promise<MintedInstanceLink> {
  const now = input.now ?? Date.now();
  const link = await mintMagicLink(db, {
    personId: null,
    purpose: "org_invite",
    redirectTo: CLAIM_REDIRECT,
    now,
  });
  const row = await db
    .prepare("SELECT expires_at FROM magic_links WHERE id = ?")
    .bind(link.id)
    .first<{ expires_at: number }>();
  return {
    id: link.id,
    url: absoluteLink(input.origin, `/join/${link.token}`),
    expires_at: row?.expires_at ?? now,
  };
}

export type InstanceLinkState =
  | { status: "live"; purpose: Extract<MagicLinkPurpose, "claim" | "org_invite"> }
  | { status: "inert" };

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
  return { status: "live", purpose: expectedPurpose };
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

  const organization = await resolveOrganization(db, now);
  const existingPerson = await db
    .prepare("SELECT * FROM people WHERE org_id = ? AND email = ?")
    .bind(organization.id, email)
    .first<PersonRow>();
  const person = existingPerson ?? (await insertPerson(db, organization.id, name, email, now));

  const membership = await upsertOrganizerMembership(db, organization.id, person.id, now);
  const session = await createSession(db, {
    personId: person.id,
    roleHint: INSTANCE_ORGANIZER_ROLE,
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

async function upsertOrganizerMembership(
  db: D1Database,
  orgId: Id,
  personId: Id,
  now: number,
): Promise<MembershipRow> {
  const existing = await db
    .prepare(
      "SELECT * FROM memberships WHERE org_id = ? AND person_id = ? AND event_id IS NULL AND role = ?",
    )
    .bind(orgId, personId, INSTANCE_ORGANIZER_ROLE)
    .first<MembershipRow>();
  if (existing) return existing;
  const membership: MembershipRow = {
    confirmation_status: "pending",
    confirmed_at: null,
    id: newUlid(now),
    org_id: orgId,
    event_id: null,
    invited_at: null,
    person_id: personId,
    role: INSTANCE_ORGANIZER_ROLE,
    created_at: now,
    updated_at: now,
  };
  await db
    .prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    )
    .bind(membership.id, membership.org_id, membership.person_id, membership.role, now, now)
    .run();
  return membership;
}
