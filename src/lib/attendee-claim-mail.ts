/**
 * The one mail this feature sends.
 *
 * It carries the code and a one-use verification token — and deliberately not
 * the write key, which the verification hands back instead (see below). The
 * address it reaches can therefore open the schedule on any device and keep
 * editing it, which is the recovery gap R2-2 exists to close and the reason
 * this mail is worth sending at all rather than being a receipt.
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
 * The link carries the code and a one-use verification token, and deliberately
 * NOT the write key.
 *
 * The key would have to travel inside the composed mail body, and that body is
 * stored in `outbox` — a table the conference's own organizers can list. A
 * credential that opens an attendee's schedule must not be readable by the
 * people the claim is disclosing that attendee to. So the key waits on the
 * claim row instead and is handed to the browser that proves, by presenting
 * this token, that it can read the mailbox. What the attendee gets is
 * identical: open the link on a new device, and that device can edit.
 */
export function claimLinkUrl(input: {
  origin: string;
  eventSlug: string;
  code: string;
  token: string;
}): string {
  const base = input.origin.replace(/\/+$/, "");
  const query = new URLSearchParams({
    event: input.eventSlug,
    sched: input.code,
    claim: input.token,
  });
  return `${base}/agenda?${query.toString()}`;
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
    "Keep this link private — it opens your schedule for editing on whatever device you use it on.",
  ].join("\n");
  const html = [
    `<p>Here is your ${escapeHtml(input.eventName)} schedule — ${picks} so far.</p>`,
    `<p><a href="${escapeHtml(input.link)}">Open my schedule</a></p>`,
    "<p>Open it on any device and your picks come with you; star something new and this same link keeps up.</p>",
    `<p>Following the link also tells the ${escapeHtml(input.eventName)} organizers that you are coming, and lets them see which sessions you picked. That is the only thing it shares, there is no account, and you can undo it from the schedule page at any time.</p>`,
    "<p>Keep this link private — it opens your schedule for editing on whatever device you use it on.</p>",
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
