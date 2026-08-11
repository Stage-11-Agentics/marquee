/**
 * What a failed send means, in the organizer's language.
 *
 * ## What this can and cannot see
 *
 * The mail provider answers a send with *accepted*, not *delivered*. Whether a
 * message actually reached a mailbox is reported later, asynchronously, over a
 * provider webhook Marquee does not yet receive. So `outbox.error` never holds a
 * bounce — it holds the reasons a message never left the building at all. This
 * module classifies those reasons, and only those.
 *
 * Two consequences the screens above this module have to honour:
 *
 *   1. Nothing here may say **delivered**. Past a successful send, delivery is
 *      genuinely unknown, and a screen that claims otherwise is lying to someone
 *      who is trying to find out whether a speaker was told.
 *   2. A hard bounce on a first send is invisible to this classifier — the row
 *      stays `sent` with no error at all. The one bounce it can see is a *repeat*
 *      send to an address the provider has since suppressed.
 *
 * ## Why scope is the distinction that earns its keep
 *
 * A spent daily allowance, a broken credential and a provider outage are
 * conference-level facts. Filing them under a speaker's name sends an organizer
 * to check an address that was never the problem — while the real cause, one
 * setting or one wait, goes unnamed. Only an `address` failure is that speaker's
 * to fix; a `conference` failure is one action for every row it touches.
 */

/** Whose problem this is. The organizer's next move follows entirely from it. */
export type SendFailureScope = "address" | "conference";

export type SendFailureClass =
  /** The daily send ceiling was already spent. */
  | "quota_exhausted"
  /** No usable credential — the mail account cannot send at all. */
  | "not_configured"
  /** The provider was unreachable or answered with a fault of its own. */
  | "provider_unavailable"
  /** The provider refused this particular address as malformed or unroutable. */
  | "address_rejected"
  /** The provider is refusing this address because it has hard-bounced before. */
  | "address_suppressed"
  /** Recognised as a failure, not recognised as a kind. Always honest about it. */
  | "unknown";

export interface SendFailure {
  class: SendFailureClass;
  scope: SendFailureScope;
  /** What happened, in one sentence an organizer can act on. */
  reason: string;
  /** The next move. For a conference-scope failure it opens by clearing the speaker. */
  what_to_do: string;
}

/**
 * Sentences are held here rather than at each call site so the ledger row, the
 * capability line and any later surface cannot drift apart on the same fact.
 *
 * Every conference-scope entry opens by saying the address is fine. That is the
 * whole point of classifying: the organizer who reads one of these must not go
 * hunting through a speaker's record for a fault that is not there.
 */
const FAILURES: Record<SendFailureClass, SendFailure> = {
  quota_exhausted: {
    class: "quota_exhausted",
    scope: "conference",
    reason: "Today's send allowance was already spent when this one went out.",
    what_to_do: "Nothing is wrong with this address. Send it again tomorrow, or split the wave across two days.",
  },
  not_configured: {
    class: "not_configured",
    scope: "conference",
    reason: "The mail account is not set up to send right now.",
    what_to_do: "Nothing is wrong with this address. Reach out to whoever hosts this conference for you — no mail is going out until this clears.",
  },
  provider_unavailable: {
    class: "provider_unavailable",
    scope: "conference",
    reason: "The mail service could not be reached.",
    what_to_do: "Nothing is wrong with this address. Send it again shortly — this kind of fault usually clears on its own.",
  },
  address_rejected: {
    class: "address_rejected",
    scope: "address",
    reason: "The mail service would not accept this address.",
    what_to_do: "Correct the address on this speaker's record, then send the decision again.",
  },
  address_suppressed: {
    class: "address_suppressed",
    scope: "address",
    reason: "This address has bounced before, so the mail service is now refusing it.",
    what_to_do: "This address will not get through as it stands. Get another one for this speaker, then send the decision again.",
  },
  unknown: {
    class: "unknown",
    scope: "address",
    reason: "The message did not go out.",
    what_to_do: "Check the address on the record and send the decision again. If it fails a second time, reach out to whoever hosts this conference for you.",
  },
};

/**
 * The consumer records its own failures in the same column as the provider's, so
 * the two vocabularies are classified together deliberately.
 */
const PATTERNS: ReadonlyArray<{ class: SendFailureClass; match: RegExp }> = [
  // Ours first: these are exact strings this codebase writes, so they cannot be
  // mistaken for provider prose that merely mentions the same words.
  { class: "not_configured", match: /RESEND_API_KEY is not configured|mail provider is unavailable/i },
  { class: "provider_unavailable", match: /mail provider returned no message id/i },

  { class: "not_configured", match: /\b(?:api[ _-]?key|unauthor[iz]s?ed|forbidden|not authorized|restricted key)\b/i },
  { class: "quota_exhausted", match: /\b(?:quota|daily limit|rate[ _-]?limit|too many requests|sending limit)\b/i },
  { class: "address_suppressed", match: /\bsuppress/i },
  // Both directions of the same sentence: the fault named before the address
  // ("Invalid `to` field") and the address named before the fault ("the address
  // was rejected"). Bounded by `[^.]` so the two halves have to share a clause.
  { class: "address_rejected", match: /\b(?:invalid|malformed|missing|no such|unknown)\b[^.]{0,60}\b(?:e-?mails?|addresse?s?|recipients?|`?to`?)\b/i },
  { class: "address_rejected", match: /\b(?:e-?mails?|addresse?s?|recipients?|`?to`?)\b[^.]{0,60}\b(?:invalid|malformed|not valid|rejected|refused|unroutable|not accepted|does not exist)\b/i },
  { class: "provider_unavailable", match: /\b(?:network|timed? ?out|timeout|unavailable|connection|socket|fetch failed|internal server error|bad gateway)\b/i },
];

/**
 * Statuses this codebase emits verbatim as `mail provider returned <status>`
 * when the provider gave no message of its own. Mapped before the prose
 * patterns, because a bare number carries no words to match on.
 */
function classFromStatus(status: number): SendFailureClass | null {
  if (status === 401 || status === 403) return "not_configured";
  if (status === 429) return "quota_exhausted";
  if (status === 422 || status === 400) return "address_rejected";
  if (status >= 500) return "provider_unavailable";
  return null;
}

/**
 * Classify one stored failure. Unrecognised text is `unknown` rather than
 * forced into the nearest bucket — a wrong confident sentence costs the
 * organizer more than an honest vague one.
 */
export function classifySendFailure(errorText: string | null | undefined): SendFailure {
  const text = (errorText ?? "").trim();
  if (text.length === 0) return FAILURES.unknown;

  const status = /\b([45]\d{2})\b/.exec(text);
  if (status) {
    const fromStatus = classFromStatus(Number(status[1]));
    if (fromStatus) return FAILURES[fromStatus];
  }

  for (const pattern of PATTERNS) {
    if (pattern.match.test(text)) return FAILURES[pattern.class];
  }
  return FAILURES.unknown;
}

/** The classification of a failure class without a stored string to read. */
export function sendFailure(failureClass: SendFailureClass): SendFailure {
  return FAILURES[failureClass];
}
