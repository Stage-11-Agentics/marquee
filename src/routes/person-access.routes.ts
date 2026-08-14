import type { Context } from "hono";
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { reconcileTaskSet } from "../jobs/cascade/decisions";
import { auditStatement } from "../lib/audit";
import { getAuth } from "../lib/auth/auth-middleware";
import { revokeAccessStatements, revokeConferenceAccessStatements } from "../lib/auth/access-revocation";
import { requireOrgAdmin } from "../lib/auth/org-admin";
import { errorFields } from "../lib/observability/log";

/**
 * Ending a person's relationship with one conference — and, separately, ending
 * their way in without touching the relationship at all (ruling O5).
 *
 * Speaker-side removal is three acts with three homes, and this module owns two
 * of them. The third — un-accepting a talk — already exists as the acceptance
 * reversal cascade and is deliberately not re-implemented here; a second code
 * path that cancels tasks is a second chance to cancel the wrong ones.
 *
 * The distinction the two routes below draw is the whole point:
 *
 *   - **Remove from this conference** ends AUTHORITY. Participations, tasks and
 *     conference-scoped seats go; the CRM row, the submissions, and every
 *     attributed action stay, because history is not a permission.
 *   - **Revoke portal access** ends CREDENTIALS only. Nothing about what they
 *     are to the conference changes — this is the misconduct case, where the
 *     talk may still be happening and the login must not be.
 *
 * What deliberately survives both, per ruling O5a: a published session stays
 * published and keeps its agenda slot. The speaker leaves its public listing
 * because the listing reads participations, which is the honest mechanism —
 * but nothing unpublishes, and nothing frees the slot. A session that vanished
 * from a live schedule because one speaker was removed would be a worse defect
 * than the one this route exists to fix, and the dialog is required to name
 * every published session it touches, loudly, before any of this runs.
 */

const eventParams = z.object({ eventId: z.string().min(1) });
const personParams = eventParams.extend({ personId: z.string().min(1) });
const orgPersonParams = z.object({ personId: z.string().min(1) });

const removalPreview = z.object({
  person_id: z.string(),
  name: z.string(),
  /** Every participation this conference holds for them, with its session. */
  participations: z.array(
    z.object({
      submission_id: z.string(),
      title: z.string(),
      role: z.string(),
      status: z.string(),
      /** True when the session is on the public site. Named loudly in the dialog. */
      published: z.boolean(),
      /** True when removing them leaves the session with no speaker at all. */
      sole_speaker: z.boolean(),
    }),
  ),
  open_tasks: z.number(),
  /** They hold an organizer seat here too — the dialog must say so (the seat trap, O3). */
  holds_organizer_seat: z.boolean(),
});

const removalResult = z.object({
  person_id: z.string(),
  ended_participations: z.number(),
  cancelled_tasks: z.number(),
  removed_memberships: z.number(),
  revoked_sessions: z.number(),
  consumed_links: z.number(),
  /** Sessions left published, named so the response is as honest as the dialog. */
  published_sessions_kept: z.array(z.string()),
});

const accessErrors = errorResponses([400, 401, 403, 404, 422, 429, 500]);

interface ParticipationRow {
  submission_id: string;
  title: string;
  role: string;
  status: string;
  /**
   * `submissions.is_published`, plus any published agenda item for the same
   * session. Both matter: the first is what puts a session on the public site,
   * the second is what gives it a slot on the printed schedule, and a removal
   * that quietly emptied either one would be the loud thing this preview exists
   * to say out loud.
   */
  is_published: number;
  speaker_count: number;
}

/**
 * What this conference holds for this person. Read before the dialog and again
 * before the commit, because a preview computed from stale data is how a human
 * confirms a blast radius that is not the one that happens.
 */
async function conferenceHoldings(
  db: D1Database,
  eventId: string,
  personId: string,
): Promise<ParticipationRow[]> {
  const rows = await db
    .prepare(
      `SELECT part.submission_id AS submission_id, s.title AS title, part.role AS role,
              s.status AS status,
              CASE WHEN s.is_published = 1 OR EXISTS (
                SELECT 1 FROM agenda_items item
                 WHERE item.submission_id = s.id AND item.kind = 'session' AND item.is_published = 1
              ) THEN 1 ELSE 0 END AS is_published,
              (SELECT COUNT(*) FROM participations other
                WHERE other.submission_id = s.id AND other.role IN ('speaker', 'co_speaker')
              ) AS speaker_count
         FROM participations part
         JOIN submissions s ON s.id = part.submission_id
        WHERE s.event_id = ? AND part.person_id = ?
        ORDER BY s.title ASC, part.role ASC`,
    )
    .bind(eventId, personId)
    .all<ParticipationRow>();
  return rows.results;
}

