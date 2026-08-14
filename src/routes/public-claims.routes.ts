/**
 * "Get it by email", as three endpoints.
 *
 * All three are anonymous in the sense that matters — no session, nothing to
 * log into — and all three are authorised by the write key the schedule's own
 * device holds. That is deliberate: attaching an address to a code, and
 * detaching it again, are things only the person editing that schedule should
 * be able to do, and the key is the only proof of that which exists. The key
 * also lets the server compose the sync link itself rather than being handed a
 * URL to put in a mail, which is the difference between a product feature and
 * an open mail relay.
 *
 * Verification is the exception: it is authorised by the token in the mail,
 * because proving you can read that mailbox is the entire point of the step.
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { clientIp } from "../api/rate-limit";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import {
  ATTENDEE_CLAIM_TEMPLATE_KEY,
  claimLinkUrl,
  claimMailEnabled,
  renderClaimMail,
} from "../lib/attendee-claim-mail";
import { enqueueOutbox } from "../jobs/mail/outbox";
import {
  CODE_PATTERN,
  hashWriteKey,
  loadScheduleView,
  readSchedule,
  timingSafeEqual,
} from "../lib/public-schedules";
import { publicTurnstileExempt } from "./public-form.shared";
import { verifyTurnstile } from "../lib/r2/turnstile";
import {
  UNLINK_CONFIRMATION,
  claimState,
  maskEmail,
  normalizeClaimEmail,
  readClaim,
  requestClaim,
  unlinkClaim,
  verifyClaim,
} from "../lib/schedule-claims";
import { speakingSessionIds } from "../lib/speaker-pins";

const WRITE_KEY_HEADER = "X-Schedule-Write-Key";

function turnstileSecret(context: { env: ApiEnv["Bindings"] }): string {
  return (context.env as unknown as { TURNSTILE_SECRET_KEY: string }).TURNSTILE_SECRET_KEY;
}
const codeParams = z.object({ code: z.string().regex(CODE_PATTERN) });

/**
 * Keyed on the SCHEDULE, not the address the request came from.
 *
 * A conference is one NAT — the star beacon reasons this through at length and
 * the same fact applies here with sharper teeth: ten claims an hour per IP is
 * ten claims an hour for an entire venue's wifi, which is not a rate limit, it
 * is an outage. `requireOwner` has already proved this caller holds one
 * specific code, and a code can only ever mail whatever address is attached to
 * it, so the code is the axis that actually bounds the damage: a resend loop
 * spams one mailbox, and the ceiling stops it.
 */
const CLAIM_LIMIT = 6;
/** A code has one mail out at a time; a caller who gets twenty tokens WRONG is not its owner. */
const VERIFY_LIMIT = 20;
const CLAIM_WINDOW_SECONDS = 3600;

async function checkClaimLimit(
  store: KVNamespace | undefined,
  code: string,
  now: number,
  limit: number = CLAIM_LIMIT,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (!store) return { allowed: true, retryAfterSeconds: 0 };
  const windowStart = Math.floor(now / (CLAIM_WINDOW_SECONDS * 1000)) * CLAIM_WINDOW_SECONDS * 1000;
  const key = `schedule-claim:${code}:${windowStart}`;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + CLAIM_WINDOW_SECONDS * 1000 - now) / 1000));
  const seen = await store.get(key, "json").catch(() => null);
  const count = typeof seen === "number" ? seen : 0;
  if (count >= limit) return { allowed: false, retryAfterSeconds };
  await store
    .put(key, JSON.stringify(count + 1), { expirationTtl: CLAIM_WINDOW_SECONDS * 2 })
    .catch(() => { /* an uncounted request beats a refused one */ });
  return { allowed: true, retryAfterSeconds };
}

function verifyFailureKey(code: string, now: number): string {
  const windowStart = Math.floor(now / (CLAIM_WINDOW_SECONDS * 1000)) * CLAIM_WINDOW_SECONDS * 1000;
  return `schedule-claim-verify-fail:${code}:${windowStart}`;
}

async function readClaimFailures(store: KVNamespace | undefined, code: string, now: number): Promise<number> {
  if (!store) return 0;
  const seen = await store.get(verifyFailureKey(code, now), "json").catch(() => null);
  return typeof seen === "number" ? seen : 0;
}

