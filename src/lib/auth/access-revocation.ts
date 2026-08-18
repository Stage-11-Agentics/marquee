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

/** Event invitations are only consumed when the event-scoped seat is removed. */
export const CONFERENCE_BOUND_LINK_PURPOSES: readonly MagicLinkPurpose[] = [
  ...PERSON_BOUND_LINK_PURPOSES,
  "portal_invite",
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
  eventId?: Id,
): D1PreparedStatement {
  const placeholders = purposes.map(() => "?").join(", ");
  // `eventId` is the difference between ending someone's access to ONE
  // conference and ending it everywhere, and it is not optional detail: a
  // person is org-scoped, so the same human can be a speaker at this
  // conference and at the one next spring. Consuming every link they hold
  // because an organizer removed them from one event is precisely the
  // conference-to-conference bleed this product forbids — the one error that
  // cannot be undone.
  //
  // A link whose `event_id` is null belongs to no conference this query can
  // name (an org-level sign-in link, or a row minted before that column
  // existed), so a conference-scoped revocation leaves it alone. That is the
  // safe direction to be wrong in: the person keeps a credential that now
  // grants them nothing at the conference they were removed from, because the
  // authority behind it is gone.
  const scope = eventId === undefined ? "" : " AND event_id = ?";
  return db
    .prepare(
      `UPDATE magic_links SET used_at = ?, updated_at = ?
        WHERE person_id = ? AND used_at IS NULL AND expires_at > ?
          AND purpose IN (${placeholders})${scope}`,
    )
    .bind(now, now, personId, now, ...purposes, ...(eventId === undefined ? [] : [eventId]));
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
  input: { orgId: Id; personId: Id; keepTokenIds: readonly Id[]; now: number },
): D1PreparedStatement {
  // **Revoke is the default and keeping is the explicit act** (ruling O3: the
  // dialog lists their tokens with revoke pre-checked). The inverse — revoking
  // only ids a caller remembered to send — reads as safer and is not: the
  // product's own removal request carries no body at all, so every ordinary
  // removal revoked nothing, and a departed organizer kept a working bearer
  // secret they already knew by heart. A default that depends on the caller
  // remembering is not a default.
  //
  // This matters more than an unrevoked row suggests. An agent-evaluator
  // credential stores `created_by` = the human and `acts_as_person_id` = the
  // seat, and authority resolves through the SEAT's membership — which survives
  // the human's removal entirely. The token is the only thing that dies here,
  // so it has to actually die.
  const keep = input.keepTokenIds;
  const exclusion = keep.length === 0 ? "" : ` AND id NOT IN (${keep.map(() => "?").join(", ")})`;
  return db
    .prepare(
      `UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
        WHERE org_id = ? AND created_by = ? AND revoked_at IS NULL${exclusion}`,
    )
    .bind(input.now, input.now, input.orgId, input.personId, ...keep);
}

/**
 * The arms an org-wide revocation needs: session, links, and — only when the
 * caller asks for it — the credentials this person minted.
 *
 * There is deliberately no `eventId` here. A caller ending access to ONE
 * conference needs a different, narrower set, and giving one function both
 * shapes is how the narrow caller quietly gets the wide behaviour. See
 * `revokeConferenceAccessStatements`.
 */
export function revokeAccessStatements(
  db: D1Database,
  input: {
    orgId: Id;
    personId: Id;
    now: number;
    /** Present only for organizer removal, where credentials die with the seat. */
    keepTokenIds?: readonly Id[];
    revokeCreatedTokens?: boolean;
    purposes?: readonly MagicLinkPurpose[];
  },
): D1PreparedStatement[] {
  const statements = [
    revokeSessionsStatement(db, input.personId, input.now),
    consumeLinksStatement(db, input.personId, input.now, input.purposes),
  ];
  if (input.revokeCreatedTokens === true) {
    statements.push(
      revokeCreatedTokensStatement(db, {
        orgId: input.orgId,
        personId: input.personId,
        keepTokenIds: input.keepTokenIds ?? [],
        now: input.now,
      }),
    );
  }
  return statements;
}

/**
 * Ending access to ONE conference, and nothing beyond it.
 *
 * Two things are deliberately absent, and both absences are the point.
 *
 * **No session revocation.** `auth_sessions` has no event, so revoking one
 * would sign the person out of a conference this organizer has no authority
 * over. What this action removes is AUTHORITY — participations and the
 * conference-scoped seat — and once that is gone the surviving session grants
 * them exactly nothing here. A credential that opens a door to an empty room is
 * not an access leak.
 *
 * **No token revocation.** The credentials someone minted are organization
 * property; one conference's organizer does not get to end them.
 */
export function revokeConferenceAccessStatements(
  db: D1Database,
  input: { personId: Id; eventId: Id; now: number },
): D1PreparedStatement[] {
  return [consumeLinksStatement(db, input.personId, input.now, CONFERENCE_BOUND_LINK_PURPOSES, input.eventId)];
}
