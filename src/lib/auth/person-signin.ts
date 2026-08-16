import type { EventRow, PersonRow } from "../../db/schema";

export type PersonSigninResolution =
  | { kind: "found"; person: PersonRow }
  | { kind: "missing" }
  | { kind: "ambiguous" };

interface SigninCandidate extends PersonRow {
  candidate_source: "primary" | "alias";
  alias_created_at: number | null;
  alias_id: string | null;
}

function normalizedAddress(email: string): string {
  return email.trim().toLowerCase();
}

async function candidatesForOrg(
  db: D1Database,
  orgId: string,
  email: string,
): Promise<SigninCandidate[]> {
  const rows = await db.prepare(
    `SELECT person.*, 'primary' AS candidate_source, NULL AS alias_created_at, NULL AS alias_id
       FROM people person
      WHERE person.org_id = ? AND lower(person.email) = ?
     UNION ALL
     SELECT person.*, 'alias' AS candidate_source, alias.created_at AS alias_created_at, alias.id AS alias_id
       FROM person_aliases alias
       JOIN people person ON person.id = alias.person_id AND person.org_id = alias.org_id
      WHERE alias.org_id = ? AND lower(alias.email) = ?
      ORDER BY candidate_source ASC, person.created_at ASC, person.id ASC, alias_created_at ASC, alias_id ASC`,
  ).bind(orgId, email, orgId, email).all<SigninCandidate>();
  return rows.results;
}

/**
 * Resolve the public sign-in door without turning an email into a tenant or
 * person oracle.  Context narrows the candidate set; it never grants access.
 * A candidate set is safe only when it collapses to one current person.
 */
export async function resolvePersonForSignin(
  db: D1Database,
  input: { email: string; eventId?: string; orgId?: string },
): Promise<PersonSigninResolution> {
  const email = normalizedAddress(input.email);
  if (!email) return { kind: "missing" };

  let orgId = input.orgId;
  if (input.eventId !== undefined) {
    const event = await db.prepare("SELECT id, org_id FROM events WHERE id = ?")
      .bind(input.eventId)
      .first<Pick<EventRow, "id" | "org_id">>();
    if (!event || (orgId !== undefined && orgId !== event.org_id)) return { kind: "missing" };
    orgId = event.org_id;
  }

  if (orgId !== undefined) {
    const candidates = await candidatesForOrg(db, orgId, email);
    // Primary beats alias only after the complete tenant-scoped candidate set
    // collapses to one current person. Ranking first would hide a legacy
    // primary/alias collision with a different person.
    const people = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    if (people.size !== 1) return people.size === 0 ? { kind: "missing" } : { kind: "ambiguous" };
    return { kind: "found", person: people.values().next().value as PersonRow };
  }

  const candidates = (await db.prepare(
    `SELECT person.*, 'primary' AS candidate_source, NULL AS alias_created_at, NULL AS alias_id
       FROM people person
      WHERE lower(person.email) = ?
     UNION ALL
     SELECT person.*, 'alias' AS candidate_source, alias.created_at AS alias_created_at, alias.id AS alias_id
       FROM person_aliases alias
       JOIN people person ON person.id = alias.person_id AND person.org_id = alias.org_id
      WHERE lower(alias.email) = ?
      ORDER BY candidate_source ASC, person.created_at ASC, person.id ASC, alias_created_at ASC, alias_id ASC, person.org_id ASC`,
  ).bind(email, email).all<SigninCandidate>()).results;
  const targets = new Map(candidates.map((candidate) => [candidate.org_id + ":" + candidate.id, candidate]));
  const orgs = new Set(candidates.map((candidate) => candidate.org_id));
  if (targets.size === 0) return { kind: "missing" };
  if (orgs.size !== 1 || targets.size !== 1) return { kind: "ambiguous" };
  return { kind: "found", person: targets.values().next().value as PersonRow };
}

export function normalizeSigninEmail(email: string): string {
  return normalizedAddress(email);
}