async function recordClaimFailure(store: KVNamespace | undefined, code: string, now: number): Promise<void> {
  if (!store) return;
  const key = verifyFailureKey(code, now);
  const seen = await store.get(key, "json").catch(() => null);
  const count = typeof seen === "number" ? seen : 0;
  await store
    .put(key, JSON.stringify(count + 1), { expirationTtl: CLAIM_WINDOW_SECONDS * 2 })
    .catch(() => { /* an uncounted miss beats a refused open */ });
}

/** The write key is the proof that this caller owns the code. */
async function requireOwner(
  database: D1Database,
  code: string,
  presented: string,
): Promise<NonNullable<Awaited<ReturnType<typeof readSchedule>>>> {
  const row = await readSchedule(database, code);
  if (!row) throw ApiError.notFound("schedule not found");
  if (!timingSafeEqual(await hashWriteKey(presented), row.write_key_hash)) {
    throw ApiError.forbidden("that write key does not open this schedule");
  }
  return row;
}

const claimResponse = z.any();

const requestScheduleClaim = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/schedules/{code}/claim",
    operationId: "requestScheduleClaim",
    summary: "Ask for this schedule's link by email",
    description:
      "Sends one mail carrying the sync link, and writes nothing else. The organizer's records are untouched until the emailed link is opened — typing an address is a request, not a claim. Requires the write key, so only the device that owns a schedule can attach an address to it.",
    tags: ["Public"],
    request: {
      params: codeParams,
      headers: z.object({ "x-schedule-write-key": z.string().min(1).max(200) }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              email: z.string().trim().email().max(320).optional()
                .describe("Omit to send again to the address already attached to this code — the address itself is never handed back, only a masked form of it."),
              turnstileToken: z.string().optional(),
              turnstile_token: z.string().optional(),
            }),
          },
        },
      },
    },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(claimResponse, "The claim as it now stands"),
      ...errorResponses([400, 403, 404, 409, 422, 429, 500]),
    },
  },
  async (context) => {
    const code = context.req.valid("param").code;
    const presentedKey = context.req.header(WRITE_KEY_HEADER) ?? "";
    const row = await requireOwner(context.env.DB, code, presentedKey);
    const body = context.req.valid("json");

    if (!claimMailEnabled(context.env)) {
      // Said plainly rather than queued into silence: a pending state that can
      // never resolve is a worse answer than "this is not switched on".
      throw ApiError.conflict(
        "Email links are not switched on for this conference yet. Your schedule is still saved on this device, and Open on your phone moves it across.",
      );
    }

    const limit = await checkClaimLimit(context.env.CACHE, code, Date.now());
    if (!limit.allowed) throw ApiError.rateLimited(limit.retryAfterSeconds);

    // The same exemption the public form takes, for the same reason: a demo
    // conference is driven by tests and walkthroughs that have no human to
    // solve a challenge, and gating it would make the demo the one place the
    // product cannot be seen working.
    if (!(await publicTurnstileExempt(context.env.DB, row.event_id))) {
      const turnstile = await verifyTurnstile({
        secretKey: turnstileSecret(context),
        token: body.turnstileToken ?? body.turnstile_token,
        remoteIp: context.req.header("cf-connecting-ip"),
      });
      if (!turnstile.ok) {
        throw ApiError.forbidden("Complete the security check, then choose Send again.");
      }
    }

    // "Email it to me again" must work without the page holding the address:
    // the owner is proved by the write key, and the row already knows where to
    // send. Displaying only a masked address is a deliberate choice, so the
    // page genuinely cannot supply the full one back.
    const existing = await readClaim(context.env.DB, code);
    const email = body.email ?? existing?.email;
    if (!email) {
      throw ApiError.unprocessable("this schedule has no email attached yet — send one to start", "email");
    }

    const now = Date.now();
    const requested = await requestClaim(context.env.DB, {
      code,
      eventId: row.event_id,
      email,
      // Held on the claim row, not put in the mail — see attendee-claim-mail.ts.
      // The owner presented it in this request; it is the same key, parked
      // where an organizer-readable table cannot reach it.
      writeKey: presentedKey,
      now,
    });
    if (!requested.ok) {
      throw ApiError.conflict(
        `This schedule is already linked to ${requested.maskedEmail}. Unlink it first to use a different address.`,
      );
    }

    const view = await loadScheduleView(context.env.DB, row);
    if (!view) throw ApiError.notFound("schedule not found");
    const mail = renderClaimMail({
      eventName: view.event.name,
      link: claimLinkUrl({
        origin: new URL(context.req.url).origin,
        eventSlug: view.event.slug,
        code,
        token: requested.token,
      }),
      sessionCount: view.sessions.length,
    });
    await enqueueOutbox({
      db: context.env.DB,
      eventId: row.event_id,
      templateKey: ATTENDEE_CLAIM_TEMPLATE_KEY,
      // A resend is a new request, so it gets a new identity and actually
      // sends — the idempotency key exists to stop double-submits, not to make
      // "email it to me again" a no-op.
      entityId: `${ATTENDEE_CLAIM_TEMPLATE_KEY}:${code}:${now}`,
      personId: null,
      toEmail: normalizeClaimEmail(email),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      now,
    });

    context.header("Cache-Control", "no-store");
    return context.json({ claim: claimState(requested.row) }, 200);
  },
);

