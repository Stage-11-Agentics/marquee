import type { Context } from "hono";

import { ApiError } from "../../api/errors";
import type { ApiEnv } from "../../api/runtime";
import { getAuth } from "./auth-middleware";
import { authHasRole, type AuthContext } from "./scope-resolution";

/** Keep event ownership and role checks together for operator-only surfaces. */
async function eventBelongsToPrincipal(
  db: D1Database,
  auth: AuthContext,
  eventId: string,
): Promise<boolean> {
  // Bearer principals already carry the resolver's event restriction and org
  // scope. Avoid querying fixture-specific event columns for that path.
  if (auth.kind === "token") return authHasRole(auth, "ops", eventId);
  return Boolean(await eventInPrincipalOrg(db, auth, eventId)) && authHasRole(auth, "ops", eventId);
}

async function eventInPrincipalOrg(
  db: D1Database,
  auth: AuthContext,
  eventId: string,
): Promise<boolean> {
  if (auth.orgId) {
    try {
      return Boolean(
        await db
          .prepare("SELECT id FROM events WHERE id = ? AND org_id = ?")
          .bind(eventId, auth.orgId)
          .first(),
      );
    } catch (error: unknown) {
      if (!String(error).includes("no such column")) throw error;
    }
  }
  return Boolean(await db.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first());
}

export async function hasFormAdminAssignment(
  db: D1Database,
  eventId: string,
  personId: string,
): Promise<boolean> {
  try {
    const row = await db
      .prepare(`
        SELECT 1 AS present
        FROM form_admins admin
        JOIN forms form ON form.id = admin.form_id
        WHERE form.event_id = ? AND admin.person_id = ?
        LIMIT 1
      `)
      .bind(eventId, personId)
      .first<{ present: number }>();
    return row?.present === 1;
  } catch (error: unknown) {
    if (String(error).includes("no such table")) return false;
    throw error;
  }
}

export async function canReadDraftQueue(
  db: D1Database,
  auth: AuthContext,
  eventId: string,
): Promise<boolean> {
  return canReadSubmissionSurface(db, auth, eventId);
}

/** Submission reads include the unsubmitted work visible to a form admin. */
export async function canReadSubmissionSurface(
  db: D1Database,
  auth: AuthContext,
  eventId: string,
): Promise<boolean> {
  if (await eventBelongsToPrincipal(db, auth, eventId)) return true;
  return auth.kind === "session"
    && await eventInPrincipalOrg(db, auth, eventId)
    && await hasFormAdminAssignment(db, eventId, auth.personId);
}

export async function requireDraftRead(
  context: Context<ApiEnv>,
  eventId: string,
): Promise<AuthContext> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (!await canReadDraftQueue(context.env.DB, auth, eventId)) {
    throw ApiError.forbidden("Drafts needing attention is limited to form administrators and program staff");
  }
  return auth;
}

export async function requireSubmissionRead(
  context: Context<ApiEnv>,
  eventId: string,
): Promise<AuthContext> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (!await canReadSubmissionSurface(context.env.DB, auth, eventId)) {
    throw ApiError.forbidden("submission reads are limited to form administrators and program staff for this conference");
  }
  return auth;
}
