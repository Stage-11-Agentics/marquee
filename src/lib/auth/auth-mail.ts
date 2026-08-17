import type { Id } from "../../db/schema";
import { IDEMPOTENCY_REGISTRY, type EntityId } from "../../jobs/mail/idempotency";
import { enqueueOutbox } from "../../jobs/mail/outbox";
import { escapeHtml } from "../../jobs/mail/render";

export const AUTH_TEMPLATE_KEYS = ["magic_link_login", "portal_invite", "draft_resume", "task_link"] as const;
export type AuthTemplateKey = (typeof AUTH_TEMPLATE_KEYS)[number];

/**
 * G3/A-3: auth mail enqueues an `outbox` row and nothing else. No module in
 * src/lib/auth or src/routes imports a mail provider; the queue consumer is
 * the only sender, in every mode. `send_policy` takes the schema default
 * `demo_safe` — only the two call sites named in SPEC §3.8 may write
 * `always_live`, and auth mail is not one of them.
 */
export async function enqueueAuthMail(
  db: D1Database,
  input: {
    eventId: Id;
    personId: Id;
    toEmail: string;
    templateKey: AuthTemplateKey;
    subject: string;
    text: string;
    html: string;
    entityId?: EntityId;
    now?: number;
  },
): Promise<Id> {
  const now = input.now ?? Date.now();
  const queued = await enqueueOutbox({
    db,
    eventId: input.eventId,
    templateKey: input.templateKey,
    entityId: input.entityId ?? IDEMPOTENCY_REGISTRY.authAttempt(input.templateKey, input.personId, now),
    personId: input.personId,
    toEmail: input.toEmail,
    subject: input.subject,
    html: input.html,
    text: input.text,
    now,
  });
  return queued.id;
}

export function renderMagicLinkLoginMail(link: string): { subject: string; text: string; html: string } {
  const subject = "Your Marquee sign-in link";
  const text = `Sign in to Marquee: ${link}\n\nThis link works once and expires in 15 minutes.`;
  const html = `<p><a href="${link}">Sign in to Marquee</a></p><p>This link works once and expires in 15 minutes.</p>`;
  return { subject, text, html };
}

/**
 * The mail the submitter's door sends.
 *
 * It is an ordinary `login` link, so it inherits the same one-use, 15-minute
 * terms as every other sign-in — but the words have to be about proposals
 * rather than about Marquee, because the person who asked for it did not think
 * of themselves as signing in to anything. They asked where their proposals
 * stand.
 */
export function renderProposalsLinkMail(input: { eventName: string; link: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Your ${input.eventName} proposals`;
  const text = `See every proposal you have sent to ${input.eventName}, and where each one stands: ${input.link}\n\nThis link works once and expires in 15 minutes. There is no password — ask for a new link any time.`;
  const html = `<p><a href="${input.link}">See every proposal you have sent to ${escapeHtml(input.eventName)}</a></p><p>This link works once and expires in 15 minutes. There is no password — ask for a new link any time.</p>`;
  return { subject, text, html };
}

export function renderPortalInviteMail(link: string): { subject: string; text: string; html: string } {
  const subject = "Your Marquee speaker portal invitation";
  const text = `Open your Marquee speaker portal: ${link}\n\nThis invitation is valid for 15 days and can be opened again during that window.`;
  const html = `<p><a href="${link}">Open your Marquee speaker portal</a></p><p>This invitation is valid for 15 days and can be opened again during that window.</p>`;
  return { subject, text, html };
}
