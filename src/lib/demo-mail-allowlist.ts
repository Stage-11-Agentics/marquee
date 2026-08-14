import type { D1Database } from "@cloudflare/workers-types";

/**
 * The addresses a demo conference is allowed to send real email to.
 *
 * A conference in demo mode writes every `demo_safe` message to the outbox
 * instead of sending it, which is what lets a demo be driven hard without
 * mailing a thousand real submitters. This list is the exception: an address on
 * it genuinely receives mail, so the last step of a walkthrough — "and it
 * arrives" — can be shown rather than described.
 *
 * One key, one reader, one writer. The mail consumer, the reviewer-invite
 * honesty check and the screen that edits the list all resolve the same way,
 * including the unset case, which means "nobody receives real mail".
 */

export const DEMO_MAIL_ALLOWLIST_SETTING_KEY = "demo_safe_allowlist";

/**
 * How many addresses one conference may list. This is a demo affordance, not a
 * mailing list — a cap keeps a stray paste from turning suppression off for a
 * whole roster, and gives the screen a bound it can state out loud.
 */
export const DEMO_MAIL_ALLOWLIST_LIMIT = 10;

/**
 * Deliberately plainer than RFC 5322: one `@`, something either side, a dot in
 * the domain, no whitespace. It exists to catch the typo an operator makes
 * while a judge watches, not to adjudicate exotic addresses — and it is the
 * same predicate on both sides of the wire, so the browser never accepts an
 * address the server will refuse.
 */
const ALLOWLIST_EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function isAllowlistEmail(value: string): boolean {
  const candidate = value.trim();
  return candidate.length > 0 && candidate.length <= 254 && ALLOWLIST_EMAIL.test(candidate);
}

/** Addresses are matched case-insensitively, so they are stored the way they are compared. */
export function normalizeAllowlistEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * What a rejection is allowed to quote back.
 *
 * A rejected value is by definition not an address — it is whatever was pasted,
 * up to the 254 characters the schema permits. Echoing all of it whole puts an
 * unbounded string into a message that has to be read: in the API it bloats an
 * error field, and on screen it overruns the line reserved for it. An operator
 * needs enough to recognise what they typed, not all of it.
 */
export function describeRejectedEmail(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.length <= 48 ? trimmed : `${trimmed.slice(0, 47)}…`;
}

/**
 * Accepts both shapes this key has ever held — a bare array and `{ emails }` —
 * because a deployment seeded by hand is not a reason to start suppressing mail
 * an operator believed was allowed through.
 */
export function parseAllowlist(valueJson: string | null | undefined): string[] {
  if (!valueJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(valueJson);
  } catch {
    return [];
  }
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { emails?: unknown }).emails)
      ? (parsed as { emails: unknown[] }).emails
      : [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const email = normalizeAllowlistEmail(value);
    if (email.length === 0 || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

/** The addresses this conference will send real mail to, in the order they were saved. */
export async function demoMailAllowlistFor(db: D1Database, eventId: string): Promise<string[]> {
  const setting = await db
    .prepare("SELECT value_json FROM event_settings WHERE event_id = ? AND key = ?")
    .bind(eventId, DEMO_MAIL_ALLOWLIST_SETTING_KEY)
    .first<{ value_json: string }>();
  return parseAllowlist(setting?.value_json ?? null);
}

/**
 * Replaces the list wholesale. The screen edits a list, not a set of
 * independent rows, so a partial write is not a state anyone asked for.
 */
export async function writeDemoMailAllowlist(
  db: D1Database,
  eventId: string,
  emails: readonly string[],
  now: number,
): Promise<string[]> {
  const stored = parseAllowlist(JSON.stringify(emails));
  await db
    .prepare(
      `INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(`demo-mail-allowlist-${eventId}`, eventId, DEMO_MAIL_ALLOWLIST_SETTING_KEY, JSON.stringify(stored), now, now)
    .run();
  return stored;
}