const verifyScheduleClaim = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/public/schedules/{code}/claim/verify",
    operationId: "verifyScheduleClaim",
    summary: "Complete a claim by presenting the token from its mail",
    description:
      "The step that creates identity: the person is upserted by email into the organization's people record — matched, never duplicated — and an attendance row records that they are coming to this conference. Also returns the schedule's write key once, which is how the device reading the mail gains the ability to edit — the mail itself never carries it. Opening the same link twice answers with the same state.",
    tags: ["Public"],
    request: {
      params: codeParams,
      body: { content: { "application/json": { schema: z.object({ token: z.string().min(1).max(200) }) } } },
    },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(claimResponse, "The verified claim, with any sessions its owner is speaking at"),
      ...errorResponses([400, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const code = context.req.valid("param").code;
    // The only claim endpoint a caller reaches without proving they own the
    // code, so it is the only one where guessing a token is even a shape.
    //
    // Only FAILURES are counted, and that is the whole design. Keyed on the IP
    // this would be the venue NAT again — every attendee verifies from one
    // address. Keyed on the code and counting successes, it is the mirror
    // image: the code travels in a share link, so anyone holding one could burn
    // the budget and lock the real owner out of completing their own claim.
    // Counting only wrong tokens leaves a guesser bounded and an owner
    // untouched, however many times they open their mail.
    const spent = await readClaimFailures(context.env.CACHE, code, Date.now());
    if (spent >= VERIFY_LIMIT) throw ApiError.rateLimited(CLAIM_WINDOW_SECONDS);
    const outcome = await verifyClaim(context.env.DB, {
      code,
      token: context.req.valid("json").token,
      now: Date.now(),
    });
    if (!outcome.ok) {
      await recordClaimFailure(context.env.CACHE, code, Date.now());
      if (outcome.reason === "unknown") throw ApiError.notFound("schedule not found");
      throw ApiError.forbidden("that link has been replaced by a newer one — ask for it again from your schedule");
    }

    const row = await readSchedule(context.env.DB, code);
    const view = row ? await loadScheduleView(context.env.DB, row) : null;
    context.header("Cache-Control", "no-store");
    return context.json({
      claim: claimState(outcome.row),
      speakingSessionIds: view ? speakingSessionIds(view.allSessions, outcome.personId) : [],
      // The one moment this crosses the wire, to the one caller that proved it
      // can read the mailbox. Null when an earlier open already collected it.
      writeKey: outcome.writeKey,
      feedToken: outcome.feedToken,
    }, 200);
  },
);

const unlinkScheduleClaim = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/public/schedules/{code}/claim",
    operationId: "unlinkScheduleClaim",
    summary: "Remove the email attached to this schedule",
    description:
      "Removes the link between the address and the code, the attendance row that claim created, and the person record if — and only if — this claim is what created it and nothing else refers to it. People the organizer imported are never touched. The schedule itself keeps working.",
    tags: ["Public"],
    request: {
      params: codeParams,
      headers: z.object({ "x-schedule-write-key": z.string().min(1).max(200) }),
    },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(claimResponse, "What was removed"),
      ...errorResponses([400, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const code = context.req.valid("param").code;
    await requireOwner(context.env.DB, code, context.req.header(WRITE_KEY_HEADER) ?? "");
    const outcome = await unlinkClaim(context.env.DB, { code });
    context.header("Cache-Control", "no-store");
    return context.json({ ...outcome, message: UNLINK_CONFIRMATION }, 200);
  },
);

/** Exported for the tests that assert the copy an attendee actually reads. */
export { UNLINK_CONFIRMATION, maskEmail, readClaim };

export const apiRoutes = [requestScheduleClaim, verifyScheduleClaim, unlinkScheduleClaim];