/** Published is the state that makes removal dangerous; the query above derives it. */
function isPublished(row: ParticipationRow): boolean {
  return Number(row.is_published) === 1;
}

async function requirePerson(db: D1Database, personId: string, orgId: string): Promise<{ id: string; name: string }> {
  const person = await db
    .prepare("SELECT id, name FROM people WHERE id = ? AND org_id = ?")
    .bind(personId, orgId)
    .first<{ id: string; name: string }>();
  if (!person) throw ApiError.notFound("person not found");
  return person;
}

async function eventOrg(db: D1Database, eventId: string): Promise<string> {
  const event = await db.prepare("SELECT org_id FROM events WHERE id = ?").bind(eventId).first<{ org_id: string }>();
  if (!event) throw ApiError.notFound("conference not found");
  return event.org_id;
}

/**
 * Who is doing this, resolved the same way the evaluation routes resolve it: a
 * bearer credential is attributed to the human who issued it, because "a token
 * removed this speaker" tells an organizer reading the history nothing they can
 * act on.
 */
async function actorOf(
  context: Context<ApiEnv>,
): Promise<{ kind: "user" | "api_token"; personId: string | null; requestId: string | null }> {
  const auth = getAuth(context);
  const requestId = (context.get("requestId") as string | undefined) ?? null;
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") return { kind: "user", personId: auth.personId, requestId };
  const token = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>();
  return { kind: "api_token", personId: token?.created_by ?? null, requestId };
}

const previewConferenceRemoval = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/people/{personId}/removal-preview",
    operationId: "previewConferenceRemoval",
    summary: "Everything removing this person from the conference would touch",
    description:
      "Read this before showing the confirmation. It names every participation, flags each published session, and calls out any session where this person is the only speaker — which removal would leave speakerless on the public site.",
    tags: ["Speakers"],
    request: { params: personParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: removalPreview }), "What removal touches"), ...accessErrors },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    const orgId = await eventOrg(context.env.DB, eventId);
    const person = await requirePerson(context.env.DB, personId, orgId);
    const holdings = await conferenceHoldings(context.env.DB, eventId, personId);
    const openTasks = await context.env.DB.prepare(
      "SELECT COUNT(*) AS total FROM speaker_tasks WHERE event_id = ? AND person_id = ? AND status = 'open' AND cancelled_at IS NULL",
    )
      .bind(eventId, personId)
      .first<{ total: number }>();
    const seat = await context.env.DB.prepare(
      "SELECT 1 AS present FROM memberships WHERE org_id = ? AND person_id = ? AND role != 'speaker' LIMIT 1",
    )
      .bind(orgId, personId)
      .first<{ present: number }>();
    return context.json(
      {
        data: {
          person_id: person.id,
          name: person.name,
          participations: holdings.map((row) => ({
            submission_id: row.submission_id,
            title: row.title,
            role: row.role,
            status: row.status,
            published: isPublished(row),
            sole_speaker: Number(row.speaker_count) <= 1,
          })),
          open_tasks: Number(openTasks?.total ?? 0),
          holds_organizer_seat: seat !== null,
        },
      },
      200,
    );
  },
);

