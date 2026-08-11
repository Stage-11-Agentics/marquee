import type { Id } from "../../db/schema";

export const AUTH_TEMPLATE_KEYS = ["magic_link_login", "draft_resume", "task_link"] as const;
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
    now?: number;
  },
): Promise<Id> {
  const now = input.now ?? Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO outbox
        (id, event_id, template_key, person_id, to_email, subject, html, text,
         status, send_policy, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'demo_safe', ?, ?, ?)`,
    )
    .bind(
      id,
      input.eventId,
      input.templateKey,
      input.personId,
      input.toEmail,
      input.subject,
      input.html,
      input.text,
      `auth:${input.templateKey}:${id}`,
      now,
      now,
    )
    .run();
  return id;
}

export function renderMagicLinkLoginMail(link: string): { subject: string; text: string; html: string } {
  const subject = "Your Marquee sign-in link";
  const text = `Sign in to Marquee: ${link}\n\nThis link works once and expires in 15 minutes.`;
  const html = `<p><a href="${link}">Sign in to Marquee</a></p><p>This link works once and expires in 15 minutes.</p>`;
  return { subject, text, html };
}
