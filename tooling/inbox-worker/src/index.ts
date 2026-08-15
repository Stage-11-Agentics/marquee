import type { D1Database, ExportedHandler, ForwardableEmailMessage } from "@cloudflare/workers-types";

export interface InboxWorkerEnv {
  DB: D1Database;
}

export interface CapturedInboxMessage {
  id: string;
  received_at: string;
  from_email: string;
  to_email: string;
  subject: string | null;
  raw_rfc822: string;
}

interface CaptureOptions {
  id?: string;
  receivedAt?: string;
}

/**
 * Store the delivery envelope and the original RFC-822 bytes without trying
 * to become a mail parser. Parsing belongs in each oracle that needs it; the
 * inbox is deliberately a lossless, private observation point.
 */
export async function captureIncomingEmail(
  message: Pick<ForwardableEmailMessage, "from" | "to" | "headers" | "raw">,
  env: InboxWorkerEnv,
  options: CaptureOptions = {},
): Promise<CapturedInboxMessage> {
  const captured: CapturedInboxMessage = {
    id: options.id ?? crypto.randomUUID(),
    received_at: options.receivedAt ?? new Date().toISOString(),
    from_email: message.from,
    to_email: message.to,
    subject: message.headers.get("subject"),
    raw_rfc822: await new Response(message.raw).text(),
  };

  await env.DB
    .prepare(
      `INSERT INTO inbox_messages
        (id, received_at, from_email, to_email, subject, raw_rfc822)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      captured.id,
      captured.received_at,
      captured.from_email,
      captured.to_email,
      captured.subject,
      captured.raw_rfc822,
    )
    .run();

  return captured;
}

const handler = {
  async email(message: ForwardableEmailMessage, env: InboxWorkerEnv): Promise<void> {
    await captureIncomingEmail(message, env);
  },

  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<InboxWorkerEnv>;

export default handler;