const removeFromConference = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/people/{personId}/remove",
    operationId: "removePersonFromConference",
    summary: "End this person's participation in this conference",
    description:
      "Ends every participation they hold here across all roles and sessions, cancels their open tasks through the same cancellation machinery as an acceptance reversal, drops any conference-scoped seat, and revokes their access credentials. Their CRM record, their submissions, and every attributed action survive untouched, as do all their participations at other conferences. Published sessions stay published and keep their agenda slot; the speaker simply leaves the public listing.",
    tags: ["Speakers"],
    request: { params: personParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: removalResult }), "Removed"), ...accessErrors },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    const orgId = await eventOrg(context.env.DB, eventId);
    const person = await requirePerson(context.env.DB, personId, orgId);
    const holdings = await conferenceHoldings(context.env.DB, eventId, personId);
    const now = Date.now();
    const actor = await actorOf(context);
    const submissionIds = [...new Set(holdings.map((row) => row.submission_id))];

    // One transaction. Authority, work, and every credential end together:
    // a request that failed between the participation delete and the task
    // cancellation would leave a removed speaker still being chased, which is
    // the exact cruelty this action exists to prevent.
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `DELETE FROM participations
          WHERE person_id = ?
            AND submission_id IN (SELECT id FROM submissions WHERE event_id = ?)`,
      ).bind(personId, eventId),
      // The same `cancelled_at` machinery as the reversal cascade, scoped to
      // this person rather than to a submission: finished work stays finished,
      // and a cancelled task is never deleted.
      context.env.DB.prepare(
        `UPDATE speaker_tasks
            SET cancelled_at = ?, updated_at = ?, last_write_source = 'marquee'
          WHERE event_id = ? AND person_id = ? AND status = 'open' AND cancelled_at IS NULL`,
      ).bind(now, now, eventId, personId),
      // Only the seat scoped to THIS conference. An org-wide organizer seat is
      // not this conference's to take away — that is the O3 removal flow, and
      // conflating them would let a program lead fire an owner sideways.
      context.env.DB.prepare(
        "DELETE FROM memberships WHERE org_id = ? AND person_id = ? AND event_id = ?",
      ).bind(orgId, personId, eventId),
      ...revokeConferenceAccessStatements(context.env.DB, { personId, eventId, now }),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "person_removed_from_conference",
        entityType: "person",
        entityId: personId,
        before: {
          participations: holdings.map((row) => ({ submission_id: row.submission_id, role: row.role })),
        },
        now,
        requestId: actor.requestId,
      }),
    ]);

    // After the participations are gone, so the reconciler sees the truth: it
    // derives its task set from participations, so a person with none is no
    // longer a candidate and nothing it does can resurrect what was just
    // cancelled. Idempotent by contract (AC-266), and this is the same function
    // acceptance and re-acceptance traverse — not a parallel one. It cannot join
    // the D1 batch, so a failure here is a best-effort tail: the authoritative
    // removal already committed, and reporting a 500 would lie about that fact.
    try {
      if (submissionIds.length > 0) {
        await reconcileTaskSet(
          context.env.DB,
          eventId,
          submissionIds,
          now,
          // The reconciler's actor names a person; a credential whose issuer we
          // could not resolve is honestly nobody, and it takes the undefined
          // rather than a fabricated id.
          actor.personId === null
            ? undefined
            : { kind: actor.kind, personId: actor.personId, requestId: actor.requestId },
        );
      }
    } catch (error) {
      context.get("logger")?.emit("worker_error", "warn", {
        source: "removePersonFromConference.reconcileTaskSet",
        ...errorFields(error),
      });
    }

    const changes = results.map((result) => Number(result.meta?.changes ?? 0));
    return context.json(
      {
        data: {
          person_id: person.id,
          ended_participations: changes[0] ?? 0,
          cancelled_tasks: changes[1] ?? 0,
          removed_memberships: changes[2] ?? 0,
          // Conference removal deliberately does not revoke the person's
          // person-scoped session. It only consumes the links bound to this
          // event, so the result names that absence rather than borrowing the
          // org-wide helper's positional indexes.
          revoked_sessions: 0,
          consumed_links: changes[3] ?? 0,
          published_sessions_kept: holdings.filter((row) => isPublished(row)).map((row) => row.title),
        },
      },
      200,
    );
  },
);

const revokePortalAccess = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/people/{personId}/revoke-access",
    operationId: "revokePersonPortalAccess",
    summary: "End this person's way in, and nothing else",
    description:
      "Revokes their live sessions and consumes every unexpired link already sent to them — sign-in, task, co-speaker, and draft-resume alike. Participations, tasks, submissions, memberships, and history are untouched: this is the misconduct case, where the talk may still be happening and the login must not be.",
    tags: ["Organization"],
    request: { params: orgPersonParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(
        z.object({
          data: z.object({
            person_id: z.string(),
            revoked_sessions: z.number(),
            consumed_links: z.number(),
          }),
        }),
        "Access revoked",
      ),
      ...accessErrors,
    },
  },
  async (context) => {
    // Org-wide authority: this route has no `{eventId}` for the grant pipeline
    // to resolve against, and killing someone's credentials is not a
    // conference-scoped act — the credentials are not conference-scoped either.
    const auth = requireOrgAdmin(context);
    const { personId } = context.req.valid("param");
    const person = await requirePerson(context.env.DB, personId, auth.orgId);
    const now = Date.now();
    const results = await context.env.DB.batch(
      revokeAccessStatements(context.env.DB, { orgId: auth.orgId, personId, now }),
    );
    const changes = results.map((result) => Number(result.meta?.changes ?? 0));
    return context.json(
      {
        data: {
          person_id: person.id,
          revoked_sessions: changes[0] ?? 0,
          consumed_links: changes[1] ?? 0,
        },
      },
      200,
    );
  },
);

export const apiRoutes = [previewConferenceRemoval, removeFromConference, revokePortalAccess];
