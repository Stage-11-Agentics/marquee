/**
 * Ending someone's access, as statements rather than as calls.
 *
 * Every arm here returns a prepared statement instead of running one, because
 * revocation is only true if it is atomic: access must not end in the
 * membership table and survive in the session table, however the request fails
 * after the first write. Callers collect the arms they need and hand the whole
 * set to `DB.batch()`, which D1 runs as a single transaction.
 *
 * Three arms, because there are exactly three ways back in:
 *
 *   1. a live session cookie          → `auth_sessions`
 *   2. a link already in their inbox  → `magic_links`, unused and unexpired
 *   3. a credential they minted       → `api_tokens` they created
 *
 * Revoking one and not the others is not a partial fix, it is no fix: a fired
 * volunteer holding an unexpired sign-in link walks straight back through door
 * two the moment door one closes.
 *
 * Note what these arms deliberately do NOT do: they take away credentials, not
 * history and not identity. Credentials in this product are person-scoped
 * rather than event-scoped — one person, one session, one inbox — so ending
 * someone's access at one conference does end their live session outright. That
 * is honest rather than over-broad: they may sign in again, and what they will
 * find is exactly the authority they still hold, which at the conference they
 * were removed from is none.
 */
import type { Id, MagicLinkPurpose } from "../../db/schema";

/** Every purpose whose token names a person, and therefore lets that person back in. */
export const PERSON_BOUND_LINK_PURPOSES: readonly MagicLinkPurpose[] = [
  "login",
  "draft_resume",
  "cospeaker_profile",
  "task_link",
];

/** Arm 1 — every live session for this person stops answering on the next request. */
export function revokeSessionsStatement(
  db: D1Database,
  personId: Id,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE person_id = ? AND revoked_at IS NULL",
    )
    .bind(now, now, personId);
}

/**
 * Arm 2 — the links already sent.
 *
 * Consumed rather than deleted: `used_at` is how this table says spent
 * everywhere else, and a deleted row would make an inert link indistinguishable
 * from a forged one at the door. Only unused, unexpired rows are touched, so
 * the statement is idempotent and never re-dates history.
 */
export function consumeLinksStatement(
  db: D1Database,
  personId: Id,
  now: number,
  purposes: readonly MagicLinkPurpose[] = PERSON_BOUND_LINK_PURPOSES,
): D1PreparedStatement {
  const placeholders = purposes.map(() => "?").join(", ");
  return db
    .prepare(
      `UPDATE magic_links SET used_at = ?, updated_at = ?
        WHERE person_id = ? AND used_at IS NULL AND expires_at > ?
          AND purpose IN (${placeholders})`,
    )
    .bind(now, now, personId, now, ...purposes);
}

/**
 * Arm 3 — the credentials they minted, and only the ones named.
 *
 * A fired volunteer knows the value of every token they created, but some of
 * those tokens power integrations the organization keeps running (ruling O3).
 * So this is show-and-choose rather than a sweep: the dialog lists their tokens
 * with revoke pre-checked, and the caller passes back exactly the ids the human
 * confirmed. An empty list is a legitimate answer and yields no statement — the
 * caller must not fabricate one, because a bare `created_by = ?` UPDATE is the
 * sweep this design refuses.
 *
 * `created_by` and `org_id` are both bound: a token id is supplied by the
 * client, and without the ownership predicates a well-formed request could
 * revoke any token on the instance.
 */
export function revokeCreatedTokensStatement(
  db: D1Database,
  input: { orgId: Id; personId: Id; tokenIds: readonly Id[]; now: number },
): D1PreparedStatement | null {
  if (input.tokenIds.length === 0) return null;
  const placeholders = input.tokenIds.map(() => "?").join(", ");
  return db
    .prepare(
      `UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
        WHERE org_id = ? AND created_by = ? AND revoked_at IS NULL
          AND id IN (${placeholders})`,
    )
    .bind(input.now, input.now, input.orgId, input.personId, ...input.tokenIds);
}

/**
 * All three arms at once, for the callers that end access outright.
 * `tokenIds` defaults to none: sweeping a person's tokens is a decision, and a
 * default that made it silently would be the wrong one.
 */
export function revokeAccessStatements(
  db: D1Database,
  input: {
    orgId: Id;
    personId: Id;
    now: number;
    tokenIds?: readonly Id[];
    purposes?: readonly MagicLinkPurpose[];
  },
): D1PreparedStatement[] {
  const statements = [
    revokeSessionsStatement(db, input.personId, input.now),
    consumeLinksStatement(db, input.personId, input.now, input.purposes),
  ];
  const tokens = revokeCreatedTokensStatement(db, {
    orgId: input.orgId,
    personId: input.personId,
    tokenIds: input.tokenIds ?? [],
    now: input.now,
  });
  if (tokens) statements.push(tokens);
  return statements;
}
