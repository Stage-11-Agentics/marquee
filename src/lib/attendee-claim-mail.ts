/**
 * The one mail this feature sends.
 *
 * It carries the sync link — the code plus the write key in the fragment — so
 * the address it reaches can open the schedule on any device and keep editing
 * it. That is the recovery gap R2-2 exists to close, and it is why the mail is
 * worth sending at all rather than being a receipt.
 *
 * It is also the verification. The link carries a claim token, and opening it
 * is what writes the person and the attendance row; until then the claim is a
 * request nobody has proved. So the copy has to be plain about both halves —
 * here is your link, and following it tells the organizers you are coming —
 * without turning into a consent form. Somebody typed their address into a
 * conference website; they are owed one clear paragraph, not a policy.
 */

export interface ClaimMailCopy {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The link is the sync URL with the claim token on it: `?…&claim=<token>#k=<key>`.
 * The key rides the fragment, which no browser sends to a server — it is in the
 * mail because the attendee needs it, not because anything on our side reads it.
 */
export function claimLinkUrl(input: {
  origin: string;
  eventSlug: string;
  code: string;
  writeKey: string;
  token: string;
}): string {
  const base = input.origin.replace(/\/+$/, "");
  const query = new URLSearchParams({
    event: input.eventSlug,
    sched: input.code,
    claim: input.token,
  });
  return `${base}/agenda?${query.toString()}#k=${input.writeKey}`;
}

export function renderClaimMail(input: {
  eventName: string;
  link: string;
  sessionCount: number;
}): ClaimMailCopy {
  const picks = input.sessionCount === 1 ? "1 session" : `${input.sessionCount} sessions`;
  const subject = `Your ${input.eventName} schedule`;
  const text = [
    `Here is your ${input.eventName} schedule — ${picks} so far.`,
    "",
    input.link,
    "",
    "Open it on any device and your picks come with you; star something new and this same link keeps up.",
    "",
    `Following the link also tells the ${input.eventName} organizers that you are coming, and lets them see which sessions you picked. That is the only thing it shares, there is no account, and you can undo it from the schedule page at any time.`,
    "",
    "Keep this link private — anyone who has it can edit your schedule.",
  ].join("\n");
  const html = [
    `<p>Here is your ${escapeHtml(input.eventName)} schedule — ${picks} so far.</p>`,
    `<p><a href="${escapeHtml(input.link)}">Open my schedule</a></p>`,
    "<p>Open it on any device and your picks come with you; star something new and this same link keeps up.</p>",
    `<p>Following the link also tells the ${escapeHtml(input.eventName)} organizers that you are coming, and lets them see which sessions you picked. That is the only thing it shares, there is no account, and you can undo it from the schedule page at any time.</p>`,
    "<p>Keep this link private — anyone who has it can edit your schedule.</p>",
  ].join("\n");
  return { subject, text, html };
}

export const ATTENDEE_CLAIM_TEMPLATE_KEY = "attendee_schedule_claim";

/**
 * Build ≠ enable (design §7, Constraints). Resend's free tier is 100 mails a
 * day and conference-week claim volume from one or two thousand attendees would
 * eat the speaker communications this product exists to run. So the send is
 * behind a var that ships "0": everything else in the claim flow is live, and
 * turning this on is a deliberate act taken next to a paid mail plan.
 *
 * When it is off the product says so rather than pretending — a claim row is
 * never written for a mail that will not arrive.
 */
export function claimMailEnabled(env: { ATTENDEE_CLAIM_MAIL?: string }): boolean {
  return env.ATTENDEE_CLAIM_MAIL === "1";
}
